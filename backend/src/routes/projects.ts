import { Hono } from "hono";
import { getDb } from "../db/schema.js";
import { v4 as uuid } from "uuid";
import { logAudit } from "../services/audit.js";
import { getUserWorkspaceRole } from "../middleware/acl.js";
import { propagateProjectStatusUp, syncMilestoneStatusDirect, propagateStatusDown } from "../lib/planStatusSync.js";
import { handleRecurringTask, getNextOccurrenceString } from "../lib/recurrence.js";
import { calculateRemindAt } from "../lib/reminders.js";

const projectsRouter = new Hono();

// Helper: check project permission
function getProjectPermission(projectId: string, userId: string) {
  const db = getDb();
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as any;
  if (!project) return { project: null, canRead: false, canWrite: false, isOwner: false };

  if (project.ownerId === userId) return { project, canRead: true, canWrite: true, isOwner: true };

  // Check if user is a member
  const member = db.prepare("SELECT role FROM project_members WHERE projectId = ? AND userId = ?").get(projectId, userId) as { role: string } | undefined;
  if (member) {
    return { project, canRead: true, canWrite: member.role === "admin" || member.role === "member" || member.role === "owner", isOwner: member.role === "owner" };
  }

  // Check workspace visibility
  if (project.visibility === "PUBLIC" || project.visibility === "WORKSPACE") {
    return { project, canRead: true, canWrite: false, isOwner: false };
  }

  return { project, canRead: false, canWrite: false, isOwner: false };
}

// 1. Project CRUD
// List projects
projectsRouter.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId");

  let query = `
    SELECT p.*, u.username as ownerName, u.displayName as ownerDisplayName
    FROM projects p
    LEFT JOIN users u ON p.ownerId = u.id
    WHERE p.isDeleted = 0
  `;
  const params: any[] = [];

  if (workspaceId) {
    query += " AND p.workspaceId = ?";
    params.push(workspaceId);
  } else {
    query += " AND (p.visibility = 'PUBLIC' OR p.ownerId = ? OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?))";
    params.push(userId, userId);
  }

  query += " ORDER BY p.createdAt DESC";
  const projects = db.prepare(query).all(params);

  return c.json(projects);
});

// 获取项目分组列表
projectsRouter.get("/groups", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId");

  let query = "SELECT * FROM project_groups WHERE userId = ?";
  const params: any[] = [userId];

  if (workspaceId) {
    query += " AND workspaceId = ?";
    params.push(workspaceId);
  } else {
    query += " AND (workspaceId IS NULL OR workspaceId = '')";
  }

  query += " ORDER BY sortOrder ASC";
  const groups = db.prepare(query).all(...params);
  return c.json(groups);
});

// 获取分配给当前用户的项目任务
projectsRouter.get("/my-tasks", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId");

  let query = `
    SELECT pt.*, p.name as projectName, p.workspaceId as projectWorkspaceId, ps.name as stageName
    FROM project_tasks pt
    JOIN projects p ON pt.projectId = p.id
    LEFT JOIN project_stages ps ON pt.stageId = ps.id
    WHERE p.isDeleted = 0 AND pt.assigneeId = ?
  `;
  const params: any[] = [userId];

  if (workspaceId) {
    query += " AND p.workspaceId = ?";
    params.push(workspaceId);
  }

  query += " ORDER BY pt.isCompleted ASC, pt.endDate ASC, pt.createdAt DESC LIMIT 200";
  const tasks = db.prepare(query).all(...params) as any[];

  // 补充参与者和标签信息
  for (const t of tasks) {
    t.participants = db.prepare(`
      SELECT u.id, u.username, u.displayName, u.avatarUrl
      FROM project_task_members ptm
      JOIN users u ON ptm.userId = u.id
      WHERE ptm.taskId = ?
    `).all(t.id);

    t.tags = db.prepare(`
      SELECT tg.*
      FROM project_task_tags ptt
      JOIN tags tg ON ptt.tagId = tg.id
      WHERE ptt.taskId = ?
    `).all(t.id);
  }

  return c.json(tasks);
});


