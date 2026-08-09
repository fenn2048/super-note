/**
 * 家庭药箱 CRUD + 标签 + 搜索
 */
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import {
  MEDICINE_CATEGORIES,
  type HealthMedicineRow,
  type HealthMedicineTagRow,
  type MedicineOcrStructured,
  isValidDateOnly,
  normalizeMedicineSystem,
} from "./types.js";

export type MedicineWithTags = HealthMedicineRow & {
  tags: HealthMedicineTagRow[];
};

function nowTs() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function getMedicine(
  db: Database.Database,
  id: string,
): HealthMedicineRow | undefined {
  return db
    .prepare(`SELECT * FROM health_medicines WHERE id = ? AND isDeleted = 0`)
    .get(id) as HealthMedicineRow | undefined;
}

export function listTagsForMedicine(
  db: Database.Database,
  medicineId: string,
): HealthMedicineTagRow[] {
  return db
    .prepare(
      `SELECT t.* FROM health_medicine_tags t
       JOIN health_medicine_tag_map m ON m.tagId = t.id
       WHERE m.medicineId = ?
       ORDER BY t.name ASC`,
    )
    .all(medicineId) as HealthMedicineTagRow[];
}

export function getMedicineDetail(
  db: Database.Database,
  id: string,
): MedicineWithTags | null {
  const row = getMedicine(db, id);
  if (!row) return null;
  return { ...row, tags: listTagsForMedicine(db, id) };
}

export function listMedicineTags(
  db: Database.Database,
  workspaceId: string,
): HealthMedicineTagRow[] {
  return db
    .prepare(
      `SELECT * FROM health_medicine_tags WHERE workspaceId = ? ORDER BY name ASC`,
    )
    .all(workspaceId) as HealthMedicineTagRow[];
}

export function ensureTag(
  db: Database.Database,
  workspaceId: string,
  name: string,
  color?: string | null,
): HealthMedicineTagRow {
  const n = name.trim();
  if (!n) throw new Error("标签名不能为空");
  const existing = db
    .prepare(
      `SELECT * FROM health_medicine_tags WHERE workspaceId = ? AND name = ?`,
    )
    .get(workspaceId, n) as HealthMedicineTagRow | undefined;
  if (existing) return existing;
  const id = uuid();
  db.prepare(
    `INSERT INTO health_medicine_tags (id, workspaceId, name, color) VALUES (?, ?, ?, ?)`,
  ).run(id, workspaceId, n, color ?? null);
  return db
    .prepare(`SELECT * FROM health_medicine_tags WHERE id = ?`)
    .get(id) as HealthMedicineTagRow;
}

function setMedicineTags(
  db: Database.Database,
  medicineId: string,
  workspaceId: string,
  tagNames?: string[] | null,
  tagIds?: string[] | null,
) {
  db.prepare(`DELETE FROM health_medicine_tag_map WHERE medicineId = ?`).run(
    medicineId,
  );
  const ids = new Set<string>();
  if (tagIds?.length) {
    for (const tid of tagIds) {
      const t = db
        .prepare(
          `SELECT id FROM health_medicine_tags WHERE id = ? AND workspaceId = ?`,
        )
        .get(tid, workspaceId) as { id: string } | undefined;
      if (t) ids.add(t.id);
    }
  }
  if (tagNames?.length) {
    for (const name of tagNames) {
      if (!name?.trim()) continue;
      ids.add(ensureTag(db, workspaceId, name).id);
    }
  }
  const ins = db.prepare(
    `INSERT OR IGNORE INTO health_medicine_tag_map (medicineId, tagId) VALUES (?, ?)`,
  );
  for (const tid of ids) ins.run(medicineId, tid);
}

