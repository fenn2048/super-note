import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

const testDbPath = path.join(process.cwd(), "data", "test-user-prefs-temp.db");
process.env.DB_PATH = testDbPath;

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

test("User Preferences API", async (t) => {
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: prefsRouter } = await import("../user-preferences.js");

  const app = new Hono();
  app.route("/api/users", prefsRouter);

  const db = getDb();
  const userId = "user-prefs-1";
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)",
  ).run(userId, "prefsuser", "pwd", "prefs@test.com");

  // Ensure table exists (migration may not auto-run in all paths)
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      userId TEXT PRIMARY KEY,
      prefsJson TEXT NOT NULL DEFAULT '{}',
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  await t.test("GET empty prefs", async () => {
    const res = await app.request("/api/users/me/preferences", {
      headers: { "X-User-Id": userId },
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.prefs, {});
  });

  await t.test("PUT merges allowed keys and strips unknown", async () => {
    const res = await app.request("/api/users/me/preferences", {
      method: "PUT",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        modulePack: "minimal",
        startupLanding: "home",
        noteListDensity: "compact",
        evilKey: "should-drop",
      }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.prefs.modulePack, "minimal");
    assert.strictEqual(body.prefs.startupLanding, "home");
    assert.strictEqual(body.prefs.noteListDensity, "compact");
    assert.strictEqual(body.prefs.evilKey, undefined);
  });

  await t.test("PUT partial merge keeps previous", async () => {
    const res = await app.request("/api/users/me/preferences", {
      method: "PUT",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ startupLanding: "notes" }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.prefs.modulePack, "minimal");
    assert.strictEqual(body.prefs.startupLanding, "notes");
  });

  await t.test("401 without user", async () => {
    const res = await app.request("/api/users/me/preferences");
    assert.strictEqual(res.status, 401);
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
