import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

const testDbPath = path.join(process.cwd(), "data", "test-workspace-splash-temp.db");
const testSplashDir = path.join(process.cwd(), "data", "test-workspace-splash-files");
process.env.DB_PATH = testDbPath;
process.env.ELECTRON_USER_DATA = path.dirname(testSplashDir);
// 路由用 data/splash 相对 ELECTRON_USER_DATA；这里把 ELECTRON_USER_DATA 指到 data，
// 再在测试里用独立子目录不太方便——直接让 SPLASH 落在 data/splash 并用唯一 workspaceId。

for (const ext of ["", "-wal", "-shm"]) {
  const p = testDbPath + ext;
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

test("Workspace Splash API", async (t) => {
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: splashRouter } = await import("../workspace-splash.js");

  const app = new Hono();
  // 模拟 JWT 中间件：透传 X-User-Id
  app.use("/api/workspaces/*", async (c, next) => {
    await next();
  });
  app.route("/api/workspaces", splashRouter);

  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      passwordHash TEXT,
      email TEXT,
      role TEXT DEFAULT 'user'
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT,
      ownerId TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspaceId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT NOT NULL,
      PRIMARY KEY (workspaceId, userId)
    );
    CREATE TABLE IF NOT EXISTS workspace_splash (
      workspaceId TEXT PRIMARY KEY,
      imageId TEXT NOT NULL,
      fileName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      size INTEGER NOT NULL,
      displayDurationSec INTEGER NOT NULL DEFAULT 5,
      expiresAt TEXT,
      uploadedBy TEXT NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const wsId = "ws-splash-1";
  const ownerId = "user-owner-1";
  const memberId = "user-member-1";
  const strangerId = "user-stranger-1";

  for (const [id, name] of [
    [ownerId, "owner"],
    [memberId, "member"],
    [strangerId, "stranger"],
  ] as const) {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, passwordHash, email, role) VALUES (?, ?, ?, ?, ?)",
    ).run(id, name, "pwd", `${name}@test.com`, "user");
  }

  db.prepare(
    "INSERT OR IGNORE INTO workspaces (id, name, ownerId) VALUES (?, ?, ?)",
  ).run(wsId, "家庭", ownerId);
  db.prepare(
    "INSERT OR IGNORE INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)",
  ).run(wsId, ownerId, "owner");
  db.prepare(
    "INSERT OR IGNORE INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)",
  ).run(wsId, memberId, "editor");

  // 1x1 PNG
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const pngBytes = Buffer.from(pngBase64, "base64");

  await t.test("GET meta unconfigured", async () => {
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      headers: { "X-User-Id": memberId },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.configured, false);
  });

  await t.test("401 without user on GET meta", async () => {
    const res = await app.request(`/api/workspaces/${wsId}/splash`);
    // requireWorkspaceRole: empty userId → hasRole null → 403
    assert.ok(res.status === 403 || res.status === 401);
  });

  await t.test("stranger cannot GET meta", async () => {
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      headers: { "X-User-Id": strangerId },
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test("member cannot POST", async () => {
    const form = new FormData();
    form.append("file", new File([pngBytes], "t.png", { type: "image/png" }));
    form.append("displayDurationSec", "5");
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "POST",
      headers: { "X-User-Id": memberId },
      body: form,
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test("owner can POST splash", async () => {
    const form = new FormData();
    form.append("file", new File([pngBytes], "t.png", { type: "image/png" }));
    form.append("displayDurationSec", "8");
    form.append("expiresAt", "");
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "POST",
      headers: { "X-User-Id": ownerId },
      body: form,
    });
    assert.strictEqual(res.status, 200, await res.clone().text());
    const body = await res.json();
    assert.strictEqual(body.configured, true);
    assert.strictEqual(body.displayDurationSec, 8);
    assert.strictEqual(body.expired, false);
    assert.ok(body.imageId);
    assert.ok(String(body.downloadPath).includes("/splash/image"));
  });

  await t.test("member can GET meta and image", async () => {
    const metaRes = await app.request(`/api/workspaces/${wsId}/splash`, {
      headers: { "X-User-Id": memberId },
    });
    assert.strictEqual(metaRes.status, 200);
    const meta = await metaRes.json();
    assert.strictEqual(meta.configured, true);

    const imgRes = await app.request(`/api/workspaces/${wsId}/splash/image`, {
      headers: { "X-User-Id": memberId },
    });
    assert.strictEqual(imgRes.status, 200);
    assert.ok((imgRes.headers.get("content-type") || "").includes("image/png"));
    const buf = Buffer.from(await imgRes.arrayBuffer());
    assert.ok(buf.length > 0);
  });

  await t.test("stranger cannot download image", async () => {
    const res = await app.request(`/api/workspaces/${wsId}/splash/image`, {
      headers: { "X-User-Id": strangerId },
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test("PATCH duration by owner", async () => {
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "PATCH",
      headers: {
        "X-User-Id": ownerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayDurationSec: 3 }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.displayDurationSec, 3);
  });

  await t.test("expired returns expired flag and 410 on image", async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "PATCH",
      headers: {
        "X-User-Id": ownerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresAt: past }),
    });
    assert.strictEqual(res.status, 200);
    const meta = await res.json();
    assert.strictEqual(meta.expired, true);

    const imgRes = await app.request(`/api/workspaces/${wsId}/splash/image`, {
      headers: { "X-User-Id": memberId },
    });
    assert.strictEqual(imgRes.status, 410);
  });

  await t.test("DELETE by owner", async () => {
    // re-upload so there is something to delete
    const form = new FormData();
    form.append("file", new File([pngBytes], "t2.png", { type: "image/png" }));
    await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "POST",
      headers: { "X-User-Id": ownerId },
      body: form,
    });

    const res = await app.request(`/api/workspaces/${wsId}/splash`, {
      method: "DELETE",
      headers: { "X-User-Id": ownerId },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.configured, false);

    const meta = await (
      await app.request(`/api/workspaces/${wsId}/splash`, {
        headers: { "X-User-Id": memberId },
      })
    ).json();
    assert.strictEqual(meta.configured, false);
  });

  closeDb();
  for (const ext of ["", "-wal", "-shm"]) {
    const p = testDbPath + ext;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
});