// Create project
projectsRouter.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();

  const { name, description = "", cover = "", startDate = null, endDate = null, visibility = "PRIVATE", workspaceId = null, groupId = null, status = "pending", milestoneId = null } = body;
  if (!name) return c.json({ error: "项目名称不能为空" }, 400);

  if (name === "家庭TODO" || name === "个人TODO") {
    let existingProject: any = null;
    if (workspaceId) {
      existingProject = db.prepare(`
        SELECT * FROM projects 
        WHERE name = ? AND workspaceId = ? AND isDeleted = 0
      `).get(name, workspaceId);
    } else {
      existingProject = db.prepare(`
        SELECT * FROM projects 
        WHERE name = ? AND ownerId = ? AND (workspaceId IS NULL OR workspaceId = '') AND isDeleted = 0
      `).get(name, userId);
    }

    if (existingProject) {
      return c.json(existingProject);
    }
  }

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内创建项目", code: "FORBIDDEN" }, 403);
  }

  const projectId = uuid();
  db.prepare(`
    INSERT INTO projects (id, name, description, cover, startDate, endDate, visibility, workspaceId, groupId, ownerId, status, milestoneId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, name, description, cover, startDate, endDate, visibility, workspaceId, groupId, userId, status, milestoneId);

  if (milestoneId) {
    propagateProjectStatusUp(db, projectId, userId);
  }

  // Add owner to members list
  db.prepare("INSERT INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')").run(projectId, userId);

  // Create default stages: "待启动", "进行中", "已完成"
  db.prepare("INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, ?)").run(uuid(), projectId, "待启动", 0);
  db.prepare("INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, ?)").run(uuid(), projectId, "进行中", 1);
  db.prepare("INSERT INTO project_stages (id, projectId, name, sortOrder) VALUES (?, ?, ?, ?)").run(uuid(), projectId, "已完成", 2);

  logAudit(userId, "system", "create_project", `创建项目「${name}」`, { targetType: "project", targetId: projectId });

  const createdProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  return c.json(createdProject);
});

// Get project detail
projectsRouter.get("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { project, canRead } = getProjectPermission(id, userId);
  if (!project) return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  if (!canRead) return c.json({ error: "无权查看该项目", code: "FORBIDDEN" }, 403);

  const projectWithUserInfo = db.prepare(`
    SELECT p.*, u.username as ownerName, u.displayName as ownerDisplayName
    FROM projects p
    LEFT JOIN users u ON p.ownerId = u.id
    WHERE p.id = ? AND p.isDeleted = 0
  `).get(id);

  if (!projectWithUserInfo) {
    return c.json({ error: "项目不存在", code: "NOT_FOUND" }, 404);
  }

  const members = db.prepare(`
    SELECT pm.userId, pm.role, u.username, u.displayName, u.avatarUrl
    FROM project_members pm
    JOIN users u ON pm.userId = u.id
    WHERE pm.projectId = ?
  `).all(id);

  (projectWithUserInfo as any).members = members;

  return c.json(projectWithUserInfo);
});

// Update project
projectsRouter.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { isOwner, canWrite } = getProjectPermission(id, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目", code: "FORBIDDEN" }, 403);

  const { name, description, cover, startDate, endDate, visibility, groupId, isArchived, isDeleted, status, milestoneId } = body;

  const oldProject = db.prepare("SELECT name, milestoneId, status FROM projects WHERE id = ?").get(id) as { name: string; milestoneId: string | null; status: string };

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
  if (status !== undefined) { updates.push("status = ?"); params.push(status); }
  if (milestoneId !== undefined) { updates.push("milestoneId = ?"); params.push(milestoneId); }

  if (updates.length > 0) {
    updates.push("updatedAt = datetime('now')");
    params.push(id);
    db.prepare(`UPDATE projects SET ${updates.join(", ")} WHERE id = ?`).run(params);
  }

  if (status !== undefined && status !== oldProject.status) {
    logAudit(userId, "system", "project_status_update", `修改项目「${name || oldProject.name}」状态为: ${status}`, { targetType: "project", targetId: id });
    propagateStatusDown(db, "project", id, status, userId);
  } else if (updates.length > 0) {
    logAudit(userId, "system", "project_update", `修改了项目「${name || oldProject.name}」的属性`, { targetType: "project", targetId: id });
  }

  if (status !== undefined || milestoneId !== undefined) {
    propagateProjectStatusUp(db, id, userId);
    if (milestoneId !== undefined && oldProject.milestoneId && oldProject.milestoneId !== milestoneId) {
      syncMilestoneStatusDirect(db, oldProject.milestoneId, userId);
    }
  }

  const updatedProject = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return c.json(updatedProject);
});

// Delete project (soft delete)
projectsRouter.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { isOwner } = getProjectPermission(id, userId);
  if (!isOwner) return c.json({ error: "仅项目创建者能删除项目", code: "FORBIDDEN" }, 403);

  db.prepare("UPDATE projects SET isDeleted = 1, updatedAt = datetime('now') WHERE id = ?").run(id);
  logAudit(userId, "system", "delete_project", "删除了项目", { targetType: "project", targetId: id });

  return c.json({ message: "项目已删除" });
});

// 2. Project Stages
// List stages
projectsRouter.get("/:id/stages", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canRead } = getProjectPermission(id, userId);
  if (!canRead) return c.json({ error: "无权查看该项目", code: "FORBIDDEN" }, 403);

  const db = getDb();
  const stages = db.prepare("SELECT * FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC").all(id) as any[];

  const tasks = db.prepare(`
    SELECT pt.*, u.username as assigneeName, u.displayName as assigneeDisplayName, u.avatarUrl as assigneeAvatarUrl
    FROM project_tasks pt
    LEFT JOIN users u ON pt.assigneeId = u.id
    WHERE pt.projectId = ?
    ORDER BY pt.sortOrder ASC
  `).all(id) as any[];

  for (const t of tasks) {
    t.participants = db.prepare(`
      SELECT u.id, u.username, u.displayName, u.avatarUrl
      FROM project_task_members ptm
      JOIN users u ON ptm.userId = u.id
      WHERE ptm.taskId = ?
    `).all(t.id);

    t.tags = db.prepare(`
      SELECT tg.*
      FROM project_task_tags ptt
      JOIN tags tg ON ptt.tagId = tg.id
      WHERE ptt.taskId = ?
    `).all(t.id);

    t.checklists = db.prepare("SELECT * FROM project_task_checklists WHERE taskId = ? ORDER BY sortOrder ASC").all(t.id);

    t.dependencies = db.prepare(`
      SELECT pt.id, pt.title, pt.isCompleted
      FROM project_task_dependencies ptd
      JOIN project_tasks pt ON ptd.dependsOnTaskId = pt.id
      WHERE ptd.taskId = ?
    `).all(t.id);
  }

  // Group tasks by stageId
  const tasksByStage: Record<string, any[]> = {};
  for (const t of tasks) {
    if (!tasksByStage[t.stageId]) {
      tasksByStage[t.stageId] = [];
    }
    tasksByStage[t.stageId].push(t);
  }

  // Attach tasks to stages
  for (const stage of stages) {
    stage.tasks = tasksByStage[stage.id] || [];
  }

  return c.json(stages);
});

// Create stage
projectsRouter.post("/:id/stages", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canWrite } = getProjectPermission(id, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目", code: "FORBIDDEN" }, 403);

  const { name, bgColor = null } = body;
  if (!name) return c.json({ error: "看板列名称不能为空" }, 400);

  const stageId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_stages WHERE projectId = ?").get(id) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  db.prepare("INSERT INTO project_stages (id, projectId, name, sortOrder, bgColor) VALUES (?, ?, ?, ?, ?)").run(stageId, id, name, sortOrder, bgColor);

  const createdStage = db.prepare("SELECT * FROM project_stages WHERE id = ?").get(stageId);
  return c.json(createdStage);
});

// Update stage
projectsRouter.put("/stages/:stageId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const stageId = c.req.param("stageId");
  const body = await c.req.json();

  const stage = db.prepare("SELECT projectId FROM project_stages WHERE id = ?").get(stageId) as { projectId: string } | undefined;
  if (!stage) return c.json({ error: "看板列不存在" }, 404);

  const { canWrite } = getProjectPermission(stage.projectId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目", code: "FORBIDDEN" }, 403);

  const { name, sortOrder, bgColor } = body;
  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) { updates.push("name = ?"); params.push(name); }
  if (sortOrder !== undefined) { updates.push("sortOrder = ?"); params.push(sortOrder); }
  if (bgColor !== undefined) { updates.push("bgColor = ?"); params.push(bgColor); }

  if (updates.length > 0) {
    params.push(stageId);
    db.prepare(`UPDATE project_stages SET ${updates.join(", ")} WHERE id = ?`).run(params);
  }

  return c.json({ success: true });
});

// Delete stage
projectsRouter.delete("/stages/:stageId", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const stageId = c.req.param("stageId");

  const stage = db.prepare("SELECT projectId FROM project_stages WHERE id = ?").get(stageId) as { projectId: string } | undefined;
  if (!stage) return c.json({ error: "看板列不存在" }, 404);

  const { canWrite } = getProjectPermission(stage.projectId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目", code: "FORBIDDEN" }, 403);

  // Move tasks to another stage or delete them? For now, prevent delete if not empty.
  const taskCount = db.prepare("SELECT COUNT(*) as count FROM project_tasks WHERE stageId = ?").get(stageId) as { count: number };
  if (taskCount.count > 0) {
    return c.json({ error: "请先清空或转移该看板列下的任务" }, 400);
  }

  db.prepare("DELETE FROM project_stages WHERE id = ?").run(stageId);
  return c.json({ message: "看板列已删除" });
});

// 3. Project Tasks
// List tasks
projectsRouter.get("/:id/tasks", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canRead } = getProjectPermission(id, userId);
  if (!canRead) return c.json({ error: "无权查看该项目任务", code: "FORBIDDEN" }, 403);

  const db = getDb();
  const tasks = db.prepare(`
    SELECT pt.*, u.username as assigneeName, u.displayName as assigneeDisplayName, u.avatarUrl as assigneeAvatarUrl
    FROM project_tasks pt
    LEFT JOIN users u ON pt.assigneeId = u.id
    WHERE pt.projectId = ?
    ORDER BY pt.sortOrder ASC
  `).all(id) as any[];

  for (const t of tasks) {
    t.participants = db.prepare(`
      SELECT u.id, u.username, u.displayName, u.avatarUrl
      FROM project_task_members ptm
      JOIN users u ON ptm.userId = u.id
      WHERE ptm.taskId = ?
    `).all(t.id);

    t.tags = db.prepare(`
      SELECT tg.*
      FROM project_task_tags ptt
      JOIN tags tg ON ptt.tagId = tg.id
      WHERE ptt.taskId = ?
    `).all(t.id);

    t.checklists = db.prepare("SELECT * FROM project_task_checklists WHERE taskId = ? ORDER BY sortOrder ASC").all(t.id);

    t.dependencies = db.prepare(`
      SELECT pt.id, pt.title, pt.isCompleted
      FROM project_task_dependencies ptd
      JOIN project_tasks pt ON ptd.dependsOnTaskId = pt.id
      WHERE ptd.taskId = ?
    `).all(t.id);
  }

  return c.json(tasks);
});

// Get single project task details
projectsRouter.get("/tasks/:taskId", (c) => {
  const db = getDb();
  const taskId = c.req.param("taskId");
  const task = getFullProjectTask(db, taskId);
  if (!task) return c.json({ error: "任务不存在" }, 404);
  return c.json(task);
});

function getFullProjectTask(db: any, taskId: string) {
  const t = db.prepare(`
    SELECT pt.*, u.username as assigneeName, u.displayName as assigneeDisplayName, u.avatarUrl as assigneeAvatarUrl,
           p.name as projectName, p.workspaceId as projectWorkspaceId, ps.name as stageName
    FROM project_tasks pt
    LEFT JOIN users u ON pt.assigneeId = u.id
    JOIN projects p ON pt.projectId = p.id
    LEFT JOIN project_stages ps ON pt.stageId = ps.id
    WHERE pt.id = ?
  `).get(taskId) as any;
  if (!t) return null;

  t.participants = db.prepare(`
    SELECT u.id, u.username, u.displayName, u.avatarUrl
    FROM project_task_members ptm
    JOIN users u ON ptm.userId = u.id
    WHERE ptm.taskId = ?
  `).all(taskId);

  t.tags = db.prepare(`
    SELECT tg.*
    FROM project_task_tags ptt
    JOIN tags tg ON ptt.tagId = tg.id
    WHERE ptt.taskId = ?
  `).all(taskId);

  t.checklists = db.prepare("SELECT * FROM project_task_checklists WHERE taskId = ? ORDER BY sortOrder ASC").all(taskId);

  t.dependencies = db.prepare(`
    SELECT pt.id, pt.title, pt.isCompleted
    FROM project_task_dependencies ptd
    JOIN project_tasks pt ON ptd.dependsOnTaskId = pt.id
    WHERE ptd.taskId = ?
  `).all(taskId);

  return t;
}

// Create project task
projectsRouter.post("/:id/tasks", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canWrite } = getProjectPermission(id, userId);
  if (!canWrite) return c.json({ error: "无权在此项目内创建任务", code: "FORBIDDEN" }, 403);

  const { stageId, title, description = "", assigneeId = null, startDate = null, endDate = null, cover = "", participants = [], tags = [], priority = 2, remindAt = null, titleColor = null, progress = 0, isRecurring = 0, recurrenceRule = null, dependencies = [], status = 'pending', reminderOffsetValue = 1, reminderOffsetUnit = 'day', recurrenceEndDate = null } = body;
  if (!title) return c.json({ error: "任务标题不能为空" }, 400);
  if (!stageId) return c.json({ error: "必须指定任务阶段" }, 400);

  const taskId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_tasks WHERE stageId = ?").get(stageId) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  let calculatedEndDate = endDate;
  if (isRecurring && recurrenceRule) {
    try {
       let rule = typeof recurrenceRule === 'string' ? JSON.parse(recurrenceRule) : recurrenceRule;
       const now = new Date();
       const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
       calculatedEndDate = getNextOccurrenceString(todayStr, rule);
    } catch (e) {
      console.warn("Failed to calculate initial recurring end date", e);
    }
  }

  let calculatedRemindAt = remindAt;
  if (calculatedEndDate && (!remindAt || isRecurring)) {
    try {
       calculatedRemindAt = calculateRemindAt(calculatedEndDate, reminderOffsetValue, reminderOffsetUnit);
    } catch (e) {
       console.warn("Failed to calculate remind at", e);
    }
  }

  db.prepare(`
    INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate, description, cover, sortOrder, creatorId, modifierId, priority, remindAt, titleColor, progress, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, id, stageId, title, status, assigneeId, startDate, calculatedEndDate, description, cover, sortOrder, userId, userId, priority, calculatedRemindAt, titleColor, progress, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate);

  // Add dependencies
  if (Array.isArray(dependencies)) {
    for (const depId of dependencies) {
      if (depId !== taskId) {
        db.prepare("INSERT INTO project_task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)").run(taskId, depId);
      }
    }
  }

  logAudit(userId, "task", "create_task", `创建任务「${title}」`, { targetType: "project_task", targetId: taskId });

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

  const createdTask = getFullProjectTask(db, taskId);
  return c.json(createdTask);
});

