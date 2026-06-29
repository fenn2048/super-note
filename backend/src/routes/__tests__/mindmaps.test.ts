import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

// Configure DB_PATH
const testDbPath = path.join(process.cwd(), "data", "test-mindmaps-temp.db");
process.env.DB_PATH = testDbPath;

// Clean up any stale DB files
for (const ext of ["", "-wal", "-shm"]) {
  const p = testDbPath + ext;
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

let app: Hono;

test("Mindmaps Module Tests", async (t) => {
  // Dynamically import inside async block to prevent wrong DB path initialization due to hoisting
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: mindmapsRouter } = await import("../mindmaps.js");

  app = new Hono();
  app.route("/api/mindmaps", mindmapsRouter);

  const db = getDb();

  // Seed user
  const userId = "user-333";
  db.prepare("INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)").run(userId, "mindmapuser", "pwd", "map@map.com");

  let createdMapId = "";

  await t.test("1. Create Mindmap", async () => {
    const res = await app.request("/api/mindmaps", {
      method: "POST",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Mindmap",
        data: JSON.stringify({ root: { topic: "Root topic" } }),
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.title, "Test Mindmap");
    createdMapId = body.id;
  });

  await t.test("2. List Mindmaps", async () => {
    const res = await app.request("/api/mindmaps", {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].id, createdMapId);
  });

  await t.test("3. Get Mindmap Detail", async () => {
    const res = await app.request(`/api/mindmaps/${createdMapId}`, {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, createdMapId);
    assert.strictEqual(body.title, "Test Mindmap");
  });

  await t.test("4. Update Mindmap", async () => {
    const res = await app.request(`/api/mindmaps/${createdMapId}`, {
      method: "PUT",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Updated Mindmap Title",
        data: JSON.stringify({ root: { topic: "Updated topic" } }),
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.title, "Updated Mindmap Title");
  });

  await t.test("5. Delete Mindmap", async () => {
    const res = await app.request(`/api/mindmaps/${createdMapId}`, {
      method: "DELETE",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);

    // Verify it is deleted
    const resGet = await app.request(`/api/mindmaps/${createdMapId}`, {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });
    assert.strictEqual(resGet.status, 404);
  });

  closeDb();
  for (const ext of ["", "-wal", "-shm"]) {
    const p = testDbPath + ext;
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {}
    }
  }
});
