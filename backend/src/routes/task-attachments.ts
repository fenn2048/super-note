/**
 * 任务附件路由（/api/task-attachments）
 * ---------------------------------------------------------------------------
 * 背景：
 *   待办事项模块（TaskCenter）支持在新建任务时插入图片。任务的 title 字段
 *   会以 Markdown 形式保存图片标记 `![filename](/api/task-attachments/<id>)`，
 *   渲染时在列表里显示成缩略图，详情面板里显示成完整图片。
 *
 *   不复用 attachments 表的原因：
 *     - attachments.noteId 强外键到 notes 表（NOT NULL + CASCADE）；
 *     - attachments 的 ACL 是按 note 的 read/write 权限做的，与 task 模型不一致；
 *     - 拆分后双方独立演进，任务的"用户级附件"语义更清晰。
 *
 *   不复用 base64 内联的原因：
 *     - 与 notes.content 同样的问题：title 字段会膨胀，列表 SQL 拖慢；
 *     - 浏览器无法对 data URI 缓存，每次刷新都要重新解码。
 *
 * 模块导出：
 *   - taskAttachmentsAuthRouter：挂在 /api/task-attachments，走 JWT 中间件。
 *     承接 POST（上传）/ DELETE。
 *   - handleDownloadTaskAttachment：挂在 JWT 中间件**之前**的下载 handler，
 *     与 attachments 同款"id 不可枚举"授权模型。
 *
 * 文件复用同一个 ATTACHMENTS_DIR：
 *   省掉再开一个目录，文件名仍然是 uuid+ext，与 attachments 不会冲突。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { getDb } from "../db/schema";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { ensureAttachmentsDir, getAttachmentsDir, MIME_TO_EXT } from "./attachments";
import { getUserWorkspaceRole, canManageResource } from "../middleware/acl";
import { getAuthUserId } from "../lib/auth-security";

// 与 attachments 一致的 MIME 白名单（图片类）以及新增的视频类型。
const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/mpeg",
  "video/x-matroska",
]);

const MIME_TO_EXT_EXTENDED: Record<string, string> = {
  ...MIME_TO_EXT,
  "video/mpeg": "mpeg",
  "video/x-matroska": "mkv",
};

// 单个附件最大 50MB（与 attachments 对齐）。
const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

/**
 * 不需要 JWT 的下载 handler。index.ts 直接把它挂在 JWT 中间件**之前**。
 *
 * 授权模型：与 attachments 完全一致——uuid 不可枚举即视为隐式授权。
 * 任务列表是用户私有的，附件 id 仅在用户自己的 task.title 里存在，泄露面
 * 与笔记附件等同。
 */
export function handleDownloadTaskAttachment(c: Context): Response {
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare("SELECT id, mimeType, path, taskId, workspaceId, userId FROM task_attachments WHERE id = ?")
    .get(id) as { id: string; mimeType: string; path: string; taskId: string | null; workspaceId: string | null; userId: string } | undefined;
  if (!row) return c.json({ error: "附件不存在" }, 404);

  const actorId = getAuthUserId(c);
  if (!actorId) {
    return c.json({ error: "未授权，请先登录", code: "UNAUTHENTICATED" }, 401);
  }

  // 校验权限
  if (row.workspaceId) {
    const role = getUserWorkspaceRole(row.workspaceId, actorId);
    if (!role) {
      return c.json({ error: "无权访问该附件", code: "FORBIDDEN" }, 403);
    }
  } else {
    // 个人空间：只能创建者本人查看
    if (row.userId !== actorId) {
      return c.json({ error: "无权访问该附件", code: "FORBIDDEN" }, 403);
    }
  }

  const absPath = path.join(getAttachmentsDir(), row.path);
  if (!fs.existsSync(absPath)) {
    return c.json({ error: "附件文件丢失" }, 404);
  }

  const buffer = fs.readFileSync(absPath);
  return new Response(buffer, {
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Cache-Control": "private, no-cache",
      // Phase 5: 为附件下载添加严格 CSP
      "Content-Security-Policy": "default-src 'none'; sandbox;",
    },
  });
}

const app = new Hono();

