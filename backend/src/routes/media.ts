import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db/schema";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { redis } from "../services/redis";
import { getAttachmentsDir } from "./attachments";
import {
  getUserWorkspaceRole,
  canManageResource,
  requireWorkspaceFeature,
  isSystemAdmin
} from "../middleware/acl";
import { getAuthUserId } from "../lib/auth-security";

const media = new Hono();

// Helper to resolve workspace scope and features
function resolveMediaScope(
  c: Context,
  userId: string
): { scope: "personal" | "workspace"; workspaceId: string | null; error?: string } {
  const raw = c.req.query("workspaceId") || c.req.query("workspace_id");
  if (!raw || raw === "personal") {
    return { scope: "personal", workspaceId: null };
  }
  const role = getUserWorkspaceRole(raw, userId);
  if (!role) {
    return { scope: "personal", workspaceId: null, error: "无权访问该工作区" };
  }
  return { scope: "workspace", workspaceId: raw };
}

// Check if user has permission to manage media (owner/admin in workspace, or personal space)
function canUserManageMedia(workspaceId: string | null, userId: string): boolean {
  if (!workspaceId) return true; // Personal space: owner always has access
  const role = getUserWorkspaceRole(workspaceId, userId);
  return role === "owner" || role === "admin";
}

// Get Alist config helper
function getAlistConfig() {
  const db = getDb();
  const urlRow = db.prepare("SELECT value FROM system_settings WHERE key = 'alist_url'").get() as { value?: string } | undefined;
  const tokenRow = db.prepare("SELECT value FROM system_settings WHERE key = 'alist_token'").get() as { value?: string } | undefined;
  return {
    url: urlRow?.value || "",
    token: tokenRow?.value || "",
  };
}

// Filename cleaning helper for title generation
function cleanFilename(filename: string): string {
  let name = filename.replace(/\.[^/.]+$/, ""); // Remove extension
  name = name.replace(/(1080p|720p|4k|2160p|bluray|bdrip|web-dl|webrip|h264|h265|x264|x265|dts|aac|ac3)/gi, ""); // Remove quality tags
  name = name.replace(/\b(19\d{2}|20\d{2})\b/g, ""); // Remove year
  name = name.replace(/[._\-]/g, " "); // Replace separators with spaces
  name = name.trim().replace(/\s+/g, " "); // Normalize spaces
  return name || filename;
}

// ===========================================================================
// 1. Alist Configuration (System Admin Only)
// ===========================================================================

media.get("/settings/alist", (c) => {
  const userId = getAuthUserId(c);
  if (!userId || !isSystemAdmin(userId)) {
    return c.json({ error: "仅管理员可查看 Alist 配置", code: "FORBIDDEN" }, 403);
  }
  const { url, token } = getAlistConfig();
  return c.json({ url, token });
});

media.put("/settings/alist", async (c) => {
  const userId = getAuthUserId(c);
  if (!userId || !isSystemAdmin(userId)) {
    return c.json({ error: "仅管理员可配置 Alist", code: "FORBIDDEN" }, 403);
  }

  const { url, token } = await c.req.json() as { url: string; token: string };
  if (!url) {
    return c.json({ error: "Alist 地址不能为空", code: "BAD_REQUEST" }, 400);
  }

  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))").run("alist_url", url.trim().replace(/\/$/, ""));
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updatedAt) VALUES (?, ?, datetime('now'))").run("alist_token", token ? token.trim() : "");

  return c.json({ success: true, message: "Alist 配置已保存" });
});