// Update project task
projectsRouter.put("/tasks/:taskId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const taskId = c.req.param("taskId");
  const body = await c.req.json();

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as any;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const { canWrite } = getProjectPermission(task.projectId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该项目的任务", code: "FORBIDDEN" }, 403);

  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate } = body;

  let finalIsCompleted = isCompleted;
  let finalProgress = progress;

  let calculatedRemindAt = remindAt !== undefined ? remindAt : task.remindAt;
  const finalOffsetValue = reminderOffsetValue !== undefined ? reminderOffsetValue : task.reminderOffsetValue;
  const finalOffsetUnit = reminderOffsetUnit !== undefined ? reminderOffsetUnit : task.reminderOffsetUnit;

  if (endDate && body.endDate !== undefined && (!calculatedRemindAt || isRecurring)) {
      try {
         calculatedRemindAt = calculateRemindAt(endDate, finalOffsetValue, finalOffsetUnit);
      } catch(e) { console.warn("Failed to update calculated remind at", e); }
  } else if (!endDate && body.endDate === null) {
    calculatedRemindAt = null;
  }

  if (finalProgress !== undefined) {
    const progVal = Number(finalProgress);
    if (progVal === 100) {
      finalIsCompleted = 1;
    } else {
      finalIsCompleted = 0;
    }
  } else if (finalIsCompleted !== undefined) {
    const compVal = (finalIsCompleted === 1 || finalIsCompleted === true) ? 1 : 0;
    if (compVal === 1) {
      finalProgress = 100;
    } else {
      if (task && task.progress === 100) {
        finalProgress = 0;
      }
    }
  }

  // Enforce task dependency constraint
  if (finalIsCompleted === 1 && task.isCompleted === 0) {
    const incompleteDeps = db.prepare(`
      SELECT pt.title FROM project_task_dependencies ptd
      JOIN project_tasks pt ON ptd.dependsOnTaskId = pt.id
      WHERE ptd.taskId = ? AND pt.isCompleted = 0
    `).all(taskId) as { title: string }[];
    
    if (incompleteDeps.length > 0) {
      const depTitles = incompleteDeps.map(d => `「${d.title}」`).join(", ");
      return c.json({
        error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
        code: "DEPENDENCY_UNRESOLVED"
      }, 400);
    }
  }

  // Audit Log Changes
  const getUserName = (id: string | null) => {
    if (!id) return "无";
    const u = db.prepare("SELECT username, displayName FROM users WHERE id = ?").get(id) as { username: string; displayName?: string } | undefined;
    return u ? (u.displayName || u.username) : "未知";
  };

  if (title !== undefined && title !== task.title) {
    logAudit(userId, "task", "update_task_title", `将任务标题从「${task.title}」修改为「${title}」`, { targetType: "project_task", targetId: taskId });
  }
  if (description !== undefined && description !== task.description) {
    logAudit(userId, "task", "update_task_desc", `将任务描述从「${task.description ? (task.description.length > 20 ? task.description.slice(0, 20) + "..." : task.description) : "无"}」修改为「${description ? (description.length > 20 ? description.slice(0, 20) + "..." : description) : "无"}」`, { targetType: "project_task", targetId: taskId });
  }
  if (status !== undefined && status !== task.status) {
    const statusMap: Record<string, string> = {
      pending: "待办",
      in_progress: "进行中",
      completed: "已完成",
      suspended: "挂起"
    };
    const oldStatusLabel = statusMap[task.status] || task.status || "无";
    const newStatusLabel = statusMap[status] || status || "无";
    logAudit(userId, "task", "update_task_status", `将任务状态从「${oldStatusLabel}」修改为「${newStatusLabel}」`, { targetType: "project_task", targetId: taskId });
  }
  if (finalIsCompleted !== undefined && ((finalIsCompleted === 1 || finalIsCompleted === true) ? 1 : 0) !== task.isCompleted) {
    const isComp = (finalIsCompleted === 1 || finalIsCompleted === true);
    logAudit(userId, "task", isComp ? "complete_task" : "reopen_task", isComp ? "完成了任务" : "重新开启了任务", { targetType: "project_task", targetId: taskId });
  }
  if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
    const oldAssigneeName = getUserName(task.assigneeId);
    const newAssigneeName = getUserName(assigneeId);
    logAudit(userId, "task", "update_task_assignee", `将任务负责人从「${oldAssigneeName}」变更为「${newAssigneeName}」`, { targetType: "project_task", targetId: taskId });
  }
  if (startDate !== undefined && startDate !== task.startDate) {
    const oldStart = task.startDate ? task.startDate.split("T")[0] : "无";
    const newStart = startDate ? startDate.split("T")[0] : "无";
    logAudit(userId, "task", "update_task_start_date", `将任务开始时间从「${oldStart}」修改为「${newStart}」`, { targetType: "project_task", targetId: taskId });
  }
  if (endDate !== undefined && endDate !== task.endDate) {
    const oldEnd = task.endDate ? task.endDate.split("T")[0] : "无";
    const newEnd = endDate ? endDate.split("T")[0] : "无";
    logAudit(userId, "task", "update_task_end_date", `将任务截止时间从「${oldEnd}」修改为「${newEnd}」`, { targetType: "project_task", targetId: taskId });
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (title !== undefined) { updates.push("title = ?"); params.push(title); }
  if (description !== undefined) { updates.push("description = ?"); params.push(description); }
  if (finalIsCompleted !== undefined) { updates.push("isCompleted = ?"); params.push((finalIsCompleted === 1 || finalIsCompleted === true) ? 1 : 0); }
  if (status !== undefined) { updates.push("status = ?"); params.push(status); }
  if (assigneeId !== undefined) { updates.push("assigneeId = ?"); params.push(assigneeId); }
  if (startDate !== undefined) { updates.push("startDate = ?"); params.push(startDate); }
  if (endDate !== undefined) { updates.push("endDate = ?"); params.push(endDate); }
  if (cover !== undefined) { updates.push("cover = ?"); params.push(cover); }
  if (stageId !== undefined) { updates.push("stageId = ?"); params.push(stageId); }
  if (projectId !== undefined) { updates.push("projectId = ?"); params.push(projectId); }
  if (sortOrder !== undefined) { updates.push("sortOrder = ?"); params.push(sortOrder); }
  if (priority !== undefined) { updates.push("priority = ?"); params.push(priority); }
  updates.push("remindAt = ?"); params.push(calculatedRemindAt);
  if (titleColor !== undefined) { updates.push("titleColor = ?"); params.push(titleColor); }
  if (finalProgress !== undefined) { updates.push("progress = ?"); params.push(finalProgress); }
  if (isRecurring !== undefined) { updates.push("isRecurring = ?"); params.push((isRecurring === 1 || isRecurring === true) ? 1 : 0); }
  if (recurrenceRule !== undefined) { updates.push("recurrenceRule = ?"); params.push(typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule)); }
  if (reminderOffsetValue !== undefined) { updates.push("reminderOffsetValue = ?"); params.push(reminderOffsetValue); }
  if (reminderOffsetUnit !== undefined) { updates.push("reminderOffsetUnit = ?"); params.push(reminderOffsetUnit); }
  if (recurrenceEndDate !== undefined) { updates.push("recurrenceEndDate = ?"); params.push(recurrenceEndDate); }

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

  // Sync dependencies
  if (dependencies !== undefined && Array.isArray(dependencies)) {
    db.prepare("DELETE FROM project_task_dependencies WHERE taskId = ?").run(taskId);
    for (const depId of dependencies) {
      if (depId !== taskId) {
        db.prepare("INSERT INTO project_task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)").run(taskId, depId);
      }
    }
  }

  const compVal = (finalIsCompleted === 1 || finalIsCompleted === true) ? 1 : 0;
  if (compVal === 1 && task.isCompleted === 0) {
    handleRecurringTask(db, taskId, true);
  }

  const updatedTask = getFullProjectTask(db, taskId);
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