/**
 * 上传任务附件。
 *
 * 请求：
 *   POST /api/task-attachments
 *   query:    workspaceId?  ('personal' / <uuid>；仅"未指定 taskId 的孤儿态"生效)
 *   multipart/form-data：
 *     file:   File
 *     taskId: string  // 可选——新任务尚未创建时不传，前端创建 task 后再 PATCH 关联
 *
 * 响应：
 *   { id, url, mimeType, size, filename }
 *   url = `/api/task-attachments/<id>`，前端写到 markdown 图片标记里。
 *
 * 权限（Y3 工作区语义）：
 *   - 若带 taskId：必须对该 task 有 canManageResource 权限，workspaceId 从 task 继承
 *     （query 里的 workspaceId 被忽略以确保一致性）；
 *   - 若不带 taskId（孤儿态）：workspaceId 来自 query（省略即个人空间）；
 *     工作区必须当前用户为成员，否则 403；
 *   - arbitrarily 指定 query workspaceId + taskId 且两者冲突时，以 task 为准。
 */
app.post("/", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const file = body.file;
  const taskId = typeof body.taskId === "string" && body.taskId ? body.taskId : null;

  if (!(file instanceof File)) {
    return c.json({ error: "file 字段缺失或非文件" }, 400);
  }

  // 解析 workspaceId：有 taskId 从 task 行继承；否则走 query。
  let effectiveWorkspaceId: string | null = null;
  if (taskId) {
    let task = db
      .prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?")
      .get(taskId) as { userId: string; workspaceId: string | null } | undefined;
    if (!task) {
      const pTask = db
        .prepare("SELECT creatorId, projectId FROM project_tasks WHERE id = ?")
        .get(taskId) as { creatorId: string; projectId: string } | undefined;
      if (!pTask) return c.json({ error: "任务不存在" }, 404);
      const project = db
        .prepare("SELECT ownerId, workspaceId FROM projects WHERE id = ?")
        .get(pTask.projectId) as { ownerId: string; workspaceId: string | null } | undefined;
      if (!project) return c.json({ error: "所属项目不存在" }, 404);
      if (!canManageResource(pTask.creatorId || project.ownerId, project.workspaceId, userId)) {
        return c.json({ error: "无权向该任务上传附件", code: "FORBIDDEN" }, 403);
      }
      effectiveWorkspaceId = project.workspaceId;
    } else {
      if (!canManageResource(task.userId, task.workspaceId, userId)) {
        return c.json({ error: "无权向该任务上传附件", code: "FORBIDDEN" }, 403);
      }
      effectiveWorkspaceId = task.workspaceId;
    }
  } else {
    const raw = c.req.query("workspaceId");
    if (raw && raw !== "personal") {
      const role = getUserWorkspaceRole(raw, userId);
      if (!role) return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
      effectiveWorkspaceId = raw;
    }
  }

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return c.json(
      { error: `文件过大（最大 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB）` },
      413,
    );
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return c.json({ error: `不支持的 MIME 类型: ${mime}` }, 415);
  }

  ensureAttachmentsDir();
  const id = uuid();
  const ext = MIME_TO_EXT_EXTENDED[mime] || "bin";
  const filename = `${id}.${ext}`;
  const savePath = path.join(getAttachmentsDir(), filename);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(savePath, buffer);
  } catch (err: any) {
    return c.json({ error: `写入文件失败: ${err?.message || err}` }, 500);
  }

  try {
    db.prepare(
      `INSERT INTO task_attachments (id, taskId, userId, workspaceId, filename, mimeType, size, path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, taskId, userId, effectiveWorkspaceId, file.name || filename, mime, file.size, filename);
  } catch (err: any) {
    try { fs.unlinkSync(savePath); } catch { /* ignore */ }
    return c.json({ error: `写入数据库失败: ${err?.message || err}` }, 500);
  }

  return c.json(
    {
      id,
      url: `/api/task-attachments/${id}`,
      mimeType: mime,
      size: file.size,
      filename: file.name || filename,
    },
    201,
  );
});

/**
 * 把孤儿附件关联到具体 task（前端在 createTask 之后调用）。
 * Y3:
 *   - 附件原始 workspaceId（上传时记录）与目标 task 的 workspaceId 不一致时，
 *     同步对齐到 task，保证"附件与任务同域"；
 *   - 权限：对目标 task 有 canManageResource；对附件仍要求上传者本人
 *     （避免跨用户盗绑：A 上传的悬空图不该被 B 绑到 B 自己的 task）。
 */
app.patch("/:id/bind", async (c) => {
  const userId = c.req.header("X-User-Id") || "";
  const db = getDb();
  const id = c.req.param("id");

  let body: any;
  try { body = await c.req.json(); } catch { body = {}; }
  const taskId = typeof body.taskId === "string" ? body.taskId : "";
  if (!taskId) return c.json({ error: "taskId 必传" }, 400);

  const att = db
    .prepare("SELECT id, userId FROM task_attachments WHERE id = ?")
    .get(id) as { id: string; userId: string } | undefined;
  if (!att) return c.json({ error: "附件不存在" }, 404);
  if (att.userId !== userId) {
    return c.json({ error: "无权绑定该附件", code: "FORBIDDEN" }, 403);
  }

  let taskUserId: string;
  let taskWorkspaceId: string | null = null;
  
  const task = db
    .prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?")
    .get(taskId) as { userId: string; workspaceId: string | null } | undefined;
  if (!task) {
    const pTask = db
      .prepare("SELECT creatorId, projectId FROM project_tasks WHERE id = ?")
      .get(taskId) as { creatorId: string; projectId: string } | undefined;
    if (!pTask) return c.json({ error: "任务不存在" }, 404);
    const project = db
      .prepare("SELECT ownerId, workspaceId FROM projects WHERE id = ?")
      .get(pTask.projectId) as { ownerId: string; workspaceId: string | null } | undefined;
    if (!project) return c.json({ error: "所属项目不存在" }, 404);
    taskUserId = pTask.creatorId || project.ownerId;
    taskWorkspaceId = project.workspaceId;
  } else {
    taskUserId = task.userId;
    taskWorkspaceId = task.workspaceId;
  }
  
  if (!canManageResource(taskUserId, taskWorkspaceId, userId)) {
    return c.json({ error: "无权操作该任务", code: "FORBIDDEN" }, 403);
  }

  db.prepare("UPDATE task_attachments SET taskId = ?, workspaceId = ? WHERE id = ?")
    .run(taskId, taskWorkspaceId, id);
  return c.json({ success: true });
});

/**
 * 删除附件。一般在用户主动从 task.title 里去掉图片时由前端调用；
 * task 被删除时数据库 ON DELETE CASCADE 自动清行，物理文件靠定期清理脚本扫描。
 *
 * Y3 权限：
 *   - 已绑定 task 的附件：按 canManageResource —— 创建者本人 + admin/owner 可删；
 *   - 悬空附件（无 taskId）：仍仅限上传者本人可删（未归属任何工作区语义层）。
 */
app.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id") || "";
  const id = c.req.param("id");

  const row = db
    .prepare("SELECT id, userId, taskId, workspaceId, path FROM task_attachments WHERE id = ?")
    .get(id) as
    | { id: string; userId: string; taskId: string | null; workspaceId: string | null; path: string }
    | undefined;
  if (!row) return c.json({ error: "附件不存在" }, 404);

  if (row.taskId) {
    let taskUserId: string | null = null;
    let taskWorkspaceId: string | null = null;
    
    const task = db
      .prepare("SELECT userId, workspaceId FROM tasks WHERE id = ?")
      .get(row.taskId) as { userId: string; workspaceId: string | null } | undefined;
    if (task) {
      taskUserId = task.userId;
      taskWorkspaceId = task.workspaceId;
    } else {
      const pTask = db
        .prepare("SELECT creatorId, projectId FROM project_tasks WHERE id = ?")
        .get(row.taskId) as { creatorId: string; projectId: string } | undefined;
      if (pTask) {
        const project = db
          .prepare("SELECT ownerId, workspaceId FROM projects WHERE id = ?")
          .get(pTask.projectId) as { ownerId: string; workspaceId: string | null } | undefined;
        if (project) {
          taskUserId = pTask.creatorId || project.ownerId;
          taskWorkspaceId = project.workspaceId;
        }
      }
    }
    
    const ok = taskUserId
      ? canManageResource(taskUserId, taskWorkspaceId, userId) || row.userId === userId
      : row.userId === userId;
    if (!ok) return c.json({ error: "无权删除该附件", code: "FORBIDDEN" }, 403);
  } else {
    if (row.userId !== userId) {
      return c.json({ error: "无权删除该附件", code: "FORBIDDEN" }, 403);
    }
  }

  const absPath = path.join(getAttachmentsDir(), row.path);
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    /* 文件删不掉不阻塞，DB 记录仍然要清掉 */
  }
  db.prepare("DELETE FROM task_attachments WHERE id = ?").run(id);

  return c.json({ success: true });
});

export default app;
