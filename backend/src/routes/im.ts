/**
 * 在线 IM（家庭群 + 成员私聊）
 *
 *   GET    /api/im/conversations
 *   GET    /api/im/unread-count
 *   GET    /api/im/conversations/:id/messages  ?before&beforeId | after&afterId | around
 *   GET    /api/im/search?q=
 *   POST   /api/im/conversations/:id/messages
 *   POST   /api/im/conversations/:id/files
 *   POST   /api/im/dm
 *   PUT    /api/im/conversations/:id/read
 *   DELETE /api/im/conversations/:id
 *   DELETE /api/im/conversations/:id/messages  { ids?: string[], all?: boolean }
 *   GET    /api/im/files/:id          （挂在 JWT 之前，见 index.ts）
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDb } from "../db/schema";
import { getAuthUserId } from "../lib/auth-security";
import { getUserWorkspaceRole, isFeatureEnabled, resolveWorkspaceFeatures } from "../middleware/acl";
import {
  assertImMember,
  destroyConversation,
  ensureWorkspaceGroup,
  getBundledStickersDir,
  getImFilesDir,
  getImStickersDir,
  getOrCreateDm,
  isImModerator,
  lastMessagePreview,
  previewFromMessage,
  resolveShareCard,
  ShareCardError,
  unlinkImFilePaths,
  type ImMessageType,
} from "../lib/im";
import { createChatMentions } from "../lib/mentions";
import { MIME_TO_EXT } from "./attachments";
import {
  parseThumbnailWidth,
  getOrCreateThumbnailAsync,
  isThumbnailable,
} from "../services/thumbnails";

const IM_FILES_DIR = getImFilesDir();

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BLOCKED_MIMES = new Set([
  "application/x-msdownload",
  "application/x-ms-installer",
  "application/x-ms-shortcut",
  "application/x-bat",
  "application/x-sh",
  "application/hta",
]);
const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
]);
const AUDIO_MIMES = new Set([
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/x-m4a",
  "audio/m4a",
]);
const BUNDLED_STICKER = /^\/emojis\/(?:pack\/)?[a-zA-Z0-9._-]+\.(png|gif|webp|jpe?g)$/i;
const BUNDLED_STICKER_FILE = /^[a-zA-Z0-9._-]+\.(png|gif|webp|jpe?g|json)$/i;
const CUSTOM_STICKER = /^sticker:([a-zA-Z0-9-]+)$/;
const MAX_STICKERS_PER_WS = 80;
const MAX_STICKER_SIZE = 2 * 1024 * 1024;
const MAX_VOICE_SEC = 60;

function ensureImFilesDir(): string {
  return getImFilesDir();
}

function pickExt(filename: string | undefined, mime: string): string {
  const name = filename || "";
  const idx = name.lastIndexOf(".");
  if (idx >= 0 && idx < name.length - 1) {
    const ext = name.slice(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (ext && ext.length <= 8) return ext;
  }
  return MIME_TO_EXT[mime.toLowerCase()] || "bin";
}

function encodeContentDispositionFilename(name: string, inline: boolean): string {
  const safe = (name || "file").replace(/[\r\n"]/g, "_");
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function toResponseBody(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out as Uint8Array<ArrayBuffer>;
}

function requireWorkspace(c: Context): { userId: string; workspaceId: string } | Response {
  const userId = c.req.header("X-User-Id") || "";
  const raw = (c.req.query("workspaceId") || "").trim();
  const workspaceId = !raw || raw === "personal" ? "" : raw;
  if (!workspaceId) {
    return c.json({ error: "聊天仅在家庭工作区可用", code: "WORKSPACE_REQUIRED" }, 400);
  }
  const role = getUserWorkspaceRole(workspaceId, userId);
  if (!role) {
    return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
  }
  const features = resolveWorkspaceFeatures(workspaceId);
  if (!isFeatureEnabled(features, "chat")) {
    return c.json(
      { error: "该功能在当前工作区已被管理员关闭", code: "FEATURE_DISABLED", feature: "chat" },
      403,
    );
  }
  return { userId, workspaceId };
}

function actorNameOf(userId: string): string {
  const db = getDb();
  const actor = db
    .prepare("SELECT displayName, username FROM users WHERE id = ?")
    .get(userId) as { displayName: string | null; username: string } | undefined;
  return actor?.displayName || actor?.username || "某人";
}

function notifyImMessage(opts: {
  conversationId: string;
  workspaceId: string;
  message: Record<string, unknown>;
  senderId: string;
  preview: string;
  mentionedUserIds?: string[];
}): void {
  const db = getDb();
  const members = db
    .prepare("SELECT userId FROM im_members WHERE conversationId = ? AND userId != ?")
    .all(opts.conversationId, opts.senderId) as { userId: string }[];
  if (members.length === 0) return;

  const actorName = actorNameOf(opts.senderId);
  const upsert = db.prepare(
    `SELECT id FROM notifications
     WHERE userId = ? AND type = 'chat_message' AND sourceId = ? AND readAt IS NULL`,
  );
  const insert = db.prepare(
    `INSERT INTO notifications (id, userId, type, sourceType, sourceId, sourceTitle, actorId, actorName, createdAt)
     VALUES (?, ?, 'chat_message', 'chat', ?, ?, ?, ?, datetime('now'))`,
  );
  const update = db.prepare(
    `UPDATE notifications
     SET sourceTitle = ?, actorId = ?, actorName = ?, createdAt = datetime('now')
     WHERE id = ?`,
  );

  let broadcastToUser: ((userId: string, msg: any) => void) | null = null;
  try {
    broadcastToUser = require("../services/realtime").broadcastToUser;
  } catch {
    broadcastToUser = null;
  }

  const mentioned = new Set(opts.mentionedUserIds || []);

  for (const m of members) {
    // @ 到的人已经有 mention 通知，不再叠一条「发来聊天消息」
    const skipInbox = mentioned.has(m.userId);
    let notifId: string | null = null;
    if (!skipInbox) {
      const existing = upsert.get(m.userId, opts.conversationId) as { id: string } | undefined;
      if (existing) {
        notifId = existing.id;
        update.run(opts.preview, opts.senderId, actorName, notifId);
      } else {
        notifId = crypto.randomUUID();
        insert.run(notifId, m.userId, opts.conversationId, opts.preview, opts.senderId, actorName);
      }
    }

    if (!broadcastToUser) continue;
    try {
      const unread = db
        .prepare("SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND readAt IS NULL")
        .get(m.userId) as { count: number };
      broadcastToUser(m.userId, {
        type: "im:message",
        conversationId: opts.conversationId,
        workspaceId: opts.workspaceId,
        message: opts.message,
      });
      if (notifId) {
        broadcastToUser(m.userId, {
          type: "notification:received",
          unreadCount: unread.count,
          notification: {
            id: notifId,
            type: "chat_message",
            sourceType: "chat",
            sourceId: opts.conversationId,
            sourceTitle: opts.preview,
            actorId: opts.senderId,
            actorName,
          },
        });
      }
    } catch (e) {
      console.warn("[im] broadcast failed:", e);
    }
  }

  // 发送方其它设备也同步一条，不写通知
  if (broadcastToUser) {
    try {
      broadcastToUser(opts.senderId, {
        type: "im:message",
        conversationId: opts.conversationId,
        workspaceId: opts.workspaceId,
        message: opts.message,
        echo: true,
      });
    } catch {
      /* ignore */
    }
  }
}

