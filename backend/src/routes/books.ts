import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/schema";
import { ensureHolderNote } from "./files";
import {
  ensureAttachmentsDir,
  getAttachmentsDir,
  MIME_TO_EXT,
} from "./attachments";
import {
  getUserWorkspaceRole,
  isSystemAdmin,
} from "../middleware/acl";

const app = new Hono();

// ---------------------------------------------------------------------------
// 权限辅助函数
// ---------------------------------------------------------------------------

function canManageBook(creatorId: string, workspaceId: string | null, actorId: string): boolean {
  if (!actorId) return false;
  if (creatorId === actorId) return true;
  if (!workspaceId) return false; // 个人空间他人资源：一律不可动
  const role = getUserWorkspaceRole(workspaceId, actorId);
  return role === "owner" || role === "admin";
}

// ---------------------------------------------------------------------------
// 1. 书籍分类管理 (Book Groups)
// ---------------------------------------------------------------------------

// 获取分类列表
app.get("/groups", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const workspaceId = c.req.query("workspaceId") || "";
  const db = getDb();

  try {
    let rows;
    if (workspaceId) {
      // 校验工作区成员身份
      const role = getUserWorkspaceRole(workspaceId, userId);
      if (!role) return c.json({ error: "无权访问该工作区" }, 403);
      rows = db.prepare("SELECT * FROM book_groups WHERE workspaceId = ? ORDER BY createdAt ASC").all(workspaceId);
    } else {
      rows = db.prepare("SELECT * FROM book_groups WHERE userId = ? AND workspaceId IS NULL ORDER BY createdAt ASC").all(userId);
    }
    return c.json(rows);
  } catch (err) {
    return c.json({ error: "获取分类失败: " + (err as Error).message }, 500);
  }
});

// 新建分类
app.post("/groups", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const { name, workspaceId } = await c.req.json<{ name: string; workspaceId?: string }>();
  if (!name || !name.trim()) return c.json({ error: "分类名称不能为空" }, 400);

  const db = getDb();
  const id = uuid();

  try {
    if (workspaceId) {
      const role = getUserWorkspaceRole(workspaceId, userId);
      if (!role) return c.json({ error: "无权访问该工作区" }, 403);
    }

    db.prepare(
      "INSERT INTO book_groups (id, name, userId, workspaceId) VALUES (?, ?, ?, ?)"
    ).run(id, name.trim(), userId, workspaceId || null);

    return c.json({ id, name: name.trim(), userId, workspaceId: workspaceId || null });
  } catch (err) {
    return c.json({ error: "新建分类失败: " + (err as Error).message }, 500);
  }
});

// 修改分类
app.put("/groups/:id", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const { name } = await c.req.json<{ name: string }>();
  if (!name || !name.trim()) return c.json({ error: "分类名称不能为空" }, 400);

  const db = getDb();
  const group = db.prepare("SELECT * FROM book_groups WHERE id = ?").get(id) as any;
  if (!group) return c.json({ error: "分类不存在" }, 404);

  if (!canManageBook(group.userId, group.workspaceId, userId)) {
    return c.json({ error: "权限不足，仅所有者或管理员可修改" }, 403);
  }

  try {
    db.prepare("UPDATE book_groups SET name = ? WHERE id = ?").run(name.trim(), id);
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: "更新分类失败: " + (err as Error).message }, 500);
  }
});

