import { Hono } from "hono";
import { getDb } from "../db/schema.js";
import { v4 as uuid } from "uuid";
import { logAudit } from "../services/audit.js";
import { canManageResource } from "../middleware/acl.js";
import { handleRecurringTask } from "../lib/recurrence.js";
import { broadcastToWorkspace } from "../lib/mentions.js";
import { createMentions } from "../lib/mentions.js";
import { calculateRemindAt } from "../lib/reminders.js";
import { getNextOccurrenceString } from "../lib/recurrence.js";

const tasks = new Hono();

// 获取任务列表
tasks.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId");

  let query = "SELECT * FROM tasks WHERE userId = ? AND (parentId IS NULL OR parentId = '')";
  const params: any[] = [userId];

  if (workspaceId) {
    query += " AND workspaceId = ?";
    params.push(workspaceId);
  } else {
    query += " AND (workspaceId IS NULL OR workspaceId = '')";
  }

  query += " ORDER BY isCompleted ASC, sortOrder ASC, createdAt DESC";

  const rows = db.prepare(query).all(params) as any[];

  // 为每个任务获取标签和子任务
  for (const row of rows) {
    row.tags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN task_tags tt ON t.id = tt.tagId
      WHERE tt.taskId = ?
    `).all(row.id);

    row.subTasks = db.prepare("SELECT * FROM tasks WHERE parentId = ? ORDER BY sortOrder ASC").all(row.id);
    for (const sub of row.subTasks) {
       sub.tags = db.prepare(`
        SELECT t.* FROM tags t
        JOIN task_tags tt ON t.id = tt.tagId
        WHERE tt.taskId = ?
      `).all(sub.id);
    }

    row.dependencies = db.prepare(`
      SELECT t.id, t.title, t.isCompleted
      FROM task_dependencies td
      JOIN tasks t ON td.dependsOnTaskId = t.id
      WHERE td.taskId = ?
    `).all(row.id);
  }

  return c.json(rows);
});

// 获取单个任务
tasks.get("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (task.userId !== userId && !task.workspaceId) {
     // Check workspace permissions if needed, but for now simple owner check
     return c.json({ error: "Forbidden" }, 403);
  }

  task.tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN task_tags tt ON t.id = tt.tagId
    WHERE tt.taskId = ?
  `).all(id);

  task.subTasks = db.prepare("SELECT * FROM tasks WHERE parentId = ? ORDER BY sortOrder ASC").all(id);

  task.dependencies = db.prepare(`
    SELECT t.id, t.title, t.isCompleted
    FROM task_dependencies td
    JOIN tasks t ON td.dependsOnTaskId = t.id
    WHERE td.taskId = ?
  `).all(id);

  return c.json(task);
});