function hydrateMessage(row: any) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderName: row.senderName || null,
    senderAvatarUrl: row.senderAvatarUrl || null,
    type: row.type as ImMessageType,
    body: row.body || "",
    fileId: row.fileId || null,
    file: row.fileId
      ? {
          id: row.fileId,
          filename: row.filename,
          mimeType: row.mimeType,
          size: row.size,
          url: `/api/im/files/${row.fileId}`,
        }
      : null,
    createdAt: row.createdAt,
  };
}

export async function handleDownloadImFile(c: Context): Promise<Response> {
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT f.id, f.conversationId, f.filename, f.mimeType, f.path, c.workspaceId
       FROM im_files f
       JOIN im_conversations c ON c.id = f.conversationId
       WHERE f.id = ?`,
    )
    .get(id) as
    | {
        id: string;
        conversationId: string;
        filename: string;
        mimeType: string;
        path: string;
        workspaceId: string;
      }
    | undefined;
  if (!row) return c.json({ error: "文件不存在" }, 404);

  const actorId = getAuthUserId(c);
  if (!actorId) {
    return c.json({ error: "未授权，请先登录", code: "UNAUTHENTICATED" }, 401);
  }
  try {
    assertImMember(row.conversationId, actorId);
  } catch {
    return c.json({ error: "无权访问该文件", code: "FORBIDDEN" }, 403);
  }

  const absPath = path.join(IM_FILES_DIR, row.path);
  if (!fs.existsSync(absPath)) {
    return c.json({ error: "文件丢失" }, 404);
  }

  const mime = row.mimeType || "application/octet-stream";
  const isImage = IMAGE_MIMES.has(mime.toLowerCase());
  const isAudio = AUDIO_MIMES.has(mime.toLowerCase()) || mime.startsWith("audio/");
  const width = parseThumbnailWidth(c.req.query("w"));
  if (width && isThumbnailable(mime)) {
    const thumb = await getOrCreateThumbnailAsync(IM_FILES_DIR, row.id, absPath, mime, width);
    if (thumb) {
      return new Response(toResponseBody(thumb.buffer), {
        headers: {
          "Content-Type": thumb.mimeType,
          "Cache-Control": "private, max-age=86400",
          "Content-Disposition": encodeContentDispositionFilename(row.filename, true),
          "Content-Security-Policy": "default-src 'none'; sandbox;",
        },
      });
    }
  }

  const buffer = fs.readFileSync(absPath);
  return new Response(toResponseBody(buffer), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": encodeContentDispositionFilename(row.filename, isImage || isAudio),
      "Content-Security-Policy": isAudio ? "default-src 'none'" : "default-src 'none'; sandbox;",
    },
  });
}

const BUNDLED_MIME: Record<string, string> = {
  ".gif": "image/gif",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** 全员默认表情包：/emojis/pack/<file>，无需登录。 */
export function handleDownloadBundledSticker(c: Context): Response {
  const file = c.req.param("file") || "";
  if (!BUNDLED_STICKER_FILE.test(file)) {
    return c.json({ error: "无效的表情" }, 400);
  }
  const dir = getBundledStickersDir();
  if (!dir) return c.json({ error: "默认表情包未安装" }, 404);
  const root = path.resolve(dir);
  const abs = path.resolve(root, file);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return c.json({ error: "表情不存在" }, 404);
  }
  const ext = path.extname(file).toLowerCase();
  const mime = BUNDLED_MIME[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(abs);
  return new Response(toResponseBody(buffer), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": "inline",
    },
  });
}

export async function handleDownloadImSticker(c: Context): Promise<Response> {
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, workspaceId, filename, mimeType, path FROM im_stickers WHERE id = ?`,
    )
    .get(id) as
    | { id: string; workspaceId: string; filename: string; mimeType: string; path: string }
    | undefined;
  if (!row) return c.json({ error: "表情不存在" }, 404);
  const actorId = getAuthUserId(c);
  if (!actorId) {
    return c.json({ error: "未授权，请先登录", code: "UNAUTHENTICATED" }, 401);
  }
  if (!getUserWorkspaceRole(row.workspaceId, actorId)) {
    return c.json({ error: "无权访问该表情", code: "FORBIDDEN" }, 403);
  }
  const absPath = path.join(getImStickersDir(), row.path);
  if (!fs.existsSync(absPath)) return c.json({ error: "文件丢失" }, 404);
  const mime = row.mimeType || "image/png";
  const buffer = fs.readFileSync(absPath);
  return new Response(toResponseBody(buffer), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=86400",
      "Content-Disposition": encodeContentDispositionFilename(row.filename, true),
      "Content-Security-Policy": "default-src 'none'; sandbox;",
    },
  });
}