media.get("/settings/alist/status", async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) {
    return c.json({ error: "未授权", code: "UNAUTHORIZED" }, 401);
  }

  const { url, token } = getAlistConfig();
  if (!url) {
    return c.json({ configured: false, status: "error", message: "Alist 未配置" });
  }

  try {
    const res = await fetch(`${url}/api/fs/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token,
      },
      body: JSON.stringify({
        path: "/",
        page: 1,
        per_page: 10,
        refresh: false
      })
    });

    const data = await res.json() as any;
    if (data.code === 200) {
      return c.json({ configured: true, status: "ok", message: "连接成功" });
    } else {
      return c.json({ configured: true, status: "error", message: data.message || "Alist 认证失败" });
    }
  } catch (err: any) {
    return c.json({ configured: true, status: "error", message: `连接超时或失败: ${err.message}` });
  }
});

// ===========================================================================
// 2. Alist Directory Browser (Admin/Owner Only)
// ===========================================================================

media.get("/alist/list", async (c) => {
  const userId = getAuthUserId(c);
  const workspaceId = c.req.query("workspaceId") || null;
  if (!userId || !canUserManageMedia(workspaceId, userId)) {
    return c.json({ error: "无权浏览网盘", code: "FORBIDDEN" }, 403);
  }

  const pathParam = c.req.query("path") || "/";
  const { url, token } = getAlistConfig();
  if (!url) {
    return c.json({ error: "Alist 服务尚未配置", code: "ALIST_NOT_CONFIGURED" }, 400);
  }

  try {
    const res = await fetch(`${url}/api/fs/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": token,
      },
      body: JSON.stringify({
        path: pathParam,
        page: 1,
        per_page: 0,
        refresh: false
      })
    });

    const data = await res.json() as any;
    if (data.code !== 200) {
      return c.json({ error: data.message || "获取目录失败", code: "ALIST_ERROR" }, 502);
    }

    return c.json({
      path: pathParam,
      files: (data.data?.content || []).map((f: any) => ({
        name: f.name,
        size: f.size,
        is_dir: f.is_dir,
        modified: f.modified
      }))
    });
  } catch (err: any) {
    return c.json({ error: `Alist 连接错误: ${err.message}`, code: "ALIST_CONN_ERROR" }, 502);
  }
});

// ===========================================================================
// 3. Media Collections CRUD
// ===========================================================================

media.post("/collections", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  if (!canUserManageMedia(workspaceId, userId)) {
    return c.json({ error: "仅管理员可创建合集" }, 403);
  }

  const { title, type, cover_url, description, recommendation, sort_order } = await c.req.json() as any;
  if (!title || !type) {
    return c.json({ error: "标题和类型为必填项" }, 400);
  }

  const db = getDb();
  const id = randomUUID().replace(/-/g, "").substring(0, 32);
  db.prepare(`
    INSERT INTO media_collections (id, workspace_id, title, type, cover_url, description, recommendation, sort_order, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, title, type, cover_url || null, description || null, recommendation || null, sort_order || 0, userId);

  const newCol = db.prepare("SELECT * FROM media_collections WHERE id = ?").get(id);
  return c.json(newCol);
});

media.get("/collections", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  const type = c.req.query("type");
  const search = c.req.query("search");

  const db = getDb();
  let sql = `SELECT c.*, u.username as creator_name,
             (SELECT COUNT(*) FROM media_items WHERE collection_id = c.id) as item_count
             FROM media_collections c
             LEFT JOIN users u ON c.created_by = u.id
             WHERE 1=1`;
  const params: any[] = [];

  if (workspaceId) {
    sql += " AND c.workspace_id = ?";
    params.push(workspaceId);
  } else {
    sql += " AND c.workspace_id IS NULL";
  }

  if (type) {
    sql += " AND c.type = ?";
    params.push(type);
  }

  if (search) {
    sql += " AND c.title LIKE ?";
    params.push(`%${search}%`);
  }

  sql += " ORDER BY c.sort_order ASC, c.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  return c.json(rows);
});

media.get("/collections/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const col = db.prepare("SELECT * FROM media_collections WHERE id = ?").get(id) as any;
  if (!col) return c.json({ error: "合集不存在" }, 404);

  // Check workspace role
  if (col.workspace_id) {
    const role = getUserWorkspaceRole(col.workspace_id, userId);
    if (!role) return c.json({ error: "无权访问该合集" }, 403);
  }

  const items = db.prepare("SELECT * FROM media_items WHERE collection_id = ? ORDER BY sort_order ASC, title ASC").all(id);
  return c.json({ ...col, items });
});

media.put("/collections/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const col = db.prepare("SELECT * FROM media_collections WHERE id = ?").get(id) as any;
  if (!col) return c.json({ error: "合集不存在" }, 404);

  if (!canUserManageMedia(col.workspace_id, userId)) {
    return c.json({ error: "仅管理员可编辑合集" }, 403);
  }

  const { title, cover_url, description, recommendation, sort_order } = await c.req.json() as any;
  if (!title) {
    return c.json({ error: "标题不能为空" }, 400);
  }

  db.prepare(`
    UPDATE media_collections
    SET title = ?, cover_url = ?, description = ?, recommendation = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, cover_url || null, description || null, recommendation || null, sort_order || 0, id);

  const updatedCol = db.prepare("SELECT * FROM media_collections WHERE id = ?").get(id);
  return c.json(updatedCol);
});