// 创建任务
tasks.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();

  const { title, workspaceId, priority = 2, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule, tagIds, dependencies, reminderOffsetValue = 1, reminderOffsetUnit = 'day', recurrenceEndDate = null } = body;

  if (!title) return c.json({ error: "Title is required" }, 400);

  const id = uuid();
  const effectiveWorkspaceId = workspaceId || null;

  let calculatedDueDate = dueDate;
  if (isRecurring && recurrenceRule) {
    try {
       let rule = typeof recurrenceRule === 'string' ? JSON.parse(recurrenceRule) : recurrenceRule;
       const now = new Date();
       const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
       calculatedDueDate = getNextOccurrenceString(todayStr, rule);
    } catch (e) {
      console.warn("Failed to calculate initial recurring due date", e);
    }
  }

  let calculatedRemindAt = remindAt;
  if (calculatedDueDate && (!remindAt || isRecurring)) {
    try {
       calculatedRemindAt = calculateRemindAt(calculatedDueDate, reminderOffsetValue, reminderOffsetUnit);
    } catch (e) {
       console.warn("Failed to calculate remind at", e);
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, userId, workspaceId, title, isCompleted, status, priority, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, effectiveWorkspaceId, title.trim(), priority, calculatedDueDate, calculatedRemindAt, noteId, parentId, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate);

    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const insertTag = db.prepare("INSERT INTO task_tags (taskId, tagId) VALUES (?, ?)");
      for (const tagId of tagIds) {
        insertTag.run(id, tagId);
      }
    }

    // Add dependencies
    if (Array.isArray(dependencies) && dependencies.length > 0) {
      const insertDep = db.prepare("INSERT INTO task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)");
      for (const depId of dependencies) {
        if (depId !== id) {
          insertDep.run(id, depId);
        }
      }
    }
  });

  try {
    tx();
  } catch (err: any) {
    return c.json({ error: `创建失败：${err?.message || err}` }, 500);
  }

  const created = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN task_tags tt ON t.id = tt.tagId
    WHERE tt.taskId = ?
  `).all(id);

  // 解析 @提及
  if (title) {
    try {
      createMentions("task", id, title.trim().slice(0, 80), title, userId);
    } catch (e) {
      console.warn("[tasks.post] createMentions failed:", e);
    }
  }

  logAudit(userId, "task", "create_task", `创建待办「${title}」`, { targetType: "task", targetId: id });

  return c.json({ ...created, tags }, 201);
});

// 更新任务
tasks.put("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  return c.req.json().then(async (body: any) => {
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!existing) return c.json({ error: "Task not found" }, 404);

    if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
      return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
    }

    const title = body.title ?? existing.title;
    const isCompleted = body.isCompleted ?? existing.isCompleted;
    const status = body.status ?? existing.status;
    const priority = body.priority ?? existing.priority;
    const dueDate = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    let calculatedRemindAt = body.remindAt !== undefined ? body.remindAt : existing.remindAt;
    const noteId = body.noteId !== undefined ? body.noteId : existing.noteId;
    const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
    const sortOrder = body.sortOrder ?? existing.sortOrder;
    const isRecurring = body.isRecurring ?? existing.isRecurring;
    const recurrenceRule = body.recurrenceRule !== undefined ? body.recurrenceRule : existing.recurrenceRule;
    const finalOffsetValue = body.reminderOffsetValue !== undefined ? body.reminderOffsetValue : existing.reminderOffsetValue;
    const finalOffsetUnit = body.reminderOffsetUnit !== undefined ? body.reminderOffsetUnit : existing.reminderOffsetUnit;
    const recurrenceEndDate = body.recurrenceEndDate !== undefined ? body.recurrenceEndDate : existing.recurrenceEndDate;
    const tagIds = body.tagIds;
    const dependencies = body.dependencies;

    if (dueDate && body.dueDate !== undefined && (!calculatedRemindAt || isRecurring)) {
        try {
           calculatedRemindAt = calculateRemindAt(dueDate, finalOffsetValue, finalOffsetUnit);
        } catch(e) { console.warn("Failed to update calculated remind at", e); }
    } else if (!dueDate && body.dueDate === null) {
      calculatedRemindAt = null;
    }

    // Enforce task dependency constraint
    if ((isCompleted === 1 || isCompleted === true) && existing.isCompleted === 0) {
      const incompleteDeps = db.prepare(`
        SELECT t.title FROM task_dependencies td
        JOIN tasks t ON td.dependsOnTaskId = t.id
        WHERE td.taskId = ? AND t.isCompleted = 0
      `).all(id) as { title: string }[];
      
      if (incompleteDeps.length > 0) {
        const depTitles = incompleteDeps.map(d => `「${d.title}」`).join(", ");
        return c.json({
          error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
          code: "DEPENDENCY_UNRESOLVED"
        }, 400);
      }
    }

    // Status change handling
    if (body.status !== undefined && body.status !== existing.status) {
      logAudit(userId, "task", "update_task_status", `修改任务状态为: ${body.status}`, { targetType: "task", targetId: id });
      if (body.status === "paused") {
        const { propagateStatusDown } = await import("../lib/planStatusSync.js");
        propagateStatusDown(db, "task", id, "paused", userId);
      }
    }

    // Audit Log Changes
    if (body.title !== undefined && body.title !== existing.title) {
      logAudit(userId, "task", "update_task_title", `修改任务标题为: 「${body.title}」`, { targetType: "task", targetId: id });
    }
    if (body.isCompleted !== undefined && (body.isCompleted ? 1 : 0) !== existing.isCompleted) {
      const isComp = !!body.isCompleted;
      logAudit(userId, "task", isComp ? "complete_task" : "reopen_task", isComp ? "完成了任务" : "重新开启了任务", { targetType: "task", targetId: id });
    }
    if (body.priority !== undefined && body.priority !== existing.priority) {
      logAudit(userId, "task", "update_task_priority", `修改任务优先级为: ${body.priority}`, { targetType: "task", targetId: id });
    }
    if (body.dueDate !== undefined && body.dueDate !== existing.dueDate) {
      logAudit(userId, "task", "update_task_due_date", `修改截止日期为: ${body.dueDate || "无"}`, { targetType: "task", targetId: id });
    }

    // 重新挂接父任务时再次校验同域约束
    if (body.parentId !== undefined && body.parentId !== null && body.parentId !== existing.parentId) {
      const parent = db
        .prepare("SELECT workspaceId FROM tasks WHERE id = ?")
        .get(body.parentId) as { workspaceId: string | null } | undefined;
      if (!parent) return c.json({ error: "父任务不存在" }, 404);
      if (parent.workspaceId !== existing.workspaceId) {
        return c.json(
          { error: "子任务必须与父任务在同一工作区", code: "SCOPE_MISMATCH" },
          400,
        );
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE tasks SET title = ?, isCompleted = ?, status = ?, priority = ?, dueDate = ?, remindAt = ?,
          noteId = ?, parentId = ?, sortOrder = ?, isRecurring = ?, recurrenceRule = ?, reminderOffsetValue = ?, reminderOffsetUnit = ?, recurrenceEndDate = ?, updatedAt = datetime('now')
        WHERE id = ?
      `).run(title, isCompleted, status, priority, dueDate, calculatedRemindAt, noteId, parentId, sortOrder, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), finalOffsetValue, finalOffsetUnit, recurrenceEndDate, id);

      if (tagIds !== undefined && Array.isArray(tagIds)) {
        db.prepare("DELETE FROM task_tags WHERE taskId = ?").run(id);
        if (tagIds.length > 0) {
          const insertTag = db.prepare("INSERT INTO task_tags (taskId, tagId) VALUES (?, ?)");
          for (const tagId of tagIds) {
            insertTag.run(id, tagId);
          }
        }
      }

      // Sync dependencies
      if (dependencies !== undefined && Array.isArray(dependencies)) {
        db.prepare("DELETE FROM task_dependencies WHERE taskId = ?").run(id);
        for (const depId of dependencies) {
          if (depId !== id) {
            db.prepare("INSERT INTO task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)").run(id, depId);
          }
        }
      }
    });

    try {
      tx();
      if ((body.isCompleted === 1 || body.isCompleted === true) && existing.isCompleted === 0) {
        handleRecurringTask(db, id, false);
      }
    } catch (err: any) {
      return c.json({ error: `更新失败：${err?.message || err}` }, 500);
    }

    // 解析 @提及（标题变更时）
    if (body.title) {
      try {
        createMentions("task", id, body.title.trim().slice(0, 80), body.title, userId);
      } catch (e) {
        console.warn("[tasks.put] createMentions failed:", e);
      }
    }

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    const tags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN task_tags tt ON t.id = tt.tagId
      WHERE tt.taskId = ?
    `).all(id);

    const updatedDependencies = db.prepare(`
      SELECT t.id, t.title, t.isCompleted
      FROM task_dependencies td
      JOIN tasks t ON td.dependsOnTaskId = t.id
      WHERE td.taskId = ?
    `).all(id);

    return c.json({ ...updated, tags, dependencies: updatedDependencies });
  });
});

// 切换完成状态（快捷操作）
tasks.patch("/:id/toggle", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | { userId: string; workspaceId: string | null; isCompleted: number }
    | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (!canManageResource(task.userId, task.workspaceId, userId)) {
    return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
  }

  const newStatus = task.isCompleted ? 0 : 1;
  
  if (newStatus === 1) {
    const incompleteDeps = db.prepare(`
      SELECT t.title FROM task_dependencies td
      JOIN tasks t ON td.dependsOnTaskId = t.id
      WHERE td.taskId = ? AND t.isCompleted = 0
    `).all(id) as { title: string }[];
    
    if (incompleteDeps.length > 0) {
      const depTitles = incompleteDeps.map(d => `「${d.title}」`).join(", ");
      return c.json({
        error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
        code: "DEPENDENCY_UNRESOLVED"
      }, 400);
    }
  }

  db.prepare("UPDATE tasks SET isCompleted = ?, updatedAt = datetime('now') WHERE id = ?").run(newStatus, id);
  logAudit(userId, "task", newStatus === 1 ? "complete_task" : "reopen_task", newStatus === 1 ? "完成了任务" : "重新开启了任务", { targetType: "task", targetId: id });

  if (newStatus === 1) {
    handleRecurringTask(db, id, false);
  }

  // 任务完成时通知工作区成员
  if (newStatus === 1 && task.workspaceId) {
    try {
      broadcastToWorkspace(
        task.workspaceId, "task_completed", "task", id,
        null, userId, userId,
      );
    } catch (e) {
      console.warn("[tasks.toggle] broadcastToWorkspace failed:", e);
    }
  }

  const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN task_tags tt ON t.id = tt.tagId
    WHERE tt.taskId = ?
  `).all(id);

  return c.json({ ...updated, tags });
});