const app = new Hono();

app.get("/conversations", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const db = getDb();
  ensureWorkspaceGroup(workspaceId);

  const rows = db
    .prepare(
      `
      SELECT
        c.id, c.workspaceId, c.type, c.title, c.updatedAt,
        last.id AS lastMessageId,
        last.type AS lastMessageType,
        last.body AS lastMessageBody,
        last.createdAt AS lastMessageAt,
        last.senderId AS lastSenderId,
        COALESCE(NULLIF(peer.displayName, ''), peer.username) AS peerName,
        peer.id AS peerId,
        peer.avatarUrl AS peerAvatarUrl,
        f.filename AS lastFilename,
        (
          SELECT COUNT(*) FROM im_messages m
          WHERE m.conversationId = c.id
            AND m.senderId != ?
            AND (mem.lastReadAt IS NULL OR m.createdAt > mem.lastReadAt)
        ) AS unreadCount
      FROM im_conversations c
      JOIN im_members mem ON mem.conversationId = c.id AND mem.userId = ?
      LEFT JOIN im_messages last ON last.id = (
        SELECT id FROM im_messages
        WHERE conversationId = c.id
        ORDER BY createdAt DESC, id DESC
        LIMIT 1
      )
      LEFT JOIN im_files f ON f.id = last.fileId
      LEFT JOIN im_members other
        ON c.type = 'dm' AND other.conversationId = c.id AND other.userId != ?
      LEFT JOIN users peer ON peer.id = other.userId
      WHERE c.workspaceId = ?
      ORDER BY CASE c.type WHEN 'group' THEN 0 ELSE 1 END ASC,
               COALESCE(last.createdAt, c.updatedAt) DESC
      `,
    )
    .all(userId, userId, userId, workspaceId) as any[];

  const items = rows.map((r) => {
    const title =
      r.type === "group"
        ? r.title || "家庭群"
        : r.peerName || "私聊";
    const lastType = (r.lastMessageType || "text") as ImMessageType;
    const lastPreview = r.lastMessageId
      ? previewFromMessage(lastType, r.lastMessageBody, r.lastFilename)
      : "";
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      type: r.type,
      title,
      peerId: r.peerId || null,
      peerAvatarUrl: r.peerAvatarUrl || null,
      updatedAt: r.updatedAt,
      lastMessageAt: r.lastMessageAt || null,
      lastPreview,
      lastSenderId: r.lastSenderId || null,
      unreadCount: Number(r.unreadCount) || 0,
    };
  });

  return c.json({ items });
});