media.delete("/collections/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const col = db.prepare("SELECT * FROM media_collections WHERE id = ?").get(id) as any;
  if (!col) return c.json({ error: "合集不存在" }, 404);

  if (!canUserManageMedia(col.workspace_id, userId)) {
    return c.json({ error: "仅管理员可删除合集" }, 403);
  }

  db.transaction(() => {
    // Dissociate items instead of cascading delete
    db.prepare("UPDATE media_items SET collection_id = NULL WHERE collection_id = ?").run(id);
    db.prepare("DELETE FROM media_collections WHERE id = ?").run(id);
  })();

  return c.json({ success: true, message: "合集已成功删除，关联单品已解除绑定" });
});

// ===========================================================================
// 4. Media Items CRUD
// ===========================================================================

media.post("/items", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  if (!canUserManageMedia(workspaceId, userId)) {
    return c.json({ error: "仅管理员可创建单品" }, 403);
  }

  const { collection_id, title, type, cover_url, description, alist_path, artist, duration, year, genre, sort_order, tags } = await c.req.json() as any;
  if (!title || !type || !alist_path) {
    return c.json({ error: "标题、类型和 Alist 路径为必填项" }, 400);
  }

  const db = getDb();
  const id = randomUUID().replace(/-/g, "").substring(0, 32);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO media_items (id, collection_id, workspace_id, title, type, cover_url, description, alist_path, artist, duration, year, genre, sort_order, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, collection_id || null, workspaceId, title, type, cover_url || null, description || null, alist_path, artist || null, duration || null, year || null, JSON.stringify(genre || []), sort_order || 0, userId);

    // Save tags if any
    if (tags && Array.isArray(tags)) {
      for (const t of tags) {
        let tagId = t.id;
        if (!tagId) {
          // Find or create tag by name
          const tagRow = db.prepare("SELECT id FROM tags WHERE name = ?").get(t.name) as { id: number } | undefined;
          if (tagRow) {
            tagId = tagRow.id;
          } else {
            const insRes = db.prepare("INSERT INTO tags (name, createdAt) VALUES (?, datetime('now'))").run(t.name);
            tagId = insRes.lastInsertRowid;
          }
        }
        db.prepare("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)").run(id, tagId);
      }
    }
  })();

  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id);
  return c.json(item);
});

