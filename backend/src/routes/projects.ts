import { Hono } from "hono";
import { getDb } from "../db/schema";
import { getUserWorkspaceRole } from "../middleware/acl";
import { v4 as uuid } from "uuid";

const projectsRouter = new Hono();

// Helper to check if project exists and user has access
function getProjectPermission(projectId: string, userId: string) {
  const db = getDb();
  const project = db.prepare("SELECT ownerId, visibility, workspaceId, isDeleted, isArchived FROM projects WHERE id = ?").get(projectId) as { ownerId: string; visibility: string; workspaceId: string | null; isDeleted: number; isArchived: number } | undefined;
  if (!project) return { canRead: false, canWrite: false, isOwner: false, project: null };

  const isOwner = project.ownerId === userId;

  if (project.workspaceId) {
    const role = getUserWorkspaceRole(project.workspaceId, userId);
    if (!role) return { canRead: false, canWrite: false, isOwner: false, project };

    const isWorkspaceAdmin = role === "owner" || role === "admin";
    if (project.visibility === "PUBLIC" || isWorkspaceAdmin) {
      return { canRead: true, canWrite: true, isOwner, project };
    } else {
      const member = db.prepare("SELECT role FROM project_members WHERE projectId = ? AND userId = ?").get(projectId, userId);
      const hasAccess = isOwner || !!member;
      return { canRead: hasAccess, canWrite: hasAccess, isOwner, project };
    }
  } else {
    return { canRead: isOwner, canWrite: isOwner, isOwner, project };
  }
}

// 1. Projects CRUD
// List projects
projectsRouter.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;
  const filter = c.req.query("filter") || "active";
  const groupId = c.req.query("groupId") || null;

  let bypassPrivate = false;
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
    if (role === "owner" || role === "admin") {
      bypassPrivate = true;
    }
  }

  let sql = `
    SELECT p.*, u.username as ownerName, u.displayName as ownerDisplayName, pg.name as groupName,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.projectId = p.id AND pt.isCompleted = 1) as completedTasksCount,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.projectId = p.id) as totalTasksCount
    FROM projects p
    LEFT JOIN users u ON p.ownerId = u.id
    LEFT JOIN project_groups pg ON p.groupId = pg.id
    WHERE `;

  const params: any[] = [];
  if (workspaceId) {
    sql += `p.workspaceId = ? `;
    params.push(workspaceId);
  } else {
    sql += `p.workspaceId IS NULL `;
  }

  if (filter === "trash") {
    sql += `AND p.isDeleted = 1 `;
  } else if (filter === "archived") {
    sql += `AND p.isArchived = 1 AND p.isDeleted = 0 `;
  } else {
    sql += `AND p.isArchived = 0 AND p.isDeleted = 0 `;
  }

  if (groupId) {
    sql += `AND p.groupId = ? `;
    params.push(groupId);
  }

  if (workspaceId && !bypassPrivate) {
    sql += `AND (p.visibility = 'PUBLIC' OR p.ownerId = ? OR p.id IN (SELECT projectId FROM project_members WHERE userId = ?)) `;
    params.push(userId, userId);
  } else if (!workspaceId) {
    sql += `AND p.ownerId = ? `;
    params.push(userId);
  }

  sql += `ORDER BY p.createdAt DESC`;
  const rows = db.prepare(sql).all(params);
  return c.json(rows);
});

