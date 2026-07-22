/**
 * Redis 客户端抽象层
 * ---------------------------------------------------------------------------
 * 默认（未设置 REDIS_URL / 空 / "off" / "memory"）：
 *   使用进程内 memory 实现（pub/sub + KV + 简化 Stream）。
 *   单实例 NAS / 本地 dev 无需再起 Redis。
 *
 * 显式设置 REDIS_URL=redis://...：
 *   走 ioredis，支持多实例广播与跨进程任务队列。
 *
 * 兼容的调用面（见仓库内引用）：
 *   publish / get / setex / xadd / xgroup / xreadgroup / xack
 *   createSubClient(): subscribe + on("message") + disconnect + status
 */
import { EventEmitter } from "events";
import Redis from "ioredis";

// ---------- 模式判定 ----------

function resolveRedisUrl(): string | null {
  const raw = (process.env.REDIS_URL || "").trim();
  if (!raw || raw === "off" || raw === "memory" || raw === "none" || raw === "disabled") {
    return null;
  }
  return raw;
}

const REDIS_URL = resolveRedisUrl();
export const isRedisMemoryMode = !REDIS_URL;

// ---------- Memory 实现 ----------

type MessageHandler = (channel: string, message: string) => void;

/** 进程内 pub/sub 总线（主客户端 publish → 所有 sub 客户端收） */
const memoryBus = new EventEmitter();
// 避免 AI 任务完成频道无订阅者时的 MaxListeners 警告
memoryBus.setMaxListeners(200);

interface CacheEntry {
  value: string;
  expiresAt: number | null;
}

const memoryCache = new Map<string, CacheEntry>();

interface StreamEntry {
  id: string;
  fields: string[]; // flat [field, value, field, value, ...] 与 ioredis 一致
}

interface StreamState {
  entries: StreamEntry[];
  /** 单调递增序列，用于生成 id */
  seq: number;
  /** groupName → 已确认到的 index（下一条未读的 entries 下标） */
  groupCursors: Map<string, number>;
  waiters: Array<{
    resolve: (v: any) => void;
    count: number;
    group: string;
    consumer: string;
    timer: NodeJS.Timeout;
  }>;
}

const memoryStreams = new Map<string, StreamState>();

function getOrCreateStream(name: string): StreamState {
  let s = memoryStreams.get(name);
  if (!s) {
    s = { entries: [], seq: 0, groupCursors: new Map(), waiters: [] };
    memoryStreams.set(name, s);
  }
  return s;
}

function memoryGet(key: string): string | null {
  const e = memoryCache.get(key);
  if (!e) return null;
  if (e.expiresAt != null && Date.now() > e.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return e.value;
}

function memorySetex(key: string, seconds: number, value: string): "OK" {
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + seconds * 1000,
  });
  return "OK";
}

function memoryPublish(channel: string, message: string): number {
  memoryBus.emit("message", channel, message);
  // 返回订阅者数量（memory 下无法精确统计，返回 1 表示已投递）
  return memoryBus.listenerCount("message") > 0 ? 1 : 0;
}

function memoryXadd(stream: string, _id: string, ...fieldValues: string[]): string {
  const s = getOrCreateStream(stream);
  s.seq += 1;
  const entryId = `${Date.now()}-${s.seq}`;
  s.entries.push({ id: entryId, fields: fieldValues });

  // 唤醒阻塞的 xreadgroup waiter
  const stillWaiting: typeof s.waiters = [];
  for (const w of s.waiters) {
    const cursor = s.groupCursors.get(w.group) ?? 0;
    if (cursor < s.entries.length) {
      const batch = s.entries.slice(cursor, cursor + w.count);
      s.groupCursors.set(w.group, cursor + batch.length);
      clearTimeout(w.timer);
      // ioredis 返回: [[streamName, [[id, fields], ...]]]
      w.resolve([[stream, batch.map((e) => [e.id, e.fields])]]);
    } else {
      stillWaiting.push(w);
    }
  }
  s.waiters = stillWaiting;

  return entryId;
}

function memoryXgroup(cmd: string, stream: string, group: string, _id?: string, _mk?: string): string {
  if (String(cmd).toUpperCase() !== "CREATE") {
    throw new Error(`[redis-memory] unsupported xgroup cmd: ${cmd}`);
  }
  const s = getOrCreateStream(stream);
  if (!s.groupCursors.has(group)) {
    // 从 "0" 起读历史；AI worker 用 ">" 只读新消息，cursor 设为当前长度即可
    s.groupCursors.set(group, s.entries.length);
  }
  return "OK";
}

/**
 * 解析 ioredis 风格变参：
 *   xreadgroup("GROUP", group, consumer, "COUNT", "1", "BLOCK", "2000", "STREAMS", stream, ">")
 */
