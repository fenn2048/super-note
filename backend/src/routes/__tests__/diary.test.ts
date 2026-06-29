import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

// Configure DB_PATH
const testDbPath = path.join(process.cwd(), "data", "test-diary-temp.db");
process.env.DB_PATH = testDbPath;

// Clean up any stale test DB files (including WAL/SHM)
for (const ext of ["", "-wal", "-shm"]) {
  const p = testDbPath + ext;
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {}
  }
}

let app: Hono;

test("Diary (Saysay) Module Tests", async (t) => {
  // Dynamically import inside async block to prevent wrong DB path initialization due to hoisting
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: diaryRouter } = await import("../diary.js");

  app = new Hono();
  app.route("/api/diary", diaryRouter);

  const db = getDb();
  console.log("Diaries columns:", JSON.stringify(db.prepare("PRAGMA table_info(diaries)").all(), null, 2));

  // Seed user
  const userId = "user-111";
  db.prepare("INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)").run(userId, "diaryuser", "pwd", "diary@diary.com");

  let createdDiaryId = "";

  await t.test("1. Create Diary Post", async () => {
    const res = await app.request("/api/diary", {
      method: "POST",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentText: "This is a test saysay!",
        images: [],
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.contentText, "This is a test saysay!");
    createdDiaryId = body.id;
  });

  await t.test("2. Get Timeline", async () => {
    const res = await app.request("/api/diary/timeline", {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.items));
    assert.ok(body.items.length >= 1);
    assert.strictEqual(body.items[0].id, createdDiaryId);
  });

  await t.test("3. Get Stats", async () => {
    const res = await app.request("/api/diary/stats", {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.total !== undefined);
    assert.ok(body.todayCount !== undefined);
  });

  await t.test("4. Add and List Diary Comments", async () => {
    // Add comment
    const resAdd = await app.request(`/api/diary/${createdDiaryId}/comments`, {
      method: "POST",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Interesting post!",
      }),
    });
    assert.strictEqual(resAdd.status, 201);
    const comment = await resAdd.json();
    assert.ok(comment.id);
    assert.strictEqual(comment.content, "Interesting post!");

    // List comments
    const resList = await app.request(`/api/diary/${createdDiaryId}/comments`, {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });
    assert.strictEqual(resList.status, 200);
    const comments = await resList.json();
    assert.ok(Array.isArray(comments));
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].id, comment.id);
  });

  await t.test("5. Delete Diary Post", async () => {
    const res = await app.request(`/api/diary/${createdDiaryId}`, {
      method: "DELETE",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);

    // Verify it is deleted from timeline
    const resList = await app.request("/api/diary/timeline", {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });
    const body = await resList.json();
    assert.strictEqual(body.items.length, 0);
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