// Get workspace-wide tasks for current user
projectsRouter.get("/my-tasks", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;
  const filter = c.req.query("filter") || "all"; // "all", "assigned", "created", "participating"

  // Query all active projects the user has access to
  let bypassPrivate = false;
  if (workspaceId && workspaceId !== "personal") {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
    if (role === "owner" || role === "admin") {
      bypassPrivate = true;
    }
  }

  let projectsSql = `SELECT id FROM projects WHERE isDeleted = 0 AND isArchived = 0 `;
  const projectsParams: any[] = [];
  if (workspaceId && workspaceId !== "personal") {
    projectsSql += `AND workspaceId = ? `;
    projectsParams.push(workspaceId);
  } else {
    projectsSql += `AND workspaceId IS NULL `;
  }

  if (workspaceId && workspaceId !== "personal" && !bypassPrivate) {
    projectsSql += `AND (visibility = 'PUBLIC' OR ownerId = ? OR id IN (SELECT projectId FROM project_members WHERE userId = ?)) `;
    projectsParams.push(userId, userId);
  } else if (!workspaceId || workspaceId === "personal") {
    projectsSql += `AND ownerId = ? `;
    projectsParams.push(userId);
  }

  const allowedProjects = db.prepare(projectsSql).all(projectsParams) as { id: string }[];
  if (allowedProjects.length === 0) {
    return c.json([]);
  }

  const projectIds = allowedProjects.map(p => p.id);
  const placeholders = projectIds.map(() => "?").join(",");

  let sql = `
    SELECT pt.*, p.name as projectName, ps.name as stageName, u.username as assigneeName, u.displayName as assigneeDisplayName, u.avatarUrl as assigneeAvatarUrl
    FROM project_tasks pt
    JOIN projects p ON pt.projectId = p.id
    JOIN project_stages ps ON pt.stageId = ps.id
    LEFT JOIN users u ON pt.assigneeId = u.id
    WHERE pt.projectId IN (${placeholders})
  `;
  const params: any[] = [...projectIds];

  // Apply filter: "我负责的" (assigned), "我创建的" (created), "我参与的" (participating)
  if (filter === "assigned") {
    sql += ` AND pt.assigneeId = ?`;
    params.push(userId);
  } else if (filter === "created") {
    sql += ` AND pt.creatorId = ?`;
    params.push(userId);
  } else if (filter === "participating") {
    sql += ` AND (pt.assigneeId = ? OR pt.creatorId = ? OR pt.id IN (SELECT taskId FROM project_task_members WHERE userId = ?))`;
    params.push(userId, userId, userId);
  } else {
    // default/all: any association
    sql += ` AND (pt.assigneeId = ? OR pt.creatorId = ? OR pt.id IN (SELECT taskId FROM project_task_members WHERE userId = ?))`;
    params.push(userId, userId, userId);
  }

  sql += ` ORDER BY pt.endDate ASC, pt.createdAt DESC`;
  const tasks = db.prepare(sql).all(params) as any[];

  // Attach tags, checklists, and participants to each task
  for (const task of tasks) {
    const participants = db.prepare(`
      SELECT ptm.userId, u.username, u.displayName, u.avatarUrl
      FROM project_task_members ptm
      JOIN users u ON ptm.userId = u.id
      WHERE ptm.taskId = ?
    `).all(task.id);
    task.participants = participants;

    const tags = db.prepare(`
      SELECT t.id, t.name, t.color
      FROM project_task_tags ptt
      JOIN tags t ON ptt.tagId = t.id
      WHERE ptt.taskId = ?
    `).all(task.id);
    task.tags = tags;

    const checklists = db.prepare(`
      SELECT * FROM project_task_checklists
      WHERE taskId = ?
      ORDER BY sortOrder ASC
    `).all(task.id);
    task.checklists = checklists;
  }

  return c.json(tasks);
});

// 2. Project Groups
// List groups
projectsRouter.get("/groups", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
  }

  let sql = "SELECT * FROM project_groups WHERE ";
  const params: any[] = [];
  if (workspaceId) {
    sql += "workspaceId = ? ";
    params.push(workspaceId);
  } else {
    sql += "workspaceId IS NULL AND userId = ? ";
    params.push(userId);
  }
  sql += "ORDER BY sortOrder ASC, name ASC";

  const rows = db.prepare(sql).all(params);
  return c.json(rows);
});

// Create group
projectsRouter.post("/groups", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();
  const { name, workspaceId = null } = body;

  if (!name) return c.json({ error: "分组名称不能为空" }, 400);

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内操作", code: "FORBIDDEN" }, 403);
  }

  const id = uuid();
  db.prepare("INSERT INTO project_groups (id, name, workspaceId, userId) VALUES (?, ?, ?, ?)").run(id, name, workspaceId, userId);
  const newGroup = db.prepare("SELECT * FROM project_groups WHERE id = ?").get(id);
  return c.json(newGroup);
});

// Update group
projectsRouter.put("/groups/:groupId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const groupId = c.req.param("groupId");
  const body = await c.req.json();
  const { name, sortOrder } = body;

  const group = db.prepare("SELECT * FROM project_groups WHERE id = ?").get(groupId) as any;
  if (!group) return c.json({ error: "分组不存在" }, 404);

  if (group.workspaceId) {
    const role = getUserWorkspaceRole(group.workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内操作", code: "FORBIDDEN" }, 403);
  } else {
    if (group.userId !== userId) return c.json({ error: "权限不足", code: "FORBIDDEN" }, 403);
  }

  if (name !== undefined) {
    db.prepare("UPDATE project_groups SET name = ? WHERE id = ?").run(name, groupId);
  }
  if (sortOrder !== undefined) {
    db.prepare("UPDATE project_groups SET sortOrder = ? WHERE id = ?").run(sortOrder, groupId);
  }

  const updatedGroup = db.prepare("SELECT * FROM project_groups WHERE id = ?").get(groupId);
  return c.json(updatedGroup);
});

