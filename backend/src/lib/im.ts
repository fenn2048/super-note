/**
 * IM 会话辅助：家庭工作区群 + 成员 1:1。
 * 个人空间没有聊天。
 */
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";
import { getDb } from "../db/schema";
import { getUserWorkspaceRole, hasPermission, isSystemAdmin, resolveNotePermission } from "../middleware/acl";

export type ImConversationType = "group" | "dm";
export type ImMessageType = "text" | "image" | "file" | "sticker" | "voice" | "card";
export type ImCardKind = "note" | "diary" | "task";

export interface ImCardPayload {
  kind: ImCardKind;
  id: string;
  title: string;
  snippet?: string;
  label: string;
}

export function dmKey(userA: string, userB: string): string {
  return userA < userB ? `${userA}:${userB}` : `${userB}:${userA}`;
}

function dbOf(db?: Database.Database): Database.Database {
  return db || getDb();
}

/** 工作区家庭群：没有则创建，并把缺失成员补进群。 */
export function ensureWorkspaceGroup(workspaceId: string, db?: Database.Database): string {
  const d = dbOf(db);
  const ws = d.prepare("SELECT id, name FROM workspaces WHERE id = ?").get(workspaceId) as
    | { id: string; name: string }
    | undefined;
  if (!ws) throw new Error("工作区不存在");

  let conv = d
    .prepare("SELECT id FROM im_conversations WHERE workspaceId = ? AND type = 'group'")
    .get(workspaceId) as { id: string } | undefined;

  if (!conv) {
    const id = uuid();
    const title = (ws.name || "家庭").trim() || "家庭群";
    d.prepare(
      `INSERT INTO im_conversations (id, workspaceId, type, title, dmKey)
       VALUES (?, ?, 'group', ?, NULL)`,
    ).run(id, workspaceId, title);
    conv = { id };
  } else {
    // 工作区改名时同步群标题（仅当仍是默认「工作区名」或空）
    const row = d
      .prepare("SELECT title FROM im_conversations WHERE id = ?")
      .get(conv.id) as { title: string | null };
    if (!row?.title) {
      d.prepare("UPDATE im_conversations SET title = ?, updatedAt = datetime('now') WHERE id = ?").run(
        (ws.name || "家庭群").trim(),
        conv.id,
      );
    }
  }

  const members = d
    .prepare("SELECT userId FROM workspace_members WHERE workspaceId = ?")
    .all(workspaceId) as { userId: string }[];
  const insert = d.prepare(
    `INSERT OR IGNORE INTO im_members (conversationId, userId, lastReadAt, joinedAt)
     VALUES (?, ?, NULL, datetime('now'))`,
  );
  for (const m of members) {
    insert.run(conv.id, m.userId);
  }
  return conv.id;
}

export function addUserToWorkspaceGroup(workspaceId: string, userId: string, db?: Database.Database): void {
  const d = dbOf(db);
  const convId = ensureWorkspaceGroup(workspaceId, d);
  d.prepare(
    `INSERT OR IGNORE INTO im_members (conversationId, userId, lastReadAt, joinedAt)
     VALUES (?, ?, NULL, datetime('now'))`,
  ).run(convId, userId);
}

/** 退出 / 被移出工作区：从该工作区所有 IM 会话移除。 */
export function removeUserFromWorkspaceIm(
  workspaceId: string,
  userId: string,
  db?: Database.Database,
): void {
  const d = dbOf(db);
  d.prepare(
    `DELETE FROM im_members
     WHERE userId = ?
       AND conversationId IN (SELECT id FROM im_conversations WHERE workspaceId = ?)`,
  ).run(userId, workspaceId);
}

export function syncWorkspaceGroupTitle(workspaceId: string, name: string, db?: Database.Database): void {
  const d = dbOf(db);
  const title = (name || "").trim();
  if (!title) return;
  d.prepare(
    `UPDATE im_conversations SET title = ?, updatedAt = datetime('now')
     WHERE workspaceId = ? AND type = 'group'`,
  ).run(title, workspaceId);
}

