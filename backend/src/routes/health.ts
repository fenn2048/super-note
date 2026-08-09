/**
 * 健康管理档案 API — /api/health
 * 家庭工作区内全员可见/可写；删除：创建者或 workspace admin/owner
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { v4 as uuid } from "uuid";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "../db/schema.js";
import { getUserWorkspaceRole, hasRole, isSystemAdmin } from "../middleware/acl.js";
import { getAuthUserId } from "../lib/auth-security.js";
import { ensureAttachmentsDir, getAttachmentsDir, MIME_TO_EXT } from "./attachments.js";
import * as membersSvc from "../services/health/members.js";
import * as booksSvc from "../services/health/books.js";
import * as recordsSvc from "../services/health/records.js";
import {
  computeHealthAnalytics,
  buildHealthAnalyticsMarkdown,
  resolveHealthPeriod,
} from "../services/health/analytics.js";
import {
  loadAiConfig,
  persistOcrResult,
  runHealthOcr,
  runHealthOcrMulti,
  runMedicineOcr,
  runMedicineOcrMulti,
  setOcrProcessing,
} from "../services/health/ocr.js";
import * as medicinesSvc from "../services/health/medicines.js";
import {
  ATTACHMENT_KINDS,
  type HealthAttachmentRow,
  type HealthOcrStructured,
} from "../services/health/types.js";

const health = new Hono();

const MAX_ATTACHMENT_SIZE = 50 * 1024 * 1024;

const ALLOWED_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
]);

function uid(c: Context): string {
  return c.req.header("X-User-Id") || "";
}

function requireWsMember(workspaceId: string, userId: string): { ok: true } | { error: string; status: 403 | 400 } {
  if (!workspaceId) return { error: "workspaceId 必填", status: 400 };
  if (isSystemAdmin(userId)) return { ok: true };
  const role = getUserWorkspaceRole(workspaceId, userId);
  if (!role) return { error: "您不是该工作区成员", status: 403 };
  return { ok: true };
}

function canDelete(createdBy: string, workspaceId: string, userId: string): boolean {
  if (createdBy === userId) return true;
  if (isSystemAdmin(userId)) return true;
  const role = getUserWorkspaceRole(workspaceId, userId);
  return hasRole(role, "admin");
}

// ── Members ──────────────────────────────────────────────────────────────

health.get("/members", (c) => {
  const userId = uid(c);
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const includeArchived = c.req.query("includeArchived") === "1";
  const list = membersSvc.listMembers(getDb(), workspaceId, { includeArchived });
  return c.json(list);
});

health.post("/members", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  try {
    const result = membersSvc.createMember(getDb(), {
      workspaceId,
      displayName: String(body.displayName || ""),
      relationship: body.relationship ?? null,
      birthDate: body.birthDate ?? null,
      gender: body.gender ?? null,
      bloodType: body.bloodType ?? null,
      allergies: body.allergies ?? null,
      chronicNotes: body.chronicNotes ?? null,
      linkedUserId: body.linkedUserId ?? null,
      createdBy: userId,
      withDefaultBook: body.withDefaultBook !== false,
    });
    return c.json(result, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

health.patch("/members/:id", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const id = c.req.param("id");
  const member = membersSvc.getMember(db, id);
  if (!member) return c.json({ error: "成员不存在" }, 404);
  const gate = requireWsMember(member.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json().catch(() => ({}));
  try {
    const updated = membersSvc.updateMember(db, id, body);
    return c.json(updated);
  } catch (e: any) {
    return c.json({ error: e?.message || "更新失败" }, 400);
  }
});

health.post("/members/:id/archive", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const id = c.req.param("id");
  const member = membersSvc.getMember(db, id);
  if (!member) return c.json({ error: "成员不存在" }, 404);
  const gate = requireWsMember(member.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json().catch(() => ({}));
  const archived = body.archived !== false;
  return c.json(membersSvc.archiveMember(db, id, archived));
});

// ── Books ────────────────────────────────────────────────────────────────

health.get("/books", (c) => {
  const userId = uid(c);
  const db = getDb();
  const memberId = (c.req.query("memberId") || "").trim();
  if (!memberId) return c.json({ error: "memberId 必填" }, 400);
  const member = membersSvc.getMember(db, memberId);
  if (!member) return c.json({ error: "成员不存在" }, 404);
  const gate = requireWsMember(member.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const includeArchived = c.req.query("includeArchived") === "1";
  return c.json(booksSvc.listBooks(db, memberId, { includeArchived }));
});

health.post("/books", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const memberId = String(body.memberId || "").trim();
  const db = getDb();
  const member = membersSvc.getMember(db, memberId);
  if (!member) return c.json({ error: "成员不存在" }, 404);
  const gate = requireWsMember(member.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  try {
    const book = booksSvc.createBook(db, {
      memberId,
      title: String(body.title || ""),
      description: body.description ?? null,
      color: body.color ?? null,
      createdBy: userId,
    });
    return c.json(book, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

health.patch("/books/:id", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const id = c.req.param("id");
  const book = booksSvc.getBook(db, id);
  if (!book) return c.json({ error: "病历本不存在" }, 404);
  const gate = requireWsMember(book.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(booksSvc.updateBook(db, id, body));
  } catch (e: any) {
    return c.json({ error: e?.message || "更新失败" }, 400);
  }
});

// ── Records ──────────────────────────────────────────────────────────────

health.get("/records", (c) => {
  const userId = uid(c);
  const db = getDb();
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  const memberId = (c.req.query("memberId") || "").trim() || undefined;
  const bookId = (c.req.query("bookId") || "").trim() || undefined;
  const from = (c.req.query("from") || "").trim() || undefined;
  const to = (c.req.query("to") || "").trim() || undefined;
  const status = (c.req.query("status") || "").trim() || undefined;
  const medicineSystem = (c.req.query("medicineSystem") || "").trim() || undefined;

  let ws = workspaceId;
  if (!ws && bookId) {
    const book = booksSvc.getBook(db, bookId);
    if (!book) return c.json({ error: "病历本不存在" }, 404);
    ws = book.workspaceId;
  }
  if (!ws && memberId) {
    const member = membersSvc.getMember(db, memberId);
    if (!member) return c.json({ error: "成员不存在" }, 404);
    ws = member.workspaceId;
  }
  if (!ws) return c.json({ error: "workspaceId / bookId / memberId 至少其一" }, 400);

  const gate = requireWsMember(ws, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const rows = recordsSvc.listRecords(db, {
    workspaceId: ws,
    memberId,
    bookId,
    from,
    to,
    status,
    medicineSystem,
  });
  return c.json(rows.map(recordsSvc.toTimelineItem));
});

health.get("/records/:id", (c) => {
  const userId = uid(c);
  const db = getDb();
  const detail = recordsSvc.getRecordDetail(db, c.req.param("id"));
  if (!detail) return c.json({ error: "病历不存在" }, 404);
  const gate = requireWsMember(detail.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  return c.json(detail);
});

health.post("/records", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const db = getDb();
  const book = booksSvc.getBook(db, String(body.bookId || ""));
  if (!book) return c.json({ error: "病历本不存在" }, 404);
  const gate = requireWsMember(book.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  try {
    const detail = recordsSvc.createRecord(db, {
      bookId: book.id,
      title: String(body.title || ""),
      recordType: body.recordType,
      status: body.status,
      medicineSystem: body.medicineSystem,
      occurredAt: String(body.occurredAt || ""),
      endedAt: body.endedAt ?? null,
      hospital: body.hospital ?? null,
      department: body.department ?? null,
      doctor: body.doctor ?? null,
      diagnosis: body.diagnosis ?? null,
      diagnosisWestern: body.diagnosisWestern ?? null,
      diagnosisTcm: body.diagnosisTcm ?? null,
      prescription: body.prescription ?? null,
      advice: body.advice ?? null,
      notes: body.notes ?? null,
      tags: body.tags ?? null,
      costMinor: body.costMinor ?? null,
      careExtra: body.careExtra ?? null,
      careExtraJson: body.careExtraJson ?? null,
      stages: body.stages,
      createdBy: userId,
    });

    // 绑定预上传附件
    if (Array.isArray(body.attachmentIds) && body.attachmentIds.length && detail) {
      const upd = db.prepare(
        `UPDATE health_attachments SET recordId = ?, memberId = ?, bookId = ?
         WHERE id = ? AND workspaceId = ? AND (recordId IS NULL OR recordId = '')`,
      );
      for (const aid of body.attachmentIds) {
        upd.run(detail.id, detail.memberId, detail.bookId, String(aid), book.workspaceId);
      }
      return c.json(recordsSvc.getRecordDetail(db, detail.id), 201);
    }
    return c.json(detail, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

health.patch("/records/:id", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const existing = recordsSvc.getRecord(db, c.req.param("id"));
  if (!existing) return c.json({ error: "病历不存在" }, 404);
  const gate = requireWsMember(existing.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json().catch(() => ({}));
  try {
    const detail = recordsSvc.updateRecord(db, existing.id, {
      ...body,
      updatedBy: userId,
    });
    return c.json(detail);
  } catch (e: any) {
    return c.json({ error: e?.message || "更新失败" }, 400);
  }
});

health.delete("/records/:id", (c) => {
  const userId = uid(c);
  const db = getDb();
  const existing = recordsSvc.getRecord(db, c.req.param("id"));
  if (!existing) return c.json({ error: "病历不存在" }, 404);
  const gate = requireWsMember(existing.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!canDelete(existing.createdBy, existing.workspaceId, userId)) {
    return c.json({ error: "仅创建者或管理员可删除" }, 403);
  }
  return c.json(recordsSvc.softDeleteRecord(db, existing.id, userId));
});

health.put("/records/:id/stages", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const existing = recordsSvc.getRecord(db, c.req.param("id"));
  if (!existing) return c.json({ error: "病历不存在" }, 404);
  const gate = requireWsMember(existing.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const body = await c.req.json().catch(() => ({}));
  const stages = Array.isArray(body.stages) ? body.stages : Array.isArray(body) ? body : [];
  const list = recordsSvc.replaceStages(db, existing.id, stages);
  // touch updatedAt
  db.prepare(
    `UPDATE health_records SET updatedBy = ?, updatedAt = datetime('now') WHERE id = ?`,
  ).run(userId, existing.id);
  return c.json({ stages: list });
});

// ── Attachments ──────────────────────────────────────────────────────────

function getAttachment(db: ReturnType<typeof getDb>, id: string): HealthAttachmentRow | undefined {
  return db.prepare(`SELECT * FROM health_attachments WHERE id = ?`).get(id) as
    | HealthAttachmentRow
    | undefined;
}

function attachmentPublic(a: HealthAttachmentRow) {
  let ocrStructured: HealthOcrStructured | null = null;
  if (a.ocrStructuredJson) {
    try {
      ocrStructured = JSON.parse(a.ocrStructuredJson);
    } catch {
      ocrStructured = null;
    }
  }
  return {
    ...a,
    url: `/api/health/attachments/${a.id}`,
    ocrStructured,
  };
}

health.post("/attachments", async (c) => {
  const userId = uid(c);
  const db = getDb();

  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file 字段缺失" }, 400);

  const workspaceId = String(body.workspaceId || c.req.query("workspaceId") || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const kind = String(body.kind || "other");
  if (!ATTACHMENT_KINDS.includes(kind as any)) {
    return c.json({ error: `无效 kind: ${kind}` }, 400);
  }

  let recordId = typeof body.recordId === "string" && body.recordId ? body.recordId : null;
  let memberId = typeof body.memberId === "string" && body.memberId ? body.memberId : null;
  let bookId = typeof body.bookId === "string" && body.bookId ? body.bookId : null;

  if (recordId) {
    const rec = recordsSvc.getRecord(db, recordId);
    if (!rec || rec.workspaceId !== workspaceId) {
      return c.json({ error: "病历不存在或不属于该工作区" }, 400);
    }
    memberId = rec.memberId;
    bookId = rec.bookId;
  }

  if (file.size > MAX_ATTACHMENT_SIZE) {
    return c.json({ error: `文件过大（最大 ${MAX_ATTACHMENT_SIZE / 1024 / 1024}MB）` }, 413);
  }

  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return c.json({ error: `不支持的 MIME 类型: ${mime}` }, 415);
  }

  ensureAttachmentsDir();
  const id = uuid();
  const ext = MIME_TO_EXT[mime] || (mime === "application/pdf" ? "pdf" : "bin");
  const diskName = `${id}.${ext}`;
  const savePath = path.join(getAttachmentsDir(), diskName);
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");

  try {
    fs.writeFileSync(savePath, buffer);
  } catch (err: any) {
    return c.json({ error: `写入失败: ${err?.message || err}` }, 500);
  }

  try {
    db.prepare(
      `INSERT INTO health_attachments (
        id, workspaceId, recordId, memberId, bookId, userId, kind,
        filename, mimeType, size, path, hash, ocrStatus
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none')`,
    ).run(
      id,
      workspaceId,
      recordId,
      memberId,
      bookId,
      userId,
      kind,
      file.name || diskName,
      mime,
      file.size,
      diskName,
      hash,
    );
  } catch (err: any) {
    try {
      fs.unlinkSync(savePath);
    } catch {
      /* ignore */
    }
    return c.json({ error: `写入数据库失败: ${err?.message || err}` }, 500);
  }

  const row = getAttachment(db, id)!;
  return c.json(attachmentPublic(row), 201);
});