export function listMedicines(
  db: Database.Database,
  opts: {
    workspaceId: string;
    q?: string;
    tag?: string;
    /** soon = 30 天内过期；expired = 已过期；ok = 未过期或无日期 */
    expiry?: "soon" | "expired" | "ok" | "all";
    includeArchived?: boolean;
    limit?: number;
  },
): MedicineWithTags[] {
  const clauses: string[] = ["m.workspaceId = ?", "m.isDeleted = 0"];
  const params: any[] = [opts.workspaceId];
  if (!opts.includeArchived) {
    clauses.push("m.isArchived = 0");
  }
  if (opts.q?.trim()) {
    const like = `%${opts.q.trim()}%`;
    clauses.push(
      `(m.name LIKE ? OR IFNULL(m.brand,'') LIKE ? OR IFNULL(m.spec,'') LIKE ?
        OR EXISTS (
          SELECT 1 FROM health_medicine_tag_map mp
          JOIN health_medicine_tags t ON t.id = mp.tagId
          WHERE mp.medicineId = m.id AND t.name LIKE ?
        ))`,
    );
    params.push(like, like, like, like);
  }
  if (opts.tag?.trim()) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM health_medicine_tag_map mp
        JOIN health_medicine_tags t ON t.id = mp.tagId
        WHERE mp.medicineId = m.id AND t.name = ?
      )`,
    );
    params.push(opts.tag.trim());
  }
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const soonStr = soon.toISOString().slice(0, 10);
  if (opts.expiry === "expired") {
    clauses.push(`m.expiryDate IS NOT NULL AND m.expiryDate < ?`);
    params.push(today);
  } else if (opts.expiry === "soon") {
    clauses.push(
      `m.expiryDate IS NOT NULL AND m.expiryDate >= ? AND m.expiryDate <= ?`,
    );
    params.push(today, soonStr);
  } else if (opts.expiry === "ok") {
    clauses.push(`(m.expiryDate IS NULL OR m.expiryDate > ?)`);
    params.push(soonStr);
  }

  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const rows = db
    .prepare(
      `SELECT m.* FROM health_medicines m
       WHERE ${clauses.join(" AND ")}
       ORDER BY
         CASE WHEN m.expiryDate IS NULL THEN 1 ELSE 0 END,
         m.expiryDate ASC,
         m.name ASC
       LIMIT ?`,
    )
    .all(...params, limit) as HealthMedicineRow[];

  return rows.map((r) => ({
    ...r,
    tags: listTagsForMedicine(db, r.id),
  }));
}

export interface MedicineInput {
  workspaceId: string;
  name: string;
  brand?: string | null;
  category?: string;
  spec?: string | null;
  usageText?: string | null;
  efficacy?: string | null;
  form?: string | null;
  unit?: string | null;
  quantityTotal?: number | null;
  quantityRemain?: number | null;
  expiryDate?: string | null;
  openedAt?: string | null;
  location?: string | null;
  memberId?: string | null;
  medicineSystem?: string | null;
  notes?: string | null;
  imageAttachmentId?: string | null;
  sourceRecordId?: string | null;
  tagNames?: string[];
  tagIds?: string[];
  createdBy: string;
}

function assertMedicineDates(expiryDate?: string | null, openedAt?: string | null) {
  if (expiryDate && !isValidDateOnly(expiryDate)) {
    throw new Error("expiryDate 须为 YYYY-MM-DD");
  }
  if (openedAt && !isValidDateOnly(openedAt)) {
    throw new Error("openedAt 须为 YYYY-MM-DD");
  }
}

export function createMedicine(
  db: Database.Database,
  input: MedicineInput,
): MedicineWithTags {
  const name = input.name.trim();
  if (!name) throw new Error("药品名称不能为空");
  assertMedicineDates(input.expiryDate, input.openedAt);
  const category = input.category || "western";
  if (!MEDICINE_CATEGORIES.includes(category as any)) {
    throw new Error(`无效 category: ${category}`);
  }
  const id = uuid();
  const now = nowTs();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO health_medicines (
        id, workspaceId, name, brand, category, spec, usageText, efficacy,
        form, unit, quantityTotal, quantityRemain, expiryDate, openedAt,
        location, memberId, medicineSystem, notes, imageAttachmentId, sourceRecordId,
        createdBy, updatedBy, createdAt, updatedAt, isDeleted, isArchived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
    ).run(
      id,
      input.workspaceId,
      name,
      input.brand ?? null,
      category,
      input.spec ?? null,
      input.usageText ?? null,
      input.efficacy ?? null,
      input.form ?? null,
      input.unit ?? null,
      input.quantityTotal ?? null,
      input.quantityRemain ?? null,
      input.expiryDate ?? null,
      input.openedAt ?? null,
      input.location ?? null,
      input.memberId ?? null,
      input.medicineSystem
        ? normalizeMedicineSystem(input.medicineSystem)
        : "unknown",
      input.notes ?? null,
      input.imageAttachmentId ?? null,
      input.sourceRecordId ?? null,
      input.createdBy,
      input.createdBy,
      now,
      now,
    );
    setMedicineTags(
      db,
      id,
      input.workspaceId,
      input.tagNames,
      input.tagIds,
    );
  });
  tx();
  return getMedicineDetail(db, id)!;
}

export function updateMedicine(
  db: Database.Database,
  id: string,
  input: Partial<Omit<MedicineInput, "workspaceId" | "createdBy">> & {
    updatedBy: string;
    isArchived?: boolean;
  },
): MedicineWithTags {
  const existing = getMedicine(db, id);
  if (!existing) throw new Error("药品不存在");
  const name =
    input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new Error("药品名称不能为空");
  assertMedicineDates(
    input.expiryDate !== undefined ? input.expiryDate : existing.expiryDate,
    input.openedAt !== undefined ? input.openedAt : existing.openedAt,
  );
  if (input.category && !MEDICINE_CATEGORIES.includes(input.category as any)) {
    throw new Error(`无效 category: ${input.category}`);
  }
  const now = nowTs();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE health_medicines SET
        name = ?, brand = ?, category = ?, spec = ?, usageText = ?, efficacy = ?,
        form = ?, unit = ?, quantityTotal = ?, quantityRemain = ?,
        expiryDate = ?, openedAt = ?, location = ?, memberId = ?,
        medicineSystem = ?, notes = ?, imageAttachmentId = ?, sourceRecordId = ?,
        isArchived = ?, updatedBy = ?, updatedAt = ?
       WHERE id = ?`,
    ).run(
      name,
      input.brand !== undefined ? input.brand : existing.brand,
      input.category ?? existing.category,
      input.spec !== undefined ? input.spec : existing.spec,
      input.usageText !== undefined ? input.usageText : existing.usageText,
      input.efficacy !== undefined ? input.efficacy : existing.efficacy,
      input.form !== undefined ? input.form : existing.form,
      input.unit !== undefined ? input.unit : existing.unit,
      input.quantityTotal !== undefined
        ? input.quantityTotal
        : existing.quantityTotal,
      input.quantityRemain !== undefined
        ? input.quantityRemain
        : existing.quantityRemain,
      input.expiryDate !== undefined ? input.expiryDate : existing.expiryDate,
      input.openedAt !== undefined ? input.openedAt : existing.openedAt,
      input.location !== undefined ? input.location : existing.location,
      input.memberId !== undefined ? input.memberId : existing.memberId,
      input.medicineSystem !== undefined
        ? normalizeMedicineSystem(input.medicineSystem)
        : existing.medicineSystem,
      input.notes !== undefined ? input.notes : existing.notes,
      input.imageAttachmentId !== undefined
        ? input.imageAttachmentId
        : existing.imageAttachmentId,
      input.sourceRecordId !== undefined
        ? input.sourceRecordId
        : existing.sourceRecordId,
      input.isArchived !== undefined
        ? input.isArchived
          ? 1
          : 0
        : existing.isArchived,
      input.updatedBy,
      now,
      id,
    );
    if (input.tagNames !== undefined || input.tagIds !== undefined) {
      setMedicineTags(
        db,
        id,
        existing.workspaceId,
        input.tagNames,
        input.tagIds,
      );
    }
  });
  tx();
  return getMedicineDetail(db, id)!;
}

