/**
 * mediaFileCache — 视频/音频库本地文件缓存（IndexedDB）
 * =========================================================================
 * 独立于笔记 localStore，避免大体积媒体拖垮主库升级。
 * 按 serverScope + userId 隔离；失败 warn 不抛，最坏退化为在线播放。
 */

import { openDB, type IDBPDatabase, type DBSchema } from "idb";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MediaCacheType = "video" | "audio";

/** 列表/管理页用的元数据（不含 blob） */
export interface MediaCacheMeta {
  mediaId: string;
  type: MediaCacheType;
  title: string;
  mimeType?: string;
  size: number;
  alistPath?: string;
  cachedAt: number;
}

export interface MediaCacheRecord extends MediaCacheMeta {
  blob: Blob;
}

export interface MediaCacheStats {
  count: number;
  totalBytes: number;
}

interface MediaCacheSchema extends DBSchema {
  mediaFiles: {
    key: string;
    value: MediaCacheRecord;
    indexes: {
      "by-type": string;
      "by-cachedAt": number;
    };
  };
}

// ─── Identity / connection ────────────────────────────────────────────────────

const DB_NAME_PREFIX = "super-media-cache-v1-";
const DB_VERSION = 1;

let currentUserId: string | null = null;
let currentCacheIdentity: string | null = null;
let dbPromise: Promise<IDBPDatabase<MediaCacheSchema>> | null = null;

function normalizeDbPart(value: string): string {
  return (value || "unknown").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
  } catch {
    return false;
  }
}

function getServerScope(): string {
  let server = "";
  try {
    server = localStorage.getItem("super-server-url") || "";
  } catch {
    /* ignore */
  }
  const origin =
    typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? window.location.origin
      : "";
  const isDesktop = typeof window !== "undefined" && !!(window as any).superDesktop?.isDesktop;

  if (
    isDesktop &&
    ((server && isLoopbackUrl(server)) || (!server && origin && isLoopbackUrl(origin)))
  ) {
    return "local-desktop";
  }
  if (server) return normalizeUrl(server);
  if (origin) return normalizeUrl(origin);
  return "same-origin";
}

function getCacheIdentity(userId: string): string {
  return `${normalizeDbPart(getServerScope())}-${normalizeDbPart(userId)}`;
}

function getDbName(cacheIdentity: string): string {
  return `${DB_NAME_PREFIX}${cacheIdentity}`;
}

/** 登录/切换账号时绑定；登出传 null（不删库） */
export function setMediaCacheUser(userId: string | null): void {
  const nextIdentity = userId ? getCacheIdentity(userId) : null;
  if (currentUserId === userId && currentCacheIdentity === nextIdentity) return;

  // 切换库时释放 blob URL
  revokeAllObjectUrls();

  if (dbPromise) {
    dbPromise
      .then((db) => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* ignore */
      });
    dbPromise = null;
  }
  currentUserId = userId;
  currentCacheIdentity = nextIdentity;
  // 清空 has-set 缓存
  cachedIdSet = null;
  notifyListeners();
}

export function isMediaCacheReady(): boolean {
  return !!currentCacheIdentity;
}

function getDb(): Promise<IDBPDatabase<MediaCacheSchema>> | null {
  if (!currentCacheIdentity) return null;
  if (!dbPromise) {
    dbPromise = openDB<MediaCacheSchema>(getDbName(currentCacheIdentity), DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("mediaFiles")) {
          const s = db.createObjectStore("mediaFiles", { keyPath: "mediaId" });
          s.createIndex("by-type", "type");
          s.createIndex("by-cachedAt", "cachedAt");
        }
      },
      blocked() {
        console.warn("[mediaFileCache] db blocked by another tab/version");
      },
      blocking() {
        console.warn("[mediaFileCache] db blocking newer version, will close");
      },
    }).catch((e) => {
      console.warn("[mediaFileCache] openDB failed:", e);
      throw e;
    });
  }
  return dbPromise;
}