export function getOrCreateDm(
  workspaceId: string,
  userA: string,
  userB: string,
  db?: Database.Database,
): string {
  const d = dbOf(db);
  if (userA === userB) throw new Error("不能与自己私聊");
  const key = dmKey(userA, userB);
  const existing = d
    .prepare(
      `SELECT id FROM im_conversations WHERE workspaceId = ? AND type = 'dm' AND dmKey = ?`,
    )
    .get(workspaceId, key) as { id: string } | undefined;
  if (existing) {
    // 确保双方都在成员表（被踢后又加回）
    const insert = d.prepare(
      `INSERT OR IGNORE INTO im_members (conversationId, userId, lastReadAt, joinedAt)
       VALUES (?, ?, NULL, datetime('now'))`,
    );
    insert.run(existing.id, userA);
    insert.run(existing.id, userB);
    return existing.id;
  }
  const id = uuid();
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO im_conversations (id, workspaceId, type, title, dmKey)
       VALUES (?, ?, 'dm', NULL, ?)`,
    ).run(id, workspaceId, key);
    d.prepare(
      `INSERT INTO im_members (conversationId, userId, lastReadAt, joinedAt)
       VALUES (?, ?, NULL, datetime('now'))`,
    ).run(id, userA);
    d.prepare(
      `INSERT INTO im_members (conversationId, userId, lastReadAt, joinedAt)
       VALUES (?, ?, NULL, datetime('now'))`,
    ).run(id, userB);
  });
  tx();
  return id;
}

export function assertImMember(
  conversationId: string,
  userId: string,
  db?: Database.Database,
): { workspaceId: string; type: ImConversationType } {
  const d = dbOf(db);
  const row = d
    .prepare(
      `SELECT c.workspaceId, c.type
       FROM im_conversations c
       JOIN im_members m ON m.conversationId = c.id AND m.userId = ?
       WHERE c.id = ?`,
    )
    .get(userId, conversationId) as { workspaceId: string; type: ImConversationType } | undefined;
  if (!row) {
    const err = new Error("无权访问该会话") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (!getUserWorkspaceRole(row.workspaceId, userId)) {
    const err = new Error("无权访问该工作区") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  return row;
}

export function isImModerator(workspaceId: string, userId: string): boolean {
  if (isSystemAdmin(userId)) return true;
  const role = getUserWorkspaceRole(workspaceId, userId);
  return role === "owner" || role === "admin";
}

export function getImFilesDir(): string {
  const dir = path.join(
    process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"),
    "im-files",
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function unlinkImFilePaths(relPaths: string[]): void {
  const dir = getImFilesDir();
  for (const rel of relPaths) {
    if (!rel || rel.includes("..") || rel.includes("/") || rel.includes("\\")) continue;
    try {
      fs.unlinkSync(path.join(dir, rel));
    } catch {
      /* ignore missing */
    }
  }
}

/** 物理删除会话（消息、成员、附件行 CASCADE）并清理磁盘文件。 */
export function destroyConversation(conversationId: string, db?: Database.Database): void {
  const d = dbOf(db);
  const files = d
    .prepare("SELECT path FROM im_files WHERE conversationId = ?")
    .all(conversationId) as { path: string }[];
  d.prepare("DELETE FROM im_conversations WHERE id = ?").run(conversationId);
  d.prepare(
    `DELETE FROM notifications WHERE sourceType = 'chat' AND sourceId = ?`,
  ).run(conversationId);
  unlinkImFilePaths(files.map((f) => f.path).filter(Boolean));
}

export function lastMessagePreview(
  conversationId: string,
  db?: Database.Database,
): { lastPreview: string; lastMessageAt: string | null } {
  const d = dbOf(db);
  const row = d
    .prepare(
      `SELECT m.type, m.body, m.createdAt, f.filename
       FROM im_messages m
       LEFT JOIN im_files f ON f.id = m.fileId
       WHERE m.conversationId = ?
       ORDER BY m.createdAt DESC, m.id DESC
       LIMIT 1`,
    )
    .get(conversationId) as
    | { type: ImMessageType; body: string | null; createdAt: string; filename: string | null }
    | undefined;
  if (!row) return { lastPreview: "", lastMessageAt: null };
  return {
    lastPreview: previewFromMessage(row.type, row.body, row.filename),
    lastMessageAt: row.createdAt,
  };
}

export function previewFromMessage(type: ImMessageType, body: string | null, filename?: string | null): string {
  if (type === "image") return "[图片]";
  if (type === "sticker") return "[表情]";
  if (type === "voice") return "[语音]";
  if (type === "file") return filename ? `[文件] ${filename}` : "[文件]";
  if (type === "card") {
    const card = parseImCard(body);
    if (!card) return "[卡片]";
    const title = (card.title || "").trim() || "未命名";
    const text = `[${card.label}] ${title}`;
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
  const text = (body || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

const CARD_LABEL: Record<ImCardKind, string> = {
  note: "笔记",
  diary: "说说",
  task: "任务",
};

export function parseImCard(body: string | null): ImCardPayload | null {
  if (!body) return null;
  try {
    const raw = JSON.parse(body) as Partial<ImCardPayload>;
    if (raw.kind !== "note" && raw.kind !== "diary" && raw.kind !== "task") return null;
    if (typeof raw.id !== "string" || !raw.id.trim()) return null;
    return {
      kind: raw.kind,
      id: raw.id.trim(),
      title: typeof raw.title === "string" ? raw.title : "",
      snippet: typeof raw.snippet === "string" ? raw.snippet : undefined,
      label: CARD_LABEL[raw.kind],
    };
  } catch {
    return null;
  }
}

function clipSnippet(text: string | null | undefined, max = 80): string {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export class ShareCardError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** 校验发送者可读，并生成发送时的标题/摘要快照。仅允许当前工作区资源。 */
export function resolveShareCard(
  kind: string,
  id: string,
  userId: string,
  workspaceId: string,
): ImCardPayload {
  const cardId = (id || "").trim();
  if (!cardId) throw new ShareCardError("缺少卡片 id");
  if (kind !== "note" && kind !== "diary" && kind !== "task") {
    throw new ShareCardError("不支持的卡片类型");
  }
  const d = getDb();

  if (kind === "note") {
    const note = d
      .prepare(
        `SELECT id, userId, workspaceId, title, contentText, visibility, isTrashed, isLocked
         FROM notes WHERE id = ?`,
      )
      .get(cardId) as
      | {
          id: string;
          userId: string;
          workspaceId: string | null;
          title: string;
          contentText: string | null;
          visibility: string | null;
          isTrashed: number;
          isLocked: number;
        }
      | undefined;
    if (!note) throw new ShareCardError("笔记不存在", 404);
    if (note.workspaceId !== workspaceId) throw new ShareCardError("只能分享当前工作区的笔记", 403);
    if (note.isTrashed) throw new ShareCardError("已删除的笔记不能分享", 400);
    const { permission } = resolveNotePermission(cardId, userId);
    if (!hasPermission(permission, "read")) throw new ShareCardError("无权分享该笔记", 403);
    if ((note.visibility || "WORKSPACE") === "PRIVATE" && note.userId !== userId) {
      throw new ShareCardError("无权分享该笔记", 403);
    }
    return {
      kind: "note",
      id: note.id,
      title: (note.title || "").trim() || "无标题笔记",
      snippet: note.isLocked ? "" : clipSnippet(note.contentText),
      label: CARD_LABEL.note,
    };
  }

  if (kind === "diary") {
    const diary = d
      .prepare(`SELECT id, userId, workspaceId, contentText, visibility FROM diaries WHERE id = ?`)
      .get(cardId) as
      | {
          id: string;
          userId: string;
          workspaceId: string | null;
          contentText: string | null;
          visibility: string | null;
        }
      | undefined;
    if (!diary) throw new ShareCardError("说说不存在", 404);
    if (diary.workspaceId !== workspaceId) throw new ShareCardError("只能分享当前工作区的说说", 403);
    const vis = (diary.visibility || "PRIVATE").toUpperCase();
    const canRead = diary.userId === userId || vis === "PUBLIC";
    if (!canRead) throw new ShareCardError("无权分享该说说", 403);
    const snippet = clipSnippet(diary.contentText) || "说说";
    return {
      kind: "diary",
      id: diary.id,
      title: snippet,
      snippet: "",
      label: CARD_LABEL.diary,
    };
  }

  const task = d
    .prepare(
      `SELECT pt.id, pt.title, pt.description, p.id AS projectId, p.workspaceId, p.visibility, p.ownerId, p.isDeleted
       FROM project_tasks pt
       JOIN projects p ON p.id = pt.projectId
       WHERE pt.id = ?`,
    )
    .get(cardId) as
    | {
        id: string;
        title: string;
        description: string | null;
        projectId: string;
        workspaceId: string | null;
        visibility: string | null;
        ownerId: string;
        isDeleted: number;
      }
    | undefined;
  if (!task || task.isDeleted) throw new ShareCardError("任务不存在", 404);
  if (task.workspaceId !== workspaceId) throw new ShareCardError("只能分享当前工作区的任务", 403);

  let canRead = task.ownerId === userId;
  if (!canRead) {
    const member = d
      .prepare("SELECT 1 AS ok FROM project_members WHERE projectId = ? AND userId = ?")
      .get(task.projectId, userId) as { ok: number } | undefined;
    if (member) canRead = true;
  }
  if (!canRead) {
    const vis = (task.visibility || "").toUpperCase();
    if (vis === "PUBLIC" || vis === "WORKSPACE") canRead = true;
  }
  if (!canRead) throw new ShareCardError("无权分享该任务", 403);

  return {
    kind: "task",
    id: task.id,
    title: (task.title || "").trim() || "未命名任务",
    snippet: clipSnippet(task.description),
    label: CARD_LABEL.task,
  };
}

export function getImStickersDir(): string {
  const dir = path.join(
    process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"),
    "im-stickers",
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** 全员默认表情包（仓库 assets，不进用户 data）。 */
export function getBundledStickersDir(): string | null {
  const env = (process.env.BUNDLED_STICKERS_DIR || "").trim();
  const candidates = [
    env,
    path.join(process.cwd(), "assets", "bundled-stickers"),
    path.join(process.cwd(), "backend", "assets", "bundled-stickers"),
    path.join(__dirname, "..", "assets", "bundled-stickers"),
    path.join(__dirname, "..", "..", "assets", "bundled-stickers"),
  ].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) return dir;
    } catch {
      /* skip */
    }
  }
  return null;
}