// Delete group
projectsRouter.delete("/groups/:groupId", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const groupId = c.req.param("groupId");

  const group = db.prepare("SELECT * FROM project_groups WHERE id = ?").get(groupId) as any;
  if (!group) return c.json({ error: "分组不存在" }, 404);

  if (group.workspaceId) {
    const role = getUserWorkspaceRole(group.workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内操作", code: "FORBIDDEN" }, 403);
  } else {
    if (group.userId !== userId) return c.json({ error: "权限不足", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM project_groups WHERE id = ?").run(groupId);
  return c.json({ message: "分组已删除" });
});

// Get single project
projectsRouter.get("/:id", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const { canRead, project } = getProjectPermission(id, userId);

  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!canRead) return c.json({ error: "无权查看该项目", code: "FORBIDDEN" }, 403);

  // Fetch complete project details with members
  const db = getDb();
  const projectDetails = db.prepare(`
    SELECT p.*, u.username as ownerName, u.displayName as ownerDisplayName, pg.name as groupName
    FROM projects p
    LEFT JOIN users u ON p.ownerId = u.id
    LEFT JOIN project_groups pg ON p.groupId = pg.id
    WHERE p.id = ?
  `).get(id) as any;

  let members;
  if (projectDetails.visibility === "PUBLIC" && projectDetails.workspaceId) {
    members = db.prepare(`
      SELECT DISTINCT wm.userId,
             CASE WHEN wm.role = 'owner' THEN 'owner' WHEN wm.role = 'admin' THEN 'admin' ELSE 'member' END as role,
             u.username, u.displayName, u.avatarUrl
      FROM workspace_members wm
      JOIN users u ON wm.userId = u.id
      WHERE wm.workspaceId = ?
    `).all(projectDetails.workspaceId);
  } else {
    members = db.prepare(`
      SELECT pm.userId, pm.role, u.username, u.displayName, u.avatarUrl
      FROM project_members pm
      JOIN users u ON pm.userId = u.id
      WHERE pm.projectId = ?
    `).all(id);
  }

  projectDetails.members = members;
  return c.json(projectDetails);
});

// Create project
projectsRouter.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();

  const { name, description = "", cover = "", startDate = null, endDate = null, visibility = "PRIVATE", workspaceId = null, groupId = null } = body;
  if (!name) return c.json({ error: "项目名称不能为空" }, 400);

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内创建项目", code: "FORBIDDEN" }, 403);
  }

  const projectId = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, description, cover, startDate, endDate, visibility, workspaceId, groupId, ownerId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, name, description, cover, startDate, endDate, visibility, workspaceId, groupId, userId);

  // Add owner to members list
  db.prepare("INSERT INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')").run(projectId, userId);

  const newProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return c.json(newProject);
});

// Update project
projectsRouter.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canWrite, project } = getProjectPermission(id, userId);
  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!canWrite) return c.json({ error: "无权编辑该项目", code: "FORBIDDEN" }, 403);

  const { name, description, cover, startDate, endDate, visibility, groupId, isArchived, isDeleted } = body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) { updates.push("name = ?"); params.push(name); }
  if (description !== undefined) { updates.push("description = ?"); params.push(description); }
  if (cover !== undefined) { updates.push("cover = ?"); params.push(cover); }
  if (startDate !== undefined) { updates.push("startDate = ?"); params.push(startDate); }
  if (endDate !== undefined) { updates.push("endDate = ?"); params.push(endDate); }
  if (visibility !== undefined) { updates.push("visibility = ?"); params.push(visibility); }
  if (groupId !== undefined) { updates.push("groupId = ?"); params.push(groupId); }
  if (isArchived !== undefined) { updates.push("isArchived = ?"); params.push(isArchived); }
  if (isDeleted !== undefined) { updates.push("isDeleted = ?"); params.push(isDeleted); }

  if (updates.length > 0) {
    updates.push("updatedAt = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(params);
  }

  const updatedProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return c.json(updatedProject);
});