async function safe<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[mediaFileCache] ${label} failed:`, e);
    return fallback;
  }
}

// ─── Change listeners (for UI badges) ─────────────────────────────────────────

const listeners = new Set<() => void>();
/** 已缓存 id 的内存快照（list 后刷新） */
let cachedIdSet: Set<string> | null = null;
/** 单调版本，供 useSyncExternalStore 检测变更 */
let cacheVersion = 0;

function notifyListeners() {
  cacheVersion += 1;
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function subscribeMediaCache(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getMediaCacheVersion(): number {
  return cacheVersion;
}

/** 同步读内存中的「已缓存」集合（可能尚未 hydrate） */
export function getCachedMediaIdSet(): Set<string> {
  return cachedIdSet ?? new Set();
}

/** 从 IDB 刷新 id 集合并通知订阅者 */
export async function refreshCachedMediaIdSet(): Promise<Set<string>> {
  const rows = await listMediaCacheMeta();
  cachedIdSet = new Set(rows.map((r) => r.mediaId));
  notifyListeners();
  return cachedIdSet;
}

// ─── Blob URL registry ────────────────────────────────────────────────────────

const objectUrls = new Map<string, { url: string; refs: number }>();

function revokeAllObjectUrls() {
  for (const [, entry] of objectUrls) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch {
      /* ignore */
    }
  }
  objectUrls.clear();
}

/**
 * 取得本地播放 URL。命中则 createObjectURL 并 +1 ref。
 * 播放结束/切歌时务必 releaseLocalPlayUrl。
 */
export async function acquireLocalPlayUrl(mediaId: string): Promise<string | null> {
  if (!mediaId) return null;
  const existing = objectUrls.get(mediaId);
  if (existing) {
    existing.refs += 1;
    return existing.url;
  }
  const blob = await getMediaFileBlob(mediaId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  objectUrls.set(mediaId, { url, refs: 1 });
  return url;
}

export function releaseLocalPlayUrl(mediaId: string): void {
  const entry = objectUrls.get(mediaId);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch {
      /* ignore */
    }
    objectUrls.delete(mediaId);
  }
}

/** 仅探测是否已缓存（不读 blob） */
export async function hasMediaFile(mediaId: string): Promise<boolean> {
  if (!mediaId) return false;
  if (cachedIdSet?.has(mediaId)) return true;
  const p = getDb();
  if (!p) return false;
  return safe(async () => {
    const db = await p;
    const key = await db.getKey("mediaFiles", mediaId);
    return key != null;
  }, false, "hasMediaFile");
}

export async function getMediaFileMeta(mediaId: string): Promise<MediaCacheMeta | undefined> {
  if (!mediaId) return undefined;
  const p = getDb();
  if (!p) return undefined;
  return safe(async () => {
    const db = await p;
    const row = await db.get("mediaFiles", mediaId);
    if (!row) return undefined;
    const { blob: _b, ...meta } = row;
    return meta;
  }, undefined, "getMediaFileMeta");
}

export async function getMediaFileBlob(mediaId: string): Promise<Blob | undefined> {
  if (!mediaId) return undefined;
  const p = getDb();
  if (!p) return undefined;
  return safe(async () => {
    const db = await p;
    const row = await db.get("mediaFiles", mediaId);
    return row?.blob;
  }, undefined, "getMediaFileBlob");
}

export async function putMediaFile(
  record: Omit<MediaCacheRecord, "cachedAt" | "size"> & { cachedAt?: number; size?: number },
): Promise<void> {
  const p = getDb();
  if (!p) throw new Error("媒体缓存未就绪（请先登录）");
  const size = record.size ?? record.blob.size;
  const cachedAt = record.cachedAt ?? Date.now();
  const full: MediaCacheRecord = {
    mediaId: record.mediaId,
    type: record.type,
    title: record.title,
    mimeType: record.mimeType || record.blob.type || undefined,
    size,
    alistPath: record.alistPath,
    cachedAt,
    blob: record.blob,
  };
  try {
    const db = await p;
    await db.put("mediaFiles", full);
  } catch (e) {
    console.warn("[mediaFileCache] putMediaFile failed:", e);
    throw e;
  }
  if (!cachedIdSet) cachedIdSet = new Set();
  cachedIdSet.add(record.mediaId);
  // 换文件后旧 object URL 失效
  const oldUrl = objectUrls.get(record.mediaId);
  if (oldUrl) {
    try {
      URL.revokeObjectURL(oldUrl.url);
    } catch {
      /* ignore */
    }
    objectUrls.delete(record.mediaId);
  }
  notifyListeners();
}

export async function deleteMediaFile(mediaId: string): Promise<void> {
  if (!mediaId) return;
  const p = getDb();
  if (!p) return;
  await safe(async () => {
    const db = await p;
    await db.delete("mediaFiles", mediaId);
  }, undefined, "deleteMediaFile");
  releaseLocalPlayUrl(mediaId);
  const entry = objectUrls.get(mediaId);
  if (entry) {
    try {
      URL.revokeObjectURL(entry.url);
    } catch {
      /* ignore */
    }
    objectUrls.delete(mediaId);
  }
  cachedIdSet?.delete(mediaId);
  notifyListeners();
}

export async function deleteMediaFiles(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const p = getDb();
  if (!p) return;
  await safe(async () => {
    const db = await p;
    const tx = db.transaction("mediaFiles", "readwrite");
    await Promise.all(ids.map((id) => tx.store.delete(id)));
    await tx.done;
  }, undefined, "deleteMediaFiles");
  for (const id of ids) {
    const entry = objectUrls.get(id);
    if (entry) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {
        /* ignore */
      }
      objectUrls.delete(id);
    }
    cachedIdSet?.delete(id);
  }
  notifyListeners();
}

export async function listMediaCacheMeta(opts?: {
  type?: MediaCacheType;
}): Promise<MediaCacheMeta[]> {
  const p = getDb();
  if (!p) return [];
  return safe(async () => {
    const db = await p;
    let rows: MediaCacheRecord[];
    if (opts?.type) {
      rows = await db.getAllFromIndex("mediaFiles", "by-type", opts.type);
    } else {
      rows = await db.getAll("mediaFiles");
    }
    rows.sort((a, b) => b.cachedAt - a.cachedAt);
    return rows.map(({ blob: _b, ...meta }) => meta);
  }, [], "listMediaCacheMeta");
}

export async function getMediaCacheStats(): Promise<MediaCacheStats> {
  const rows = await listMediaCacheMeta();
  return {
    count: rows.length,
    totalBytes: rows.reduce((sum, r) => sum + (r.size || 0), 0),
  };
}

export async function clearAllMediaFiles(): Promise<void> {
  const p = getDb();
  if (!p) return;
  await safe(async () => {
    const db = await p;
    await db.clear("mediaFiles");
  }, undefined, "clearAllMediaFiles");
  revokeAllObjectUrls();
  cachedIdSet = new Set();
  notifyListeners();
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