media.get("/items", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  const type = c.req.query("type");
  const collectionId = c.req.query("collection_id");
  const tag = c.req.query("tag");
  const search = c.req.query("search");
  const sort = c.req.query("sort") || "newest";
  const year = c.req.query("year");

  const db = getDb();
  let sql = `SELECT i.*, u.username as creator_name, mc.title as collection_title
             FROM media_items i
             LEFT JOIN users u ON i.created_by = u.id
             LEFT JOIN media_collections mc ON i.collection_id = mc.id
             WHERE 1=1`;
  const params: any[] = [];

  if (workspaceId) {
    sql += " AND i.workspace_id = ?";
    params.push(workspaceId);
  } else {
    sql += " AND i.workspace_id IS NULL";
  }

  if (type) {
    sql += " AND i.type = ?";
    params.push(type);
  }

  if (collectionId) {
    sql += " AND i.collection_id = ?";
    params.push(collectionId);
  }

  if (year) {
    sql += " AND i.year = ?";
    params.push(parseInt(year, 10));
  }

  if (search) {
    sql += " AND (i.title LIKE ? OR i.artist LIKE ? OR i.description LIKE ?)";
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (tag) {
    sql += " AND i.id IN (SELECT media_id FROM media_tags mt JOIN tags t ON mt.tag_id = t.id WHERE t.name = ?)";
    params.push(tag);
  }

  if (sort === "newest") {
    sql += " ORDER BY i.created_at DESC";
  } else if (sort === "oldest") {
    sql += " ORDER BY i.created_at ASC";
  } else if (sort === "title") {
    sql += " ORDER BY i.title ASC";
  } else if (sort === "play_count") {
    sql += " ORDER BY i.play_count DESC";
  } else if (sort === "sort_order") {
    sql += " ORDER BY i.sort_order ASC, i.title ASC";
  }

  const rows = db.prepare(sql).all(...params);
  return c.json(rows);
});

media.get("/items/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const item = db.prepare(`
    SELECT i.*, mc.title as collection_title 
    FROM media_items i
    LEFT JOIN media_collections mc ON i.collection_id = mc.id
    WHERE i.id = ?
  `).get(id) as any;
  if (!item) return c.json({ error: "单品不存在" }, 404);

  if (item.workspace_id) {
    const role = getUserWorkspaceRole(item.workspace_id, userId);
    if (!role) return c.json({ error: "无权访问该单品" }, 403);
  }

  // Get tags
  const tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    JOIN media_tags mt ON mt.tag_id = t.id
    WHERE mt.media_id = ?
  `).all(id);

  // Get history for this user
  const history = db.prepare("SELECT progress, played_at FROM media_play_history WHERE media_id = ? AND user_id = ? ORDER BY played_at DESC LIMIT 1").get(id, userId);

  return c.json({ ...item, tags, history });
});

media.put("/items/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as any;
  if (!item) return c.json({ error: "单品不存在" }, 404);

  if (!canUserManageMedia(item.workspace_id, userId)) {
    return c.json({ error: "仅管理员可编辑单品" }, 403);
  }

  const { collection_id, title, cover_url, description, alist_path, artist, duration, year, genre, sort_order, tags } = await c.req.json() as any;
  if (!title || !alist_path) {
    return c.json({ error: "标题和 Alist 路径不能为空" }, 400);
  }

  db.transaction(() => {
    db.prepare(`
      UPDATE media_items
      SET collection_id = ?, title = ?, cover_url = ?, description = ?, alist_path = ?, artist = ?, duration = ?, year = ?, genre = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(collection_id || null, title, cover_url || null, description || null, alist_path, artist || null, duration || null, year || null, JSON.stringify(genre || []), sort_order || 0, id);

    // Sync tags
    db.prepare("DELETE FROM media_tags WHERE media_id = ?").run(id);
    if (tags && Array.isArray(tags)) {
      for (const t of tags) {
        let tagId = t.id;
        if (!tagId) {
          const tagRow = db.prepare("SELECT id FROM tags WHERE name = ?").get(t.name) as { id: number } | undefined;
          if (tagRow) {
            tagId = tagRow.id;
          } else {
            const insRes = db.prepare("INSERT INTO tags (name, createdAt) VALUES (?, datetime('now'))").run(t.name);
            tagId = insRes.lastInsertRowid;
          }
        }
        db.prepare("INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)").run(id, tagId);
      }
    }
  })();

  const updatedItem = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id);
  return c.json(updatedItem);
});

media.delete("/items/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as any;
  if (!item) return c.json({ error: "单品不存在" }, 404);

  if (!canUserManageMedia(item.workspace_id, userId)) {
    return c.json({ error: "仅管理员可删除单品" }, 403);
  }

  db.prepare("DELETE FROM media_items WHERE id = ?").run(id);
  return c.json({ success: true, message: "单品已成功删除" });
});

// ===========================================================================
// 5. Play Direct Link Resolving with Redis Caching
// ===========================================================================

media.get("/items/:id/play-url", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as any;
  if (!item) return c.json({ error: "单品不存在" }, 404);

  if (item.workspace_id) {
    const role = getUserWorkspaceRole(item.workspace_id, userId);
    if (!role) return c.json({ error: "无权访问该单品" }, 403);
  }

  const { url: alistUrl, token: alistToken } = getAlistConfig();
  if (!alistUrl) {
    return c.json({ error: "Alist 未配置，无法播放" }, 400);
  }

  const cacheKey = `media:link:${id}`;
  try {
    const cachedUrl = await redis.get(cacheKey);
    if (cachedUrl) {
      return c.json({ url: cachedUrl, expires_in: 2700 });
    }
  } catch (redisErr) {
    console.warn("[media] Redis connection error, skipping cache:", redisErr);
  }

  try {
    const res = await fetch(`${alistUrl}/api/fs/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": alistToken
      },
      body: JSON.stringify({
        path: item.alist_path,
        password: ""
      })
    });

    const data = await res.json() as any;
    if (data.code !== 200) {
      return c.json({ error: data.message || "从 Alist 获取播放直链失败", code: "ALIST_ERROR" }, 502);
    }

    const rawUrl = data.data?.raw_url;
    if (!rawUrl) {
      return c.json({ error: "Alist 未返回播放直链", code: "NO_DIRECT_LINK" }, 502);
    }

    try {
      await redis.setex(cacheKey, 2700, rawUrl);
    } catch (redisErr) {
      // Ignore Redis caching failures
    }

    return c.json({ url: rawUrl, expires_in: 2700 });
  } catch (err: any) {
    return c.json({ error: `连接 Alist 失败: ${err.message}`, code: "ALIST_CONN_ERROR" }, 502);
  }
});