// Delete project
projectsRouter.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canWrite, project } = getProjectPermission(id, userId);
  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!canWrite) return c.json({ error: "无权删除该项目", code: "FORBIDDEN" }, 403);

  if (project.isDeleted === 1) {
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    return c.json({ message: "项目已彻底删除" });
  } else {
    db.prepare("UPDATE projects SET isDeleted = 1, updatedAt = datetime('now') WHERE id = ?").run(id);
    return c.json({ message: "项目已移入回收站" });
  }
});

// 3. Project Stages & Tasks
// Get stages with nested tasks
projectsRouter.get("/:id/stages", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canRead } = getProjectPermission(id, userId);
  if (!canRead) return c.json({ error: "无权查看该项目", code: "FORBIDDEN" }, 403);

  const db = getDb();
  const stages = db.prepare("SELECT * FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC").all(id) as any[];

  for (const stage of stages) {
    const tasks = db.prepare(`
      SELECT pt.*, u.username as assigneeName, u.displayName as assigneeDisplayName, u.avatarUrl as assigneeAvatarUrl,
        (SELECT COUNT(*) FROM project_task_checklists WHERE taskId = pt.id) as checklistTotal,
        (SELECT COUNT(*) FROM project_task_checklists WHERE taskId = pt.id AND isCompleted = 1) as checklistCompleted
      FROM project_tasks pt
      LEFT JOIN users u ON pt.assigneeId = u.id
      WHERE pt.projectId = ? AND pt.stageId = ?
      ORDER BY pt.sortOrder ASC, pt.createdAt DESC
    `).all(id, stage.id) as any[];

    for (const task of tasks) {
      const participants = db.prepare(`
        SELECT ptm.userId, u.username, u.displayName, u.avatarUrl
        FROM project_task_members ptm
        JOIN users u ON ptm.userId = u.id
        WHERE ptm.taskId = ?
      `).all(task.id);
      task.participants = participants;

      const tags = db.prepare(`
        SELECT t.id, t.userId, t.name, t.color, t.createdAt
        FROM project_task_tags ptt
        JOIN tags t ON ptt.tagId = t.id
        WHERE ptt.taskId = ?
      `).all(task.id);
      task.tags = tags;
      
      const checklists = db.prepare(`
        SELECT * FROM project_task_checklists
        WHERE taskId = ?
        ORDER BY sortOrder ASC
      `).all(task.id);
      task.checklists = checklists;
    }
    stage.tasks = tasks;
  }

  return c.json(stages);
});

// Create stage
projectsRouter.post("/:id/stages", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();
  const { name } = body;

  if (!name) return c.json({ error: "阶段名称不能为空" }, 400);

  const { canWrite } = getProjectPermission(id, userId);
  if (!canWrite) return c.json({ error: "无权在此项目内操作", code: "FORBIDDEN" }, 403);

  const stageId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_stages WHERE projectId = ?").get(id) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  db.prepare("INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, ?)").run(stageId, id, name, sortOrder);
  const newStage = db.prepare("SELECT * FROM project_stages WHERE id = ?").get(stageId);
  return c.json(newStage);
});

// Update stage
projectsRouter.put("/stages/:stageId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const stageId = c.req.param("stageId");
  const body = await c.req.json();
  const { name, sortOrder, bgColor } = body;

  const stage = db.prepare("SELECT * FROM project_stages WHERE id = ?").get(stageId) as { name: string; projectId: string } | undefined;
  if (!stage) return c.json({ error: "阶段不存在" }, 404);

  const { canWrite } = getProjectPermission(stage.projectId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目的阶段", code: "FORBIDDEN" }, 403);

  if (name !== undefined) {
    db.prepare("UPDATE project_stages SET name = ? WHERE id = ?").run(name, stageId);
  }
  if (sortOrder !== undefined) {
    db.prepare("UPDATE project_stages SET sortOrder = ? WHERE id = ?").run(sortOrder, stageId);
  }
  if (bgColor !== undefined) {
    db.prepare("UPDATE project_stages SET bgColor = ? WHERE id = ?").run(bgColor, stageId);
  }

  const updated = db.prepare("SELECT * FROM project_stages WHERE id = ?").get(stageId);
  return c.json(updated);
});

// Delete stage
projectsRouter.delete("/stages/:stageId", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const stageId = c.req.param("stageId");

  const stage = db.prepare("SELECT * FROM project_stages WHERE id = ?").get(stageId) as { projectId: string } | undefined;
  if (!stage) return c.json({ error: "阶段不存在" }, 404);

  const { canWrite } = getProjectPermission(stage.projectId, userId);
  if (!canWrite) return c.json({ error: "无权删除该项目的阶段", code: "FORBIDDEN" }, 403);

  db.prepare("DELETE FROM project_stages WHERE id = ?").run(stageId);
  return c.json({ message: "阶段已成功删除" });
});

