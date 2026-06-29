import test from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { Hono } from "hono";

// Configure DB_PATH
const testDbPath = path.join(process.cwd(), "data", "test-projects-temp.db");
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

test("Project Management Module Tests", async (t) => {
  // Dynamically import inside async block to prevent wrong DB path initialization due to hoisting
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: projectsRouter } = await import("../projects.js");

  app = new Hono();
  app.route("/api/projects", projectsRouter);

  const db = getDb();
  
  // Set up mock users
  const testUserId = "user-123";
  const otherUserId = "user-456";
  db.prepare("INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)").run(testUserId, "testuser", "pwd", "a@a.com");
  db.prepare("INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)").run(otherUserId, "otheruser", "pwd", "b@b.com");

  // Set up workspace
  const wsId = "ws-789";
  db.prepare("INSERT OR IGNORE INTO workspaces (id, name, ownerId) VALUES (?, ?, ?)").run(wsId, "Test Workspace", testUserId);
  db.prepare("INSERT OR IGNORE INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)").run(wsId, testUserId, "owner");
  db.prepare("INSERT OR IGNORE INTO workspace_members (workspaceId, userId, role) VALUES (?, ?, ?)").run(wsId, otherUserId, "viewer");

  let createdProjectId = "";

  await t.test("1. Create Project", async () => {
    const res = await app.request("/api/projects", {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test Project",
        description: "Test Desc",
        visibility: "PRIVATE",
        workspaceId: wsId,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.id);
    assert.strictEqual(body.name, "Test Project");
    assert.strictEqual(body.workspaceId, wsId);
    assert.strictEqual(body.ownerId, testUserId);
    createdProjectId = body.id;
  });

  await t.test("2. Create Special Projects without Duplicates (家庭TODO)", async () => {
    // Call 1
    const res1 = await app.request("/api/projects", {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "家庭TODO",
        workspaceId: wsId,
      }),
    });
    assert.strictEqual(res1.status, 200);
    const project1 = await res1.json();

    // Call 2
    const res2 = await app.request("/api/projects", {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "家庭TODO",
        workspaceId: wsId,
      }),
    });
    assert.strictEqual(res2.status, 200);
    const project2 = await res2.json();

    // The two calls should return the EXACT same project ID
    assert.strictEqual(project1.id, project2.id);
  });

  await t.test("3. Get Project Groups", async () => {
    // Insert a group first
    db.prepare("INSERT INTO project_groups (id, name, userId, workspaceId, sortOrder) VALUES (?, ?, ?, ?, ?)")
      .run("group-1", "Group 1", testUserId, wsId, 1);

    const res = await app.request(`/api/projects/groups?workspaceId=${wsId}`, {
      method: "GET",
      headers: {
        "X-User-Id": testUserId,
      },
    });

    assert.strictEqual(res.status, 200);
    const groups = await res.json();
    assert.ok(Array.isArray(groups));
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].id, "group-1");
  });

  await t.test("4. Get Project Detail", async () => {
    // Successful fetch
    const res = await app.request(`/api/projects/${createdProjectId}`, {
      method: "GET",
      headers: {
        "X-User-Id": testUserId,
      },
    });
    assert.strictEqual(res.status, 200);
    const detail = await res.json();
    assert.strictEqual(detail.id, createdProjectId);
    assert.strictEqual(detail.ownerName, "testuser");

    // Forbidden fetch
    const resForbidden = await app.request(`/api/projects/${createdProjectId}`, {
      method: "GET",
      headers: {
        "X-User-Id": otherUserId,
      },
    });
    assert.strictEqual(resForbidden.status, 403);
  });

  await t.test("5. Update Project", async () => {
    const res = await app.request(`/api/projects/${createdProjectId}`, {
      method: "PUT",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Project Name",
        description: "Updated Desc",
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.name, "Updated Project Name");
    assert.strictEqual(body.description, "Updated Desc");
  });

  await t.test("6. Project Stages", async () => {
    // Create stage
    const resCreate = await app.request(`/api/projects/${createdProjectId}/stages`, {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Todo Stage",
        bgColor: "#ff0000",
      }),
    });
    assert.strictEqual(resCreate.status, 200);
    const createdStage = await resCreate.json();
    assert.ok(createdStage.id);
    assert.strictEqual(createdStage.name, "Todo Stage");

    // List stages
    const resList = await app.request(`/api/projects/${createdProjectId}/stages`, {
      method: "GET",
      headers: {
        "X-User-Id": testUserId,
      },
    });
    assert.strictEqual(resList.status, 200);
    const stages = await resList.json();
    assert.strictEqual(stages.length, 4);

    // Update stage
    const resUpdate = await app.request(`/api/projects/stages/${createdStage.id}`, {
      method: "PUT",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "In Progress",
      }),
    });
    assert.strictEqual(resUpdate.status, 200);

    // Delete stage (should work since it's empty)
    const resDelete = await app.request(`/api/projects/stages/${createdStage.id}`, {
      method: "DELETE",
      headers: {
        "X-User-Id": testUserId,
      },
    });
    assert.strictEqual(resDelete.status, 200);
  });

  await t.test("7. Project Tasks", async () => {
    // Get stages
    const stagesRes = await app.request(`/api/projects/${createdProjectId}/stages`, {
      method: "GET",
      headers: { "X-User-Id": testUserId }
    });
    const stages = await stagesRes.json();
    const stageId = stages[0].id;

    // Create Task
    const resCreate = await app.request(`/api/projects/${createdProjectId}/tasks`, {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Task 1",
        stageId,
        priority: 1,
      }),
    });
    assert.strictEqual(resCreate.status, 200);
    const task = await resCreate.json();
    assert.ok(task.id);
    assert.strictEqual(task.title, "Task 1");

    // List Tasks
    const resList = await app.request(`/api/projects/${createdProjectId}/tasks`, {
      method: "GET",
      headers: { "X-User-Id": testUserId }
    });
    assert.strictEqual(resList.status, 200);
    const tasks = await resList.json();
    assert.strictEqual(tasks.length, 1);

    // Update Task
    const resUpdate = await app.request(`/api/projects/tasks/${task.id}`, {
      method: "PUT",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Updated Task 1",
        isCompleted: 1,
      }),
    });
    assert.strictEqual(resUpdate.status, 200);
    const updatedTask = await resUpdate.json();
    assert.strictEqual(updatedTask.title, "Updated Task 1");
    assert.strictEqual(updatedTask.isCompleted, 1);

    // Get My Tasks
    const resMyTasks = await app.request(`/api/projects/my-tasks?workspaceId=${wsId}`, {
      method: "GET",
      headers: { "X-User-Id": testUserId }
    });
    assert.strictEqual(resMyTasks.status, 200);

    // Delete Task
    const resDelete = await app.request(`/api/projects/tasks/${task.id}`, {
      method: "DELETE",
      headers: { "X-User-Id": testUserId }
    });
    assert.strictEqual(resDelete.status, 200);
  });

  await t.test("8. Project Discussions", async () => {
    // Create post
    const resCreate = await app.request(`/api/projects/${createdProjectId}/discussions`, {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: "Hello discussion",
      }),
    });
    assert.strictEqual(resCreate.status, 200);
    const post = await resCreate.json();
    assert.ok(post.id);
    assert.strictEqual(post.content, "Hello discussion");

    // List posts
    const resList = await app.request(`/api/projects/${createdProjectId}/discussions`, {
      method: "GET",
      headers: { "X-User-Id": testUserId }
    });
    assert.strictEqual(resList.status, 200);
    const posts = await resList.json();
    assert.strictEqual(posts.length, 1);
  });

  await t.test("9. Members Management", async () => {
    // Add member
    const resAdd = await app.request(`/api/projects/${createdProjectId}/members`, {
      method: "POST",
      headers: {
        "X-User-Id": testUserId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        memberUserId: otherUserId,
        role: "member",
      }),
    });
    assert.strictEqual(resAdd.status, 200);

    // Check member access
    const resGet = await app.request(`/api/projects/${createdProjectId}`, {
      method: "GET",
      headers: { "X-User-Id": otherUserId },
    });
    assert.strictEqual(resGet.status, 200);

    // Remove member
    const resDel = await app.request(`/api/projects/${createdProjectId}/members/${otherUserId}`, {
      method: "DELETE",
      headers: { "X-User-Id": testUserId },
    });
    assert.strictEqual(resDel.status, 200);
  });

  await t.test("10. Delete Project", async () => {
    const res = await app.request(`/api/projects/${createdProjectId}`, {
      method: "DELETE",
      headers: {
        "X-User-Id": testUserId,
      },
    });

    assert.strictEqual(res.status, 200);
    
    // Attempting to fetch it now should fail
    const resGet = await app.request(`/api/projects/${createdProjectId}`, {
      method: "GET",
      headers: { "X-User-Id": testUserId },
    });
    assert.strictEqual(resGet.status, 404);
  });

  // Clean up and close DB
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