app.get("/unread-count", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT COALESCE(SUM(u.c), 0) AS count FROM (
        SELECT (
          SELECT COUNT(*) FROM im_messages m
          WHERE m.conversationId = c.id
            AND m.senderId != ?
            AND (mem.lastReadAt IS NULL OR m.createdAt > mem.lastReadAt)
        ) AS c
        FROM im_conversations c
        JOIN im_members mem ON mem.conversationId = c.id AND mem.userId = ?
        WHERE c.workspaceId = ?
      ) u
      `,
    )
    .get(userId, userId, workspaceId) as { count: number };
  return c.json({ count: Number(row?.count) || 0 });
});

const MSG_SELECT = `
  SELECT msg.id, msg.conversationId, msg.senderId, msg.type, msg.body, msg.fileId, msg.createdAt,
         COALESCE(NULLIF(u.displayName, ''), u.username) AS senderName,
         u.avatarUrl AS senderAvatarUrl,
         f.filename, f.mimeType, f.size
  FROM im_messages msg
  LEFT JOIN users u ON u.id = msg.senderId
  LEFT JOIN im_files f ON f.id = msg.fileId
`;

function pageMeta(items: ReturnType<typeof hydrateMessage>[], hasMoreBefore: boolean, hasMoreAfter: boolean) {
  const first = items[0];
  const last = items[items.length - 1];
  return {
    items,
    hasMoreBefore,
    hasMoreAfter,
    beforeCursor: first ? { createdAt: first.createdAt, id: first.id } : null,
    afterCursor: last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

app.get("/conversations/:id/messages", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId } = scope;
  const id = c.req.param("id");
  try {
    assertImMember(id, userId);
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }

  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "30", 10) || 30, 1), 50);
  const around = (c.req.query("around") || "").trim();
  const beforeAt = c.req.query("before") || "";
  const beforeId = c.req.query("beforeId") || "";
  const afterAt = c.req.query("after") || "";
  const afterId = c.req.query("afterId") || "";
  const db = getDb();

  if (around) {
    const target = db
      .prepare(`${MSG_SELECT} WHERE msg.conversationId = ? AND msg.id = ?`)
      .get(id, around) as any;
    if (!target) return c.json({ error: "消息不存在" }, 404);
    const side = Math.max(8, Math.floor(limit / 2));
    const older = db
      .prepare(
        `${MSG_SELECT}
         WHERE msg.conversationId = ?
           AND (msg.createdAt < ? OR (msg.createdAt = ? AND msg.id < ?))
         ORDER BY msg.createdAt DESC, msg.id DESC
         LIMIT ?`,
      )
      .all(id, target.createdAt, target.createdAt, target.id, side + 1) as any[];
    const newer = db
      .prepare(
        `${MSG_SELECT}
         WHERE msg.conversationId = ?
           AND (msg.createdAt > ? OR (msg.createdAt = ? AND msg.id > ?))
         ORDER BY msg.createdAt ASC, msg.id ASC
         LIMIT ?`,
      )
      .all(id, target.createdAt, target.createdAt, target.id, side + 1) as any[];
    const hasMoreBefore = older.length > side;
    const hasMoreAfter = newer.length > side;
    const olderPage = older.slice(0, side).reverse().map(hydrateMessage);
    const newerPage = newer.slice(0, side).map(hydrateMessage);
    const items = [...olderPage, hydrateMessage(target), ...newerPage];
    return c.json(pageMeta(items, hasMoreBefore, hasMoreAfter));
  }

  if (afterAt && afterId) {
    const rows = db
      .prepare(
        `${MSG_SELECT}
         WHERE msg.conversationId = ?
           AND (msg.createdAt > ? OR (msg.createdAt = ? AND msg.id > ?))
         ORDER BY msg.createdAt ASC, msg.id ASC
         LIMIT ?`,
      )
      .all(id, afterAt, afterAt, afterId, limit + 1) as any[];
    const hasMoreAfter = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(hydrateMessage);
    return c.json(pageMeta(items, false, hasMoreAfter));
  }

  // 默认：最新一页；before = 比该游标更早（向上）
  const args: unknown[] = [id];
  let where = "WHERE msg.conversationId = ?";
  if (beforeAt && beforeId) {
    where += " AND (msg.createdAt < ? OR (msg.createdAt = ? AND msg.id < ?))";
    args.push(beforeAt, beforeAt, beforeId);
  } else if (c.req.query("cursor")) {
    // 兼容旧客户端：cursor = createdAt
    where += " AND msg.createdAt < ?";
    args.push(c.req.query("cursor"));
  }
  const rows = db
    .prepare(
      `${MSG_SELECT}
       ${where}
       ORDER BY msg.createdAt DESC, msg.id DESC
       LIMIT ?`,
    )
    .all(...args, limit + 1) as any[];
  const hasMoreBefore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map(hydrateMessage).reverse();
  return c.json(pageMeta(items, hasMoreBefore, false));
});

function likePattern(q: string): string {
  const cleaned = q.replace(/[%_\\]/g, "").trim().slice(0, 80);
  return `%${cleaned}%`;
}

function makeSnippet(text: string, q: string, max = 88): string {
  const raw = (text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const needle = q.replace(/[%_\\]/g, "").trim();
  const lower = raw.toLowerCase();
  const i = needle ? lower.indexOf(needle.toLowerCase()) : -1;
  if (i < 0) return raw.length > max ? `${raw.slice(0, max)}…` : raw;
  const start = Math.max(0, i - 24);
  const end = Math.min(raw.length, i + needle.length + 40);
  const slice = `${start > 0 ? "…" : ""}${raw.slice(start, end)}${end < raw.length ? "…" : ""}`;
  return slice;
}

app.get("/search", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const q = (c.req.query("q") || "").trim();
  if (!q) return c.json({ items: [], hasMore: false, nextCursor: null });
  const conversationId = (c.req.query("conversationId") || "").trim();
  if (conversationId) {
    try {
      assertImMember(conversationId, userId);
    } catch (e: any) {
      return c.json({ error: e.message || "无权访问" }, e.status || 403);
    }
  }
  const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "20", 10) || 20, 1), 40);
  const cursorAt = c.req.query("cursor") || "";
  const cursorId = c.req.query("cursorId") || "";
  const like = likePattern(q);
  if (like === "%%") return c.json({ items: [], hasMore: false, nextCursor: null });

  const db = getDb();
  const args: unknown[] = [userId, workspaceId, like, like];
  let extra = "";
  if (conversationId) {
    extra += " AND msg.conversationId = ?";
    args.push(conversationId);
  }
  if (cursorAt && cursorId) {
    extra += " AND (msg.createdAt < ? OR (msg.createdAt = ? AND msg.id < ?))";
    args.push(cursorAt, cursorAt, cursorId);
  }

  const rows = db
    .prepare(
      `
      SELECT msg.id, msg.conversationId, msg.senderId, msg.type, msg.body, msg.fileId, msg.createdAt,
             COALESCE(NULLIF(u.displayName, ''), u.username) AS senderName,
             u.avatarUrl AS senderAvatarUrl,
             f.filename, f.mimeType, f.size,
             c.type AS convType, c.title AS convTitle,
             COALESCE(NULLIF(peer.displayName, ''), peer.username) AS peerName
      FROM im_messages msg
      JOIN im_conversations c ON c.id = msg.conversationId
      JOIN im_members mem ON mem.conversationId = c.id AND mem.userId = ?
      LEFT JOIN users u ON u.id = msg.senderId
      LEFT JOIN im_files f ON f.id = msg.fileId
      LEFT JOIN im_members other
        ON c.type = 'dm' AND other.conversationId = c.id AND other.userId != mem.userId
      LEFT JOIN users peer ON peer.id = other.userId
      WHERE c.workspaceId = ?
        AND (msg.body LIKE ? OR IFNULL(f.filename, '') LIKE ?)
        ${extra}
      ORDER BY msg.createdAt DESC, msg.id DESC
      LIMIT ?
      `,
    )
    .all(...args, limit + 1) as any[];

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items = page.map((r) => {
    const message = hydrateMessage(r);
    const title =
      r.convType === "group" ? r.convTitle || "家庭群" : r.peerName || "私聊";
    const hay =
      message.type === "file"
        ? message.file?.filename || message.body
        : message.type === "card"
          ? previewFromMessage("card", message.body)
          : message.body;
    return {
      conversationId: r.conversationId,
      conversationTitle: title,
      conversationType: r.convType,
      message,
      snippet: makeSnippet(hay || "", q),
    };
  });
  const last = items[items.length - 1];
  return c.json({
    items,
    hasMore,
    nextCursor: hasMore && last ? last.message.createdAt : null,
    nextCursorId: hasMore && last ? last.message.id : null,
  });
});

app.post("/conversations/:id/messages", async (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const id = c.req.param("id");
  let conv;
  try {
    conv = assertImMember(id, userId);
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }
  if (conv.workspaceId !== workspaceId) {
    return c.json({ error: "会话不属于当前工作区" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  let type = (body.type || "text") as ImMessageType;
  if (!["text", "image", "file", "sticker", "voice", "card"].includes(type)) {
    return c.json({ error: "不支持的消息类型" }, 400);
  }
  let text = typeof body.body === "string" ? body.body : "";
  const fileId = typeof body.fileId === "string" ? body.fileId : null;

  const db = getDb();
  let fileRow: { id: string; filename: string; mimeType: string; size: number } | undefined;
  if (fileId && type !== "card") {
    fileRow = db
      .prepare(
        `SELECT id, filename, mimeType, size FROM im_files WHERE id = ? AND conversationId = ?`,
      )
      .get(fileId, id) as typeof fileRow;
    if (!fileRow) return c.json({ error: "附件不存在" }, 400);
    const mime = (fileRow.mimeType || "").toLowerCase();
    if (type !== "sticker" && type !== "voice") {
      if (IMAGE_MIMES.has(mime)) type = "image";
      else if (AUDIO_MIMES.has(mime) || mime.startsWith("audio/")) type = "voice";
      else type = "file";
    }
    if (type === "voice") {
      const sec = parseInt(text, 10);
      if (!Number.isFinite(sec) || sec < 1) {
        return c.json({ error: "语音时长无效" }, 400);
      }
    }
  } else if (type === "sticker") {
    const ref = text.trim();
    if (BUNDLED_STICKER.test(ref)) {
      /* bundled /emojis/*.png */
    } else {
      const m = CUSTOM_STICKER.exec(ref);
      if (!m) return c.json({ error: "无效的表情" }, 400);
      const sticker = db
        .prepare("SELECT id FROM im_stickers WHERE id = ? AND workspaceId = ?")
        .get(m[1], workspaceId) as { id: string } | undefined;
      if (!sticker) return c.json({ error: "表情不存在" }, 400);
    }
  } else if (type === "card") {
    let parsed: { kind?: string; id?: string } = {};
    try {
      parsed = JSON.parse(text) as { kind?: string; id?: string };
    } catch {
      return c.json({ error: "卡片内容无效" }, 400);
    }
    try {
      const snapshot = resolveShareCard(parsed.kind || "", parsed.id || "", userId, workspaceId);
      text = JSON.stringify(snapshot);
    } catch (e: any) {
      const status = e instanceof ShareCardError ? e.status : e?.status || 400;
      return c.json({ error: e?.message || "无法分享该内容" }, status);
    }
  } else if (type !== "text") {
    return c.json({ error: "该消息需要附件" }, 400);
  }

  if (type === "text" && !text.trim()) {
    return c.json({ error: "消息不能为空" }, 400);
  }

  const msgId = uuid();
  db.prepare(
    `INSERT INTO im_messages (id, conversationId, senderId, type, body, fileId)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(msgId, id, userId, type, type === "text" ? text.trim() : text.trim() || "", fileId);
  db.prepare(`UPDATE im_conversations SET updatedAt = datetime('now') WHERE id = ?`).run(id);
  db.prepare(
    `UPDATE im_members SET lastReadAt = datetime('now') WHERE conversationId = ? AND userId = ?`,
  ).run(id, userId);

  const row = db
    .prepare(
      `
      SELECT msg.id, msg.conversationId, msg.senderId, msg.type, msg.body, msg.fileId, msg.createdAt,
             COALESCE(NULLIF(u.displayName, ''), u.username) AS senderName,
             u.avatarUrl AS senderAvatarUrl,
             f.filename, f.mimeType, f.size
      FROM im_messages msg
      LEFT JOIN users u ON u.id = msg.senderId
      LEFT JOIN im_files f ON f.id = msg.fileId
      WHERE msg.id = ?
      `,
    )
    .get(msgId) as any;
  const message = hydrateMessage(row);
  const preview = previewFromMessage(type, message.body, fileRow?.filename);

  let mentionedUserIds: string[] = [];
  if (conv.type === "group" && type === "text") {
    const memberIds = db
      .prepare("SELECT userId FROM im_members WHERE conversationId = ? AND userId != ?")
      .all(id, userId) as { userId: string }[];
    mentionedUserIds = createChatMentions(
      id,
      preview,
      text.trim(),
      userId,
      new Set(memberIds.map((m) => m.userId)),
    );
  }

  notifyImMessage({
    conversationId: id,
    workspaceId,
    message,
    senderId: userId,
    preview,
    mentionedUserIds,
  });
  return c.json(message, 201);
});