// 删除分类
app.delete("/groups/:id", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();
  const group = db.prepare("SELECT * FROM book_groups WHERE id = ?").get(id) as any;
  if (!group) return c.json({ error: "分类不存在" }, 404);

  if (!canManageBook(group.userId, group.workspaceId, userId)) {
    return c.json({ error: "权限不足，仅所有者或管理员可删除" }, 403);
  }

  try {
    const tx = db.transaction(() => {
      // 分类下的书籍重置为未分类
      db.prepare("UPDATE books SET groupId = NULL WHERE groupId = ?").run(id);
      db.prepare("DELETE FROM book_groups WHERE id = ?").run(id);
    });
    tx();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: "删除分类失败: " + (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// 2. 书籍管理 (Books)
// ---------------------------------------------------------------------------

// 获取书籍列表
app.get("/", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const workspaceId = c.req.query("workspaceId") || "";
  const groupId = c.req.query("groupId");
  const q = c.req.query("q") || "";
  const db = getDb();

  let sql = "";
  const params: any[] = [];

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);

    // 工作区共享书籍：可见 WORKSPACE，或者可见 PRIVATE 且所有者是自己的书
    sql = "SELECT b.*, COALESCE(u.displayName, u.username) AS creatorName FROM books b LEFT JOIN users u ON b.userId = u.id WHERE b.workspaceId = ? AND (b.visibility = 'WORKSPACE' OR (b.visibility = 'PRIVATE' AND b.userId = ?))";
    params.push(workspaceId, userId);
  } else {
    // 个人空间书籍
    sql = "SELECT b.*, COALESCE(u.displayName, u.username) AS creatorName FROM books b LEFT JOIN users u ON b.userId = u.id WHERE b.userId = ? AND b.workspaceId IS NULL";
    params.push(userId);
  }

  if (groupId) {
    if (groupId === "uncategorized") {
      sql += " AND b.groupId IS NULL";
    } else {
      sql += " AND b.groupId = ?";
      params.push(groupId);
    }
  }

  if (q.trim()) {
    sql += " AND (b.title LIKE ? OR b.author LIKE ?)";
    params.push(`%${q}%`, `%${q}%`);
  }

  sql += " ORDER BY b.createdAt DESC";

  try {
    const rows = db.prepare(sql).all(...params);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: "查询书籍失败: " + (err as Error).message }, 500);
  }
});

// 获取单本书籍详情
app.get("/:bookHash", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const db = getDb();

  try {
    const book = db.prepare("SELECT * FROM books WHERE bookHash = ?").get(bookHash) as any;
    if (!book) return c.json({ error: "书籍不存在" }, 404);

    // 可见性检查
    if (book.workspaceId) {
      const role = getUserWorkspaceRole(book.workspaceId, userId);
      if (!role) return c.json({ error: "无权访问该工作区" }, 403);
      if (book.visibility === "PRIVATE" && book.userId !== userId) {
        return c.json({ error: "该书籍仅上传者可见" }, 403);
      }
    } else {
      if (book.userId !== userId) return c.json({ error: "无权访问此书籍" }, 403);
    }

    return c.json(book);
  } catch (err) {
    return c.json({ error: "查询书籍详情失败: " + (err as Error).message }, 500);
  }
});

