import { Hono } from "hono";
import { getDb } from "../db/schema.js";
import { v4 as uuid } from "uuid";
import { logAudit } from "../services/audit.js";
import { canManageResource, getUserWorkspaceRole } from "../middleware/acl.js";
import { handleRecurringTask } from "../lib/recurrence.js";
import { broadcastToWorkspace } from "../lib/mentions.js";
import { createMentions } from "../lib/mentions.js";
import { calculateRemindAt } from "../lib/reminders.js";
import { getNextOccurrenceString } from "../lib/recurrence.js";
import { ensureDefaultTodoProject } from "../lib/defaultTodoProject.js";
import {
  applyFamilyTaxonomyPreset,
  backfillPresetDescriptions,
  buildCategoryTree,
  createTaskCategory,
  listTaskCategories,
} from "../services/task-taxonomy.js";
import {
  buildTaskAnalyticsMarkdown,
  computeTaskAnalytics,
  resolvePeriod,
} from "../services/task-analytics.js";

const tasks = new Hono();

/**
 * P1 收尾 / P2-X2：/api/tasks 兼容层
 * ---------------------------------------------------------------------------
 * 产品任务模型已统一到 project_tasks（个人TODO/家庭TODO）。
 * 本路由对旧客户端保持 URL 与大致字段形状，读写优先走 project_tasks。
 */

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

// ─── 静态路径必须在 /:id 之前注册，否则会被当成任务 id ────────────────

function normalizeWs(raw: string | null | undefined): string | null {
  if (!raw || raw === "personal") return null;
  return raw;
}

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

/** GET /api/tasks/categories?workspaceId= */
tasks.get("/categories", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const ws = normalizeWs(c.req.query("workspaceId"));
  if (ws) {
    const role = getUserWorkspaceRole(ws, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }
  // 先补全空说明（历史导入的预设没有 description）
  try {
    if (ws) {
      // 工作区：用当前用户做 owner 作用域补全不够；按 workspaceId 直接补
      const codes = db
        .prepare(
          `SELECT code FROM task_categories WHERE workspaceId = ? AND (description IS NULL OR TRIM(description) = '')`,
        )
        .all(ws) as { code: string }[];
      if (codes.length > 0) {
        backfillPresetDescriptions(db, ws, userId, { force: false });
      }
    } else {
      backfillPresetDescriptions(db, null, userId, { force: false });
    }
  } catch (e) {
    console.warn("[tasks.categories] backfill:", e);
  }

  let rows = listTaskCategories(db, ws, userId, {
    includeInactive: true,
    backfillDescriptions: false,
  });
  if (ws) {
    rows = db
      .prepare(
        `SELECT * FROM task_categories WHERE workspaceId = ? ORDER BY sortOrder ASC, code ASC`,
      )
      .all(ws) as typeof rows;
  }
  const active = rows.filter((r) => r.isActive === 1);
  return c.json({
    items: rows,
    tree: buildCategoryTree(active),
    /** 含停用节点，供管理页展示 */
    treeAll: buildCategoryTree(rows),
    count: rows.length,
    activeCount: active.length,
  });
});