app.post("/conversations/:id/files", async (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const id = c.req.param("id");
  try {
    const conv = assertImMember(id, userId);
    if (conv.workspaceId !== workspaceId) {
      return c.json({ error: "会话不属于当前工作区" }, 400);
    }
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }

  let parsed: Record<string, any>;
  try {
    parsed = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const file = parsed.file;
  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }
  if (file.size > MAX_FILE_SIZE) {
    return c.json({ error: `文件过大（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）` }, 413);
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (BLOCKED_MIMES.has(mime)) {
    return c.json({ error: `出于安全考虑，不支持该类型: ${mime}` }, 415);
  }

  ensureImFilesDir();
  const fileId = uuid();
  const ext = pickExt(file.name, mime);
  const relPath = `${fileId}.${ext}`;
  const abs = path.join(IM_FILES_DIR, relPath);
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch (err: any) {
    return c.json({ error: `读取上传内容失败: ${err?.message || err}` }, 500);
  }
  fs.writeFileSync(abs, buffer);

  const filename = (file.name || relPath).slice(0, 255);
  const db = getDb();
  db.prepare(
    `INSERT INTO im_files (id, conversationId, uploaderId, filename, mimeType, size, path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(fileId, id, userId, filename, mime, buffer.length, relPath);

  return c.json(
    {
      id: fileId,
      filename,
      mimeType: mime,
      size: buffer.length,
      url: `/api/im/files/${fileId}`,
      kind: IMAGE_MIMES.has(mime)
        ? "image"
        : AUDIO_MIMES.has(mime) || mime.startsWith("audio/")
          ? "audio"
          : "file",
    },
    201,
  );
});

app.get("/stickers", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { workspaceId } = scope;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, uploaderId, filename, mimeType, size, createdAt
       FROM im_stickers WHERE workspaceId = ?
       ORDER BY createdAt DESC`,
    )
    .all(workspaceId) as any[];
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      uploaderId: r.uploaderId,
      filename: r.filename,
      mimeType: r.mimeType,
      size: r.size,
      url: `/api/im/stickers/${r.id}`,
      createdAt: r.createdAt,
    })),
  });
});