// 删除任务
tasks.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const task = db.prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?").get(id) as
    | { userId: string; workspaceId: string | null }
    | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (!canManageResource(task.userId, task.workspaceId, userId)) {
    return c.json({ error: "无权删除该任务", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return c.json({ success: true });
});

// 任务统计摘要
tasks.get("/stats/summary", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId");

  const baseWhere = workspaceId
    ? "WHERE userId = ? AND workspaceId = ?"
    : "WHERE userId = ? AND (workspaceId IS NULL OR workspaceId = '')";
  const baseParams: any[] = workspaceId ? [userId, workspaceId] : [userId];

  const count = (sql: string) => {
    const row = db.prepare(`SELECT COUNT(*) as count FROM tasks ${baseWhere} AND ${sql}`).get(...baseParams) as any;
    return row?.count ?? 0;
  };

  const total = (db.prepare(`SELECT COUNT(*) as count FROM tasks ${baseWhere}`).get(...baseParams) as any)?.count ?? 0;
  const completed = count("isCompleted = 1");
  const pending = total - completed;
  const today = count("isCompleted = 0 AND dueDate = date('now')");
  const overdue = count("isCompleted = 0 AND dueDate IS NOT NULL AND dueDate < date('now')");
  const week = count("isCompleted = 0 AND dueDate IS NOT NULL AND dueDate >= date('now') AND dueDate <= date('now', '+7 days')");
  const personalActiveReminders = count("isCompleted = 0 AND remindAt IS NOT NULL AND remindAt <= datetime('now', 'localtime')");

  let projectActiveReminders = 0;
  try {
    const projectWhere = workspaceId
      ? "WHERE p.isDeleted = 0 AND pt.assigneeId = ? AND COALESCE(pt.isCompleted, 0) != 1 AND (ps.name IS NULL OR ps.name != '已完成') AND pt.remindAt IS NOT NULL AND pt.remindAt <= datetime('now', 'localtime') AND p.workspaceId = ?"
      : "WHERE p.isDeleted = 0 AND pt.assigneeId = ? AND COALESCE(pt.isCompleted, 0) != 1 AND (ps.name IS NULL OR ps.name != '已完成') AND pt.remindAt IS NOT NULL AND pt.remindAt <= datetime('now', 'localtime') AND (p.workspaceId IS NULL OR p.workspaceId = '')";
    const projectParams = workspaceId ? [userId, workspaceId] : [userId];
    const row = db.prepare(`
      SELECT COUNT(*) as count 
      FROM project_tasks pt
      JOIN projects p ON pt.projectId = p.id
      LEFT JOIN project_stages ps ON pt.stageId = ps.id
      ${projectWhere}
    `).get(...projectParams) as any;
    projectActiveReminders = row?.count ?? 0;
  } catch (err) {
    console.error("Failed to query project task active reminders:", err);
  }

  const activeReminders = personalActiveReminders + projectActiveReminders;

  return c.json({ total, completed, pending, today, overdue, week, activeReminders });
});

export default tasks;