// 导入/上传书籍
app.post("/import", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const file = body.file;
  const workspaceId = (body.workspaceId as string) || null;
  const groupId = (body.groupId as string) || null;
  const reqTitle = body.title as string | undefined;
  const reqAuthor = body.author as string | undefined;
  const coverFile = body.cover;

  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }

  const mime = (file.type || "application/octet-stream").toLowerCase();
  const filename = file.name || "";
  const ext = filename.split(".").pop()?.toLowerCase() || "bin";

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");

  const db = getDb();

  // 校验工作区权限
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }

  // 1. 检查此用户在此空间下是否已经存在此书籍
  const existingBook = db.prepare(
    "SELECT * FROM books WHERE userId = ? AND bookHash = ?"
  ).get(userId, sha256) as any;

  if (existingBook) {
    return c.json(existingBook);
  }

  // 2. 新建或获取未归档文件的占位 Note
  const { noteId } = ensureHolderNote(userId, workspaceId);

  // 3. 落盘并创建 attachment 记录
  ensureAttachmentsDir();
  const attachmentId = uuid();
  const savePath = path.join(getAttachmentsDir(), `${attachmentId}.${ext}`);
  let coverSavePath: string | null = null;
  let coverAttachmentId: string | null = null;

  try {
    fs.writeFileSync(savePath, buffer);
  } catch (err) {
    return c.json({ error: "写入书籍文件失败: " + (err as Error).message }, 500);
  }

  try {
    // 4. 处理封面图片上传
    if (coverFile instanceof File) {
      const coverMime = (coverFile.type || "image/jpeg").toLowerCase();
      const coverExt = "jpg";
      const coverBuffer = Buffer.from(await coverFile.arrayBuffer());
      const coverSha256 = crypto.createHash("sha256").update(coverBuffer).digest("hex");
      coverAttachmentId = uuid();
      coverSavePath = path.join(getAttachmentsDir(), `${coverAttachmentId}.${coverExt}`);
      fs.writeFileSync(coverSavePath, coverBuffer);

      db.prepare(
        `INSERT INTO attachments (id, noteId, userId, filename, mimeType, size, path, workspaceId, hash, uploadSource)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'book_cover')`
      ).run(
        coverAttachmentId,
        noteId,
        userId,
        "cover.jpg",
        coverMime,
        coverFile.size,
        `${coverAttachmentId}.${coverExt}`,
        workspaceId,
        coverSha256
      );
    }

    const cleanTitle = filename.replace(/\.[^/.]+$/, ""); // 去除后缀
    const metadataJson = JSON.stringify({ coverAttachmentId });

    const tx = db.transaction(() => {
      // 写入 attachments 附件表，从而在“文件管理”中展示
      db.prepare(
        `INSERT INTO attachments (id, noteId, userId, filename, mimeType, size, path, workspaceId, hash, uploadSource)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'book')`
      ).run(
        attachmentId,
        noteId,
        userId,
        filename,
        mime,
        file.size,
        `${attachmentId}.${ext}`,
        workspaceId,
        sha256
      );

      // 写入 books 书籍表
      db.prepare(
        `INSERT INTO books (userId, bookHash, workspaceId, attachmentId, title, author, format, size, groupId, visibility, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRIVATE', ?)`
      ).run(
        userId,
        sha256,
        workspaceId,
        attachmentId,
        reqTitle || cleanTitle,
        reqAuthor || "未知作者",
        ext,
        file.size,
        groupId,
        metadataJson
      );
    });
    tx();

    const book = db.prepare("SELECT * FROM books WHERE userId = ? AND bookHash = ?").get(userId, sha256);
    return c.json(book);
  } catch (err) {
    // 失败清理文件
    try { fs.unlinkSync(savePath); } catch {}
    if (coverSavePath) {
      try { fs.unlinkSync(coverSavePath); } catch {}
    }
    return c.json({ error: "导入书籍入库失败: " + (err as Error).message }, 500);
  }
});

// 编辑书籍元数据
app.put("/:bookHash", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const { title, author, groupId, tags, visibility } = await c.req.json<{
    title?: string;
    author?: string;
    groupId?: string | null;
    tags?: string;
    visibility?: "PRIVATE" | "WORKSPACE";
  }>();

  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE bookHash = ?").get(bookHash) as any;
  if (!book) return c.json({ error: "书籍不存在" }, 404);

  if (!canManageBook(book.userId, book.workspaceId, userId)) {
    return c.json({ error: "权限不足，仅上传者或管理员可修改书籍信息" }, 403);
  }

  try {
    const tx = db.transaction(() => {
      const updates: string[] = [];
      const params: any[] = [];

      if (title !== undefined) {
        updates.push("title = ?");
        params.push(title.trim());
      }
      if (author !== undefined) {
        updates.push("author = ?");
        params.push(author.trim());
      }
      if (groupId !== undefined) {
        updates.push("groupId = ?");
        params.push(groupId || null);
      }
      if (tags !== undefined) {
        updates.push("tags = ?");
        params.push(tags);
      }
      if (visibility !== undefined) {
        updates.push("visibility = ?");
        params.push(visibility);

        // 如果可见性升级为 WORKSPACE，将底层的 attachments 的 workspaceId 也对齐（如果是工作区的话）
        if (visibility === "WORKSPACE" && book.workspaceId) {
          db.prepare("UPDATE attachments SET workspaceId = ? WHERE id = ?").run(book.workspaceId, book.attachmentId);
        }
      }

      if (updates.length > 0) {
        updates.push("updatedAt = datetime('now')");
        params.push(bookHash);
        db.prepare(`UPDATE books SET ${updates.join(", ")} WHERE bookHash = ?`).run(...params);
      }
    });
    tx();

    const updated = db.prepare("SELECT * FROM books WHERE bookHash = ?").get(bookHash);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: "更新书籍失败: " + (err as Error).message }, 500);
  }
});