app.post("/stickers", async (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const db = getDb();
  const count = (
    db.prepare("SELECT COUNT(*) AS c FROM im_stickers WHERE workspaceId = ?").get(workspaceId) as {
      c: number;
    }
  ).c;
  if (count >= MAX_STICKERS_PER_WS) {
    return c.json({ error: `最多添加 ${MAX_STICKERS_PER_WS} 个自定义表情` }, 400);
  }
  let parsed: Record<string, any>;
  try {
    parsed = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const file = parsed.file;
  if (!(file instanceof File)) return c.json({ error: "file 字段缺失" }, 400);
  if (file.size > MAX_STICKER_SIZE) {
    return c.json({ error: "表情图片不能超过 2MB" }, 413);
  }
  const mime = (file.type || "image/png").toLowerCase();
  if (!IMAGE_MIMES.has(mime)) {
    return c.json({ error: "自定义表情只支持图片" }, 415);
  }
  const dir = getImStickersDir();
  const stickerId = uuid();
  const ext = pickExt(file.name, mime);
  const relPath = `${stickerId}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(dir, relPath), buffer);
  const filename = (file.name || relPath).slice(0, 255);
  db.prepare(
    `INSERT INTO im_stickers (id, workspaceId, uploaderId, filename, mimeType, size, path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(stickerId, workspaceId, userId, filename, mime, buffer.length, relPath);
  return c.json(
    {
      id: stickerId,
      uploaderId: userId,
      filename,
      mimeType: mime,
      size: buffer.length,
      url: `/api/im/stickers/${stickerId}`,
    },
    201,
  );
});

app.delete("/stickers/:id", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const stickerId = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare("SELECT id, uploaderId, path FROM im_stickers WHERE id = ? AND workspaceId = ?")
    .get(stickerId, workspaceId) as { id: string; uploaderId: string; path: string } | undefined;
  if (!row) return c.json({ error: "表情不存在" }, 404);
  if (row.uploaderId !== userId && !isImModerator(workspaceId, userId)) {
    return c.json({ error: "只能删除自己添加的表情" }, 403);
  }
  db.prepare("DELETE FROM im_stickers WHERE id = ?").run(stickerId);
  const abs = path.join(getImStickersDir(), row.path);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
  return c.json({ success: true });
});

app.post("/dm", async (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const body = await c.req.json().catch(() => ({}));
  const peerId = typeof body.userId === "string" ? body.userId : "";
  if (!peerId) return c.json({ error: "缺少 userId" }, 400);
  if (peerId === userId) return c.json({ error: "不能与自己私聊" }, 400);
  if (!getUserWorkspaceRole(workspaceId, peerId)) {
    return c.json({ error: "对方不是当前工作区成员" }, 400);
  }
  try {
    const id = getOrCreateDm(workspaceId, userId, peerId);
    return c.json({ id, workspaceId, type: "dm" }, 201);
  } catch (e: any) {
    return c.json({ error: e.message || "创建私聊失败" }, 400);
  }
});

app.put("/conversations/:id/read", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId } = scope;
  const id = c.req.param("id");
  try {
    assertImMember(id, userId);
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }
  const db = getDb();
  db.prepare(
    `UPDATE im_members SET lastReadAt = datetime('now') WHERE conversationId = ? AND userId = ?`,
  ).run(id, userId);
  db.prepare(
    `UPDATE notifications SET readAt = datetime('now')
     WHERE userId = ? AND sourceId = ? AND readAt IS NULL
       AND (
         type = 'chat_message'
         OR (type = 'mention' AND sourceType = 'chat')
       )`,
  ).run(userId, id);
  return c.json({ success: true });
});

