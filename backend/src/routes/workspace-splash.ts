/**
 * 工作区 APP 启动闪屏（云端图 + 成员鉴权下载）
 * ---------------------------------------------------------------------------
 * 端点（挂在 /api/workspaces）：
 *   GET    /:id/splash        - 元数据（任意成员）
 *   GET    /:id/splash/image  - 图片字节（任意成员 + JWT，禁止匿名直链）
 *   POST   /:id/splash        - 上传/替换图 + 时长/过期（owner/admin）
 *   PATCH  /:id/splash        - 仅改时长/过期（owner/admin）
 *   DELETE /:id/splash        - 清除（owner/admin）
 *
 * 安全：
 *   - 下载必须登录且为工作区成员；不做「不可枚举 id 免鉴权」。
 *   - Cache-Control: private, no-store，避免中间缓存泄漏。
 *   - 文件名仅服务端生成，落盘 data/splash/。
 */
import { Hono } from "hono";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import { getDb } from "../db/schema";
import {
  getUserWorkspaceRole,
  isSystemAdmin,
  requireWorkspaceRole,
} from "../middleware/acl";

const app = new Hono();

const SPLASH_DIR = path.join(
  process.env.ELECTRON_USER_DATA || path.join(process.cwd(), "data"),
  "splash",
);

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Map<string, string>([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

type SplashRow = {
  workspaceId: string;
  imageId: string;
  fileName: string;
  mimeType: string;
  size: number;
  displayDurationSec: number;
  expiresAt: string | null;
  uploadedBy: string;
  updatedAt: string;
};

function ensureSplashDir(): string {
  if (!fs.existsSync(SPLASH_DIR)) {
    fs.mkdirSync(SPLASH_DIR, { recursive: true });
  }
  return SPLASH_DIR;
}

function getSplashRow(workspaceId: string): SplashRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT workspaceId, imageId, fileName, mimeType, size,
              displayDurationSec, expiresAt, uploadedBy, updatedAt
       FROM workspace_splash WHERE workspaceId = ?`,
    )
    .get(workspaceId) as SplashRow | undefined;
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return Date.now() >= t;
}

function parseDuration(raw: unknown, fallback = 5): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1 || n > 30) return null;
  return Math.floor(n);
}

/** 接受 ISO 字符串；空串/null → null（不过期）；非法 → throw */
function parseExpiresAt(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) {
    throw new Error("过期时间格式无效");
  }
  return new Date(t).toISOString();
}

function requireMember(workspaceId: string, userId: string): boolean {
  if (!userId) return false;
  if (isSystemAdmin(userId)) return true;
  return !!getUserWorkspaceRole(workspaceId, userId);
}

function metaPayload(row: SplashRow) {
  const expired = isExpired(row.expiresAt);
  return {
    configured: true as const,
    imageId: row.imageId,
    downloadPath: `/api/workspaces/${row.workspaceId}/splash/image`,
    displayDurationSec: row.displayDurationSec,
    expiresAt: row.expiresAt,
    expired,
    updatedAt: row.updatedAt,
    mimeType: row.mimeType,
    size: row.size,
    uploadedBy: row.uploadedBy,
  };
}

function unlinkSafe(fileName: string | undefined | null) {
  if (!fileName) return;
  const abs = path.join(SPLASH_DIR, fileName);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch {
    /* ignore */
  }
}

// ---------- GET meta：任意成员 ----------
app.get("/:id/splash", requireWorkspaceRole("viewer"), (c) => {
  const workspaceId = c.req.param("id");
  const row = getSplashRow(workspaceId);
  if (!row) return c.json({ configured: false as const });
  return c.json(metaPayload(row));
});

// ---------- GET image：任意成员 + JWT（中间件已保护） ----------
app.get("/:id/splash/image", requireWorkspaceRole("viewer"), (c) => {
  const workspaceId = c.req.param("id");
  const row = getSplashRow(workspaceId);
  if (!row) return c.json({ error: "未配置闪屏" }, 404);

  // 过期后仍允许成员下载元数据路径上的文件意义不大；返回 410 促使客户端清缓存
  if (isExpired(row.expiresAt)) {
    return c.json({ error: "闪屏已过期", code: "EXPIRED" }, 410);
  }

  ensureSplashDir();
  const absPath = path.join(SPLASH_DIR, row.fileName);
  if (!fs.existsSync(absPath)) {
    return c.json({ error: "闪屏文件丢失" }, 404);
  }

  const buffer = fs.readFileSync(absPath);
  // Buffer → Uint8Array 视图，避免 TS / Response 对 ArrayBufferLike 不兼容
  const body = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return c.body(body, 200, {
    "Content-Type": row.mimeType || "application/octet-stream",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox;",
    "X-Splash-Image-Id": row.imageId,
  });
});

// ---------- POST：上传/替换（owner/admin） ----------
app.post("/:id/splash", requireWorkspaceRole("admin"), async (c) => {
  const workspaceId = c.req.param("id");
  const userId = c.req.header("X-User-Id") || "";
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  ensureSplashDir();

  let body: Record<string, unknown>;
  try {
    body = (await c.req.parseBody({ all: true })) as Record<string, unknown>;
  } catch {
    return c.json({ error: "无法解析上传内容" }, 400);
  }

  const file = body["file"];
  if (!(file instanceof File)) {
    return c.json({ error: "请选择图片文件" }, 400);
  }

  const mime = (file.type || "").toLowerCase();
  const ext = ALLOWED_MIME.get(mime);
  if (!ext) {
    return c.json({ error: "仅支持 JPG / PNG / WebP" }, 415);
  }
  if (file.size > MAX_BYTES) {
    return c.json({ error: "图片不能超过 5MB" }, 400);
  }

  const duration = parseDuration(body["displayDurationSec"], 5);
  if (duration === null) {
    return c.json({ error: "展示时长须为 1–30 秒" }, 400);
  }

  let expiresAt: string | null;
  try {
    expiresAt = parseExpiresAt(body["expiresAt"]);
  } catch (e: any) {
    return c.json({ error: e?.message || "过期时间无效" }, 400);
  }

  const imageId = uuid();
  const fileName = `${workspaceId}-${imageId}${ext}`;
  const absPath = path.join(SPLASH_DIR, fileName);

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(absPath, buf);
  } catch (e) {
    console.error("[workspace-splash] write failed", e);
    return c.json({ error: "保存图片失败" }, 500);
  }

  const db = getDb();
  const existing = getSplashRow(workspaceId);
  if (existing) {
    unlinkSafe(existing.fileName);
  }

  db.prepare(
    `INSERT INTO workspace_splash
       (workspaceId, imageId, fileName, mimeType, size, displayDurationSec, expiresAt, uploadedBy, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(workspaceId) DO UPDATE SET
       imageId = excluded.imageId,
       fileName = excluded.fileName,
       mimeType = excluded.mimeType,
       size = excluded.size,
       displayDurationSec = excluded.displayDurationSec,
       expiresAt = excluded.expiresAt,
       uploadedBy = excluded.uploadedBy,
       updatedAt = datetime('now')`,
  ).run(
    workspaceId,
    imageId,
    fileName,
    mime === "image/jpg" ? "image/jpeg" : mime,
    file.size,
    duration,
    expiresAt,
    userId,
  );

  const row = getSplashRow(workspaceId)!;
  return c.json(metaPayload(row));
});

// ---------- PATCH：仅 meta（owner/admin） ----------
app.patch("/:id/splash", requireWorkspaceRole("admin"), async (c) => {
  const workspaceId = c.req.param("id");
  const row = getSplashRow(workspaceId);
  if (!row) return c.json({ error: "未配置闪屏" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  let duration = row.displayDurationSec;
  if (body.displayDurationSec !== undefined) {
    const d = parseDuration(body.displayDurationSec, row.displayDurationSec);
    if (d === null) return c.json({ error: "展示时长须为 1–30 秒" }, 400);
    duration = d;
  }

  let expiresAt = row.expiresAt;
  if ("expiresAt" in body) {
    try {
      expiresAt = parseExpiresAt(body.expiresAt);
    } catch (e: any) {
      return c.json({ error: e?.message || "过期时间无效" }, 400);
    }
  }

  const db = getDb();
  db.prepare(
    `UPDATE workspace_splash
     SET displayDurationSec = ?, expiresAt = ?, updatedAt = datetime('now')
     WHERE workspaceId = ?`,
  ).run(duration, expiresAt, workspaceId);

  const updated = getSplashRow(workspaceId)!;
  return c.json(metaPayload(updated));
});

// ---------- DELETE（owner/admin） ----------
app.delete("/:id/splash", requireWorkspaceRole("admin"), (c) => {
  const workspaceId = c.req.param("id");
  const row = getSplashRow(workspaceId);
  if (!row) return c.json({ success: true, configured: false });

  unlinkSafe(row.fileName);
  getDb().prepare("DELETE FROM workspace_splash WHERE workspaceId = ?").run(workspaceId);
  return c.json({ success: true, configured: false });
});

export default app;

/** 测试/运维用：导出目录路径 */
export function getSplashDir(): string {
  return SPLASH_DIR;
}

/** 测试用：成员校验（不经中间件时） */
export function assertSplashMember(workspaceId: string, userId: string): boolean {
  return requireMember(workspaceId, userId);
}