// Update play progress & increment play count
media.post("/items/:id/play", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const { progress } = await c.req.json() as { progress: number };

  const db = getDb();
  const item = db.prepare("SELECT * FROM media_items WHERE id = ?").get(id) as any;
  if (!item) return c.json({ error: "单品不存在" }, 404);

  db.transaction(() => {
    if (progress === 0 || progress === 5) {
      db.prepare("UPDATE media_items SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?").run(id);
    } else {
      db.prepare("UPDATE media_items SET last_played_at = datetime('now') WHERE id = ?").run(id);
    }

    const hist = db.prepare("SELECT id FROM media_play_history WHERE media_id = ? AND user_id = ?").get(id, userId) as { id: string } | undefined;
    if (hist) {
      db.prepare("UPDATE media_play_history SET progress = ?, played_at = datetime('now') WHERE id = ?").run(progress, hist.id);
    } else {
      const histId = randomUUID().replace(/-/g, "").substring(0, 32);
      db.prepare("INSERT INTO media_play_history (id, media_id, user_id, progress) VALUES (?, ?, ?, ?)").run(histId, id, userId, progress);
    }
  })();

  return c.json({ success: true });
});

// ===========================================================================
// 6. Alist Directory & JSON Batch Importing (Admin/Owner Only)
// ===========================================================================

media.post("/import", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  if (!canUserManageMedia(workspaceId, userId)) {
    return c.json({ error: "仅管理员可执行导入" }, 403);
  }

  const { collection_id, type, files } = await c.req.json() as { collection_id?: string; type: "video" | "audio"; files: Array<{ name: string; path: string }> };
  if (!files || !Array.isArray(files) || files.length === 0) {
    return c.json({ error: "未勾选任何文件" }, 400);
  }

  const db = getDb();
  let count = 0;

  db.transaction(() => {
    for (const f of files) {
      const id = randomUUID().replace(/-/g, "").substring(0, 32);
      const title = cleanFilename(f.name);
      db.prepare(`
        INSERT INTO media_items (id, collection_id, workspace_id, title, type, cover_url, description, alist_path, artist, duration, year, genre, created_by)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, NULL, '[]', ?)
      `).run(id, collection_id || null, workspaceId, title, type, f.path, userId);
      count++;
    }
  })();

  return c.json({ success: true, message: `成功导入 ${count} 个单品` });
});