function broadcastImEvent(
  conversationId: string,
  senderId: string,
  payload: Record<string, unknown>,
): void {
  const db = getDb();
  const members = db
    .prepare("SELECT userId FROM im_members WHERE conversationId = ?")
    .all(conversationId) as { userId: string }[];
  let broadcastToUser: ((userId: string, msg: any) => void) | null = null;
  try {
    broadcastToUser = require("../services/realtime").broadcastToUser;
  } catch {
    return;
  }
  if (!broadcastToUser) return;
  const send = broadcastToUser;
  for (const m of members) {
    try {
      send(m.userId, {
        ...payload,
        conversationId,
        echo: m.userId === senderId,
      });
    } catch {
      /* ignore */
    }
  }
}

/** 删除会话：私聊硬删；家庭群不能删。 */
app.delete("/conversations/:id", (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const id = c.req.param("id");
  let conv;
  try {
    conv = assertImMember(id, userId);
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }
  if (conv.workspaceId !== workspaceId) {
    return c.json({ error: "会话不属于当前工作区" }, 400);
  }
  if (conv.type === "group") {
    return c.json(
      { error: "家庭群不能删除，可以清空或删除消息", code: "GROUP_CANNOT_DELETE" },
      400,
    );
  }
  broadcastImEvent(id, userId, { type: "im:conversation-deleted" });
  destroyConversation(id);
  return c.json({ success: true });
});