/** POST /api/tasks/categories  body: { workspaceId?, parentId?, code, name, color?, kind? } */
tasks.post("/categories", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json().catch(() => ({}));
  const ws = normalizeWs(body.workspaceId ?? c.req.query("workspaceId"));
  if (ws) {
    const role = getUserWorkspaceRole(ws, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }
  try {
    const row = createTaskCategory(db, {
      workspaceId: ws,
      ownerUserId: userId,
      parentId: body.parentId ?? null,
      code: String(body.code || ""),
      name: String(body.name || ""),
      description: body.description ?? null,
      color: body.color ?? null,
      kind: body.kind || "normal",
    });
    logAudit(userId, "task", "create_task_category", `创建任务分类「${row.name}」`, {
      targetType: "task_category",
      targetId: row.id,
    });
    return c.json(row, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

/** POST /api/tasks/categories/apply-preset */
tasks.post("/categories/apply-preset", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json().catch(() => ({}));
  const ws = normalizeWs(body.workspaceId ?? c.req.query("workspaceId"));
  if (ws) {
    const role = getUserWorkspaceRole(ws, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }
  const result = applyFamilyTaxonomyPreset(db, ws, userId);
  logAudit(userId, "task", "apply_task_taxonomy_preset", `应用家庭事务分类预设（+${result.created}/~${result.updated}）`, {
    targetType: "task_taxonomy",
    targetId: ws || userId,
  });
  const rows = ws
    ? (db
        .prepare(`SELECT * FROM task_categories WHERE workspaceId = ? ORDER BY sortOrder`)
        .all(ws) as ReturnType<typeof listTaskCategories>)
    : listTaskCategories(db, null, userId, { includeInactive: true });
  return c.json({ ...result, items: rows, tree: buildCategoryTree(rows.filter((r) => r.isActive === 1)) });
});

/** PATCH /api/tasks/categories/:id */
tasks.patch("/categories/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const row = db.prepare("SELECT * FROM task_categories WHERE id = ?").get(id) as
    | { id: string; workspaceId: string | null; ownerUserId: string; code: string }
    | undefined;
  if (!row) return c.json({ error: "分类不存在" }, 404);
  if (row.workspaceId) {
    const role = getUserWorkspaceRole(row.workspaceId, userId);
    if (!role) return c.json({ error: "无权修改" }, 403);
  } else if (row.ownerUserId !== userId) {
    return c.json({ error: "无权修改" }, 403);
  }
  const updates: string[] = [];
  const params: any[] = [];
  if (body.name !== undefined) {
    updates.push("name = ?");
    params.push(String(body.name).trim() || row.code);
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    const d = body.description == null ? null : String(body.description).trim();
    params.push(d || null);
  }
  if (body.color !== undefined) {
    updates.push("color = ?");
    params.push(body.color);
  }
  if (body.isActive !== undefined) {
    updates.push("isActive = ?");
    params.push(body.isActive ? 1 : 0);
  }
  if (!updates.length) return c.json({ error: "无更新字段" }, 400);
  updates.push("updatedAt = datetime('now')");
  params.push(id);
  db.prepare(`UPDATE task_categories SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  const updated = db.prepare("SELECT * FROM task_categories WHERE id = ?").get(id);
  return c.json(updated);
});

function parseAnalyticsQuery(c: any, userId: string) {
  const ws = normalizeWs(c.req.query("workspaceId"));
  if (ws) {
    const role = getUserWorkspaceRole(ws, userId);
    if (!role) return { error: "无权访问该工作区" as const, status: 403 as const };
  }
  const scopeRaw = c.req.query("scope") || "self";
  const scope = scopeRaw === "workspace" && ws ? "workspace" : "self";
  const period = c.req.query("period") || "week";
  const weekStartsOn = c.req.query("weekStartsOn") === "0" ? 0 : 1;
  const range = resolvePeriod(period, c.req.query("from"), c.req.query("to"), weekStartsOn as 0 | 1);
  const memberId = c.req.query("memberId") || null;
  return {
    q: {
      workspaceId: ws,
      userId,
      scope: scope as "self" | "workspace",
      memberId,
      ...range,
    },
  };
}

/** GET /api/tasks/analytics */
tasks.get("/analytics", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const parsed = parseAnalyticsQuery(c, userId);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }

  try {
    const result = computeTaskAnalytics(db, parsed.q!);
    return c.json(result);
  } catch (e: any) {
    console.error("[tasks.analytics]", e);
    return c.json({ error: e?.message || "统计失败" }, 500);
  }
});

/** GET /api/tasks/analytics/report — Markdown 周报/周期报告 */
tasks.get("/analytics/report", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const parsed = parseAnalyticsQuery(c, userId);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }
  try {
    const data = computeTaskAnalytics(db, parsed.q!);
    const markdown = buildTaskAnalyticsMarkdown(data);
    const filename = `task-review-${data.range.from}_${data.range.to}.md`;
    return c.json({ markdown, filename, range: data.range });
  } catch (e: any) {
    console.error("[tasks.analytics.report]", e);
    return c.json({ error: e?.message || "报告生成失败" }, 500);
  }
});

/**
 * POST /api/tasks/analytics/advice
 * 基于规则洞察 + KPI 调用系统 AI 润色为家庭向可执行建议。
 * body 可选：{ includeReport?: boolean } — 为 true 时一并返回带 AI 段落的 markdown
 */
tasks.post("/analytics/advice", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const parsed = parseAnalyticsQuery(c, userId);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }
  const body = await c.req.json().catch(() => ({}));

  let data: ReturnType<typeof computeTaskAnalytics>;
  try {
    data = computeTaskAnalytics(db, parsed.q!);
  } catch (e: any) {
    return c.json({ error: e?.message || "统计失败" }, 500);
  }

  const settings = db
    .prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('ai_provider','ai_api_url','ai_api_key','ai_model')`,
    )
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  if (!map.ai_api_url || !map.ai_model) {
    const markdown = body.includeReport
      ? buildTaskAnalyticsMarkdown(data)
      : null;
    return c.json({
      insights: data.insights,
      aiText: null,
      message: "未配置 AI，仅返回规则建议。请在设置中配置 AI 服务。",
      markdown,
    });
  }

  const k = data.kpis.current;
  const prompt = `你是家庭任务复盘顾问（双职工+孩子场景）。请根据下列结构化数据，用中文写 3～6 条简洁、可执行的反思建议。
要求：
- 语气温暖务实，禁止 KPI 压榨式说教（不要说「效率低下」）
- 结合分类占比、积压、突发、成员负载（若有）给出具体动作
- 每条 1～3 句；可用 Markdown 小标题或编号
- 不要编造数据中不存在的数字

周期：${data.range.from} ~ ${data.range.to}（对比 ${data.range.prevFrom} ~ ${data.range.prevTo}）
范围：${data.scope === "workspace" ? "全家" : "个人"}
KPI：完成 ${k.completed}，创建 ${k.created}，完成率 ${k.completionRate}，按时率 ${k.onTimeRate}，中位耗时分钟 ${k.medianCycleMinutes}，未安排积压 ${k.unscheduledOpen}，归类率 ${k.categorizeRate}，突发占比 ${k.urgentShare}
环比：${JSON.stringify(data.kpis.deltas)}
大类完成：${JSON.stringify(data.categories.root.slice(0, 12))}
成员：${JSON.stringify(data.members.slice(0, 8))}
规则洞察：${JSON.stringify(data.insights)}
未安排 Top：${JSON.stringify(data.openLists.unscheduled.slice(0, 8).map((t) => t.title))}
逾期 Top：${JSON.stringify(data.openLists.overdue.slice(0, 8).map((t) => t.title))}
`;

  try {
    const url = map.ai_api_url.replace(/\/+$/, "");
    const endpoint = url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(map.ai_api_key ? { Authorization: `Bearer ${map.ai_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: map.ai_model,
        messages: [
          {
            role: "system",
            content: "你是简洁务实的家庭任务复盘顾问，用中文回答，面向夫妻共同生活。",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.45,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return c.json({
        insights: data.insights,
        aiText: null,
        message: `AI 调用失败: ${t.slice(0, 200)}`,
        markdown: body.includeReport ? buildTaskAnalyticsMarkdown(data) : null,
      });
    }
    const raw = (await res.json()) as any;
    const aiText = raw?.choices?.[0]?.message?.content || null;
    const markdown = body.includeReport
      ? buildTaskAnalyticsMarkdown(data, { aiText })
      : null;
    return c.json({ insights: data.insights, aiText, markdown });
  } catch (e: any) {
    return c.json({
      insights: data.insights,
      aiText: null,
      message: e?.message || "AI 调用异常",
      markdown: body.includeReport ? buildTaskAnalyticsMarkdown(data) : null,
    });
  }
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

  // 周期任务：用户已指定首期 dueDate 则尊重；否则按规则从今天推算
  let calculatedDueDate = dueDate;
  if (isRecurring && recurrenceRule && !dueDate) {
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
        const remindChanged =
          String(calculatedRemindAt ?? "") !== String(pt.remindAt ?? "");
        const dueChanged =
          String(endDate ?? "") !== String(pt.endDate ?? "");
        db.prepare(
          `
          UPDATE project_tasks SET
            title = ?, isCompleted = ?, status = ?, priority = ?,
            endDate = ?, remindAt = ?, sortOrder = ?,
            isRecurring = ?, recurrenceRule = ?,
            reminderOffsetValue = ?, reminderOffsetUnit = ?,
            recurrenceEndDate = ?, progress = ?,
            reminderFiredAt = CASE WHEN ? THEN NULL ELSE reminderFiredAt END,
            dueReminderFiredAt = CASE WHEN ? THEN NULL ELSE dueReminderFiredAt END,
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
          remindChanged ? 1 : 0,
          dueChanged ? 1 : 0,
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

        let nextOccurrence: any = null;
        let recurrenceMeta: { created: boolean; reason?: string } | null = null;
        if (
          (body.isCompleted === 1 || body.isCompleted === true) &&
          pt.isCompleted === 0
        ) {
          const rec = handleRecurringTask(db, id, true);
          recurrenceMeta = { created: rec.created, reason: rec.reason };
          if (rec.created && rec.newTaskId) {
            nextOccurrence = loadProjectTaskLegacy(db, rec.newTaskId);
          } else if (
            pt.isRecurring &&
            !rec.created &&
            rec.reason &&
            rec.reason !== "not_recurring"
          ) {
            console.warn(
              `[recurrence] failed to spawn next for task ${id}: ${rec.reason}`,
            );
          }
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

        const result = loadProjectTaskLegacy(db, id);
        if (nextOccurrence || recurrenceMeta) {
          return c.json({
            ...result,
            nextOccurrence: nextOccurrence || undefined,
            recurrence: recurrenceMeta || undefined,
          });
        }
        return c.json(result);
      } catch (err: any) {
        return c.json(
          { error: `更新失败：${err?.message || err}` },
          500,
        );
      }
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

    let nextOccurrence: any = null;
    let recurrenceMeta: { created: boolean; reason?: string } | null = null;
    try {
      tx();
      if (
        (body.isCompleted === 1 || body.isCompleted === true) &&
        existing.isCompleted === 0
      ) {
        const rec = handleRecurringTask(db, id, false);
        recurrenceMeta = { created: rec.created, reason: rec.reason };
        if (rec.created && rec.newTaskId) {
          nextOccurrence = loadLegacyTask(db, rec.newTaskId);
        }
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

    const legacyResult = loadLegacyTask(db, id);
    if (nextOccurrence || recurrenceMeta) {
      return c.json({
        ...legacyResult,
        nextOccurrence: nextOccurrence || undefined,
        recurrence: recurrenceMeta || undefined,
      });
    }
    return c.json(legacyResult);
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

    let nextOccurrence: any = null;
    let recurrenceMeta: { created: boolean; reason?: string } | null = null;
    if (newStatus === 1) {
      const rec = handleRecurringTask(db, id, true);
      recurrenceMeta = { created: rec.created, reason: rec.reason };
      if (rec.created && rec.newTaskId) {
        nextOccurrence = loadProjectTaskLegacy(db, rec.newTaskId);
      } else if (
        pt.isRecurring &&
        !rec.created &&
        rec.reason &&
        rec.reason !== "not_recurring"
      ) {
        console.warn(
          `[recurrence] toggle failed to spawn next for task ${id}: ${rec.reason}`,
        );
      }
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

    const toggleResult = loadProjectTaskLegacy(db, id);
    if (nextOccurrence || recurrenceMeta) {
      return c.json({
        ...toggleResult,
        nextOccurrence: nextOccurrence || undefined,
        recurrence: recurrenceMeta || undefined,
      });
    }
    return c.json(toggleResult);
  }

  // legacy 兜底
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
    | { userId: string; workspaceId: string | null; isCompleted: number; isRecurring?: number }
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

  let nextOccurrence: any = null;
  let recurrenceMeta: { created: boolean; reason?: string } | null = null;
  if (newStatus === 1) {
    const rec = handleRecurringTask(db, id, false);
    recurrenceMeta = { created: rec.created, reason: rec.reason };
    if (rec.created && rec.newTaskId) {
      nextOccurrence = loadLegacyTask(db, rec.newTaskId);
    }
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

  const legacyToggle = loadLegacyTask(db, id);
  if (nextOccurrence || recurrenceMeta) {
    return c.json({
      ...legacyToggle,
      nextOccurrence: nextOccurrence || undefined,
      recurrence: recurrenceMeta || undefined,
    });
  }
  return c.json(legacyToggle);
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

export default tasks;