// Create project task
projectsRouter.post("/:id/tasks", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canWrite } = getProjectPermission(id, userId);
  if (!canWrite) return c.json({ error: "无权在此项目内创建任务", code: "FORBIDDEN" }, 403);

  const { stageId, title, description = "", assigneeId = null, startDate = null, endDate = null, cover = "", participants = [], tags = [], priority = 2, remindAt = null, titleColor = null } = body;
  if (!title) return c.json({ error: "任务标题不能为空" }, 400);
  if (!stageId) return c.json({ error: "必须指定任务阶段" }, 400);

  const taskId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_tasks WHERE stageId = ?").get(stageId) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  db.prepare(`
    INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate, description, cover, sortOrder, creatorId, modifierId, priority, remindAt, titleColor)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, id, stageId, title, assigneeId, startDate, endDate, description, cover, sortOrder, userId, userId, priority, remindAt, titleColor);

  // Add participants
  if (Array.isArray(participants)) {
    for (const pId of participants) {
      db.prepare("INSERT OR IGNORE INTO project_task_members (taskId, userId) VALUES (?, ?)").run(taskId, pId);
    }
  }

  // Add tags
  if (Array.isArray(tags)) {
    for (const tagId of tags) {
      db.prepare("INSERT OR IGNORE INTO project_task_tags (taskId, tagId) VALUES (?, ?)").run(taskId, tagId);
    }
  }

  const newTask = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId);
  return c.json(newTask);
});