/** 删除一条或多条消息；all=true 清空会话（群聊需管理员）。 */
app.delete("/conversations/:id/messages", async (c) => {
  const scope = requireWorkspace(c);
  if (scope instanceof Response) return scope;
  const { userId, workspaceId } = scope;
  const id = c.req.param("id");
  let conv;
  try {
    conv = assertImMember(id, userId);
  } catch (e: any) {
    return c.json({ error: e.message || "无权访问" }, e.status || 403);
  }
  if (conv.workspaceId !== workspaceId) {
    return c.json({ error: "会话不属于当前工作区" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const all = body.all === true;
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  const ids = rawIds.filter((x: unknown) => typeof x === "string" && x).slice(0, 100) as string[];
  if (!all && ids.length === 0) {
    return c.json({ error: "请选择要删除的消息" }, 400);
  }

  const db = getDb();
  const moderate = isImModerator(workspaceId, userId);

  if (all) {
    if (conv.type === "group" && !moderate) {
      return c.json({ error: "只有管理员可以清空家庭群", code: "FORBIDDEN" }, 403);
    }
    const files = db
      .prepare("SELECT path FROM im_files WHERE conversationId = ?")
      .all(id) as { path: string }[];
    db.prepare("DELETE FROM im_messages WHERE conversationId = ?").run(id);
    db.prepare("DELETE FROM im_files WHERE conversationId = ?").run(id);
    db.prepare(`UPDATE im_conversations SET updatedAt = datetime('now') WHERE id = ?`).run(id);
    unlinkImFilePaths(files.map((f) => f.path).filter(Boolean));
    const last = lastMessagePreview(id);
    broadcastImEvent(id, userId, {
      type: "im:deleted",
      all: true,
      ids: [],
      lastPreview: last.lastPreview,
      lastMessageAt: last.lastMessageAt,
    });
    return c.json({ success: true, deletedIds: [], all: true });
  }

  const ph = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, senderId, fileId FROM im_messages WHERE conversationId = ? AND id IN (${ph})`,
    )
    .all(id, ...ids) as { id: string; senderId: string; fileId: string | null }[];

  const allowed = rows.filter((r) => r.senderId === userId || moderate);
  const deletedIds = allowed.map((r) => r.id);
  if (deletedIds.length === 0) {
    return c.json({ error: "无权删除这些消息", code: "FORBIDDEN" }, 403);
  }

  const delPh = deletedIds.map(() => "?").join(",");
  db.prepare(`DELETE FROM im_messages WHERE conversationId = ? AND id IN (${delPh})`).run(
    id,
    ...deletedIds,
  );

  const fileIds = [...new Set(allowed.map((r) => r.fileId).filter(Boolean))] as string[];
  const orphanPaths: string[] = [];
  for (const fid of fileIds) {
    const still = db
      .prepare("SELECT 1 FROM im_messages WHERE fileId = ? LIMIT 1")
      .get(fid);
    if (still) continue;
    const file = db.prepare("SELECT path FROM im_files WHERE id = ?").get(fid) as
      | { path: string }
      | undefined;
    if (file?.path) orphanPaths.push(file.path);
    db.prepare("DELETE FROM im_files WHERE id = ?").run(fid);
  }
  unlinkImFilePaths(orphanPaths);
  db.prepare(`UPDATE im_conversations SET updatedAt = datetime('now') WHERE id = ?`).run(id);

  const last = lastMessagePreview(id);
  broadcastImEvent(id, userId, {
    type: "im:deleted",
    all: false,
    ids: deletedIds,
    lastPreview: last.lastPreview,
    lastMessageAt: last.lastMessageAt,
  });
  return c.json({
    success: true,
    deletedIds,
    skipped: rows.length - deletedIds.length,
    all: false,
  });
});

export default app;