/** 下载附件（需登录 + 工作区成员；可挂在 JWT 中间件之前） */
export function handleDownloadHealthAttachment(c: Context): Response {
  const userId = getAuthUserId(c) || uid(c);
  if (!userId) {
    return c.json({ error: "未授权", code: "UNAUTHENTICATED" }, 401) as any;
  }
  const db = getDb();
  const row = getAttachment(db, c.req.param("id"));
  if (!row) return c.json({ error: "附件不存在" }, 404) as any;
  const gate = requireWsMember(row.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status) as any;

  const absPath = path.join(getAttachmentsDir(), row.path);
  if (!fs.existsSync(absPath)) return c.json({ error: "附件文件丢失" }, 404) as any;

  const buffer = fs.readFileSync(absPath);
  return new Response(buffer, {
    headers: {
      "Content-Type": row.mimeType || "application/octet-stream",
      "Cache-Control": "private, no-cache",
      "Content-Security-Policy": "default-src 'none'; sandbox;",
    },
  });
}

health.get("/attachments/:id", (c) => handleDownloadHealthAttachment(c));

health.get("/attachments/:id/meta", (c) => {
  const userId = uid(c);
  const db = getDb();
  const row = getAttachment(db, c.req.param("id"));
  if (!row) return c.json({ error: "附件不存在" }, 404);
  const gate = requireWsMember(row.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  return c.json(attachmentPublic(row));
});

health.delete("/attachments/:id", (c) => {
  const userId = uid(c);
  const db = getDb();
  const row = getAttachment(db, c.req.param("id"));
  if (!row) return c.json({ error: "附件不存在" }, 404);
  const gate = requireWsMember(row.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!canDelete(row.userId, row.workspaceId, userId)) {
    return c.json({ error: "仅上传者或管理员可删除" }, 403);
  }

  const others = db
    .prepare(`SELECT COUNT(*) AS c FROM health_attachments WHERE path = ? AND id <> ?`)
    .get(row.path, row.id) as { c: number };
  db.prepare(`DELETE FROM health_attachments WHERE id = ?`).run(row.id);
  if (!others?.c) {
    const abs = path.join(getAttachmentsDir(), row.path);
    try {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
  return c.json({ ok: true });
});

health.post("/attachments/:id/ocr", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const row = getAttachment(db, c.req.param("id"));
  if (!row) return c.json({ error: "附件不存在" }, 404);
  const gate = requireWsMember(row.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  if (!loadAiConfig(db)) {
    return c.json(
      {
        error: "未配置 AI",
        message: "请在设置中配置支持多模态（Vision）的 AI 模型后再使用 OCR。",
      },
      400,
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const documentHint =
    typeof body.documentHint === "string" ? body.documentHint : row.kind || "auto";

  setOcrProcessing(db, row.id);
  try {
    const result = await runHealthOcr(db, row, documentHint);
    persistOcrResult(db, row.id, result);
    const updated = getAttachment(db, row.id)!;
    return c.json({
      attachmentId: row.id,
      ocrStatus: "done",
      rawText: result.rawText,
      structured: result.structured,
      model: result.model,
      attachment: attachmentPublic(updated),
    });
  } catch (e: any) {
    const msg = e?.message || "OCR 失败";
    console.error("[health.ocr]", row.id, msg);
    persistOcrResult(db, row.id, null, msg);
    // 配置/格式问题用 400，便于前端直接展示；其它仍 500
    const clientHint =
      /未配置|不支持|过大|丢失|未能识别|无可提取|请换|请将|请在设置/.test(msg);
    return c.json({ error: msg, ocrStatus: "failed" }, clientHint ? 400 : 502);
  }
});

/**
 * 病历多图 OCR（检查报告多页等）
 * body: { attachmentIds: string[], documentHint?: string }
 */
health.post("/ocr/batch", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String).filter(Boolean).slice(0, 6)
    : [];
  if (!ids.length) return c.json({ error: "attachmentIds 必填" }, 400);
  const documentHint =
    typeof body.documentHint === "string" ? body.documentHint : "auto";

  const rows: HealthAttachmentRow[] = [];
  let workspaceId = "";
  for (const id of ids) {
    const row = getAttachment(db, id);
    if (!row) return c.json({ error: `附件不存在: ${id}` }, 404);
    if (!workspaceId) workspaceId = row.workspaceId;
    if (row.workspaceId !== workspaceId) {
      return c.json({ error: "附件须属于同一工作区" }, 400);
    }
    rows.push(row);
  }
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!loadAiConfig(db)) {
    return c.json(
      { error: "未配置 AI", message: "请在设置中配置支持多模态的 AI 模型。" },
      400,
    );
  }

  for (const r of rows) setOcrProcessing(db, r.id);
  try {
    const result = await runHealthOcrMulti(db, rows, documentHint);
    for (let i = 0; i < rows.length; i++) {
      persistOcrResult(db, rows[i].id, {
        rawText: i === 0 ? result.rawText : `(merged into ${rows[0].id})`,
        structured: result.structured,
        model: result.model,
      });
    }
    return c.json({
      attachmentId: rows[0].id,
      attachmentIds: result.attachmentIds,
      ocrStatus: "done",
      rawText: result.rawText,
      structured: result.structured,
      model: result.model,
      imageCount: rows.length,
    });
  } catch (e: any) {
    const msg = e?.message || "OCR 失败";
    for (const r of rows) persistOcrResult(db, r.id, null, msg);
    return c.json({ error: msg, ocrStatus: "failed" }, 502);
  }
});

/**
 * 将 OCR 结构化结果应用到新建或更新病历
 * body: { bookId, structured, attachmentIds?, recordId?, merge? }
 */
health.post("/ocr/apply", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const structured = body.structured as HealthOcrStructured | undefined;
  if (!structured || typeof structured !== "object") {
    return c.json({ error: "structured 必填" }, 400);
  }

  const bookId = String(body.bookId || "").trim();
  const recordId = body.recordId ? String(body.recordId) : null;
  const merge = body.merge !== false;

  if (recordId) {
    const existing = recordsSvc.getRecord(db, recordId);
    if (!existing) return c.json({ error: "病历不存在" }, 404);
    const gate = requireWsMember(existing.workspaceId, userId);
    if ("error" in gate) return c.json({ error: gate.error }, gate.status);

    const patch: any = { updatedBy: userId };
    /** 已有非空字段被占用时，把 OCR 新内容追加到备注，避免「先检查后开方」丢信息 */
    const extras: string[] = [];
    const fill = (key: string, val: any, label?: string) => {
      if (val == null || val === "") return;
      const cur = (existing as any)[key];
      if (merge && cur != null && String(cur).trim() !== "") {
        // 日期/体系等标识字段不进备注
        if (
          label &&
          key !== "occurredAt" &&
          key !== "medicineSystem" &&
          key !== "title"
        ) {
          const v = String(val).trim();
          if (v && !String(cur).includes(v.slice(0, 40))) {
            extras.push(`${label}：${v}`);
          }
        }
        return;
      }
      patch[key] = val;
    };
    const isExamDoc =
      (structured.documentType || "").includes("exam") ||
      !!(structured.examFindings || (structured.labs && structured.labs.length));

    // 非 merge（强制覆盖）时直接写入
    if (!merge) {
      const set = (key: string, val: any) => {
        if (val != null && val !== "") patch[key] = val;
      };
      set("title", structured.title);
      set("occurredAt", structured.occurredAt);
      set("hospital", structured.hospital);
      set("department", structured.department);
      set("doctor", structured.doctor);
      set("medicineSystem", structured.medicineSystem);
      set("diagnosis", structured.diagnosis);
      set("diagnosisWestern", structured.diagnosisWestern);
      set("diagnosisTcm", structured.diagnosisTcm);
      // 检查单不写 prescription
      if (!isExamDoc) set("prescription", structured.prescription);
      set("advice", structured.advice);
      if (structured.costMinor != null) set("costMinor", structured.costMinor);
      if (isExamDoc) patch.recordType = "checkup";
    } else {
      fill("title", structured.title, "标题");
      fill("occurredAt", structured.occurredAt);
      fill("hospital", structured.hospital, "医院");
      fill("department", structured.department, "科室");
      fill("doctor", structured.doctor, "医生");
      fill("medicineSystem", structured.medicineSystem);
      fill("diagnosis", structured.diagnosis, "诊断摘要");
      fill("diagnosisWestern", structured.diagnosisWestern, "西医诊断");
      fill("diagnosisTcm", structured.diagnosisTcm, "中医证候");
      if (!isExamDoc) fill("prescription", structured.prescription, "处方");
      fill("advice", structured.advice, "建议");
      if (structured.costMinor != null) fill("costMinor", structured.costMinor, "费用");
    }
    // 检查结果 → careExtraJson.labs / examFindings
    const examExtra = recordsSvc.mergeExamCareExtra(existing.careExtraJson, structured);
    if (examExtra) patch.careExtra = examExtra;

    if (structured.stages?.length) {
      const stages = recordsSvc.listStages(db, recordId);
      if (!stages.length) patch.stages = structured.stages;
    }
    if (extras.length) {
      const stamp = new Date().toISOString().slice(0, 10);
      const docHint =
        structured.documentType && structured.documentType !== "auto"
          ? structured.documentType
          : "OCR";
      const block =
        `\n\n—— ${stamp} 合并自 ${docHint} ——\n` + extras.join("\n");
      const base =
        patch.notes !== undefined
          ? String(patch.notes || "")
          : String(existing.notes || "");
      patch.notes = (base + block).trim();
    }

    try {
      const detail = recordsSvc.updateRecord(db, recordId, patch);
      if (Array.isArray(body.attachmentIds)) {
        for (const aid of body.attachmentIds) {
          db.prepare(
            `UPDATE health_attachments SET recordId = ?, memberId = ?, bookId = ?
             WHERE id = ? AND workspaceId = ?`,
          ).run(recordId, existing.memberId, existing.bookId, String(aid), existing.workspaceId);
        }
      }
      return c.json(recordsSvc.getRecordDetail(db, detail!.id));
    } catch (e: any) {
      return c.json({ error: e?.message || "应用失败" }, 400);
    }
  }

  // 新建
  const book = booksSvc.getBook(db, bookId);
  if (!book) return c.json({ error: "bookId 必填且病历本须存在" }, 400);
  const gate = requireWsMember(book.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);

  const isExamCreate =
    (structured.documentType || "").includes("exam") ||
    !!(structured.examFindings || (structured.labs && structured.labs.length));

  const title = (
    structured.title ||
    structured.diagnosisTcm ||
    structured.diagnosisWestern ||
    structured.diagnosis ||
    (isExamCreate ? "检查化验" : "OCR 导入病历")
  ).slice(0, 200);
  const occurredAt =
    structured.occurredAt || new Date().toISOString().slice(0, 10);

  const examCare = recordsSvc.mergeExamCareExtra(null, structured);

  try {
    const detail = recordsSvc.createRecord(db, {
      bookId: book.id,
      title,
      recordType: isExamCreate ? "checkup" : "visit",
      status: "ongoing",
      medicineSystem: structured.medicineSystem || "unknown",
      occurredAt,
      hospital: structured.hospital ?? null,
      department: structured.department ?? null,
      doctor: structured.doctor ?? null,
      diagnosis: structured.diagnosis ?? null,
      diagnosisWestern: structured.diagnosisWestern ?? null,
      diagnosisTcm: structured.diagnosisTcm ?? null,
      // 检查单不写处方字段
      prescription: isExamCreate ? null : structured.prescription ?? null,
      advice: structured.advice ?? null,
      costMinor: structured.costMinor ?? null,
      careExtra: examCare,
      stages: structured.stages,
      createdBy: userId,
    });
    if (Array.isArray(body.attachmentIds) && detail) {
      for (const aid of body.attachmentIds) {
        db.prepare(
          `UPDATE health_attachments SET recordId = ?, memberId = ?, bookId = ?
           WHERE id = ? AND workspaceId = ?`,
        ).run(detail.id, detail.memberId, detail.bookId, String(aid), book.workspaceId);
      }
      return c.json(recordsSvc.getRecordDetail(db, detail.id), 201);
    }
    return c.json(detail, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

// ── Analytics ────────────────────────────────────────────────────────────

function parseAnalyticsQuery(c: Context) {
  const userId = uid(c);
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return { error: gate.error, status: gate.status as 403 | 400 };
  const memberId = (c.req.query("memberId") || "").trim() || null;
  const range = resolveHealthPeriod({
    period: c.req.query("period") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
  });
  return {
    q: {
      workspaceId,
      memberId,
      ...range,
    },
  };
}

health.get("/analytics", (c) => {
  const parsed = parseAnalyticsQuery(c);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }
  try {
    return c.json(computeHealthAnalytics(getDb(), parsed.q!));
  } catch (e: any) {
    return c.json({ error: e?.message || "统计失败" }, 500);
  }
});

health.get("/analytics/report", (c) => {
  const parsed = parseAnalyticsQuery(c);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }
  try {
    const data = computeHealthAnalytics(getDb(), parsed.q!);
    const markdown = buildHealthAnalyticsMarkdown(data);
    return c.json({
      markdown,
      filename: `health-review-${data.range.from}_${data.range.to}.md`,
      range: data.range,
    });
  } catch (e: any) {
    return c.json({ error: e?.message || "报告失败" }, 500);
  }
});

health.post("/analytics/advice", async (c) => {
  const parsed = parseAnalyticsQuery(c);
  if ("error" in parsed && parsed.error) {
    return c.json({ error: parsed.error }, parsed.status || 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const db = getDb();
  let data: ReturnType<typeof computeHealthAnalytics>;
  try {
    data = computeHealthAnalytics(db, parsed.q!);
  } catch (e: any) {
    return c.json({ error: e?.message || "统计失败" }, 500);
  }

  const cfg = loadAiConfig(db);
  if (!cfg) {
    return c.json({
      insights: data.insights,
      aiText: null,
      message: "未配置 AI，仅返回规则建议。",
      markdown: body.includeReport ? buildHealthAnalyticsMarkdown(data) : null,
    });
  }

  const k = data.kpis.current;
  const prompt = `你是家庭健康档案复盘顾问（非执业医师）。根据数据写 3～6 条简洁、可执行的生活/档案管理建议。
要求：
- 禁止给出具体诊断、用药剂量或替代就医的承诺
- 语气温暖务实；可建议「整理材料复诊」「补全附件」「随访提醒」等
- 每条 1～3 句；可用 Markdown 编号
- 不要编造数据中不存在的数字

周期：${data.range.from} ~ ${data.range.to}
KPI：记录 ${k.total}，进行中 ${k.ongoing}，痊愈 ${k.recovered}，慢性 ${k.chronic}，费用分 ${k.costSumMinor}
成员分布：${JSON.stringify(data.byMember.slice(0, 8))}
类型：${JSON.stringify(data.byType.slice(0, 8))}
规则洞察：${JSON.stringify(data.insights)}
进行中：${JSON.stringify(data.openLists.ongoing.slice(0, 8).map((t) => t.title))}
`;

  try {
    const url = cfg.ai_api_url.replace(/\/+$/, "");
    const endpoint = url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.ai_api_key ? { Authorization: `Bearer ${cfg.ai_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.ai_model,
        temperature: 0.45,
        messages: [
          {
            role: "system",
            content:
              "你是简洁务实的家庭健康档案顾问。你不提供医疗诊断，只帮助整理记录与就医准备。用中文回答。",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return c.json({
        insights: data.insights,
        aiText: null,
        message: `AI 调用失败: ${t.slice(0, 200)}`,
        markdown: body.includeReport ? buildHealthAnalyticsMarkdown(data) : null,
      });
    }
    const raw = (await res.json()) as any;
    const aiText = raw?.choices?.[0]?.message?.content || null;
    return c.json({
      insights: data.insights,
      aiText,
      markdown: body.includeReport
        ? buildHealthAnalyticsMarkdown(data, { aiText })
        : null,
    });
  } catch (e: any) {
    return c.json({
      insights: data.insights,
      aiText: null,
      message: e?.message || "AI 调用异常",
      markdown: body.includeReport ? buildHealthAnalyticsMarkdown(data) : null,
    });
  }
});

// ── 家庭药箱 ─────────────────────────────────────────────────────────────

health.get("/medicines", (c) => {
  const userId = uid(c);
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const q = (c.req.query("q") || "").trim() || undefined;
  const tag = (c.req.query("tag") || "").trim() || undefined;
  const expiry = (c.req.query("expiry") || "all") as any;
  try {
    return c.json(
      medicinesSvc.listMedicines(getDb(), {
        workspaceId,
        q,
        tag,
        expiry: ["soon", "expired", "ok", "all"].includes(expiry)
          ? expiry
          : "all",
      }),
    );
  } catch (e: any) {
    return c.json({ error: e?.message || "加载失败" }, 500);
  }
});

health.get("/medicines/:id", (c) => {
  const userId = uid(c);
  const db = getDb();
  const detail = medicinesSvc.getMedicineDetail(db, c.req.param("id"));
  if (!detail) return c.json({ error: "药品不存在" }, 404);
  const gate = requireWsMember(detail.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  return c.json(detail);
});

health.post("/medicines", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  try {
    const row = medicinesSvc.createMedicine(getDb(), {
      workspaceId,
      name: String(body.name || ""),
      brand: body.brand ?? null,
      category: body.category,
      spec: body.spec ?? null,
      usageText: body.usageText ?? null,
      efficacy: body.efficacy ?? null,
      form: body.form ?? null,
      unit: body.unit ?? null,
      quantityTotal: body.quantityTotal ?? null,
      quantityRemain: body.quantityRemain ?? null,
      expiryDate: body.expiryDate ?? null,
      openedAt: body.openedAt ?? null,
      location: body.location ?? null,
      memberId: body.memberId ?? null,
      medicineSystem: body.medicineSystem ?? null,
      notes: body.notes ?? null,
      imageAttachmentId: body.imageAttachmentId ?? null,
      sourceRecordId: body.sourceRecordId ?? null,
      tagNames: body.tagNames,
      tagIds: body.tagIds,
      createdBy: userId,
    });
    return c.json(row, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建失败" }, 400);
  }
});

health.patch("/medicines/:id", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const existing = medicinesSvc.getMedicine(db, c.req.param("id"));
  if (!existing) return c.json({ error: "药品不存在" }, 404);
  const gate = requireWsMember(existing.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const body = await c.req.json().catch(() => ({}));
  try {
    return c.json(
      medicinesSvc.updateMedicine(db, existing.id, {
        ...body,
        updatedBy: userId,
      }),
    );
  } catch (e: any) {
    return c.json({ error: e?.message || "更新失败" }, 400);
  }
});

health.delete("/medicines/:id", (c) => {
  const userId = uid(c);
  const db = getDb();
  const existing = medicinesSvc.getMedicine(db, c.req.param("id"));
  if (!existing) return c.json({ error: "药品不存在" }, 404);
  const gate = requireWsMember(existing.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!canDelete(existing.createdBy, existing.workspaceId, userId)) {
    return c.json({ error: "仅创建者或管理员可删除" }, 403);
  }
  return c.json(medicinesSvc.softDeleteMedicine(db, existing.id, userId));
});

health.get("/medicine-tags", (c) => {
  const userId = uid(c);
  const workspaceId = (c.req.query("workspaceId") || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  return c.json(medicinesSvc.listMedicineTags(getDb(), workspaceId));
});

health.post("/medicine-tags", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  try {
    const tag = medicinesSvc.ensureTag(
      getDb(),
      workspaceId,
      String(body.name || ""),
      body.color ?? null,
    );
    return c.json(tag, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "创建标签失败" }, 400);
  }
});

/** 药盒图上传（kind 默认 drug_box） */
health.post("/medicines/attachments", async (c) => {
  const userId = uid(c);
  const db = getDb();
  let body: Record<string, any>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "file 字段缺失" }, 400);
  const workspaceId = String(body.workspaceId || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const kind = String(body.kind || "drug_box");
  if (!ATTACHMENT_KINDS.includes(kind as any)) {
    return c.json({ error: `无效 kind: ${kind}` }, 400);
  }
  if (file.size > MAX_ATTACHMENT_SIZE) {
    return c.json({ error: `文件过大` }, 413);
  }
  const mime = (file.type || "application/octet-stream").toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return c.json({ error: `不支持的 MIME: ${mime}` }, 415);
  }
  ensureAttachmentsDir();
  const id = uuid();
  const ext = MIME_TO_EXT[mime] || "bin";
  const diskName = `${id}.${ext}`;
  const savePath = path.join(getAttachmentsDir(), diskName);
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  try {
    fs.writeFileSync(savePath, buffer);
  } catch (err: any) {
    return c.json({ error: `写入失败: ${err?.message}` }, 500);
  }
  try {
    db.prepare(
      `INSERT INTO health_attachments (
        id, workspaceId, recordId, memberId, bookId, medicineId, userId, kind,
        filename, mimeType, size, path, hash, ocrStatus
      ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'none')`,
    ).run(
      id,
      workspaceId,
      userId,
      kind,
      file.name || diskName,
      mime,
      file.size,
      diskName,
      hash,
    );
  } catch (err: any) {
    try {
      fs.unlinkSync(savePath);
    } catch {
      /* ignore */
    }
    // medicineId 列可能尚未迁移时降级
    try {
      db.prepare(
        `INSERT INTO health_attachments (
          id, workspaceId, recordId, memberId, bookId, userId, kind,
          filename, mimeType, size, path, hash, ocrStatus
        ) VALUES (?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'none')`,
      ).run(
        id,
        workspaceId,
        userId,
        kind,
        file.name || diskName,
        mime,
        file.size,
        diskName,
        hash,
      );
    } catch (e2: any) {
      return c.json({ error: `写入数据库失败: ${e2?.message || err?.message}` }, 500);
    }
  }
  const row = getAttachment(db, id)!;
  return c.json(attachmentPublic(row), 201);
});

health.post("/medicines/attachments/:id/ocr", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const row = getAttachment(db, c.req.param("id"));
  if (!row) return c.json({ error: "附件不存在" }, 404);
  const gate = requireWsMember(row.workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!loadAiConfig(db)) {
    return c.json(
      { error: "未配置 AI", message: "请在设置中配置支持多模态的 AI 模型。" },
      400,
    );
  }
  setOcrProcessing(db, row.id);
  try {
    const result = await runMedicineOcr(db, row);
    persistOcrResult(db, row.id, {
      rawText: result.rawText,
      structured: result.structured as any,
      model: result.model,
    });
    return c.json({
      attachmentId: row.id,
      attachmentIds: result.attachmentIds || [row.id],
      ocrStatus: "done",
      rawText: result.rawText,
      structured: result.structured,
      model: result.model,
    });
  } catch (e: any) {
    const msg = e?.message || "OCR 失败";
    persistOcrResult(db, row.id, null, msg);
    return c.json({ error: msg, ocrStatus: "failed" }, 502);
  }
});

/**
 * 多图药盒 OCR
 * body: { attachmentIds: string[] }  同一药品的多张照片（最多 6 张）
 */
health.post("/medicines/ocr/batch", async (c) => {
  const userId = uid(c);
  const db = getDb();
  const body = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String).filter(Boolean).slice(0, 6)
    : [];
  if (!ids.length) return c.json({ error: "attachmentIds 必填" }, 400);

  const rows: HealthAttachmentRow[] = [];
  let workspaceId = "";
  for (const id of ids) {
    const row = getAttachment(db, id);
    if (!row) return c.json({ error: `附件不存在: ${id}` }, 404);
    if (!workspaceId) workspaceId = row.workspaceId;
    if (row.workspaceId !== workspaceId) {
      return c.json({ error: "附件须属于同一工作区" }, 400);
    }
    rows.push(row);
  }
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  if (!loadAiConfig(db)) {
    return c.json(
      { error: "未配置 AI", message: "请在设置中配置支持多模态的 AI 模型。" },
      400,
    );
  }

  for (const r of rows) setOcrProcessing(db, r.id);
  try {
    const result = await runMedicineOcrMulti(db, rows);
    // 主结果写在第一张；其余标记 done 并引用合并说明
    for (let i = 0; i < rows.length; i++) {
      persistOcrResult(db, rows[i].id, {
        rawText: i === 0 ? result.rawText : `(merged into ${rows[0].id})`,
        structured: result.structured as any,
        model: result.model,
      });
    }
    return c.json({
      attachmentId: rows[0].id,
      attachmentIds: result.attachmentIds,
      ocrStatus: "done",
      rawText: result.rawText,
      structured: result.structured,
      model: result.model,
      imageCount: rows.length,
    });
  } catch (e: any) {
    const msg = e?.message || "OCR 失败";
    for (const r of rows) persistOcrResult(db, r.id, null, msg);
    return c.json({ error: msg, ocrStatus: "failed" }, 502);
  }
});

health.post("/medicines/ocr/apply", async (c) => {
  const userId = uid(c);
  const body = await c.req.json().catch(() => ({}));
  const workspaceId = String(body.workspaceId || "").trim();
  const gate = requireWsMember(workspaceId, userId);
  if ("error" in gate) return c.json({ error: gate.error }, gate.status);
  const structured = body.structured as any;
  if (!structured || typeof structured !== "object") {
    return c.json({ error: "structured 必填" }, 400);
  }
  const attachmentIds: string[] = Array.isArray(body.attachmentIds)
    ? body.attachmentIds.map(String)
    : body.attachmentId
      ? [String(body.attachmentId)]
      : [];
  try {
    const input = medicinesSvc.medicineFromOcr(structured, workspaceId, userId, {
      tagNames: body.tagNames,
      imageAttachmentId: attachmentIds[0] || body.imageAttachmentId || null,
    });
    if (body.medicineId) {
      const existing = medicinesSvc.getMedicine(getDb(), String(body.medicineId));
      if (!existing || existing.workspaceId !== workspaceId) {
        return c.json({ error: "药品不存在" }, 404);
      }
      const updated = medicinesSvc.updateMedicine(getDb(), existing.id, {
        ...input,
        tagNames: input.tagNames,
        updatedBy: userId,
      });
      bindMedicineAttachments(getDb(), updated.id, workspaceId, attachmentIds);
      return c.json(updated);
    }
    const created = medicinesSvc.createMedicine(getDb(), input);
    bindMedicineAttachments(getDb(), created.id, workspaceId, attachmentIds);
    return c.json(created, 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "写入失败" }, 400);
  }
});

function bindMedicineAttachments(
  db: ReturnType<typeof getDb>,
  medicineId: string,
  workspaceId: string,
  attachmentIds: string[],
) {
  if (!attachmentIds.length) return;
  try {
    const upd = db.prepare(
      `UPDATE health_attachments SET medicineId = ? WHERE id = ? AND workspaceId = ?`,
    );
    for (const aid of attachmentIds) {
      upd.run(medicineId, aid, workspaceId);
    }
  } catch {
    /* medicineId 列可能不存在时忽略 */
  }
}

export default health;
