import { Hono } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { ensureAttachmentsDir, getAttachmentsDir, MIME_TO_EXT } from "./attachments";
import { getUserWorkspaceRole, hasRole } from "../middleware/acl";
import { logAudit } from "../services/audit";

const clip = new Hono();

// 获取当前用户的所有工作区
clip.get("/workspaces", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";

  const rows = db
    .prepare(
      `
      SELECT w.*, m.role,
             (SELECT COUNT(*) FROM workspace_members WHERE workspaceId = w.id) AS memberCount,
             (SELECT COUNT(*) FROM notebooks WHERE workspaceId = w.id) AS notebookCount
      FROM workspaces w
      JOIN workspace_members m ON m.workspaceId = w.id
      WHERE m.userId = ?
      ORDER BY w.createdAt ASC
    `,
    )
    .all(userId);

  return c.json(rows);
});

// 根据工作区筛选笔记本
clip.get("/notebooks", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const workspaceId = c.req.query("workspaceId");

  let rows: any[];

  if (!workspaceId || workspaceId === "personal") {
    rows = db
      .prepare(
        `
        SELECT * FROM notebooks
        WHERE userId = ? AND workspaceId IS NULL AND isDeleted = 0
        ORDER BY sortOrder ASC
      `,
      )
      .all(userId);
  } else {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    rows = db
      .prepare(
        `
        SELECT * FROM notebooks
        WHERE workspaceId = ? AND isDeleted = 0
        ORDER BY sortOrder ASC
      `,
      )
      .all(workspaceId);
  }

  return c.json(rows);
});