export function softDeleteMedicine(
  db: Database.Database,
  id: string,
  updatedBy: string,
) {
  const existing = getMedicine(db, id);
  if (!existing) throw new Error("药品不存在");
  db.prepare(
    `UPDATE health_medicines SET isDeleted = 1, updatedBy = ?, updatedAt = ? WHERE id = ?`,
  ).run(updatedBy, nowTs(), id);
  return { ok: true };
}

export function medicineFromOcr(
  structured: MedicineOcrStructured,
  workspaceId: string,
  createdBy: string,
  extras?: {
    tagNames?: string[];
    imageAttachmentId?: string | null;
  },
): MedicineInput {
  const name = (structured.name || "").trim();
  if (!name) throw new Error("OCR 未识别到药品名称，请手动填写");
  const tags = [
    ...(structured.suggestedTags || []),
    ...(extras?.tagNames || []),
  ].filter(Boolean);
  return {
    workspaceId,
    name,
    brand: structured.brand ?? null,
    category: structured.category || "western",
    spec: structured.spec ?? null,
    usageText: structured.usageText ?? null,
    efficacy: structured.efficacy ?? null,
    form: structured.form ?? null,
    unit: structured.unit ?? null,
    quantityRemain: structured.quantityRemain ?? null,
    expiryDate: structured.expiryDate ?? null,
    medicineSystem: structured.medicineSystem ?? "unknown",
    tagNames: tags.length ? tags : undefined,
    imageAttachmentId: extras?.imageAttachmentId ?? null,
    createdBy,
  };
}
