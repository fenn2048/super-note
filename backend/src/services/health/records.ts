import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import {
  type HealthAttachmentRow,
  type HealthLabItem,
  type HealthRecordRow,
  type HealthStageRow,
  type MedicineSystem,
  composeDiagnosisSummary,
  isValidDateOnly,
  MEDICINE_SYSTEMS,
  normalizeMedicineSystem,
  RECORD_STATUSES,
  RECORD_TYPES,
} from "./types.js";
import { getBook } from "./books.js";
import { getMember } from "./members.js";

export interface StageInput {
  id?: string;
  stageDate?: string | null;
  label?: string | null;
  symptoms: string;
  notes?: string | null;
  sortOrder?: number;
}

export interface RecordInput {
  bookId: string;
  title: string;
  recordType?: string;
  status?: string;
  medicineSystem?: string;
  occurredAt: string;
  endedAt?: string | null;
  hospital?: string | null;
  department?: string | null;
  doctor?: string | null;
  diagnosis?: string | null;
  diagnosisWestern?: string | null;
  diagnosisTcm?: string | null;
  prescription?: string | null;
  advice?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  costMinor?: number | null;
  careExtra?: Record<string, unknown> | null;
  careExtraJson?: string | null;
  stages?: StageInput[];
  createdBy: string;
}

function serializeCareExtra(
  careExtra?: Record<string, unknown> | null,
  careExtraJson?: string | null,
): string | null {
  if (careExtraJson != null && careExtraJson !== "") {
    try {
      JSON.parse(careExtraJson);
      return careExtraJson;
    } catch {
      throw new Error("careExtraJson 须为合法 JSON");
    }
  }
  if (careExtra && typeof careExtra === "object") {
    return JSON.stringify(careExtra);
  }
  return null;
}

