/**
 * 思维导图路由（工作区数据隔离 Phase 2 - Y4）
 * ---------------------------------------------------------------------------
 * 与 diary / tasks 同构：
 *   - 集合接口（list / create）：挂 `requireWorkspaceFeature("mindmaps")`，
 *     通过 `?workspaceId=` 切换 scope（不传/空 = 个人空间）。
 *   - 单资源按 id 接口（read / update / delete）：**不**挂 feature 中间件，
 *     这样工作区关闭 mindmaps 后，老成员依然可以读/善后自己已有的导图。
 *   - 读取：
 *       personal → userId = ? AND workspaceId IS NULL
 *       workspace → workspaceId = ? （全员可见，与 diary 同）
 *   - 写/删：`canManageResource(creatorId, workspaceId, actorId)`
 *     （本人 + 工作区 admin/owner）
 *   - 不允许通过 PUT 修改 workspaceId——导图一旦落到一个空间就不迁移，
 *     避免权限与附件归属的连带错位。
 */
import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuidv4 } from "uuid";
import {
  canManageResource,
  getUserWorkspaceRole,
  requireWorkspaceFeature,
} from "../middleware/acl";

const app = new Hono();

// 确保 mindmaps 表存在（新库初始化路径；已存在的老库靠 v4 迁移兜底补列）
function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mindmaps (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      workspaceId TEXT,
      title TEXT NOT NULL DEFAULT '无标题导图',
      data TEXT NOT NULL DEFAULT '{}',
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_mindmaps_user ON mindmaps(userId);
    CREATE INDEX IF NOT EXISTS idx_mindmaps_updated ON mindmaps(updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_mindmaps_workspace ON mindmaps(workspaceId);
  `);
}

// 初始化表
ensureTable();

interface MindmapRow {
  id: string;
  userId: string;
  workspaceId: string | null;
  title: string;
  data: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 解析请求的 scope（personal / workspace）。
 *   - 没传 workspaceId（空串/缺省）→ 个人空间
 *   - 传了但用户不是该工作区成员 → error
 */
function resolveMindmapScope(
  workspaceIdRaw: string,
  userId: string,
): { scope: "personal" | "workspace"; workspaceId: string | null; error?: string } {
  const workspaceId = workspaceIdRaw?.trim() || "";
  if (!workspaceId) return { scope: "personal", workspaceId: null };
  const role = getUserWorkspaceRole(workspaceId, userId);
  if (!role) return { scope: "workspace", workspaceId, error: "无权访问该工作区" };
  return { scope: "workspace", workspaceId };
}

/** 读权限：本人个人空间 OR 工作区成员（需可见性校验）。 */
function canReadMindmap(row: MindmapRow, userId: string): boolean {
  if (!row.workspaceId) return row.userId === userId;
  // 工作区：WORKSPACE 或自己的 PRIVATE
  return getUserWorkspaceRole(row.workspaceId, userId) !== null &&
    (row.visibility === "WORKSPACE" || row.userId === userId);
}

// ---------- 列表 ----------
app.get("/", requireWorkspaceFeature("mindmaps"), (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const scope = resolveMindmapScope(c.req.query("workspaceId") || "", userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  // creatorName：与 notes/tasks/diary 同款——LEFT JOIN users 拉创建者用户名，
  // 工作区下导图列表用来展示"谁建的"。LEFT JOIN 兜底用户被删除的极端窗口期。
  const sql =
    scope.scope === "workspace"
      ? `SELECT m.id, m.userId, m.workspaceId, m.title, m.visibility, m.createdAt, m.updatedAt,
                u.username AS creatorName
         FROM mindmaps m LEFT JOIN users u ON u.id = m.userId
         WHERE m.workspaceId = ? AND (m.visibility = 'WORKSPACE' OR (m.visibility = 'PRIVATE' AND m.userId = ?)) ORDER BY m.updatedAt DESC`
      : `SELECT m.id, m.userId, m.workspaceId, m.title, m.visibility, m.createdAt, m.updatedAt,
                u.username AS creatorName
         FROM mindmaps m LEFT JOIN users u ON u.id = m.userId
         WHERE m.userId = ? AND m.workspaceId IS NULL ORDER BY m.updatedAt DESC`;
  const params = scope.scope === "workspace"
    ? [scope.workspaceId, userId]
    : [userId];
  const rows = db.prepare(sql).all(...params);
  return c.json(rows);
});

// ---------- 单个读取 ----------
// 不挂 feature 中间件：功能关闭后仍允许按 id 读取（善后用）。
app.get("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const row = db.prepare("SELECT * FROM mindmaps WHERE id = ?").get(id) as
    | MindmapRow
    | undefined;
  if (!row) return c.json({ error: "思维导图不存在" }, 404);
  if (!canReadMindmap(row, userId)) {
    return c.json({ error: "无权访问该导图", code: "FORBIDDEN" }, 403);
  }
  return c.json(row);
});

// ---------- 创建 ----------
app.post("/", requireWorkspaceFeature("mindmaps"), async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const body = await c.req.json();
  const scope = resolveMindmapScope(c.req.query("workspaceId") || "", userId);
  if (scope.error) return c.json({ error: scope.error, code: "FORBIDDEN" }, 403);

  const id = uuidv4();
  const title = body.title || "无标题导图";

  // 默认初始数据：一个根节点
  const defaultData = JSON.stringify({
    root: {
      id: "root",
      text: title,
      children: [],
    },
  });
  const data = body.data || defaultData;

  db.prepare(
    "INSERT INTO mindmaps (id, userId, workspaceId, title, data, visibility) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    userId,
    scope.workspaceId,
    title,
    typeof data === "string" ? data : JSON.stringify(data),
    body.visibility || "PRIVATE",
  );

  const row = db.prepare("SELECT * FROM mindmaps WHERE id = ?").get(id);
  return c.json(row, 201);
});

// ---------- 更新 ----------
app.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");
  const body = await c.req.json();

  const existing = db.prepare("SELECT * FROM mindmaps WHERE id = ?").get(id) as
    | MindmapRow
    | undefined;
  if (!existing) return c.json({ error: "思维导图不存在" }, 404);

  if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
    return c.json({ error: "无权修改此导图", code: "FORBIDDEN" }, 403);
  }

  // visibility 仅创建者可修改
  if (body.visibility !== undefined && existing.userId !== userId) {
    return c.json({ error: "仅创建者可修改可见性" }, 403);
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (body.title !== undefined) {
    updates.push("title = ?");
    values.push(body.title);
  }
  if (body.data !== undefined) {
    updates.push("data = ?");
    values.push(typeof body.data === "string" ? body.data : JSON.stringify(body.data));
  }
  if (body.visibility !== undefined) {
    // 只有 PRIVATE 或 WORKSPACE 是合法值
    if (body.visibility !== "PRIVATE" && body.visibility !== "WORKSPACE") {
      return c.json({ error: "可见性仅支持 PRIVATE 或 WORKSPACE" }, 400);
    }
    updates.push("visibility = ?");
    values.push(body.visibility);
  }
  // 显式忽略 body.workspaceId：不允许跨空间迁移

  if (updates.length > 0) {
    updates.push("updatedAt = datetime('now')");
    values.push(id);
    db.prepare(`UPDATE mindmaps SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  }

  const row = db.prepare("SELECT * FROM mindmaps WHERE id = ?").get(id);
  return c.json(row);
});

// ---------- 删除 ----------
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");

  const existing = db.prepare("SELECT * FROM mindmaps WHERE id = ?").get(id) as
    | MindmapRow
    | undefined;
  if (!existing) return c.json({ error: "思维导图不存在" }, 404);

  if (!canManageResource(existing.userId, existing.workspaceId, userId)) {
    return c.json({ error: "无权删除此导图", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM mindmaps WHERE id = ?").run(id);
  return c.json({ success: true });
});

export default app;