// 图片接收、压缩、存储、返回本地链接
clip.post("/upload-img", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const wsRaw = c.req.query("workspaceId") || "";
  const workspaceId = !wsRaw || wsRaw === "personal" ? null : wsRaw;
  const db = getDb();

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const file = body.file;
  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }

  const mimeLower = (file.type || "application/octet-stream").toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  let compressedBuffer: any = buffer;
  let saveMime = mimeLower;
  let extension = "png";

  const isCompressible =
    mimeLower === "image/jpeg" ||
    mimeLower === "image/jpg" ||
    mimeLower === "image/png" ||
    mimeLower === "image/webp";

  if (isCompressible) {
    try {
      const img = sharp(buffer);
      const metadata = await img.metadata();
      let processed = img;
      
      // 等比例缩放：最大宽度 1200px，不放大小图
      if (metadata.width && metadata.width > 1200) {
        processed = processed.resize({ width: 1200, withoutEnlargement: true });
      }

      // JPG/PNG/WebP 统一 80% 质量压缩
      if (metadata.format === "webp" || metadata.format === "png") {
        processed = processed.webp({ quality: 80 });
        saveMime = "image/webp";
        extension = "webp";
      } else {
        processed = processed.jpeg({ quality: 80 });
        saveMime = "image/jpeg";
        extension = "jpg";
      }
      
      compressedBuffer = await processed.toBuffer();
    } catch (err) {
      console.warn("[clip] 图片压缩失败，保留原图形式:", err);
      const m = mimeLower.match(/\/(png|jpe?g|gif|webp|bmp|svg)(\?|$)/);
      extension = m ? m[1] : "png";
    }
  } else {
    const m = mimeLower.match(/\/(png|jpe?g|gif|webp|bmp|svg|x-icon|icon)(\?|$)/);
    extension = m ? m[1] : "png";
  }

  ensureAttachmentsDir();
  const id = crypto.randomUUID();
  const filename = `${id}.${extension}`;
  const savePath = path.join(getAttachmentsDir(), filename);

  try {
    fs.writeFileSync(savePath, compressedBuffer);
  } catch (err: any) {
    return c.json({ error: `写入文件失败: ${err?.message || err}` }, 500);
  }

  try {
    // 临时存入 diary_attachments，diaryId 为 NULL
    db.prepare(
      `INSERT INTO diary_attachments (id, diaryId, userId, workspaceId, mimeType, size, path)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
    ).run(id, userId, workspaceId, saveMime, compressedBuffer.length, filename);
  } catch (err: any) {
    try {
      fs.unlinkSync(savePath);
    } catch {
      /* ignore */
    }
    return c.json({ error: `写入数据库失败: ${err?.message || err}` }, 500);
  }

  return c.json(
    {
      id,
      url: `/api/diary/attachments/${id}`,
      mimeType: saveMime,
      size: compressedBuffer.length,
    },
    201,
  );
});

// 保存笔记/说说（含自动创建默认笔记本逻辑）
clip.post("/save", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const {
    type,
    title,
    content,
    contentText,
    workspaceId: wsRaw,
    notebookId: nbRaw,
    tags: tagsRaw,
    images: rawImages,
    mood,
    visibility,
  } = body;

  const workspaceId = !wsRaw || wsRaw === "personal" ? null : wsRaw;

  // 校验工作区成员身份（如果非个人空间）
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }

  // 解析标签
  let tags: string[] = [];
  if (Array.isArray(tagsRaw)) {
    tags = tagsRaw.filter((t) => typeof t === "string" && t.trim().length > 0);
  } else if (typeof tagsRaw === "string" && tagsRaw.trim().length > 0) {
    tags = tagsRaw
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  if (type === "diary") {
    // === 保存为说说 ===
    const diaryId = crypto.randomUUID();
    const imagesArray = Array.isArray(rawImages) ? rawImages.filter((img) => typeof img === "string") : [];

    const tx = db.transaction(() => {
      // 插入说说
      db.prepare(
        `INSERT INTO diaries (id, userId, workspaceId, contentText, mood, images, visibility)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        diaryId,
        userId,
        workspaceId,
        contentText || "",
        mood || "",
        JSON.stringify(imagesArray),
        visibility || "PRIVATE",
      );

      // 绑定图片
      if (imagesArray.length > 0) {
        const placeholders = imagesArray.map(() => "?").join(",");
        db.prepare(
          `UPDATE diary_attachments
           SET diaryId = ?, workspaceId = ?
           WHERE id IN (${placeholders}) AND userId = ? AND diaryId IS NULL`,
        ).run(diaryId, workspaceId, ...imagesArray, userId);
      }

      // 绑定标签
      for (const tagName of tags) {
        const tagId = findOrCreateTag(db, userId, tagName, workspaceId);
        db.prepare(
          `INSERT OR IGNORE INTO diary_tags (diaryId, tagId) VALUES (?, ?)`,
        ).run(diaryId, tagId);
      }
    });

    try {
      tx();
    } catch (err: any) {
      return c.json({ error: `保存说说失败: ${err.message || err}` }, 500);
    }

    logAudit(userId, "note", "create", { diaryId }, { targetType: "diary", targetId: diaryId });
    return c.json({ success: true, id: diaryId });

  } else {
    // === 保存为笔记 ===
    let targetNotebookId = nbRaw;

    // 默认笔记本自动创建/复用逻辑
    if (!targetNotebookId || targetNotebookId === "default" || targetNotebookId === "__default__") {
      let nb: any;
      if (workspaceId) {
        nb = db
          .prepare(
            "SELECT id FROM notebooks WHERE workspaceId = ? AND name = ? AND isDeleted = 0",
          )
          .get(workspaceId, "剪藏笔记本");
      } else {
        nb = db
          .prepare(
            "SELECT id FROM notebooks WHERE userId = ? AND workspaceId IS NULL AND name = ? AND isDeleted = 0",
          )
          .get(userId, "剪藏笔记本");
      }

      if (nb) {
        targetNotebookId = nb.id;
      } else {
        // 创建名为 "剪藏笔记本" 的笔记本
        targetNotebookId = uuid();
        db.prepare(
          `INSERT INTO notebooks (id, userId, workspaceId, parentId, name, icon, sortOrder)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(targetNotebookId, userId, workspaceId, null, "剪藏笔记本", "📓", 0);
      }
    } else {
      // 校验笔记本所有权/写权限
      const nbInfo = db
        .prepare("SELECT workspaceId, isDeleted FROM notebooks WHERE id = ?")
        .get(targetNotebookId) as { workspaceId: string | null; isDeleted: number } | undefined;
      if (!nbInfo || nbInfo.isDeleted === 1) {
        return c.json({ error: "目标笔记本不存在或已删除" }, 400);
      }
    }

    const noteId = uuid();
    let finalContent = content || "";
    let finalContentText = contentText || "";

    // 提取笔记内容中引用的临时本地图片，移入 attachments 表
    const tempImageMatches = Array.from(finalContent.matchAll(/\/api\/diary\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi));
    const referencedAttachmentIds = Array.from(new Set(tempImageMatches.map((m: any) => m[1])));

    const tx = db.transaction(() => {
      // 1. 插入笔记
      db.prepare(
        `INSERT INTO notes (id, userId, workspaceId, notebookId, title, content, contentText)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        noteId,
        userId,
        workspaceId,
        targetNotebookId,
        title || "无标题笔记",
        finalContent,
        finalContentText,
      );

      // 2. 处理图片迁移
      if (referencedAttachmentIds.length > 0) {
        const placeholders = referencedAttachmentIds.map(() => "?").join(",");
        // 查找这些临时附件
        const tempAtts = db
          .prepare(
            `SELECT id, path, mimeType, size FROM diary_attachments
             WHERE id IN (${placeholders}) AND userId = ? AND diaryId IS NULL`,
          )
          .all(...referencedAttachmentIds, userId) as Array<{
            id: string;
            path: string;
            mimeType: string;
            size: number;
          }>;

        for (const tempAtt of tempAtts) {
          // 插入到 attachments 表
          db.prepare(
            `INSERT OR REPLACE INTO attachments (id, noteId, userId, filename, mimeType, size, path, workspaceId)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            tempAtt.id,
            noteId,
            userId,
            path.basename(tempAtt.path),
            tempAtt.mimeType,
            tempAtt.size,
            tempAtt.path,
            workspaceId,
          );

          // 从 diary_attachments 删除
          db.prepare("DELETE FROM diary_attachments WHERE id = ?").run(tempAtt.id);
        }

        // 把笔记内容中的 URL 从 /api/diary/attachments/<id> 替换为 /api/attachments/<id>
        finalContent = finalContent.replace(
          /\/api\/diary\/attachments\//g,
          "/api/attachments/",
        );
        
        // 既然最终内容发生了变化（URL 被替换了），我们需要更新刚刚插入的笔记的 content
        db.prepare("UPDATE notes SET content = ? WHERE id = ?").run(finalContent, noteId);
      }

      // 3. 绑定标签
      for (const tagName of tags) {
        const tagId = findOrCreateTag(db, userId, tagName, workspaceId);
        db.prepare(
          `INSERT OR IGNORE INTO note_tags (noteId, tagId) VALUES (?, ?)`,
        ).run(noteId, tagId);
      }
    });

    try {
      tx();
    } catch (err: any) {
      return c.json({ error: `保存笔记失败: ${err.message || err}` }, 500);
    }

    logAudit(userId, "note", "create", { noteId, title }, { targetType: "note", targetId: noteId });
    return c.json({ success: true, id: noteId });
  }
});

// 辅助函数：根据名称查找或创建标签
function findOrCreateTag(db: any, userId: string, name: string, workspaceId: string | null): string {
  const existing = db
    .prepare("SELECT id FROM tags WHERE userId = ? AND name = ?")
    .get(userId, name) as { id: string } | undefined;
  
  if (existing) {
    return existing.id;
  }
  
  const tagId = uuid();
  db.prepare(
    `INSERT INTO tags (id, userId, workspaceId, name, color)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(tagId, userId, workspaceId, name, "#58a6ff");
  
  return tagId;
}

// 每日凌晨 2 点自动清理 30 天前未被引用的图片附件
function sweepExpiredClipImages(): number {
  try {
    const db = getDb();
    const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    let deletedCount = 0;

    // 1. 清理 attachments 表中的过期且未引用附件
    const atts = db
      .prepare("SELECT id, path FROM attachments WHERE createdAt < ?")
      .all(cutoffIso) as Array<{ id: string; path: string }>;

    for (const att of atts) {
      // 检查是否在任何笔记内容中引用该附件ID
      const refNote = db.prepare("SELECT 1 FROM notes WHERE content LIKE ?").get(`%${att.id}%`);
      if (!refNote) {
        db.prepare("DELETE FROM attachments WHERE id = ?").run(att.id);
        const filePath = path.join(getAttachmentsDir(), att.path);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {}
      }
    }

    // 2. 清理 diary_attachments 表中的过期且未引用附件
    const diaryAtts = db
      .prepare("SELECT id, path FROM diary_attachments WHERE createdAt < ?")
      .all(cutoffIso) as Array<{ id: string; path: string }>;

    for (const att of diaryAtts) {
      // 检查是否在说说或笔记中引用该附件ID
      const refDiary = db
        .prepare("SELECT 1 FROM diaries WHERE images LIKE ? OR contentText LIKE ?")
        .get(`%${att.id}%`, `%${att.id}%`);
      const refNote = db.prepare("SELECT 1 FROM notes WHERE content LIKE ?").get(`%${att.id}%`);
      if (!refDiary && !refNote) {
        db.prepare("DELETE FROM diary_attachments WHERE id = ?").run(att.id);
        const filePath = path.join(getAttachmentsDir(), att.path);
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            deletedCount++;
          }
        } catch {}
      }
    }

    if (deletedCount > 0) {
      console.log(`[clip] Swept ${deletedCount} expired and unreferenced attachments from disk`);
    }
    return deletedCount;
  } catch (err) {
    console.warn("[clip] sweepExpiredClipImages failed:", err);
    return 0;
  }
}

// 调度每日凌晨 2:00 进行清理
function scheduleDailyCleanup() {
  const now = new Date();
  const next2AM = new Date();
  next2AM.setHours(2, 0, 0, 0);
  if (now.getTime() >= next2AM.getTime()) {
    next2AM.setDate(next2AM.getDate() + 1);
  }
  const delay = next2AM.getTime() - now.getTime();
  
  // 延期后运行一次，然后设置 24 小时定时器
  setTimeout(() => {
    sweepExpiredClipImages();
    setInterval(sweepExpiredClipImages, 24 * 60 * 60 * 1000);
  }, delay);
}

// 进程启动后延后 1 分钟执行第一次检查（避开启动拥塞），并开启每日凌晨 2:00 清理调度
setTimeout(sweepExpiredClipImages, 60_000);
scheduleDailyCleanup();

export default clip;
