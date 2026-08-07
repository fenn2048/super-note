/** 健康档案领域类型 */

export type HealthGender = "male" | "female" | "other" | "unknown";

export type HealthRecordType =
  | "visit"
  | "hospitalization"
  | "surgery"
  | "infusion"
  | "checkup"
  | "medication"
  | "emergency"
  | "other";

export type HealthRecordStatus = "ongoing" | "recovered" | "chronic" | "unknown";

/** 医疗体系：西医 / 中医 / 中西医结合 */
export type MedicineSystem = "western" | "tcm" | "integrated" | "unknown";

export type HealthAttachmentKind =
  | "medical_record"
  | "invoice"
  | "exam_lab"
  | "prescription"
  | "prescription_western"
  | "prescription_tcm"
  | "drug_label"
  | "drug_box"
  | "other";

export type HealthOcrStatus = "none" | "pending" | "processing" | "done" | "failed";

export interface HealthMemberRow {
  id: string;
  workspaceId: string;
  displayName: string;
  relationship: string | null;
  birthDate: string | null;
  gender: string | null;
  bloodType: string | null;
  allergies: string | null;
  chronicNotes: string | null;
  avatarPath: string | null;
  linkedUserId: string | null;
  sortOrder: number;
  isArchived: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthBookRow {
  id: string;
  workspaceId: string;
  memberId: string;
  title: string;
  description: string | null;
  color: string | null;
  isArchived: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthRecordRow {
  id: string;
  workspaceId: string;
  memberId: string;
  bookId: string;
  title: string;
  recordType: string;
  status: string;
  medicineSystem: string;
  occurredAt: string;
  endedAt: string | null;
  hospital: string | null;
  department: string | null;
  doctor: string | null;
  diagnosis: string | null;
  diagnosisWestern: string | null;
  diagnosisTcm: string | null;
  prescription: string | null;
  advice: string | null;
  notes: string | null;
  tagsJson: string | null;
  costMinor: number | null;
  careExtraJson: string | null;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
}

export type MedicineCategory =
  | "western"
  | "tcm_patent"
  | "tcm_herb"
  | "topical"
  | "supplement"
  | "other";

export interface HealthMedicineRow {
  id: string;
  workspaceId: string;
  name: string;
  brand: string | null;
  category: string;
  spec: string | null;
  usageText: string | null;
  efficacy: string | null;
  form: string | null;
  unit: string | null;
  quantityTotal: number | null;
  quantityRemain: number | null;
  expiryDate: string | null;
  openedAt: string | null;
  location: string | null;
  memberId: string | null;
  medicineSystem: string | null;
  notes: string | null;
  imageAttachmentId: string | null;
  sourceRecordId: string | null;
  isArchived: number;
  isDeleted: number;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HealthMedicineTagRow {
  id: string;
  workspaceId: string;
  name: string;
  color: string | null;
}

export interface MedicineOcrStructured {
  name?: string;
  brand?: string;
  category?: string;
  spec?: string;
  usageText?: string;
  efficacy?: string;
  form?: string;
  unit?: string;
  quantityRemain?: number;
  expiryDate?: string;
  medicineSystem?: MedicineSystem;
  suggestedTags?: string[];
  confidence: number;
  fieldsConfidence?: Record<string, number>;
  warnings?: string[];
}

export interface HealthStageRow {
  id: string;
  recordId: string;
  stageDate: string | null;
  label: string | null;
  symptoms: string;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface HealthAttachmentRow {
  id: string;
  workspaceId: string;
  recordId: string | null;
  memberId: string | null;
  bookId: string | null;
  userId: string;
  kind: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  hash: string | null;
  ocrStatus: string;
  ocrRawText: string | null;
  ocrStructuredJson: string | null;
  ocrModel: string | null;
  ocrError: string | null;
  ocrAt: string | null;
  createdAt: string;
}

/** 检查/化验单条目 */
export interface HealthLabItem {
  name?: string;
  value?: string;
  unit?: string;
  refRange?: string;
  /** high | low | normal | abnormal | 原文标记 */
  flag?: string;
}

export interface HealthOcrStructured {
  documentType: string;
  confidence: number;
  medicineSystem?: MedicineSystem;
  title?: string;
  occurredAt?: string;
  hospital?: string;
  department?: string;
  doctor?: string;
  /** 兼容主诊断摘要 */
  diagnosis?: string;
  diagnosisWestern?: string;
  diagnosisTcm?: string;
  /** 仅处方类单据；检查单勿占用此字段 */
  prescription?: string;
  advice?: string;
  costMinor?: number;
  /** 检查结论 / 影像所见摘要（专用，不进 prescription） */
  examFindings?: string;
  /** 化验项目列表 → 落库 careExtraJson.labs */
  labs?: HealthLabItem[];
  stages?: Array<{ stageDate?: string; label?: string; symptoms: string; notes?: string }>;
  fieldsConfidence?: Record<string, number>;
  warnings?: string[];
}

export const RECORD_TYPES: HealthRecordType[] = [
  "visit",
  "hospitalization",
  "surgery",
  "infusion",
  "checkup",
  "medication",
  "emergency",
  "other",
];

export const RECORD_STATUSES: HealthRecordStatus[] = [
  "ongoing",
  "recovered",
  "chronic",
  "unknown",
];

export const MEDICINE_SYSTEMS: MedicineSystem[] = [
  "western",
  "tcm",
  "integrated",
  "unknown",
];

export const ATTACHMENT_KINDS: HealthAttachmentKind[] = [
  "medical_record",
  "invoice",
  "exam_lab",
  "prescription",
  "prescription_western",
  "prescription_tcm",
  "drug_label",
  "drug_box",
  "other",
];

export const MEDICINE_CATEGORIES: MedicineCategory[] = [
  "western",
  "tcm_patent",
  "tcm_herb",
  "topical",
  "supplement",
  "other",
];

/** 兼容主诊断：西医优先，否则中医，否则拼接 */
export function composeDiagnosisSummary(
  western?: string | null,
  tcm?: string | null,
  fallback?: string | null,
): string | null {
  const w = (western || "").trim();
  const t = (tcm || "").trim();
  if (w && t && w !== t) return `${w}；${t}`;
  if (w) return w;
  if (t) return t;
  const f = (fallback || "").trim();
  return f || null;
}

export function normalizeMedicineSystem(v: unknown): MedicineSystem {
  const s = String(v || "").toLowerCase();
  if (s === "western" || s === "west" || s === "西医") return "western";
  if (s === "tcm" || s === "chinese" || s === "中医") return "tcm";
  if (s === "integrated" || s === "both" || s === "中西医" || s === "中西医结合") return "integrated";
  return "unknown";
}

export function isValidDateOnly(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function normalizeDateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
  if (!m) {
    const iso = String(s).trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return iso ? iso[1] : null;
  }
  const y = m[1];
  const mo = m[2].padStart(2, "0");
  const d = m[3].padStart(2, "0");
  return `${y}-${mo}-${d}`;
}