// GET /api/projects/tasks/:taskId/comments - 获取任务评论
projectsRouter.get("/tasks/:taskId/comments", (c) => {
  const db = getDb();
  const taskId = c.req.param("taskId");
  const comments = db.prepare(`
    SELECT ptc.*, u.username, u.displayName, u.avatarUrl
      FROM project_task_comments ptc
      JOIN users u ON ptc.userId = u.id
     WHERE ptc.taskId = ?
     ORDER BY ptc.createdAt ASC
  `).all(taskId) as any[];

  return c.json(comments);
});

// POST /api/projects/tasks/:taskId/comments - 新增任务评论
projectsRouter.post("/tasks/:taskId/comments", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const taskId = c.req.param("taskId");
  const body = await c.req.json();
  const { content } = body;

  if (!content || !content.trim()) {
    return c.json({ error: "评论内容不能为空" }, 400);
  }

  const commentId = uuid();
  db.prepare(`
    INSERT INTO project_task_comments (id, taskId, userId, content, createdAt)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(commentId, taskId, userId, content.trim());

  // 写修改审计日志
  logAudit(userId, "task", "add_task_comment", `发表了任务评论: 「${content.trim().slice(0, 30)}${content.trim().length > 30 ? "..." : ""}」`, { targetType: "project_task", targetId: taskId });

  const newComment = db.prepare(`
    SELECT ptc.*, u.username, u.displayName, u.avatarUrl
      FROM project_task_comments ptc
      JOIN users u ON ptc.userId = u.id
     WHERE ptc.id = ?
  `).get(commentId) as any;

  return c.json(newComment);
});

export default projectsRouter;
