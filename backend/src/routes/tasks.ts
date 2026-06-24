import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db/schema";
import crypto from "crypto";
import { handleRecurringTask } from "../lib/recurrence";
import { logAudit } from "../services/audit.js";
import {
  getUserWorkspaceRole,
  canManageResource,
  requireWorkspaceFeature,
} from "../middleware/acl";
import { createMentions, broadcastToWorkspace } from "../lib/mentions";

const tasks = new Hono();

// ---------------------------------------------------------------------------
// Phase 2/Y3: 工作区 scope 解析
// ---------------------------------------------------------------------------
// tasks 路由兼容两种作用域：
//   - 个人空间：`?workspaceId=` 未传 / 'personal' → tasks.workspaceId IS NULL
//   - 工作区：   `?workspaceId=<uuid>`            → tasks.workspaceId = <uuid>
//                                                  （需要成员身份 + tasks 功能开关未关闭）
//
// 与 diary.ts 同款语义：
//   - 列表/创建/统计等"集合"接口由 requireWorkspaceFeature("tasks") 中间件
//     校验功能开关；
//   - 按 id 的读/写/删走资源行自带的 workspaceId 做 ACL（canManageResource）
//     —— 为了让"创建者本人 / admin / owner 在工作区内可编辑/删除他人任务"
//     的语义自然成立。
function resolveTaskScope(
  c: Context,
  userId: string,
): { scope: "personal" | "workspace"; workspaceId: string | null; error?: string } {
  const raw = c.req.query("workspaceId");
  if (!raw || raw === "personal") {
    return { scope: "personal", workspaceId: null };
  }
  const role = getUserWorkspaceRole(raw, userId);
  if (!role) {
    return { scope: "workspace", workspaceId: raw, error: "无权访问该工作区" };
  }
  return { scope: "workspace", workspaceId: raw };
}

