import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

// Configure DB_PATH
const testDbPath = path.join(process.cwd(), "data", "test-notes-temp.db");
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

test("Notes Module Tests", async (t) => {
  // Dynamically import inside async block to prevent wrong DB path initialization due to hoisting
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: notesRouter } = await import("../notes.js");

  app = new Hono();
  app.route("/api/notes", notesRouter);

  const db = getDb();

  // Seed user
  const userId = "user-222";
  db.prepare("INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)").run(userId, "notesuser", "pwd", "notes@notes.com");

  // Create a notebook first
  const notebookId = "notebook-999";
  db.prepare("INSERT INTO notebooks (id, name, userId) VALUES (?, ?, ?)").run(notebookId, "Test Notebook", userId);

  let createdNoteId = "";

  await t.test("1. Create Note", async () => {
    const res = await app.request("/api/notes", {
      method: "POST",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Test Note",
        content: "Hello world this is note content",
        notebookId: notebookId,
      }),
    });

    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.title, "Test Note");
    assert.strictEqual(body.notebookId, notebookId);
    createdNoteId = body.id;
  });

  await t.test("2. List Notes", async () => {
    const res = await app.request("/api/notes", {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].id, createdNoteId);
  });

  await t.test("3. Get Note Detail", async () => {
    const res = await app.request(`/api/notes/${createdNoteId}`, {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, createdNoteId);
    assert.strictEqual(body.title, "Test Note");
  });

  await t.test("4. Update Note", async () => {
    // Get current version first
    const resGet = await app.request(`/api/notes/${createdNoteId}`, {
      method: "GET",
      headers: {
        "X-User-Id": userId,
      },
    });
    const currentNote = await resGet.json();
    const version = currentNote.version;

    const res = await app.request(`/api/notes/${createdNoteId}`, {
      method: "PUT",
      headers: {
        "X-User-Id": userId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Updated Note Title",
        content: "Updated content",
        version: version,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.title, "Updated Note Title");
  });

  await t.test("5. Delete Note (trash)", async () => {
    const res = await app.request(`/api/notes/${createdNoteId}`, {
      method: "DELETE",
      headers: {
        "X-User-Id": userId,
      },
    });

    assert.strictEqual(res.status, 200);

    // Verify it is permanently deleted (GET returns 404)
    const resGet = await app.request(`/api/notes/${createdNoteId}`, {
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