// 删除书籍
app.delete("/:bookHash", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const db = getDb();

  const book = db.prepare("SELECT * FROM books WHERE bookHash = ?").get(bookHash) as any;
  if (!book) return c.json({ error: "书籍不存在" }, 404);

  if (!canManageBook(book.userId, book.workspaceId, userId)) {
    return c.json({ error: "权限不足，仅所有者或工作区管理员可删除" }, 403);
  }

  try {
    // 查找附件文件路径
    const attachment = db.prepare("SELECT path FROM attachments WHERE id = ?").get(book.attachmentId) as { path: string } | undefined;
    
    let coverAttachment: { path: string } | undefined;
    let coverAttachmentId: string | null = null;
    if (book.metadata) {
      try {
        const meta = JSON.parse(book.metadata);
        if (meta.coverAttachmentId) {
          coverAttachmentId = meta.coverAttachmentId;
          coverAttachment = db.prepare("SELECT path FROM attachments WHERE id = ?").get(coverAttachmentId) as { path: string } | undefined;
        }
      } catch {}
    }

    const tx = db.transaction(() => {
      // 1. 删除 book 表记录
      db.prepare("DELETE FROM books WHERE bookHash = ?").run(bookHash);
      // 2. 删除划线标注
      db.prepare("DELETE FROM book_notes WHERE bookHash = ?").run(bookHash);
      // 3. 删除阅读配置
      db.prepare("DELETE FROM book_configs WHERE bookHash = ?").run(bookHash);
      // 4. 删除附件表记录（由外键级联或手动删除）
      db.prepare("DELETE FROM attachments WHERE id = ?").run(book.attachmentId);
      if (coverAttachmentId) {
        db.prepare("DELETE FROM attachments WHERE id = ?").run(coverAttachmentId);
      }
      // 5. 解除说说引用关联 (将 diaries 中的 bookHash 设为 NULL)
      db.prepare("UPDATE diaries SET bookHash = NULL WHERE bookHash = ?").run(bookHash);
    });
    tx();

    // 6. 从磁盘删除文件
    if (attachment && attachment.path) {
      const fullPath = path.join(getAttachmentsDir(), attachment.path);
      try { fs.unlinkSync(fullPath); } catch {}
    }
    if (coverAttachment && coverAttachment.path) {
      const coverFullPath = path.join(getAttachmentsDir(), coverAttachment.path);
      try { fs.unlinkSync(coverFullPath); } catch {}
    }

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: "删除书籍失败: " + (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// 3. 阅读进度与偏好配置 (Book Configs)
// ---------------------------------------------------------------------------

// 获取阅读配置/进度
app.get("/:bookHash/config", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const db = getDb();

  try {
    const config = db.prepare("SELECT * FROM book_configs WHERE userId = ? AND bookHash = ?").get(userId, bookHash);
    if (!config) {
      // 返回默认空白配置
      return c.json({
        userId,
        bookHash,
        location: null,
        xpointer: null,
        progress: "0%",
        viewSettings: "{}",
      });
    }
    return c.json(config);
  } catch (err) {
    return c.json({ error: "获取阅读配置失败: " + (err as Error).message }, 500);
  }
});

// 保存阅读配置/进度
app.put("/:bookHash/config", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const { location, xpointer, progress, viewSettings } = await c.req.json<{
    location?: string;
    xpointer?: string;
    progress?: string;
    viewSettings?: string;
  }>();

  const db = getDb();

  try {
    const tx = db.transaction(() => {
      // 1. 写入/更新 book_configs 表
      db.prepare(`
        INSERT INTO book_configs (userId, bookHash, location, xpointer, progress, viewSettings, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(userId, bookHash) DO UPDATE SET
          location = COALESCE(?, location),
          xpointer = COALESCE(?, xpointer),
          progress = COALESCE(?, progress),
          viewSettings = COALESCE(?, viewSettings),
          updatedAt = datetime('now')
      `).run(
        userId,
        bookHash,
        location || null,
        xpointer || null,
        progress || "0%",
        viewSettings || "{}",
        location || null,
        xpointer || null,
        progress || "0%",
        viewSettings || "{}"
      );

      // 2. 同时更新 books 表的 progress 百分比和阅读状态 (仅更新操作者的 progress)
      if (progress) {
        const numericProgress = parseFloat(progress.replace("%", "")) || 0.0;
        let readingStatus = "reading";
        if (numericProgress >= 99.0) {
          readingStatus = "finished";
        } else if (numericProgress <= 0.1) {
          readingStatus = "unread";
        }

        db.prepare(
          "UPDATE books SET progress = ?, readingStatus = ?, updatedAt = datetime('now') WHERE userId = ? AND bookHash = ?"
        ).run(numericProgress, readingStatus, userId, bookHash);
      }
    });
    tx();

    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: "保存阅读配置失败: " + (err as Error).message }, 500);
  }
});