// 获取所有任务
tasks.get("/", requireWorkspaceFeature("tasks"), (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const filter = c.req.query("filter"); // all | today | week | overdue | completed
  const noteId = c.req.query("noteId");
  const search = c.req.query("search");
  const tagId = c.req.query("tagId");

  const scope = resolveTaskScope(c, userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  let sql: string;
  const params: any[] = [];
  const selectFields = `tasks.*, users.username AS creatorName,
    (SELECT json_group_array(json_object('id', t.id, 'name', t.name, 'color', t.color))
     FROM tags t
     JOIN task_tags tt ON t.id = tt.tagId
     WHERE tt.taskId = tasks.id) AS tagsJson`;

  if (scope.scope === "workspace") {
    sql = `SELECT ${selectFields}
           FROM tasks LEFT JOIN users ON users.id = tasks.userId
           WHERE workspaceId = ?`;
    params.push(scope.workspaceId);
  } else {
    sql = `SELECT ${selectFields}
           FROM tasks LEFT JOIN users ON users.id = tasks.userId
           WHERE tasks.userId = ? AND workspaceId IS NULL`;
    params.push(userId);
  }

  if (noteId) {
    sql += ` AND noteId = ?`;
    params.push(noteId);
  }

  if (search && search.trim()) {
    sql += ` AND tasks.title LIKE ?`;
    params.push(`%${search.trim()}%`);
  }

  if (tagId) {
    sql += ` AND tasks.id IN (SELECT taskId FROM task_tags WHERE tagId = ?)`;
    params.push(tagId);
  }

  if (filter === "today") {
    sql += ` AND dueDate IS NOT NULL AND date(dueDate) = date('now', 'localtime')`;
  } else if (filter === "week") {
    sql += ` AND dueDate IS NOT NULL AND date(dueDate) BETWEEN date('now', 'localtime') AND date('now', 'localtime', '+7 days')`;
  } else if (filter === "overdue") {
    sql += ` AND isCompleted = 0 AND dueDate IS NOT NULL AND date(dueDate) < date('now', 'localtime')`;
  } else if (filter === "completed") {
    sql += ` AND isCompleted = 1`;
  }

  sql += ` ORDER BY isCompleted ASC, priority DESC, sortOrder ASC, tasks.createdAt DESC`;

  const rows = db.prepare(sql).all(...params) as any[];
  const tasksWithTags = rows.map((row) => ({
    ...row,
    tags: row.tagsJson ? JSON.parse(row.tagsJson) : [],
    tagsJson: undefined,
  }));
  return c.json(tasksWithTags);
});

// 获取任务统计（必须在 /:id 之前注册）
tasks.get("/stats/summary", requireWorkspaceFeature("tasks"), (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;

  const scope = resolveTaskScope(c, userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  const whereSql = scope.scope === "workspace"
    ? "workspaceId = ?"
    : "userId = ? AND workspaceId IS NULL";
  const whereArg = scope.scope === "workspace" ? scope.workspaceId : userId;

  const row = db.prepare(`
    SELECT
      COUNT(*)                                                                          AS total,
      SUM(CASE WHEN isCompleted = 1 THEN 1 ELSE 0 END)                                 AS completed,
      SUM(CASE WHEN isCompleted = 0 AND dueDate IS NOT NULL
               AND date(dueDate) = date('now', 'localtime') THEN 1 ELSE 0 END)         AS today,
      SUM(CASE WHEN isCompleted = 0 AND dueDate IS NOT NULL
               AND date(dueDate) < date('now', 'localtime') THEN 1 ELSE 0 END)         AS overdue,
      SUM(CASE WHEN isCompleted = 0 AND dueDate IS NOT NULL
               AND date(dueDate) BETWEEN date('now', 'localtime')
                                     AND date('now', 'localtime', '+7 days')
               THEN 1 ELSE 0 END)                                                      AS week,
      SUM(CASE WHEN isCompleted = 0 AND remindAt IS NOT NULL
               AND date(remindAt) <= date('now', 'localtime') THEN 1 ELSE 0 END)       AS activeReminders
    FROM tasks
    WHERE ${whereSql}
  `).get(whereArg) as any;

  const total           = row.total           ?? 0;
  const completed       = row.completed       ?? 0;
  const today           = row.today           ?? 0;
  const overdue         = row.overdue         ?? 0;
  const week            = row.week            ?? 0;
  const activeReminders = row.activeReminders ?? 0;

  return c.json({ total, completed, pending: total - completed, today, overdue, week, activeReminders });
});

// ---------------------------------------------------------------------------
// 按 id 访问的工具：校验读/写权限
// ---------------------------------------------------------------------------
// 可读判定：工作区任务 → 成员即可读；个人任务 → 仅 owner 本人。
function canReadTask(
  task: { userId: string; workspaceId: string | null },
  actorId: string,
): boolean {
  if (!actorId) return false;
  if (task.workspaceId) {
    return getUserWorkspaceRole(task.workspaceId, actorId) !== null;
  }
  return task.userId === actorId;
}

/**
 * 获取日历数据：返回指定月份有待办事项的日期列表
 *   GET /api/tasks/calendar?year=2026&month=6
 *   query: workspaceId?
 */
tasks.get("/calendar", requireWorkspaceFeature("tasks"), (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const year = parseInt(c.req.query("year") || "0");
  const month = parseInt(c.req.query("month") || "0");

  if (year < 2000 || year > 2100 || month < 1 || month > 12) {
    return c.json({ error: "参数错误" }, 400);
  }

  const scope = resolveTaskScope(c, userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  const pad = (n: number) => n.toString().padStart(2, "0");
  const fromStr = `${year}-${pad(month)}-01`;
  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;
  const toStr = `${nextY}-${pad(nextM)}-01`;

  let whereSql: string;
  const args: unknown[] = [];

  if (scope.scope === "workspace") {
    whereSql = "tasks.workspaceId = ?";
    args.push(scope.workspaceId);
  } else {
    whereSql = "tasks.userId = ? AND tasks.workspaceId IS NULL";
    args.push(userId);
  }

  whereSql += " AND dueDate IS NOT NULL AND date(dueDate) >= ? AND date(dueDate) < ?";
  args.push(fromStr, toStr);

  // 每组日期只算未完成的任务数 + 总任务数
  const rows = db
    .prepare(
      `SELECT date(dueDate) as d,
              COUNT(*) as total,
              SUM(CASE WHEN isCompleted = 0 THEN 1 ELSE 0 END) as pending
       FROM tasks WHERE ${whereSql}
       GROUP BY date(dueDate)
       ORDER BY d ASC`,
    )
    .all(...args) as { d: string; total: number; pending: number }[];

  const dates = rows.map((r) => ({
    date: r.d,
    total: r.total,
    pending: r.pending,
  }));
  return c.json({ dates, year, month });
});

// 获取单个任务（含子任务）
// Y3: 读权限按 scope——工作区内的任何成员可见，个人任务仅本人可见。
tasks.get("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (!canReadTask(task, userId)) {
    return c.json({ error: "Task not found" }, 404);
  }

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN task_tags tt ON t.id = tt.tagId
    WHERE tt.taskId = ?
  `).all(id);

  const children = db.prepare(
    "SELECT * FROM tasks WHERE parentId = ? ORDER BY sortOrder ASC, createdAt ASC"
  ).all(id) as any[];

  const childrenWithTags = children.map(child => {
    const childTags = db.prepare(`
      SELECT t.* FROM tags t
      JOIN task_tags tt ON t.id = tt.tagId
      WHERE tt.taskId = ?
    `).all(child.id);
    return { ...child, tags: childTags };
  });

  const dependencies = db.prepare(`
    SELECT t.id, t.title, t.isCompleted
    FROM task_dependencies td
    JOIN tasks t ON td.dependsOnTaskId = t.id
    WHERE td.taskId = ?
  `).all(id);

  return c.json({ ...task, tags, children: childrenWithTags, dependencies });
});

// 创建任务
tasks.post("/", requireWorkspaceFeature("tasks"), async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;

  const scope = resolveTaskScope(c, userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  const body: any = await c.req.json();
  const id = crypto.randomUUID();
  const {
    title,
    priority = 2,
    dueDate = null,
    remindAt = null,
    noteId = null,
    parentId = null,
    tagIds = [],
    isRecurring = 0,
    recurrenceRule = null,
    dependencies = []
  } = body;

  if (!title || !title.trim()) {
    return c.json({ error: "Title is required" }, 400);
  }

  // 父任务继承：子任务必须与父任务在同一 scope。
  let effectiveWorkspaceId: string | null = scope.workspaceId;
  if (parentId) {
    const parent = db
      .prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?")
      .get(parentId) as { userId: string; workspaceId: string | null } | undefined;
    if (!parent) return c.json({ error: "父任务不存在" }, 404);
    if (!canReadTask(parent, userId)) {
      return c.json({ error: "无权在该父任务下创建子任务", code: "FORBIDDEN" }, 403);
    }
    if (effectiveWorkspaceId !== parent.workspaceId) {
      return c.json(
        { error: "子任务必须与父任务在同一工作区", code: "SCOPE_MISMATCH" },
        400,
      );
    }
    effectiveWorkspaceId = parent.workspaceId;
  }

  let calculatedRemindAt = remindAt;
  if (dueDate && !calculatedRemindAt) {
    try {
      const date = new Date(dueDate);
      date.setDate(date.getDate() - 1);
      calculatedRemindAt = date.toISOString().split("T")[0];
    } catch {}
  }

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, userId, workspaceId, title, isCompleted, priority, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, effectiveWorkspaceId, title.trim(), priority, dueDate, calculatedRemindAt, noteId, parentId, isRecurring, recurrenceRule);

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

  return c.req.json().then((body: any) => {
    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!existing) return c.json({ error: "Task not found" }, 404);

    if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
      return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
    }

    const title = body.title ?? existing.title;
    const isCompleted = body.isCompleted ?? existing.isCompleted;
    const priority = body.priority ?? existing.priority;
    const dueDate = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    let remindAt = body.remindAt !== undefined ? body.remindAt : existing.remindAt;
    const noteId = body.noteId !== undefined ? body.noteId : existing.noteId;
    const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
    const sortOrder = body.sortOrder ?? existing.sortOrder;
    const isRecurring = body.isRecurring ?? existing.isRecurring;
    const recurrenceRule = body.recurrenceRule !== undefined ? body.recurrenceRule : existing.recurrenceRule;
    const tagIds = body.tagIds;
    const dependencies = body.dependencies;

    if (dueDate && !remindAt && body.dueDate !== undefined) {
      try {
        const date = new Date(dueDate);
        date.setDate(date.getDate() - 1);
        remindAt = date.toISOString().split("T")[0];
      } catch {}
    } else if (!dueDate) {
      remindAt = null;
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
        UPDATE tasks SET title = ?, isCompleted = ?, priority = ?, dueDate = ?, remindAt = ?,
          noteId = ?, parentId = ?, sortOrder = ?, isRecurring = ?, recurrenceRule = ?, updatedAt = datetime('now')
        WHERE id = ?
      `).run(title, isCompleted, priority, dueDate, remindAt, noteId, parentId, sortOrder, isRecurring, recurrenceRule, id);

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

export default tasks;