media.post("/import/json", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { scope, workspaceId, error } = resolveMediaScope(c, userId);
  if (error) return c.json({ error }, 403);

  if (!canUserManageMedia(workspaceId, userId)) {
    return c.json({ error: "仅管理员可执行导入" }, 403);
  }

  const payload = await c.req.json() as { collection?: { title: string; type: "video" | "audio"; cover_url?: string; description?: string }; items: Array<{ title: string; alist_path: string; cover_url?: string; year?: number; duration?: number; artist?: string }> };
  if (!payload.items || !Array.isArray(payload.items) || payload.items.length === 0) {
    return c.json({ error: "JSON 格式错误：没有单品项" }, 400);
  }

  const db = getDb();
  let collectionId: string | null = null;
  let itemsCount = 0;

  db.transaction(() => {
    if (payload.collection && payload.collection.title) {
      collectionId = randomUUID().replace(/-/g, "").substring(0, 32);
      db.prepare(`
        INSERT INTO media_collections (id, workspace_id, title, type, cover_url, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(collectionId, workspaceId, payload.collection.title, payload.collection.type || "video", payload.collection.cover_url || null, payload.collection.description || null, userId);
    }

    for (const item of payload.items) {
      const id = randomUUID().replace(/-/g, "").substring(0, 32);
      const title = item.title;
      const type = payload.collection?.type || "video";
      db.prepare(`
        INSERT INTO media_items (id, collection_id, workspace_id, title, type, cover_url, description, alist_path, artist, duration, year, genre, created_by)
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, '[]', ?)
      `).run(
        id,
        collectionId,
        workspaceId,
        title,
        type,
        item.cover_url || null,
        item.alist_path,
        item.artist || null,
        item.duration || null,
        item.year || null,
        userId
      );
      itemsCount++;
    }
  })();

  return c.json({ success: true, message: `成功导入 ${collectionId ? "1 个合集，" : ""}${itemsCount} 个单品` });
});

media.get("/import/template", (c) => {
  const template = {
    collection: {
      title: "漫威电影宇宙",
      type: "video",
      cover_url: "https://image.tmdb.org/t/p/w300/xxx.jpg",
      description: "漫威电影宇宙系列合集"
    },
    items: [
      {
        title: "钢铁侠",
        alist_path: "/Movies/Marvel/Iron_Man.2008.BluRay.1080p.mp4",
        cover_url: "https://image.tmdb.org/t/p/w300/iron_man.jpg",
        year: 2008,
        duration: 7560
      },
      {
        title: "无敌浩克",
        alist_path: "/Movies/Marvel/The_Incredible_Hulk.2008.mp4",
        year: 2008
      }
    ]
  };

  return c.json(template);
});

// ===========================================================================
// 7. Interactive Reviews & Comments (All Authenticated Users)
// ===========================================================================

media.post("/items/:id/reviews", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const mediaId = c.req.param("id");
  const { type, title, content } = await c.req.json() as { type: "long_review" | "short_comment" | "recommendation"; title?: string; content: string };
  if (!content) {
    return c.json({ error: "评论内容不能为空" }, 400);
  }

  const db = getDb();
  const id = randomUUID().replace(/-/g, "").substring(0, 32);

  db.prepare(`
    INSERT INTO media_reviews (id, media_id, user_id, type, title, content)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, mediaId, userId, type, title || null, content);

  const newReview = db.prepare(`
    SELECT r.*, u.username, u.avatarUrl
    FROM media_reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).get(id);

  return c.json(newReview);
});

media.get("/items/:id/reviews", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const mediaId = c.req.param("id");
  const type = c.req.query("type");

  const db = getDb();
  let sql = `SELECT r.*, u.username, u.avatarUrl
             FROM media_reviews r
             JOIN users u ON r.user_id = u.id
             WHERE r.media_id = ?`;
  const params: any[] = [mediaId];

  if (type) {
    sql += " AND r.type = ?";
    params.push(type);
  }

  sql += " ORDER BY r.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  return c.json(rows);
});

media.put("/reviews/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const review = db.prepare("SELECT * FROM media_reviews WHERE id = ?").get(id) as any;
  if (!review) return c.json({ error: "影评不存在" }, 404);

  if (review.user_id !== userId) {
    return c.json({ error: "仅作者可编辑影评", code: "FORBIDDEN" }, 403);
  }

  const { title, content } = await c.req.json() as { title?: string; content: string };
  if (!content) {
    return c.json({ error: "内容不能为空" }, 400);
  }

  db.prepare(`
    UPDATE media_reviews
    SET title = ?, content = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title || null, content, id);

  const updatedReview = db.prepare(`
    SELECT r.*, u.username, u.avatarUrl
    FROM media_reviews r
    JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).get(id);

  return c.json(updatedReview);
});

media.delete("/reviews/:id", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const review = db.prepare("SELECT r.*, mi.workspace_id FROM media_reviews r JOIN media_items mi ON r.media_id = mi.id WHERE r.id = ?").get(id) as any;
  if (!review) return c.json({ error: "影评不存在" }, 404);

  const isAuthor = review.user_id === userId;
  const isManager = canUserManageMedia(review.workspace_id, userId);

  if (!isAuthor && !isManager) {
    return c.json({ error: "仅作者或管理员可删除影评/评论", code: "FORBIDDEN" }, 403);
  }

  db.prepare("DELETE FROM media_reviews WHERE id = ?").run(id);
  return c.json({ success: true, message: "删除成功" });
});

// ===========================================================================
// 8. Play History
// ===========================================================================

media.get("/play-history", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const db = getDb();
  const rows = db.prepare(`
    SELECT h.*, mi.title, mi.type, mi.cover_url, mi.artist, mi.duration
    FROM media_play_history h
    JOIN media_items mi ON h.media_id = mi.id
    WHERE h.user_id = ?
    ORDER BY h.played_at DESC
  `).all(userId);

  return c.json(rows);
});

media.delete("/play-history", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const db = getDb();
  db.prepare("DELETE FROM media_play_history WHERE user_id = ?").run(userId);
  return c.json({ success: true, message: "播放历史已清空" });
});

// ===========================================================================
// 9. Cover Image Upload (Fallbacks with Sharp compression to 300px WebP)
// ===========================================================================

media.post("/upload-cover", requireWorkspaceFeature("media"), async (c) => {
  const userId = getAuthUserId(c);
  if (!userId) return c.json({ error: "未授权" }, 401);

  const body = await c.req.parseBody();
  const file = body.file as File | undefined;
  if (!file) {
    return c.json({ error: "未检测到上传 file" }, 400);
  }

  if (!file.type.startsWith("image/")) {
    return c.json({ error: "仅支持上传图片文件" }, 400);
  }

  const maxCoverSize = 5 * 1024 * 1024;
  if (file.size > maxCoverSize) {
    return c.json({ error: "图片文件不能超过 5MB" }, 400);
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    const id = randomUUID().replace(/-/g, "").substring(0, 32);
    const filename = `${id}.webp`;
    const destDir = getAttachmentsDir();
    const destPath = path.join(destDir, filename);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const result = await sharp(inputBuffer)
      .resize(300, null, { withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(destPath);

    const db = getDb();
    db.prepare(`
      INSERT INTO diary_attachments (id, diaryId, userId, mimeType, size, path)
      VALUES (?, NULL, ?, 'image/webp', ?, ?)
    `).run(id, userId, result.size, filename);

    return c.json({
      id,
      url: `/api/diary/attachments/${id}`
    });
  } catch (err: any) {
    console.error("[media] sharp compression failed:", err);
    return c.json({ error: `封面图压缩处理失败: ${err.message}` }, 500);
  }
});

export default media;