// ---------------------------------------------------------------------------
// 4. 书籍标注划线与批注 (Annotations)
// ---------------------------------------------------------------------------

// 获取当前书籍的划线与标注
app.get("/:bookHash/notes", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const db = getDb();

  try {
    const book = db.prepare("SELECT * FROM books WHERE bookHash = ?").get(bookHash) as any;
    if (!book) return c.json({ error: "书籍不存在" }, 404);

    let rows;
    if (book.workspaceId && book.visibility === "WORKSPACE") {
      // 共享书籍：获取该工作区下所有人在该书的划线 (过滤掉他人的私有笔记，仅能看公开的或者本人的)
      rows = db.prepare(`
        SELECT bn.*, u.username, u.displayName, u.avatarUrl
        FROM book_notes bn
        LEFT JOIN users u ON bn.userId = u.id
        WHERE bn.bookHash = ? AND (bn.visibility = 'public' OR bn.visibility = 'WORKSPACE' OR bn.userId = ?)
        ORDER BY bn.createdAt ASC
      `).all(bookHash, userId);
    } else {
      // 私有书籍：仅获取当前用户自己的划线
      rows = db.prepare(`
        SELECT bn.*, u.username, u.displayName, u.avatarUrl
        FROM book_notes bn
        LEFT JOIN users u ON bn.userId = u.id
        WHERE bn.bookHash = ? AND bn.userId = ?
        ORDER BY bn.createdAt ASC
      `).all(bookHash, userId);
    }

    return c.json(rows);
  } catch (err) {
    return c.json({ error: "获取划线笔记失败: " + (err as Error).message }, 500);
  }
});

