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

/**
 * P1 收尾 / P2-X2：/api/tasks 兼容层
 * ---------------------------------------------------------------------------
 * 产品任务模型已统一到 project_tasks（个人TODO/家庭TODO）。
 * 本路由对旧客户端保持 URL 与大致字段形状，读写优先走 project_tasks。
 */

function ensureDefaultTodoProject(
  db: any,
  userId: string,
  workspaceId: string | null,
): { id: string } {
  const name = workspaceId ? "家庭TODO" : "个人TODO";
  let row = workspaceId
    ? (db
        .prepare(
          "SELECT id FROM projects WHERE ownerId = ? AND name = ? AND workspaceId = ? AND isDeleted = 0",
        )
        .get(userId, name, workspaceId) as { id: string } | undefined)
    : (db
        .prepare(
          "SELECT id FROM projects WHERE ownerId = ? AND name = ? AND (workspaceId IS NULL OR workspaceId = '') AND isDeleted = 0",
        )
        .get(userId, name) as { id: string } | undefined);

  if (!row) {
    const id = uuid();
    db.prepare(
      `INSERT INTO projects (id, name, description, cover, ownerId, workspaceId, visibility, isArchived, isDeleted, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'PRIVATE', 0, 0, datetime('now'), datetime('now'))`,
    ).run(
      id,
      name,
      name === "家庭TODO" ? "家庭共享待办" : "个人待办事项项目",
      "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      userId,
      workspaceId,
    );
    // 默认两列
    for (const [i, stageName] of ["进行中", "已完成"].entries()) {
      db.prepare(
        `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      ).run(uuid(), id, stageName, i);
    }
    row = { id };
  }

  const stageCount = db
    .prepare("SELECT COUNT(*) as c FROM project_stages WHERE projectId = ?")
    .get(row.id) as { c: number };
  if (!stageCount?.c) {
    db.prepare(
      `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
       VALUES (?, ?, '进行中', 0, datetime('now'))`,
    ).run(uuid(), row.id);
  }

  return row;
}

function firstStageId(db: any, projectId: string): string {
  const s = db
    .prepare(
      "SELECT id FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC LIMIT 1",
    )
    .get(projectId) as { id: string } | undefined;
  if (s) return s.id;
  const id = uuid();
  db.prepare(
    `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
     VALUES (?, ?, '进行中', 0, datetime('now'))`,
  ).run(id, projectId);
  return id;
}

/** project_tasks 行 → 旧 Task API 形状 */
function mapProjectTaskToLegacy(pt: any): any {
  return {
    id: pt.id,
    userId: pt.creatorId || pt.assigneeId,
    workspaceId: pt.projectWorkspaceId ?? pt.workspaceId ?? null,
    title: pt.title,
    isCompleted: pt.isCompleted ?? 0,
    status: pt.status || (pt.isCompleted ? "completed" : "pending"),
    priority: pt.priority ?? 2,
    dueDate: pt.endDate ?? pt.dueDate ?? null,
    remindAt: pt.remindAt ?? null,
    noteId: null,
    parentId: null,
    sortOrder: pt.sortOrder ?? 0,
    createdAt: pt.createdAt,
    updatedAt: pt.updatedAt,
    isRecurring: pt.isRecurring ?? 0,
    recurrenceRule: pt.recurrenceRule ?? null,
    reminderOffsetValue: pt.reminderOffsetValue ?? 1,
    reminderOffsetUnit: pt.reminderOffsetUnit ?? "day",
    recurrenceEndDate: pt.recurrenceEndDate ?? null,
    tags: pt.tags || [],
    children: [],
    subTasks: [],
    dependencies: pt.dependencies || [],
    projectId: pt.projectId,
    projectName: pt.projectName,
  };
}

/** 原始 project_tasks 行（含项目 ACL 字段），附 tags/deps */
function loadProjectTaskRaw(db: any, id: string): any | null {
  const pt = db
    .prepare(
      `
    SELECT pt.*, p.workspaceId as projectWorkspaceId, p.name as projectName, p.ownerId as projectOwnerId
    FROM project_tasks pt
    JOIN projects p ON p.id = pt.projectId
    WHERE pt.id = ? AND p.isDeleted = 0
  `,
    )
    .get(id) as any;
  if (!pt) return null;
  pt.tags = db
    .prepare(
      `
    SELECT tg.* FROM tags tg
    JOIN project_task_tags ptt ON ptt.tagId = tg.id
    WHERE ptt.taskId = ?
  `,
    )
    .all(id);
  pt.dependencies = db
    .prepare(
      `
    SELECT pt2.id, pt2.title, pt2.isCompleted
    FROM project_task_dependencies ptd
    JOIN project_tasks pt2 ON ptd.dependsOnTaskId = pt2.id
    WHERE ptd.taskId = ?
  `,
    )
    .all(id);
  return pt;
}

function loadProjectTaskLegacy(db: any, id: string): any | null {
  const pt = loadProjectTaskRaw(db, id);
  if (!pt) return null;
  return mapProjectTaskToLegacy(pt);
}

function canManageProjectTask(pt: any, userId: string): boolean {
  if (!userId) return false;
  if (
    pt.creatorId === userId ||
    pt.assigneeId === userId ||
    pt.projectOwnerId === userId
  ) {
    return true;
  }
  const ws = pt.projectWorkspaceId ?? null;
  if (!ws) return false;
  return canManageResource(pt.creatorId || pt.projectOwnerId || "", ws, userId);
}

/** 兼容：先 project_tasks，再 legacy tasks 表 */
function loadLegacyTask(db: any, id: string): any | null {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!task) return null;
  task.tags = db
    .prepare(
      `
    SELECT t.* FROM tags t
    JOIN task_tags tt ON t.id = tt.tagId
    WHERE tt.taskId = ?
  `,
    )
    .all(id);
  task.subTasks = db
    .prepare("SELECT * FROM tasks WHERE parentId = ? ORDER BY sortOrder ASC")
    .all(id);
  task.dependencies = db
    .prepare(
      `
    SELECT t.id, t.title, t.isCompleted
    FROM task_dependencies td
    JOIN tasks t ON td.dependsOnTaskId = t.id
    WHERE td.taskId = ?
  `,
    )
    .all(id);
  return task;
}

// 获取任务列表（兼容层 → project_tasks）
tasks.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;
  const ws = workspaceId && workspaceId !== "personal" ? workspaceId : null;

  // 确保默认 TODO 项目存在（空列表用户首次打开 Dashboard 时也一致）
  try {
    ensureDefaultTodoProject(db, userId, ws);
  } catch (e) {
    console.warn("[tasks.get] ensureDefaultTodoProject:", e);
  }

  let rows: any[] = [];
  try {
    if (ws) {
      rows = db
        .prepare(
          `
        SELECT pt.*, p.workspaceId as projectWorkspaceId, p.name as projectName
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE p.isDeleted = 0 AND p.workspaceId = ?
          AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?
               OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?))
        ORDER BY pt.isCompleted ASC, pt.sortOrder ASC, pt.createdAt DESC
      `,
        )
        .all(ws, userId, userId, userId, userId) as any[];
    } else {
      rows = db
        .prepare(
          `
        SELECT pt.*, p.workspaceId as projectWorkspaceId, p.name as projectName
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE p.isDeleted = 0 AND (p.workspaceId IS NULL OR p.workspaceId = '')
          AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?)
        ORDER BY pt.isCompleted ASC, pt.sortOrder ASC, pt.createdAt DESC
      `,
        )
        .all(userId, userId, userId) as any[];
    }

    for (const row of rows) {
      row.tags = db
        .prepare(
          `
        SELECT tg.* FROM tags tg
        JOIN project_task_tags ptt ON ptt.tagId = tg.id
        WHERE ptt.taskId = ?
      `,
        )
        .all(row.id);
      row.dependencies = db
        .prepare(
          `
        SELECT pt2.id, pt2.title, pt2.isCompleted
        FROM project_task_dependencies ptd
        JOIN project_tasks pt2 ON ptd.dependsOnTaskId = pt2.id
        WHERE ptd.taskId = ?
      `,
        )
        .all(row.id);
    }
  } catch (e) {
    console.error("[tasks.get] project_tasks query failed, empty list:", e);
    rows = [];
  }

  return c.json(rows.map(mapProjectTaskToLegacy));
});

// 获取单个任务（project_tasks 优先，legacy 兜底）
tasks.get("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const pt = loadProjectTaskRaw(db, id);
  if (pt) {
    // 读权限：本人 / 项目 owner / 工作区成员
    const readable =
      pt.creatorId === userId ||
      pt.assigneeId === userId ||
      pt.projectOwnerId === userId ||
      (pt.projectWorkspaceId
        ? canManageResource(
            pt.creatorId || pt.projectOwnerId || "",
            pt.projectWorkspaceId,
            userId,
          )
        : false);
    if (!readable) return c.json({ error: "Forbidden" }, 403);
    return c.json(mapProjectTaskToLegacy(pt));
  }

  const task = loadLegacyTask(db, id);
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (task.userId !== userId && !task.workspaceId) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (
    task.workspaceId &&
    task.userId !== userId &&
    !canManageResource(task.userId, task.workspaceId, userId)
  ) {
    return c.json({ error: "Forbidden" }, 403);
  }

  return c.json(task);
});

// 创建任务 → project_tasks（个人TODO/家庭TODO）
tasks.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();

  const {
    title,
    priority = 2,
    dueDate,
    remindAt,
    isRecurring,
    recurrenceRule,
    tagIds,
    reminderOffsetValue = 1,
    reminderOffsetUnit = "day",
    recurrenceEndDate = null,
  } = body;

  // body 或 query 均可带 workspaceId（api 客户端历史上走 query）
  const workspaceId =
    body.workspaceId ?? c.req.query("workspaceId") ?? null;

  if (!title) return c.json({ error: "Title is required" }, 400);

  const ws =
    workspaceId && workspaceId !== "personal" && workspaceId !== ""
      ? workspaceId
      : null;

  let calculatedDueDate = dueDate;
  if (isRecurring && recurrenceRule) {
    try {
      const rule =
        typeof recurrenceRule === "string"
          ? JSON.parse(recurrenceRule)
          : recurrenceRule;
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      calculatedDueDate = getNextOccurrenceString(todayStr, rule);
    } catch (e) {
      console.warn("Failed to calculate initial recurring due date", e);
    }
  }

  let calculatedRemindAt = remindAt;
  if (calculatedDueDate && (!remindAt || isRecurring)) {
    try {
      calculatedRemindAt = calculateRemindAt(
        calculatedDueDate,
        reminderOffsetValue,
        reminderOffsetUnit,
      );
    } catch (e) {
      console.warn("Failed to calculate remind at", e);
    }
  }

  const id = uuid();
  try {
    const project = ensureDefaultTodoProject(db, userId, ws);
    const stageId = firstStageId(db, project.id);
    const endDate = calculatedDueDate
      ? String(calculatedDueDate).includes("T")
        ? calculatedDueDate
        : `${calculatedDueDate}T00:00:00.000Z`
      : null;

    db.prepare(
      `
      INSERT INTO project_tasks (
        id, projectId, stageId, title, isCompleted, status, assigneeId,
        startDate, endDate, description, cover, sortOrder, creatorId, modifierId,
        priority, remindAt, isRecurring, recurrenceRule, reminderOffsetValue,
        reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
      ) VALUES (
        ?, ?, ?, ?, 0, 'pending', ?,
        NULL, ?, '', '', 0, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, datetime('now'), datetime('now')
      )
    `,
    ).run(
      id,
      project.id,
      stageId,
      title.trim(),
      userId,
      endDate,
      userId,
      userId,
      priority,
      calculatedRemindAt,
      isRecurring ? 1 : 0,
      typeof recurrenceRule === "string"
        ? recurrenceRule
        : recurrenceRule
          ? JSON.stringify(recurrenceRule)
          : null,
      reminderOffsetValue,
      reminderOffsetUnit,
      recurrenceEndDate,
    );

    if (Array.isArray(tagIds) && tagIds.length > 0) {
      const insertTag = db.prepare(
        "INSERT OR IGNORE INTO project_task_tags (taskId, tagId) VALUES (?, ?)",
      );
      for (const tagId of tagIds) insertTag.run(id, tagId);
    }
  } catch (err: any) {
    return c.json({ error: `创建失败：${err?.message || err}` }, 500);
  }

  if (title) {
    try {
      createMentions("task", id, title.trim().slice(0, 80), title, userId);
    } catch (e) {
      console.warn("[tasks.post] createMentions failed:", e);
    }
  }

  logAudit(userId, "task", "create_task", `创建待办「${title}」`, {
    targetType: "task",
    targetId: id,
  });

  const mapped = loadProjectTaskLegacy(db, id);
  return c.json(mapped || { id, title: title.trim() }, 201);
});

// 更新任务（project_tasks 优先）
tasks.put("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  return c.req.json().then(async (body: any) => {
    // ---------- project_tasks 路径 ----------
    const pt = loadProjectTaskRaw(db, id);
    if (pt) {
      if (!canManageProjectTask(pt, userId)) {
        return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
      }

      const title = body.title ?? pt.title;
      const isCompleted =
        body.isCompleted !== undefined
          ? body.isCompleted
            ? 1
            : 0
          : pt.isCompleted;
      const status =
        body.status ??
        (isCompleted ? "completed" : pt.status || "pending");
      const priority = body.priority ?? pt.priority ?? 2;
      const dueDate =
        body.dueDate !== undefined ? body.dueDate : pt.endDate;
      let calculatedRemindAt =
        body.remindAt !== undefined ? body.remindAt : pt.remindAt;
      const sortOrder = body.sortOrder ?? pt.sortOrder ?? 0;
      const isRecurring = body.isRecurring ?? pt.isRecurring ?? 0;
      const recurrenceRule =
        body.recurrenceRule !== undefined
          ? body.recurrenceRule
          : pt.recurrenceRule;
      const finalOffsetValue =
        body.reminderOffsetValue !== undefined
          ? body.reminderOffsetValue
          : pt.reminderOffsetValue ?? 1;
      const finalOffsetUnit =
        body.reminderOffsetUnit !== undefined
          ? body.reminderOffsetUnit
          : pt.reminderOffsetUnit ?? "day";
      const recurrenceEndDate =
        body.recurrenceEndDate !== undefined
          ? body.recurrenceEndDate
          : pt.recurrenceEndDate;
      const tagIds = body.tagIds;
      const dependencies = body.dependencies;

      const endDate = dueDate
        ? String(dueDate).includes("T") || String(dueDate).includes(" ")
          ? dueDate
          : `${dueDate}T00:00:00.000Z`
        : null;

      if (
        endDate &&
        body.dueDate !== undefined &&
        (!calculatedRemindAt || isRecurring)
      ) {
        try {
          calculatedRemindAt = calculateRemindAt(
            endDate,
            finalOffsetValue,
            finalOffsetUnit,
          );
        } catch (e) {
          console.warn("Failed to update calculated remind at", e);
        }
      } else if (!endDate && body.dueDate === null) {
        calculatedRemindAt = null;
      }

      if (
        (isCompleted === 1 || isCompleted === true) &&
        pt.isCompleted === 0
      ) {
        const incompleteDeps = db
          .prepare(
            `
          SELECT pt2.title FROM project_task_dependencies ptd
          JOIN project_tasks pt2 ON ptd.dependsOnTaskId = pt2.id
          WHERE ptd.taskId = ? AND pt2.isCompleted = 0
        `,
          )
          .all(id) as { title: string }[];
        if (incompleteDeps.length > 0) {
          const depTitles = incompleteDeps
            .map((d) => `「${d.title}」`)
            .join(", ");
          return c.json(
            {
              error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
              code: "DEPENDENCY_UNRESOLVED",
            },
            400,
          );
        }
      }

      if (body.title !== undefined && body.title !== pt.title) {
        logAudit(
          userId,
          "task",
          "update_task_title",
          `修改任务标题为: 「${body.title}」`,
          { targetType: "project_task", targetId: id },
        );
      }
      if (
        body.isCompleted !== undefined &&
        (body.isCompleted ? 1 : 0) !== pt.isCompleted
      ) {
        const isComp = !!body.isCompleted;
        logAudit(
          userId,
          "task",
          isComp ? "complete_task" : "reopen_task",
          isComp ? "完成了任务" : "重新开启了任务",
          { targetType: "project_task", targetId: id },
        );
      }

      const progress = isCompleted ? 100 : pt.progress === 100 ? 0 : pt.progress;

      try {
        db.prepare(
          `
          UPDATE project_tasks SET
            title = ?, isCompleted = ?, status = ?, priority = ?,
            endDate = ?, remindAt = ?, sortOrder = ?,
            isRecurring = ?, recurrenceRule = ?,
            reminderOffsetValue = ?, reminderOffsetUnit = ?,
            recurrenceEndDate = ?, progress = ?,
            modifierId = ?, updatedAt = datetime('now')
          WHERE id = ?
        `,
        ).run(
          title,
          isCompleted ? 1 : 0,
          status,
          priority,
          endDate,
          calculatedRemindAt,
          sortOrder,
          isRecurring ? 1 : 0,
          typeof recurrenceRule === "string"
            ? recurrenceRule
            : recurrenceRule
              ? JSON.stringify(recurrenceRule)
              : null,
          finalOffsetValue,
          finalOffsetUnit,
          recurrenceEndDate,
          progress,
          userId,
          id,
        );

        if (tagIds !== undefined && Array.isArray(tagIds)) {
          db.prepare("DELETE FROM project_task_tags WHERE taskId = ?").run(id);
          const insertTag = db.prepare(
            "INSERT OR IGNORE INTO project_task_tags (taskId, tagId) VALUES (?, ?)",
          );
          for (const tagId of tagIds) insertTag.run(id, tagId);
        }

        if (dependencies !== undefined && Array.isArray(dependencies)) {
          db.prepare(
            "DELETE FROM project_task_dependencies WHERE taskId = ?",
          ).run(id);
          for (const depId of dependencies) {
            if (depId !== id) {
              db.prepare(
                "INSERT OR IGNORE INTO project_task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)",
              ).run(id, depId);
            }
          }
        }

        if (
          (body.isCompleted === 1 || body.isCompleted === true) &&
          pt.isCompleted === 0
        ) {
          handleRecurringTask(db, id, true);
        }
      } catch (err: any) {
        return c.json(
          { error: `更新失败：${err?.message || err}` },
          500,
        );
      }

      if (body.title) {
        try {
          createMentions(
            "task",
            id,
            body.title.trim().slice(0, 80),
            body.title,
            userId,
          );
        } catch (e) {
          console.warn("[tasks.put] createMentions failed:", e);
        }
      }

      return c.json(loadProjectTaskLegacy(db, id));
    }

    // ---------- legacy tasks 表兜底 ----------
    const existing = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(id) as any;
    if (!existing) return c.json({ error: "Task not found" }, 404);

    if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
      return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
    }

    const title = body.title ?? existing.title;
    const isCompleted = body.isCompleted ?? existing.isCompleted;
    const status = body.status ?? existing.status;
    const priority = body.priority ?? existing.priority;
    const dueDate =
      body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    let calculatedRemindAt =
      body.remindAt !== undefined ? body.remindAt : existing.remindAt;
    const noteId =
      body.noteId !== undefined ? body.noteId : existing.noteId;
    const parentId =
      body.parentId !== undefined ? body.parentId : existing.parentId;
    const sortOrder = body.sortOrder ?? existing.sortOrder;
    const isRecurring = body.isRecurring ?? existing.isRecurring;
    const recurrenceRule =
      body.recurrenceRule !== undefined
        ? body.recurrenceRule
        : existing.recurrenceRule;
    const finalOffsetValue =
      body.reminderOffsetValue !== undefined
        ? body.reminderOffsetValue
        : existing.reminderOffsetValue;
    const finalOffsetUnit =
      body.reminderOffsetUnit !== undefined
        ? body.reminderOffsetUnit
        : existing.reminderOffsetUnit;
    const recurrenceEndDate =
      body.recurrenceEndDate !== undefined
        ? body.recurrenceEndDate
        : existing.recurrenceEndDate;
    const tagIds = body.tagIds;
    const dependencies = body.dependencies;

    if (
      dueDate &&
      body.dueDate !== undefined &&
      (!calculatedRemindAt || isRecurring)
    ) {
      try {
        calculatedRemindAt = calculateRemindAt(
          dueDate,
          finalOffsetValue,
          finalOffsetUnit,
        );
      } catch (e) {
        console.warn("Failed to update calculated remind at", e);
      }
    } else if (!dueDate && body.dueDate === null) {
      calculatedRemindAt = null;
    }

    if (
      (isCompleted === 1 || isCompleted === true) &&
      existing.isCompleted === 0
    ) {
      const incompleteDeps = db
        .prepare(
          `
        SELECT t.title FROM task_dependencies td
        JOIN tasks t ON td.dependsOnTaskId = t.id
        WHERE td.taskId = ? AND t.isCompleted = 0
      `,
        )
        .all(id) as { title: string }[];
      if (incompleteDeps.length > 0) {
        const depTitles = incompleteDeps
          .map((d) => `「${d.title}」`)
          .join(", ");
        return c.json(
          {
            error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
            code: "DEPENDENCY_UNRESOLVED",
          },
          400,
        );
      }
    }

    if (body.status !== undefined && body.status !== existing.status) {
      logAudit(
        userId,
        "task",
        "update_task_status",
        `修改任务状态为: ${body.status}`,
        { targetType: "task", targetId: id },
      );
      if (body.status === "paused") {
        const { propagateStatusDown } = await import(
          "../lib/planStatusSync.js"
        );
        propagateStatusDown(db, "task", id, "paused", userId);
      }
    }

    if (body.title !== undefined && body.title !== existing.title) {
      logAudit(
        userId,
        "task",
        "update_task_title",
        `修改任务标题为: 「${body.title}」`,
        { targetType: "task", targetId: id },
      );
    }
    if (
      body.isCompleted !== undefined &&
      (body.isCompleted ? 1 : 0) !== existing.isCompleted
    ) {
      const isComp = !!body.isCompleted;
      logAudit(
        userId,
        "task",
        isComp ? "complete_task" : "reopen_task",
        isComp ? "完成了任务" : "重新开启了任务",
        { targetType: "task", targetId: id },
      );
    }

    if (
      body.parentId !== undefined &&
      body.parentId !== null &&
      body.parentId !== existing.parentId
    ) {
      const parent = db
        .prepare("SELECT workspaceId FROM tasks WHERE id = ?")
        .get(body.parentId) as { workspaceId: string | null } | undefined;
      if (!parent) return c.json({ error: "父任务不存在" }, 404);
      if (parent.workspaceId !== existing.workspaceId) {
        return c.json(
          {
            error: "子任务必须与父任务在同一工作区",
            code: "SCOPE_MISMATCH",
          },
          400,
        );
      }
    }

    const tx = db.transaction(() => {
      db.prepare(
        `
        UPDATE tasks SET title = ?, isCompleted = ?, status = ?, priority = ?, dueDate = ?, remindAt = ?,
          noteId = ?, parentId = ?, sortOrder = ?, isRecurring = ?, recurrenceRule = ?, reminderOffsetValue = ?, reminderOffsetUnit = ?, recurrenceEndDate = ?, updatedAt = datetime('now')
        WHERE id = ?
      `,
      ).run(
        title,
        isCompleted,
        status,
        priority,
        dueDate,
        calculatedRemindAt,
        noteId,
        parentId,
        sortOrder,
        isRecurring,
        typeof recurrenceRule === "string"
          ? recurrenceRule
          : JSON.stringify(recurrenceRule),
        finalOffsetValue,
        finalOffsetUnit,
        recurrenceEndDate,
        id,
      );

      if (tagIds !== undefined && Array.isArray(tagIds)) {
        db.prepare("DELETE FROM task_tags WHERE taskId = ?").run(id);
        if (tagIds.length > 0) {
          const insertTag = db.prepare(
            "INSERT INTO task_tags (taskId, tagId) VALUES (?, ?)",
          );
          for (const tagId of tagIds) insertTag.run(id, tagId);
        }
      }

      if (dependencies !== undefined && Array.isArray(dependencies)) {
        db.prepare("DELETE FROM task_dependencies WHERE taskId = ?").run(id);
        for (const depId of dependencies) {
          if (depId !== id) {
            db.prepare(
              "INSERT INTO task_dependencies (taskId, dependsOnTaskId) VALUES (?, ?)",
            ).run(id, depId);
          }
        }
      }
    });

    try {
      tx();
      if (
        (body.isCompleted === 1 || body.isCompleted === true) &&
        existing.isCompleted === 0
      ) {
        handleRecurringTask(db, id, false);
      }
    } catch (err: any) {
      return c.json({ error: `更新失败：${err?.message || err}` }, 500);
    }

    if (body.title) {
      try {
        createMentions(
          "task",
          id,
          body.title.trim().slice(0, 80),
          body.title,
          userId,
        );
      } catch (e) {
        console.warn("[tasks.put] createMentions failed:", e);
      }
    }

    return c.json(loadLegacyTask(db, id));
  });
});

// 切换完成状态（project_tasks 优先）
tasks.patch("/:id/toggle", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const pt = loadProjectTaskRaw(db, id);
  if (pt) {
    if (!canManageProjectTask(pt, userId)) {
      return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
    }

    const newStatus = pt.isCompleted ? 0 : 1;

    if (newStatus === 1) {
      const incompleteDeps = db
        .prepare(
          `
        SELECT pt2.title FROM project_task_dependencies ptd
        JOIN project_tasks pt2 ON ptd.dependsOnTaskId = pt2.id
        WHERE ptd.taskId = ? AND pt2.isCompleted = 0
      `,
        )
        .all(id) as { title: string }[];
      if (incompleteDeps.length > 0) {
        const depTitles = incompleteDeps
          .map((d) => `「${d.title}」`)
          .join(", ");
        return c.json(
          {
            error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
            code: "DEPENDENCY_UNRESOLVED",
          },
          400,
        );
      }
    }

    const progress = newStatus === 1 ? 100 : 0;
    const status = newStatus === 1 ? "completed" : "pending";
    db.prepare(
      `
      UPDATE project_tasks SET isCompleted = ?, progress = ?, status = ?,
        modifierId = ?, updatedAt = datetime('now') WHERE id = ?
    `,
    ).run(newStatus, progress, status, userId, id);

    logAudit(
      userId,
      "task",
      newStatus === 1 ? "complete_task" : "reopen_task",
      newStatus === 1 ? "完成了任务" : "重新开启了任务",
      { targetType: "project_task", targetId: id },
    );

    if (newStatus === 1) {
      handleRecurringTask(db, id, true);
      if (pt.projectWorkspaceId) {
        try {
          broadcastToWorkspace(
            pt.projectWorkspaceId,
            "task_completed",
            "task",
            id,
            null,
            userId,
            userId,
          );
        } catch (e) {
          console.warn("[tasks.toggle] broadcastToWorkspace failed:", e);
        }
      }
    }

    return c.json(loadProjectTaskLegacy(db, id));
  }

  // legacy 兜底
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | { userId: string; workspaceId: string | null; isCompleted: number }
    | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (!canManageResource(task.userId, task.workspaceId, userId)) {
    return c.json({ error: "无权修改该任务", code: "FORBIDDEN" }, 403);
  }

  const newStatus = task.isCompleted ? 0 : 1;

  if (newStatus === 1) {
    const incompleteDeps = db
      .prepare(
        `
      SELECT t.title FROM task_dependencies td
      JOIN tasks t ON td.dependsOnTaskId = t.id
      WHERE td.taskId = ? AND t.isCompleted = 0
    `,
      )
      .all(id) as { title: string }[];
    if (incompleteDeps.length > 0) {
      const depTitles = incompleteDeps.map((d) => `「${d.title}」`).join(", ");
      return c.json(
        {
          error: `无法完成任务，因为前置依赖任务尚未完成: ${depTitles}`,
          code: "DEPENDENCY_UNRESOLVED",
        },
        400,
      );
    }
  }

  db.prepare(
    "UPDATE tasks SET isCompleted = ?, updatedAt = datetime('now') WHERE id = ?",
  ).run(newStatus, id);
  logAudit(
    userId,
    "task",
    newStatus === 1 ? "complete_task" : "reopen_task",
    newStatus === 1 ? "完成了任务" : "重新开启了任务",
    { targetType: "task", targetId: id },
  );

  if (newStatus === 1) {
    handleRecurringTask(db, id, false);
  }

  if (newStatus === 1 && task.workspaceId) {
    try {
      broadcastToWorkspace(
        task.workspaceId,
        "task_completed",
        "task",
        id,
        null,
        userId,
        userId,
      );
    } catch (e) {
      console.warn("[tasks.toggle] broadcastToWorkspace failed:", e);
    }
  }

  return c.json(loadLegacyTask(db, id));
});

// 删除任务（project_tasks 优先）
tasks.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const pt = loadProjectTaskRaw(db, id);
  if (pt) {
    if (!canManageProjectTask(pt, userId)) {
      return c.json({ error: "无权删除该任务", code: "FORBIDDEN" }, 403);
    }
    try {
      db.prepare("DELETE FROM project_task_tags WHERE taskId = ?").run(id);
      db.prepare(
        "DELETE FROM project_task_dependencies WHERE taskId = ? OR dependsOnTaskId = ?",
      ).run(id, id);
      db.prepare("DELETE FROM project_task_checklists WHERE taskId = ?").run(
        id,
      );
      db.prepare("DELETE FROM project_task_members WHERE taskId = ?").run(id);
      db.prepare("DELETE FROM project_tasks WHERE id = ?").run(id);
    } catch (err: any) {
      return c.json({ error: `删除失败：${err?.message || err}` }, 500);
    }
    logAudit(userId, "task", "delete_task", "删除了任务", {
      targetType: "project_task",
      targetId: id,
    });
    return c.json({ success: true });
  }

  const task = db
    .prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?")
    .get(id) as { userId: string; workspaceId: string | null } | undefined;
  if (!task) return c.json({ error: "Task not found" }, 404);

  if (!canManageResource(task.userId, task.workspaceId, userId)) {
    return c.json({ error: "无权删除该任务", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  return c.json({ success: true });
});

// 任务统计摘要（project_tasks 为主）
tasks.get("/stats/summary", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;
  const ws = workspaceId && workspaceId !== "personal" ? workspaceId : null;

  const projectScope = ws
    ? `p.isDeleted = 0 AND p.workspaceId = ?
       AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?
            OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?))`
    : `p.isDeleted = 0 AND (p.workspaceId IS NULL OR p.workspaceId = '')
       AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?)`;
  const projectParams = ws
    ? [ws, userId, userId, userId, userId]
    : [userId, userId, userId];

  const countPt = (extra: string) => {
    try {
      const row = db
        .prepare(
          `
        SELECT COUNT(*) as count
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE ${projectScope} AND ${extra}
      `,
        )
        .get(...projectParams) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  };

  let total = 0;
  let completed = 0;
  try {
    total =
      (
        db
          .prepare(
            `
        SELECT COUNT(*) as count
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE ${projectScope}
      `,
          )
          .get(...projectParams) as { count: number } | undefined
      )?.count ?? 0;
    completed = countPt("COALESCE(pt.isCompleted, 0) = 1");
  } catch (e) {
    console.error("[tasks.stats] project_tasks count failed:", e);
  }

  const pending = total - completed;
  // endDate 可能是 ISO 或 date 字符串，用 date() 截断比较
  const today = countPt(
    `COALESCE(pt.isCompleted, 0) = 0 AND pt.endDate IS NOT NULL AND date(pt.endDate) = date('now')`,
  );
  const overdue = countPt(
    `COALESCE(pt.isCompleted, 0) = 0 AND pt.endDate IS NOT NULL AND date(pt.endDate) < date('now')`,
  );
  const week = countPt(
    `COALESCE(pt.isCompleted, 0) = 0 AND pt.endDate IS NOT NULL AND date(pt.endDate) >= date('now') AND date(pt.endDate) <= date('now', '+7 days')`,
  );
  const activeReminders = countPt(
    `COALESCE(pt.isCompleted, 0) = 0 AND pt.remindAt IS NOT NULL AND pt.remindAt <= datetime('now', 'localtime')`,
  );

  return c.json({
    total,
    completed,
    pending,
    today,
    overdue,
    week,
    activeReminders,
  });
});

export default tasks;
