/**
 * Memory Redis 最小 API 冒烟（无外部 Redis）
 *
 * 运行：
 *   cd backend && env -u REDIS_URL npx tsx --test src/services/__tests__/redis-memory.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";

// 强制 memory 模式（测试进程内，须在 import redis 之前）
delete process.env.REDIS_URL;

test("memory redis API", async (t) => {
  const { isRedisMemoryMode, redis, createSubClient } = await import("../redis.js");

  await t.test("starts in memory mode without REDIS_URL", () => {
    assert.equal(isRedisMemoryMode, true);
  });

  await t.test("get/setex", async () => {
    await redis.setex("k1", 60, "v1");
    assert.equal(await redis.get("k1"), "v1");
  });

  await t.test("pub/sub", async () => {
    const sub = createSubClient();
    await sub.subscribe("test:ch");
    const got = await new Promise<string>(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("pubsub timeout")), 1000);
      sub.on("message", (ch: string, msg: string) => {
        if (ch === "test:ch") {
          clearTimeout(timer);
          resolve(msg);
        }
      });
      await redis.publish("test:ch", "ping");
    });
    assert.equal(got, "ping");
    sub.disconnect();
  });

  await t.test("stream xadd + xreadgroup + xack", async () => {
    const stream = `ai:test:stream:${Date.now()}`;
    const group = "g1";
    try {
      await redis.xgroup("CREATE", stream, group, "0", "MKSTREAM");
    } catch {
      /* ignore */
    }
    const payload = JSON.stringify({ taskId: "t1" });
    const id = await redis.xadd(stream, "*", "payload", payload);
    assert.ok(id);

    const res = (await redis.xreadgroup(
      "GROUP",
      group,
      "c1",
      "COUNT",
      "1",
      "BLOCK",
      "200",
      "STREAMS",
      stream,
      ">",
    )) as any;

    assert.ok(res);
    const [msgId, fields] = res[0][1][0];
    assert.equal(fields[0], "payload");
    assert.equal(fields[1], payload);
    const n = await redis.xack(stream, group, msgId);
    assert.equal(n, 1);
  });
});