// 新增划线/批注
app.post("/:bookHash/notes", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const bookHash = c.req.param("bookHash");
  const { id, type, cfi, xpointer0, xpointer1, page, text, style, color, note, visibility, chapterTitle, progress } = await c.req.json<{
    id?: string;
    type?: string;
    cfi?: string;
    xpointer0?: string;
    xpointer1?: string;
    page?: number;
    text?: string;
    style?: string;
    color?: string;
    note?: string;
    visibility?: string;
    chapterTitle?: string;
    progress?: string;
  }>();

  const noteId = id || uuid();
  const db = getDb();

  try {
    if (cfi) {
      const existing = db.prepare("SELECT * FROM book_notes WHERE userId = ? AND bookHash = ? AND cfi = ?").get(userId, bookHash, cfi) as any;
      if (existing) {
        db.prepare(`
          UPDATE book_notes
          SET type = ?, style = ?, color = ?, note = ?, visibility = ?, chapterTitle = ?, progress = ?, updatedAt = datetime('now')
          WHERE id = ?
        `).run(type || "highlight", style || "solid", color || "#ffeb3b", note || "", visibility || existing.visibility || "public", chapterTitle || existing.chapterTitle, progress || existing.progress, existing.id);
        
        const updated = db.prepare(`
          SELECT bn.*, u.username, u.displayName, u.avatarUrl
          FROM book_notes bn
          LEFT JOIN users u ON bn.userId = u.id
          WHERE bn.id = ?
        `).get(existing.id);
        return c.json(updated);
      }
    }

    db.prepare(`
      INSERT INTO book_notes (id, userId, bookHash, type, cfi, xpointer0, xpointer1, page, text, style, color, note, visibility, chapterTitle, progress, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      noteId,
      userId,
      bookHash,
      type || "highlight",
      cfi || null,
      xpointer0 || null,
      xpointer1 || null,
      page || 0,
      text || "",
      style || "solid",
      color || "#ffeb3b",
      note || "",
      visibility || "public",
      chapterTitle || null,
      progress || null
    );

    const created = db.prepare(`
      SELECT bn.*, u.username, u.displayName, u.avatarUrl
      FROM book_notes bn
      LEFT JOIN users u ON bn.userId = u.id
      WHERE bn.id = ?
    `).get(noteId);
    return c.json(created);
  } catch (err) {
    return c.json({ error: "添加划线笔记失败: " + (err as Error).message }, 500);
  }
});

// 更新自己的划线/批注
app.put("/:bookHash/notes/:id", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const { note, style, color, visibility, chapterTitle, progress } = await c.req.json<{
    note?: string;
    style?: string;
    color?: string;
    visibility?: string;
    chapterTitle?: string;
    progress?: string;
  }>();

  const db = getDb();
  const bookNote = db.prepare("SELECT userId FROM book_notes WHERE id = ?").get(id) as { userId: string } | undefined;
  if (!bookNote) return c.json({ error: "划线不存在" }, 404);

  if (bookNote.userId !== userId) {
    return c.json({ error: "无权修改他人的标注/划线" }, 403);
  }

  try {
    const updates: string[] = [];
    const params: any[] = [];

    if (note !== undefined) {
      updates.push("note = ?");
      params.push(note);
    }
    if (style !== undefined) {
      updates.push("style = ?");
      params.push(style);
    }
    if (color !== undefined) {
      updates.push("color = ?");
      params.push(color);
    }
    if (visibility !== undefined) {
      updates.push("visibility = ?");
      params.push(visibility);
    }
    if (chapterTitle !== undefined) {
      updates.push("chapterTitle = ?");
      params.push(chapterTitle);
    }
    if (progress !== undefined) {
      updates.push("progress = ?");
      params.push(progress);
    }

    if (updates.length > 0) {
      updates.push("updatedAt = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE book_notes SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    const updated = db.prepare(`
      SELECT bn.*, u.username, u.displayName, u.avatarUrl
      FROM book_notes bn
      LEFT JOIN users u ON bn.userId = u.id
      WHERE bn.id = ?
    `).get(id);
    return c.json(updated);
  } catch (err) {
    return c.json({ error: "更新划线笔记失败: " + (err as Error).message }, 500);
  }
});

// 删除自己的划线/批注
app.delete("/:bookHash/notes/:id", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const id = c.req.param("id");
  const db = getDb();

  const bookNote = db.prepare("SELECT userId FROM book_notes WHERE id = ?").get(id) as { userId: string } | undefined;
  if (!bookNote) return c.json({ error: "划线不存在" }, 404);

  if (bookNote.userId !== userId) {
    return c.json({ error: "无权删除他人的标注/划线" }, 403);
  }

  try {
    // 同时把 diaries 表中引用此 noteId 的记录 of bookNoteId 设为 NULL
    const tx = db.transaction(() => {
      db.prepare("UPDATE diaries SET bookNoteId = NULL WHERE bookNoteId = ?").run(id);
      db.prepare("DELETE FROM book_notes WHERE id = ?").run(id);
    });
    tx();
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: "删除划线笔记失败: " + (err as Error).message }, 500);
  }
});

// 通过 noteId 逆向查询 bookHash
app.get("/note-info/:noteId", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const noteId = c.req.param("noteId");
  const db = getDb();

  try {
    const row = db.prepare("SELECT bookHash FROM book_notes WHERE id = ?").get(noteId) as { bookHash: string } | undefined;
    if (!row) return c.json({ error: "笔记不存在" }, 404);
    return c.json({ bookHash: row.bookHash });
  } catch (err) {
    return c.json({ error: "查询笔记信息失败: " + (err as Error).message }, 500);
  }
});

// 获取某条书籍标注/批注的评论列表
app.get("/:bookHash/notes/:noteId/comments", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const noteId = c.req.param("noteId");
  const db = getDb();

  try {
    const rows = db.prepare(`
      SELECT bnc.*, u.username, u.displayName, u.avatarUrl
      FROM book_note_comments bnc
      LEFT JOIN users u ON bnc.userId = u.id
      WHERE bnc.noteId = ?
      ORDER BY bnc.createdAt ASC
    `).all(noteId);
    return c.json(rows);
  } catch (err) {
    return c.json({ error: "获取评论列表失败: " + (err as Error).message }, 500);
  }
});

// 给某条书籍标注/批注添加评论
app.post("/:bookHash/notes/:noteId/comments", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const noteId = c.req.param("noteId");
  const bookHash = c.req.param("bookHash");
  const body = await c.req.json() as { content: string };
  const content = (body.content || "").trim();
  if (!content) return c.json({ error: "评论内容不能为空" }, 400);

  const db = getDb();

  try {
    // 查出该 note 及其所属书籍
    const note = db.prepare("SELECT * FROM book_notes WHERE id = ?").get(noteId) as any;
    if (!note) return c.json({ error: "该读书笔记/划线不存在" }, 404);

    const book = db.prepare("SELECT title FROM books WHERE bookHash = ?").get(bookHash) as any;
    const bookTitle = book?.title || "未知书籍";

    const commentId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO book_note_comments (id, noteId, userId, content, createdAt)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(commentId, noteId, userId, content);

    // 如果评论人不是笔记拥有者，则向笔记拥有者发送通知
    if (note.userId !== userId) {
      const notificationId = crypto.randomUUID();
      const actor = db.prepare("SELECT displayName, username FROM users WHERE id = ?").get(userId) as any;
      const actorName = actor?.displayName || actor?.username || "某人";

      const sourceTitle = `《${bookTitle}》 中的读书笔记收到新回复: "${content.slice(0, 30)}${content.length > 30 ? '...' : ''}"`;

      // 1. 写入 mentions 表 (兼容 sourceType='note')
      db.prepare(`
        INSERT INTO mentions (id, sourceType, sourceId, sourceTitle, mentionedUserId, mentionedByUserId, createdAt)
        VALUES (?, 'note', ?, ?, ?, ?, datetime('now'))
      `).run(notificationId, noteId, sourceTitle, note.userId, userId);

      // 2. 写入 notifications 表 (兼容 actorName)
      db.prepare(`
        INSERT INTO notifications (id, userId, type, sourceType, sourceId, sourceTitle, actorId, actorName, createdAt)
        VALUES (?, ?, 'mention', 'note', ?, ?, ?, ?, datetime('now'))
      `).run(notificationId, note.userId, noteId, sourceTitle, userId, actorName);

      // 3. 实时广播推送
      try {
        const { broadcastToUser } = require("../services/realtime");
        const unread = db.prepare("SELECT COUNT(*) as count FROM mentions WHERE mentionedUserId = ? AND readAt IS NULL").get(note.userId) as { count: number };
        broadcastToUser(note.userId, {
          type: "notification:received",
          unreadCount: unread.count,
          notification: {
            id: notificationId,
            type: "mention",
            sourceType: "note",
            sourceId: noteId,
            sourceTitle,
            actorId: userId,
            actorName,
          }
        });
      } catch (e) {
        console.warn("[book-note-comment] failed to broadcast mention notification:", e);
      }
    }

    // 返回新创建的评论，带上作者信息
    const author = db.prepare("SELECT username, displayName, avatarUrl FROM users WHERE id = ?").get(userId) as any;
    return c.json({
      id: commentId,
      noteId,
      userId,
      content,
      createdAt: new Date().toISOString(),
      username: author?.username,
      displayName: author?.displayName,
      avatarUrl: author?.avatarUrl
    });
  } catch (err) {
    return c.json({ error: "发布评论失败: " + (err as Error).message }, 500);
  }
});

export default app;
