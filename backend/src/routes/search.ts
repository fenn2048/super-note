import { Hono } from "hono";
import { getDb } from "../db/schema";
import { getUserWorkspaceRole } from "../middleware/acl";

const app = new Hono();

/**
 * 经典笔记搜索（兼容旧客户端）
 * GET /api/search?q=
 */
app.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);
  const q = c.req.query("q");
  if (!q || q.trim().length === 0) return c.json([]);

  const searchTerm = q.split(/\s+/).map((w) => `"${w}"*`).join(" AND ");

  const results = db
    .prepare(
      `
    SELECT n.id, n.title, n.notebookId, n.updatedAt,
      CASE WHEN EXISTS(SELECT 1 FROM favorites f WHERE f.noteId = n.id AND f.userId = ?) THEN 1 ELSE 0 END AS isFavorite,
      n.isPinned,
      snippet(notes_fts, 1, '<mark>', '</mark>', '...', 40) as snippet
    FROM notes_fts fts
    JOIN notes n ON fts.rowid = n.rowid
    WHERE notes_fts MATCH ? AND n.userId = ? AND n.isTrashed = 0
    ORDER BY rank LIMIT 50
  `,
    )
    .all(userId, searchTerm, userId);

  return c.json(results);
});

/**
 * 全局多域搜索（P2-2）
 * GET /api/search/global?q=&workspaceId=
 */
app.get("/global", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "未授权" }, 401);

  const q = (c.req.query("q") || "").trim();
  if (!q) {
    return c.json({ notes: [], diaries: [], tasks: [], books: [] });
  }

  const rawWs = (c.req.query("workspaceId") || "").trim();
  const workspaceId =
    !rawWs || rawWs === "personal" || rawWs === "null" ? null : rawWs;

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区" }, 403);
  }

  const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
  const limit = 8;

  // Notes: FTS when possible, fall back LIKE
  let notes: any[] = [];
  try {
    const searchTerm = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, "")}"*`)
      .join(" AND ");
    if (workspaceId) {
      notes = db
        .prepare(
          `
        SELECT n.id, n.title, n.notebookId, n.updatedAt,
          snippet(notes_fts, 1, '', '', '...', 32) as snippet
        FROM notes_fts fts
        JOIN notes n ON fts.rowid = n.rowid
        WHERE notes_fts MATCH ?
          AND n.workspaceId = ?
          AND n.isTrashed = 0
          AND (n.visibility = 'WORKSPACE' OR n.userId = ?)
        ORDER BY rank LIMIT ?
      `,
        )
        .all(searchTerm, workspaceId, userId, limit) as any[];
    } else {
      notes = db
        .prepare(
          `
        SELECT n.id, n.title, n.notebookId, n.updatedAt,
          snippet(notes_fts, 1, '', '', '...', 32) as snippet
        FROM notes_fts fts
        JOIN notes n ON fts.rowid = n.rowid
        WHERE notes_fts MATCH ?
          AND n.userId = ? AND n.workspaceId IS NULL AND n.isTrashed = 0
        ORDER BY rank LIMIT ?
      `,
        )
        .all(searchTerm, userId, limit) as any[];
    }
  } catch {
    if (workspaceId) {
      notes = db
        .prepare(
          `
        SELECT id, title, notebookId, updatedAt, substr(contentText, 1, 80) as snippet
        FROM notes
        WHERE workspaceId = ? AND isTrashed = 0
          AND (visibility = 'WORKSPACE' OR userId = ?)
          AND (title LIKE ? ESCAPE '\\' OR contentText LIKE ? ESCAPE '\\')
        ORDER BY updatedAt DESC LIMIT ?
      `,
        )
        .all(workspaceId, userId, like, like, limit) as any[];
    } else {
      notes = db
        .prepare(
          `
        SELECT id, title, notebookId, updatedAt, substr(contentText, 1, 80) as snippet
        FROM notes
        WHERE userId = ? AND workspaceId IS NULL AND isTrashed = 0
          AND (title LIKE ? ESCAPE '\\' OR contentText LIKE ? ESCAPE '\\')
        ORDER BY updatedAt DESC LIMIT ?
      `,
        )
        .all(userId, like, like, limit) as any[];
    }
  }

  // Diaries
  let diaries: any[] = [];
  try {
    if (workspaceId) {
      diaries = db
        .prepare(
          `
        SELECT id, substr(contentText, 1, 100) as snippet, createdAt, mood
        FROM diaries
        WHERE workspaceId = ?
          AND (visibility = 'PUBLIC' OR visibility = 'WORKSPACE' OR userId = ?)
          AND contentText LIKE ? ESCAPE '\\'
        ORDER BY createdAt DESC LIMIT ?
      `,
        )
        .all(workspaceId, userId, like, limit) as any[];
    } else {
      diaries = db
        .prepare(
          `
        SELECT id, substr(contentText, 1, 100) as snippet, createdAt, mood
        FROM diaries
        WHERE userId = ? AND (workspaceId IS NULL OR workspaceId = '')
          AND contentText LIKE ? ESCAPE '\\'
        ORDER BY createdAt DESC LIMIT ?
      `,
        )
        .all(userId, like, limit) as any[];
    }
  } catch {
    diaries = [];
  }

  // Project tasks (canonical task model)
  let tasks: any[] = [];
  try {
    if (workspaceId) {
      tasks = db
        .prepare(
          `
        SELECT pt.id, pt.title, pt.projectId, pt.isCompleted, pt.updatedAt, p.name as projectName
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE p.workspaceId = ? AND p.isDeleted = 0
          AND (pt.title LIKE ? ESCAPE '\\' OR pt.description LIKE ? ESCAPE '\\')
        ORDER BY pt.updatedAt DESC LIMIT ?
      `,
        )
        .all(workspaceId, like, like, limit) as any[];
    } else {
      tasks = db
        .prepare(
          `
        SELECT pt.id, pt.title, pt.projectId, pt.isCompleted, pt.updatedAt, p.name as projectName
        FROM project_tasks pt
        JOIN projects p ON p.id = pt.projectId
        WHERE (p.workspaceId IS NULL OR p.workspaceId = '')
          AND p.isDeleted = 0
          AND (p.ownerId = ? OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?))
          AND (pt.title LIKE ? ESCAPE '\\' OR pt.description LIKE ? ESCAPE '\\')
        ORDER BY pt.updatedAt DESC LIMIT ?
      `,
        )
        .all(userId, userId, like, like, limit) as any[];
    }
  } catch {
    tasks = [];
  }

  // Books
  let books: any[] = [];
  try {
    if (workspaceId) {
      books = db
        .prepare(
          `
        SELECT bookHash, title, author, format, updatedAt
        FROM books
        WHERE workspaceId = ?
          AND (visibility = 'WORKSPACE' OR userId = ?)
          AND (title LIKE ? ESCAPE '\\' OR IFNULL(author,'') LIKE ? ESCAPE '\\')
        ORDER BY updatedAt DESC LIMIT ?
      `,
        )
        .all(workspaceId, userId, like, like, limit) as any[];
    } else {
      books = db
        .prepare(
          `
        SELECT bookHash, title, author, format, updatedAt
        FROM books
        WHERE userId = ? AND (workspaceId IS NULL OR workspaceId = '')
          AND (title LIKE ? ESCAPE '\\' OR IFNULL(author,'') LIKE ? ESCAPE '\\')
        ORDER BY updatedAt DESC LIMIT ?
      `,
        )
        .all(userId, like, like, limit) as any[];
    }
  } catch {
    books = [];
  }

  return c.json({ notes, diaries, tasks, books });
});

export default app;