function parseCareExtra(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/**
 * 将 OCR 检查结果写入 careExtra（examFindings + labs），不碰 prescription
 */
export function mergeExamCareExtra(
  existingJson: string | null | undefined,
  structured: {
    examFindings?: string;
    labs?: HealthLabItem[];
    documentType?: string;
  },
): Record<string, unknown> | null {
  const hasExam =
    !!(structured.examFindings && structured.examFindings.trim()) ||
    (Array.isArray(structured.labs) && structured.labs.length > 0) ||
    (structured.documentType || "").includes("exam");
  if (!hasExam) {
    return parseCareExtra(existingJson || null);
  }

  const base: Record<string, unknown> = {
    ...(parseCareExtra(existingJson || null) || {}),
  };

  if (structured.examFindings?.trim()) {
    const prev = String(base.examFindings || "").trim();
    const next = structured.examFindings.trim();
    if (!prev) base.examFindings = next;
    else if (!prev.includes(next.slice(0, Math.min(40, next.length)))) {
      base.examFindings = `${prev}\n${next}`;
    }
  }

  const labsIn = Array.isArray(structured.labs) ? structured.labs : [];
  if (labsIn.length) {
    const prevLabs = Array.isArray(base.labs) ? [...(base.labs as any[])] : [];
    const byName = new Map<string, any>();
    for (const l of prevLabs) {
      const n = String(l?.name || "").trim();
      if (n) byName.set(n, l);
    }
    for (const l of labsIn) {
      const n = String(l?.name || "").trim();
      if (!n) continue;
      byName.set(n, { ...(byName.get(n) || {}), ...l });
    }
    base.labs = [...byName.values()];
  }

  return base;
}

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const v = JSON.parse(tagsJson);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function listRecords(
  db: Database.Database,
  opts: {
    workspaceId?: string;
    memberId?: string;
    bookId?: string;
    from?: string;
    to?: string;
    status?: string;
    medicineSystem?: string;
    limit?: number;
  },
): HealthRecordRow[] {
  const clauses: string[] = ["isDeleted = 0"];
  const params: any[] = [];

  if (opts.bookId) {
    clauses.push("bookId = ?");
    params.push(opts.bookId);
  }
  if (opts.memberId) {
    clauses.push("memberId = ?");
    params.push(opts.memberId);
  }
  if (opts.workspaceId) {
    clauses.push("workspaceId = ?");
    params.push(opts.workspaceId);
  }
  if (opts.from) {
    clauses.push("occurredAt >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push("occurredAt <= ?");
    params.push(opts.to);
  }
  if (opts.status) {
    clauses.push("status = ?");
    params.push(opts.status);
  }
  if (opts.medicineSystem && opts.medicineSystem !== "all") {
    clauses.push("medicineSystem = ?");
    params.push(normalizeMedicineSystem(opts.medicineSystem));
  }

  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  return db
    .prepare(
      `SELECT * FROM health_records
       WHERE ${clauses.join(" AND ")}
       ORDER BY occurredAt DESC, createdAt DESC
       LIMIT ?`,
    )
    .all(...params, limit) as HealthRecordRow[];
}

export function getRecord(db: Database.Database, id: string): HealthRecordRow | undefined {
  return db.prepare(`SELECT * FROM health_records WHERE id = ? AND isDeleted = 0`).get(id) as
    | HealthRecordRow
    | undefined;
}

export function listStages(db: Database.Database, recordId: string): HealthStageRow[] {
  return db
    .prepare(
      `SELECT * FROM health_record_stages WHERE recordId = ? ORDER BY sortOrder ASC, createdAt ASC`,
    )
    .all(recordId) as HealthStageRow[];
}

export function listAttachmentsForRecord(
  db: Database.Database,
  recordId: string,
): HealthAttachmentRow[] {
  return db
    .prepare(`SELECT * FROM health_attachments WHERE recordId = ? ORDER BY createdAt DESC`)
    .all(recordId) as HealthAttachmentRow[];
}

export function getRecordDetail(db: Database.Database, id: string) {
  const record = getRecord(db, id);
  if (!record) return null;
  return {
    ...record,
    tags: parseTags(record.tagsJson),
    careExtra: parseCareExtra(record.careExtraJson),
    stages: listStages(db, id),
    attachments: listAttachmentsForRecord(db, id).map((a) => ({
      ...a,
      url: `/api/health/attachments/${a.id}`,
      ocrStructured: a.ocrStructuredJson
        ? (() => {
            try {
              return JSON.parse(a.ocrStructuredJson!);
            } catch {
              return null;
            }
          })()
        : null,
    })),
  };
}

function assertRecordEnums(
  recordType?: string,
  status?: string,
  medicineSystem?: string,
) {
  if (recordType && !RECORD_TYPES.includes(recordType as any)) {
    throw new Error(`无效 recordType: ${recordType}`);
  }
  if (status && !RECORD_STATUSES.includes(status as any)) {
    throw new Error(`无效 status: ${status}`);
  }
  if (
    medicineSystem &&
    !MEDICINE_SYSTEMS.includes(normalizeMedicineSystem(medicineSystem) as MedicineSystem)
  ) {
    throw new Error(`无效 medicineSystem: ${medicineSystem}`);
  }
}

/** 解析双诊断 + 兼容 diagnosis 字段 */
function resolveDiagnoses(input: {
  diagnosis?: string | null;
  diagnosisWestern?: string | null;
  diagnosisTcm?: string | null;
  medicineSystem?: string;
}) {
  let dw =
    input.diagnosisWestern !== undefined && input.diagnosisWestern !== null
      ? String(input.diagnosisWestern).trim() || null
      : undefined;
  let dt =
    input.diagnosisTcm !== undefined && input.diagnosisTcm !== null
      ? String(input.diagnosisTcm).trim() || null
      : undefined;
  const legacy =
    input.diagnosis !== undefined && input.diagnosis !== null
      ? String(input.diagnosis).trim() || null
      : undefined;

  // 若只传了 legacy diagnosis，按体系写入对应侧
  if (legacy && dw === undefined && dt === undefined) {
    const sys = normalizeMedicineSystem(input.medicineSystem);
    if (sys === "tcm") dt = legacy;
    else if (sys === "western") dw = legacy;
    else {
      dw = legacy;
    }
  }

  const diagnosis = composeDiagnosisSummary(
    dw === undefined ? null : dw,
    dt === undefined ? null : dt,
    legacy ?? null,
  );

  return {
    diagnosisWestern: dw === undefined ? null : dw,
    diagnosisTcm: dt === undefined ? null : dt,
    diagnosis,
  };
}

function insertStages(db: Database.Database, recordId: string, stages: StageInput[]) {
  const ins = db.prepare(
    `INSERT INTO health_record_stages (
      id, recordId, stageDate, label, symptoms, notes, sortOrder, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  stages.forEach((s, i) => {
    const symptoms = (s.symptoms || "").trim();
    if (!symptoms) return;
    ins.run(
      s.id || uuid(),
      recordId,
      s.stageDate || null,
      s.label || null,
      symptoms,
      s.notes || null,
      s.sortOrder ?? i,
    );
  });
}

export function createRecord(db: Database.Database, input: RecordInput): ReturnType<typeof getRecordDetail> {
  const book = getBook(db, input.bookId);
  if (!book) throw new Error("病历本不存在");
  const member = getMember(db, book.memberId);
  if (!member) throw new Error("成员不存在");

  const title = input.title.trim();
  if (!title) throw new Error("title 不能为空");
  if (!isValidDateOnly(input.occurredAt)) throw new Error("occurredAt 须为 YYYY-MM-DD");
  if (input.endedAt && !isValidDateOnly(input.endedAt)) throw new Error("endedAt 须为 YYYY-MM-DD");
  assertRecordEnums(input.recordType, input.status, input.medicineSystem);

  const id = uuid();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const tagsJson =
    input.tags && input.tags.length ? JSON.stringify(input.tags.map(String)) : null;
  const medicineSystem = normalizeMedicineSystem(input.medicineSystem || "unknown");
  const diag = resolveDiagnoses({
    diagnosis: input.diagnosis,
    diagnosisWestern: input.diagnosisWestern,
    diagnosisTcm: input.diagnosisTcm,
    medicineSystem,
  });
  const careExtraJson = serializeCareExtra(input.careExtra, input.careExtraJson);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO health_records (
        id, workspaceId, memberId, bookId, title, recordType, status, medicineSystem,
        occurredAt, endedAt, hospital, department, doctor,
        diagnosis, diagnosisWestern, diagnosisTcm,
        prescription, advice, notes, tagsJson, costMinor, careExtraJson,
        createdBy, updatedBy, createdAt, updatedAt, isDeleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    ).run(
      id,
      book.workspaceId,
      book.memberId,
      book.id,
      title,
      input.recordType || "visit",
      input.status || "ongoing",
      medicineSystem,
      input.occurredAt,
      input.endedAt ?? null,
      input.hospital ?? null,
      input.department ?? null,
      input.doctor ?? null,
      diag.diagnosis,
      diag.diagnosisWestern,
      diag.diagnosisTcm,
      input.prescription ?? null,
      input.advice ?? null,
      input.notes ?? null,
      tagsJson,
      input.costMinor ?? null,
      careExtraJson,
      input.createdBy,
      input.createdBy,
      now,
      now,
    );
    if (input.stages?.length) insertStages(db, id, input.stages);
  });
  tx();
  return getRecordDetail(db, id);
}

export function updateRecord(
  db: Database.Database,
  id: string,
  input: Partial<Omit<RecordInput, "bookId" | "createdBy">> & { updatedBy: string },
): ReturnType<typeof getRecordDetail> {
  const existing = getRecord(db, id);
  if (!existing) throw new Error("病历不存在");

  const title =
    input.title !== undefined ? input.title.trim() : existing.title;
  if (!title) throw new Error("title 不能为空");

  const occurredAt = input.occurredAt ?? existing.occurredAt;
  if (!isValidDateOnly(occurredAt)) throw new Error("occurredAt 须为 YYYY-MM-DD");
  const endedAt = input.endedAt !== undefined ? input.endedAt : existing.endedAt;
  if (endedAt && !isValidDateOnly(endedAt)) throw new Error("endedAt 须为 YYYY-MM-DD");

  assertRecordEnums(input.recordType, input.status, input.medicineSystem);

  let tagsJson = existing.tagsJson;
  if (input.tags !== undefined) {
    tagsJson = input.tags && input.tags.length ? JSON.stringify(input.tags.map(String)) : null;
  }

  const medicineSystem =
    input.medicineSystem !== undefined
      ? normalizeMedicineSystem(input.medicineSystem)
      : normalizeMedicineSystem(existing.medicineSystem || "unknown");

  const diag = resolveDiagnoses({
    diagnosis:
      input.diagnosis !== undefined ? input.diagnosis : existing.diagnosis,
    diagnosisWestern:
      input.diagnosisWestern !== undefined
        ? input.diagnosisWestern
        : existing.diagnosisWestern,
    diagnosisTcm:
      input.diagnosisTcm !== undefined ? input.diagnosisTcm : existing.diagnosisTcm,
    medicineSystem,
  });
  // 若两侧都未改且 resolve 只得到 null，保留旧 diagnosis
  const diagnosis =
    diag.diagnosis ||
    existing.diagnosis ||
    composeDiagnosisSummary(diag.diagnosisWestern, diag.diagnosisTcm, null);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  let careExtraJson = existing.careExtraJson;
  if (input.careExtra !== undefined || input.careExtraJson !== undefined) {
    careExtraJson = serializeCareExtra(
      input.careExtra !== undefined ? input.careExtra : null,
      input.careExtraJson !== undefined ? input.careExtraJson : null,
    );
    if (
      input.careExtra === undefined &&
      input.careExtraJson === undefined
    ) {
      careExtraJson = existing.careExtraJson;
    }
    // if only careExtra null explicitly clear
    if (input.careExtra === null && input.careExtraJson === undefined) {
      careExtraJson = null;
    }
  }

  db.prepare(
    `UPDATE health_records SET
      title = ?, recordType = ?, status = ?, medicineSystem = ?,
      occurredAt = ?, endedAt = ?,
      hospital = ?, department = ?, doctor = ?,
      diagnosis = ?, diagnosisWestern = ?, diagnosisTcm = ?,
      prescription = ?, advice = ?, notes = ?, tagsJson = ?, costMinor = ?,
      careExtraJson = ?,
      updatedBy = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(
    title,
    input.recordType ?? existing.recordType,
    input.status ?? existing.status,
    medicineSystem,
    occurredAt,
    endedAt,
    input.hospital !== undefined ? input.hospital : existing.hospital,
    input.department !== undefined ? input.department : existing.department,
    input.doctor !== undefined ? input.doctor : existing.doctor,
    diagnosis,
    input.diagnosisWestern !== undefined
      ? diag.diagnosisWestern
      : existing.diagnosisWestern ?? diag.diagnosisWestern,
    input.diagnosisTcm !== undefined
      ? diag.diagnosisTcm
      : existing.diagnosisTcm ?? diag.diagnosisTcm,
    input.prescription !== undefined ? input.prescription : existing.prescription,
    input.advice !== undefined ? input.advice : existing.advice,
    input.notes !== undefined ? input.notes : existing.notes,
    tagsJson,
    input.costMinor !== undefined ? input.costMinor : existing.costMinor,
    careExtraJson,
    input.updatedBy,
    now,
    id,
  );

  if (input.stages) {
    replaceStages(db, id, input.stages);
  }
  return getRecordDetail(db, id);
}

export function replaceStages(db: Database.Database, recordId: string, stages: StageInput[]) {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM health_record_stages WHERE recordId = ?`).run(recordId);
    insertStages(db, recordId, stages);
  });
  tx();
  return listStages(db, recordId);
}

export function softDeleteRecord(db: Database.Database, id: string, updatedBy: string) {
  const existing = getRecord(db, id);
  if (!existing) throw new Error("病历不存在");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `UPDATE health_records SET isDeleted = 1, updatedBy = ?, updatedAt = ? WHERE id = ?`,
  ).run(updatedBy, now, id);
  return { ok: true };
}

/** 时间轴摘要（列表用，不含 stages 全文） */
export function toTimelineItem(row: HealthRecordRow) {
  return {
    id: row.id,
    memberId: row.memberId,
    bookId: row.bookId,
    title: row.title,
    recordType: row.recordType,
    status: row.status,
    medicineSystem: row.medicineSystem || "unknown",
    occurredAt: row.occurredAt,
    endedAt: row.endedAt,
    hospital: row.hospital,
    department: row.department,
    doctor: row.doctor,
    diagnosis: row.diagnosis,
    diagnosisWestern: row.diagnosisWestern ?? null,
    diagnosisTcm: row.diagnosisTcm ?? null,
    costMinor: row.costMinor,
    careExtra: parseCareExtra(row.careExtraJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