async function memoryXreadgroup(...args: any[]): Promise<any> {
  // 找 GROUP / COUNT / BLOCK / STREAMS 位置
  let group = "";
  let consumer = "";
  let count = 1;
  let blockMs = 0;
  let stream = "";

  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]).toUpperCase();
    if (a === "GROUP") {
      group = String(args[i + 1] ?? "");
      consumer = String(args[i + 2] ?? "");
      i += 2;
    } else if (a === "COUNT") {
      count = parseInt(String(args[i + 1] ?? "1"), 10) || 1;
      i += 1;
    } else if (a === "BLOCK") {
      blockMs = parseInt(String(args[i + 1] ?? "0"), 10) || 0;
      i += 1;
    } else if (a === "STREAMS") {
      stream = String(args[i + 1] ?? "");
      // args[i+2] 是 ">" 或 id，memory 下只支持新消息
      i += 2;
    }
  }

  if (!stream || !group) return null;

  const s = getOrCreateStream(stream);
  if (!s.groupCursors.has(group)) {
    s.groupCursors.set(group, s.entries.length);
  }

  const tryRead = (): any => {
    const cursor = s.groupCursors.get(group) ?? 0;
    if (cursor >= s.entries.length) return null;
    const batch = s.entries.slice(cursor, cursor + count);
    s.groupCursors.set(group, cursor + batch.length);
    return [[stream, batch.map((e) => [e.id, e.fields])]];
  };

  const immediate = tryRead();
  if (immediate) return immediate;
  if (blockMs <= 0) return null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.waiters = s.waiters.filter((w) => w.resolve !== resolve);
      resolve(null);
    }, blockMs);
    s.waiters.push({ resolve, count, group, consumer, timer });
  });
}

function memoryXack(_stream: string, _group: string, _id: string): number {
  // memory 简化：xreadgroup 已推进 cursor，ack 仅作 no-op 成功
  return 1;
}

class MemoryRedisClient {
  status: string = "ready";

  async get(key: string): Promise<string | null> {
    return memoryGet(key);
  }

  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    return memorySetex(key, seconds, value);
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (memoryCache.delete(k)) n++;
    }
    return n;
  }

  async publish(channel: string, message: string): Promise<number> {
    return memoryPublish(channel, message);
  }

  async xadd(stream: string, id: string, ...fieldValues: string[]): Promise<string> {
    return memoryXadd(stream, id, ...fieldValues);
  }

  async xgroup(...args: any[]): Promise<string> {
    return memoryXgroup(args[0], args[1], args[2], args[3], args[4]);
  }

  async xreadgroup(...args: any[]): Promise<any> {
    return memoryXreadgroup(...args);
  }

  async xack(stream: string, group: string, id: string): Promise<number> {
    return memoryXack(stream, group, id);
  }

  // sub-client 兼容（主客户端一般不用）
  async subscribe(_channel: string): Promise<void> {
    /* no-op on main */
  }

  on(_event: string, _handler: (...args: any[]) => void): this {
    return this;
  }

  disconnect(): void {
    this.status = "end";
  }
}

class MemorySubClient extends EventEmitter {
  status: string = "ready";
  private channels = new Set<string>();
  private busHandler: MessageHandler;

  constructor() {
    super();
    this.busHandler = (channel: string, message: string) => {
      if (this.channels.has(channel) && this.status !== "end") {
        this.emit("message", channel, message);
      }
    };
    memoryBus.on("message", this.busHandler);
  }

  async subscribe(...channels: string[]): Promise<void> {
    for (const ch of channels) this.channels.add(ch);
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    if (channels.length === 0) {
      this.channels.clear();
    } else {
      for (const ch of channels) this.channels.delete(ch);
    }
  }

  disconnect(): void {
    this.status = "end";
    memoryBus.off("message", this.busHandler);
    this.removeAllListeners();
  }
}

// ---------- 导出 ----------

export type RedisLike = MemoryRedisClient | Redis;
export type SubClientLike = MemorySubClient | Redis;

let redis: RedisLike;
let createSubClient: () => SubClientLike;

if (isRedisMemoryMode) {
  console.log("[redis] mode=memory (set REDIS_URL=redis://... for multi-instance)");
  redis = new MemoryRedisClient();
  createSubClient = () => new MemorySubClient();
} else {
  console.log(`[redis] mode=ioredis url=${REDIS_URL!.replace(/\/\/.*@/, "//***@")}`);
  const client = new Redis(REDIS_URL!, {
    maxRetriesPerRequest: null,
    showFriendlyErrorStack: true,
  });
  client.on("connect", () => {
    console.log("📍 Redis connected successfully!");
  });
  client.on("error", (err) => {
    console.error("❌ Redis connection error:", err);
  });
  redis = client;
  createSubClient = () =>
    new Redis(REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
}

export { redis, createSubClient };