// Update project task
projectsRouter.put("/tasks/:taskId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const taskId = c.req.param("taskId");
  const body = await c.req.json();

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as { projectId: string; stageId: string } | undefined;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const { canWrite } = getProjectPermission(task.projectId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目的任务", code: "FORBIDDEN" }, 403);

  const { title, description, isCompleted, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor } = body;

  const updates: string[] = [];
  const params: any[] = [];

  if (title !== undefined) { updates.push("title = ?"); params.push(title); }
  if (description !== undefined) { updates.push("description = ?"); params.push(description); }
  if (isCompleted !== undefined) { updates.push("isCompleted = ?"); params.push(isCompleted); }
  if (assigneeId !== undefined) { updates.push("assigneeId = ?"); params.push(assigneeId); }
  if (startDate !== undefined) { updates.push("startDate = ?"); params.push(startDate); }
  if (endDate !== undefined) { updates.push("endDate = ?"); params.push(endDate); }
  if (cover !== undefined) { updates.push("cover = ?"); params.push(cover); }
  if (stageId !== undefined) { updates.push("stageId = ?"); params.push(stageId); }
  if (sortOrder !== undefined) { updates.push("sortOrder = ?"); params.push(sortOrder); }
  if (priority !== undefined) { updates.push("priority = ?"); params.push(priority); }
  if (remindAt !== undefined) { updates.push("remindAt = ?"); params.push(remindAt); }
  if (titleColor !== undefined) { updates.push("titleColor = ?"); params.push(titleColor); }

  if (updates.length > 0) {
    updates.push("modifierId = ?");
    updates.push("updatedAt = datetime('now')");
    params.push(userId, taskId);
    db.prepare(`UPDATE project_tasks SET ${updates.join(", ")} WHERE id = ?`).run(params);
  }

  // Update checklists if provided
  if (checklists && Array.isArray(checklists)) {
    const currentChecklistIds = checklists.map(c => c.id).filter(id => !!id);
    if (currentChecklistIds.length > 0) {
      const placeholders = currentChecklistIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM project_task_checklists WHERE taskId = ? AND id NOT IN (${placeholders})`).run(taskId, ...currentChecklistIds);
    } else {
      db.prepare("DELETE FROM project_task_checklists WHERE taskId = ?").run(taskId);
    }

    for (let i = 0; i < checklists.length; i++) {
      const cl = checklists[i];
      if (cl.id) {
        db.prepare("UPDATE project_task_checklists SET title = ?, isCompleted = ?, sortOrder = ? WHERE id = ?")
          .run(cl.title, cl.isCompleted ? 1 : 0, i, cl.id);
      } else {
        db.prepare("INSERT INTO project_task_checklists (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, ?, ?)")
          .run(uuid(), taskId, cl.title, cl.isCompleted ? 1 : 0, i);
      }
    }
  }

  // Sync participants
  if (participants && Array.isArray(participants)) {
    db.prepare("DELETE FROM project_task_members WHERE taskId = ?").run(taskId);
    for (const pId of participants) {
      db.prepare("INSERT INTO project_task_members (taskId, userId) VALUES (?, ?)").run(taskId, pId);
    }
  }

  // Sync tags
  if (tags && Array.isArray(tags)) {
    db.prepare("DELETE FROM project_task_tags WHERE taskId = ?").run(taskId);
    for (const tagId of tags) {
      db.prepare("INSERT INTO project_task_tags (taskId, tagId) VALUES (?, ?)").run(taskId, tagId);
    }
  }

  const updatedTask = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId);
  return c.json(updatedTask);
});

// Delete project task
projectsRouter.delete("/tasks/:taskId", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const taskId = c.req.param("taskId");

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as { projectId: string } | undefined;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const { canWrite } = getProjectPermission(task.projectId, userId);
  if (!canWrite) return c.json({ error: "无权删除该项目的任务", code: "FORBIDDEN" }, 403);

  db.prepare("DELETE FROM project_tasks WHERE id = ?").run(taskId);
  return c.json({ message: "任务已删除" });
});

// 4. Project Discussions
// List discussions
projectsRouter.get("/:id/discussions", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canRead } = getProjectPermission(id, userId);
  if (!canRead) return c.json({ error: "无权查看该项目讨论区", code: "FORBIDDEN" }, 403);

  const db = getDb();
  const discussions = db.prepare(`
    SELECT pd.*, u.username, u.displayName, u.avatarUrl
    FROM project_discussions pd
    JOIN users u ON pd.userId = u.id
    WHERE pd.projectId = ?
    ORDER BY pd.createdAt ASC
  `).all(id) as any[];

  for (const disc of discussions) {
    try {
      disc.images = JSON.parse(disc.images);
    } catch {
      disc.images = [];
    }
    try {
      disc.attachments = JSON.parse(disc.attachments);
    } catch {
      disc.attachments = [];
    }
    try {
      disc.linkedCards = JSON.parse(disc.linkedCards);
    } catch {
      disc.linkedCards = [];
    }
  }

  return c.json(discussions);
});

// Create discussion post
projectsRouter.post("/:id/discussions", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canRead } = getProjectPermission(id, userId);
  if (!canRead) return c.json({ error: "无权在此项目下发言", code: "FORBIDDEN" }, 403);

  const { content, images = [], attachments = [], linkedCards = [] } = body;
  if (!content && images.length === 0 && attachments.length === 0) {
    return c.json({ error: "讨论内容不能为空" }, 400);
  }

  const discId = uuid();
  db.prepare(`
    INSERT INTO project_discussions (id, projectId, userId, content, images, attachments, linkedCards)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    discId,
    id,
    userId,
    content || "",
    JSON.stringify(images),
    JSON.stringify(attachments),
    JSON.stringify(linkedCards)
  );

  const newDisc = db.prepare(`
    SELECT pd.*, u.username, u.displayName, u.avatarUrl
    FROM project_discussions pd
    JOIN users u ON pd.userId = u.id
    WHERE pd.id = ?
  `).get(discId) as any;

  newDisc.images = JSON.parse(newDisc.images);
  newDisc.attachments = JSON.parse(newDisc.attachments);
  newDisc.linkedCards = JSON.parse(newDisc.linkedCards);

  return c.json(newDisc);
});

// Add member to project
projectsRouter.post("/:id/members", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();
  const { memberUserId, role = "member" } = body;

  const { isOwner, project } = getProjectPermission(id, userId);
  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!isOwner) return c.json({ error: "仅项目创建者能添加成员", code: "FORBIDDEN" }, 403);

  db.prepare("INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, ?)")
    .run(id, memberUserId, role);

  return c.json({ message: "成员添加成功" });
});

// Remove member from project
projectsRouter.delete("/:id/members/:memberUserId", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const memberUserId = c.req.param("memberUserId");

  const { isOwner, project } = getProjectPermission(id, userId);
  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!isOwner && userId !== memberUserId) {
    return c.json({ error: "无权移除该成员", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM project_members WHERE projectId = ? AND userId = ?")
    .run(id, memberUserId);

  return c.json({ message: "成员移除成功" });
});

export default projectsRouter;
