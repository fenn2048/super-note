/**
 * 默认 TODO 项目
 * ---------------------------------------------------------------------------
 * - 个人TODO：每个用户一份，owner=自己，workspaceId=NULL，visibility=PRIVATE，仅自己可见
 * - 家庭TODO：每个工作区一份（共享），挂在 workspace 下
 *
 * 无论用户当前在哪个工作区，个人TODO 都必须存在。
 */
import { v4 as uuid } from "uuid";

const PERSONAL_TODO = "个人TODO";
const FAMILY_TODO = "家庭TODO";
const PERSONAL_COVER = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";

/** 与普通项目一致：创建 → 待启动，动手 → 进行中，完成 → 已完成 */
const DEFAULT_TODO_STAGES = ["待启动", "进行中", "已完成"] as const;

/**
 * 确保 TODO 项目具备标准三阶段。
 * - 空项目：一次建齐
 * - 已有「进行中/已完成」的老个人TODO：补「待启动」并排在最前
 */
function ensureStages(db: any, projectId: string) {
  const existing = db
    .prepare(
      "SELECT id, name, sortOrder FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC",
    )
    .all(projectId) as { id: string; name: string; sortOrder: number }[];

  if (existing.length === 0) {
    for (const [i, stageName] of DEFAULT_TODO_STAGES.entries()) {
      db.prepare(
        `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      ).run(uuid(), projectId, stageName, i);
    }
    return;
  }

  const byName = new Set(existing.map((s) => s.name));

  // 老数据只有「进行中」「已完成」时补「待启动」，并插到最前
  if (!byName.has("待启动")) {
    const minOrder = existing.reduce(
      (m, s) => Math.min(m, typeof s.sortOrder === "number" ? s.sortOrder : 0),
      0,
    );
    db.prepare(
      `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(uuid(), projectId, "待启动", minOrder - 1);
  }
  if (!byName.has("进行中")) {
    const maxOrder = existing.reduce(
      (m, s) => Math.max(m, typeof s.sortOrder === "number" ? s.sortOrder : 0),
      0,
    );
    db.prepare(
      `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(uuid(), projectId, "进行中", maxOrder + 1);
  }
  if (!byName.has("已完成")) {
    const maxOrder = (
      db
        .prepare(
          "SELECT COALESCE(MAX(sortOrder), 0) as m FROM project_stages WHERE projectId = ?",
        )
        .get(projectId) as { m: number }
    ).m;
    db.prepare(
      `INSERT INTO project_stages (id, projectId, name, sortOrder, createdAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(uuid(), projectId, "已完成", maxOrder + 1);
  }
}

/**
 * 确保当前用户拥有「个人TODO」：
 * - ownerId = userId
 * - workspaceId IS NULL
 * - visibility = PRIVATE
 * - 仅 owner 为成员
 */
export function ensurePersonalTodoProject(
  db: any,
  userId: string,
): { id: string } {
  let row = db
    .prepare(
      `SELECT id FROM projects
       WHERE ownerId = ? AND name = ? AND (workspaceId IS NULL OR workspaceId = '') AND isDeleted = 0
       LIMIT 1`,
    )
    .get(userId, PERSONAL_TODO) as { id: string } | undefined;

  if (!row) {
    const id = uuid();
    db.prepare(
      `INSERT INTO projects (
         id, name, description, cover, ownerId, workspaceId, visibility,
         isArchived, isDeleted, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, NULL, 'PRIVATE', 0, 0, datetime('now'), datetime('now'))`,
    ).run(
      id,
      PERSONAL_TODO,
      "个人待办事项项目",
      PERSONAL_COVER,
      userId,
    );
    db.prepare(
      "INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')",
    ).run(id, userId);
    ensureStages(db, id);
    row = { id };
  } else {
    // 纠偏：个人TODO 必须 PRIVATE + 无 workspace + 仅 owner 成员
    db.prepare(
      `UPDATE projects
       SET visibility = 'PRIVATE',
           workspaceId = NULL,
           updatedAt = datetime('now')
       WHERE id = ? AND (visibility != 'PRIVATE' OR workspaceId IS NOT NULL AND workspaceId != '')`,
    ).run(row.id);
    // 清掉非 owner 成员，保证仅自己可见（协作维度）
    db.prepare(
      "DELETE FROM project_members WHERE projectId = ? AND userId != ?",
    ).run(row.id, userId);
    db.prepare(
      "INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')",
    ).run(row.id, userId);
    ensureStages(db, row.id);
  }

  return row;
}

/**
 * 确保默认 TODO：
 * - workspaceId 为空 → 仅个人TODO
 * - workspaceId 有值 → 个人TODO + 该工作区家庭TODO
 * 返回当前上下文的主默认项目（个人 or 家庭）。
 */
export function ensureDefaultTodoProject(
  db: any,
  userId: string,
  workspaceId: string | null,
): { id: string } {
  // 无论是否在工作区，都先保证个人TODO 存在
  const personal = ensurePersonalTodoProject(db, userId);

  if (!workspaceId) {
    return personal;
  }

  // 工作区：家庭TODO（共享，按 workspace 唯一）
  let row = db
    .prepare(
      `SELECT id FROM projects
       WHERE name = ? AND workspaceId = ? AND isDeleted = 0
       LIMIT 1`,
    )
    .get(FAMILY_TODO, workspaceId) as { id: string } | undefined;

  if (!row) {
    // 兼容：历史上可能按 owner 创建过
    row = db
      .prepare(
        `SELECT id FROM projects
         WHERE ownerId = ? AND name = ? AND workspaceId = ? AND isDeleted = 0
         LIMIT 1`,
      )
      .get(userId, FAMILY_TODO, workspaceId) as { id: string } | undefined;
  }

  if (!row) {
    const id = uuid();
    db.prepare(
      `INSERT INTO projects (
         id, name, description, cover, ownerId, workspaceId, visibility,
         isArchived, isDeleted, createdAt, updatedAt
       ) VALUES (?, ?, ?, ?, ?, ?, 'WORKSPACE', 0, 0, datetime('now'), datetime('now'))`,
    ).run(
      id,
      FAMILY_TODO,
      "家庭共享待办",
      PERSONAL_COVER,
      userId,
      workspaceId,
    );
    db.prepare(
      "INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')",
    ).run(id, userId);
    ensureStages(db, id);
    row = { id };
  } else {
    ensureStages(db, row.id);
    // 工作区成员首次访问时自动加入家庭TODO，否则列表（仅 owner/成员）看不到
    const isOwner = db
      .prepare("SELECT ownerId FROM projects WHERE id = ?")
      .get(row.id) as { ownerId: string } | undefined;
    if (isOwner?.ownerId === userId) {
      db.prepare(
        "INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, 'owner')",
      ).run(row.id, userId);
    } else {
      db.prepare(
        "INSERT OR IGNORE INTO project_members (projectId, userId, role) VALUES (?, ?, 'member')",
      ).run(row.id, userId);
    }
  }

  return row;
}

export { PERSONAL_TODO, FAMILY_TODO };
