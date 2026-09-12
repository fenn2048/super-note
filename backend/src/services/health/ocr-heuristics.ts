/**
 * 从 PaddleOCR 全文做轻量字段抽取（无 LLM）
 * 目标：秒级可用 + 人工核对，不追求 VL 级结构化精度
 */
import { normalizeDateOnly, type HealthOcrStructured, type MedicineOcrStructured } from "./types.js";
import { normalizeMedicineOcrStructured, normalizeOcrStructured } from "./ocr-schemas.js";

function firstLine(text: string): string {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) || "";
}

function extractDate(text: string): string | undefined {
  const patterns = [
    /(\d{4})[年./\-](\d{1,2})[月./\-](\d{1,2})日?/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const y = m[1];
    const mo = m[2].padStart(2, "0");
    const d = m[3].padStart(2, "0");
    const iso = normalizeDateOnly(`${y}-${mo}-${d}`);
    if (iso) return iso;
  }
  return undefined;
}

function extractNearKeyword(text: string, keywords: string[], maxLen = 40): string | undefined {
  for (const kw of keywords) {
    // 仅同行：分隔符不含换行，避免「中医院\n开方日期」误抽
    // 允许规格中的 × x / 等符号
    const re = new RegExp(
      `${kw}[：: \\t]*([^\\n\\r，,]{2,${maxLen}})`,
    );
    const m = text.match(re);
    if (m?.[1]) {
      const v = m[1].replace(/[，,。；;].*$/, "").trim();
      if (v.length >= 2) return v.slice(0, maxLen);
    }
  }
  return undefined;
}

function isExamHint(hint?: string): boolean {
  const h = (hint || "").toLowerCase();
  return h.includes("exam") || h.includes("lab") || h.includes("检查") || h.includes("化验");
}

function isPrescriptionHint(hint?: string): boolean {
  const h = (hint || "").toLowerCase();
  return h.includes("prescription") || h.includes("处方") || h.includes("药");
}

/**
 * 病历 / 票据全文 → HealthOcrStructured
 */
export function structureHealthFromOcrText(
  rawText: string,
  documentHint?: string,
  opts?: { avgScore?: number; engineLabel?: string },
): HealthOcrStructured {
  const text = (rawText || "").trim().slice(0, 20000);
  const hint = documentHint || "auto";
  const fl = firstLine(text);

  let hospital =
    extractNearKeyword(text, ["医院名称", "就诊医院", "医院", "诊所", "卫生院"]) ||
    undefined;
  if (!hospital) {
    const hospLine = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => /医院|诊所|卫生院|卫生服务中心/.test(l) && l.length <= 40);
    if (hospLine) hospital = hospLine.slice(0, 40);
  }
  const department = extractNearKeyword(text, ["科室", "就诊科室", "科别"], 20);
  const doctor = extractNearKeyword(text, ["医师", "医生", "开方医生", "主治"], 16);
  const occurredAt = extractDate(text);

  let title = fl.slice(0, 40);
  if (hint === "prescription_tcm") title = title || "中药处方";
  else if (hint === "prescription_western") title = title || "西药处方";
  else if (isExamHint(hint)) title = title || "检查化验";
  else if (hint && hint !== "auto") title = title || hint;

  const base: Record<string, unknown> = {
    documentType: hint !== "auto" ? hint : "medical_record",
    confidence: opts?.avgScore != null ? Math.min(0.92, Math.max(0.4, opts.avgScore)) : 0.7,
    title: title || "OCR 识别",
    occurredAt: occurredAt || null,
    hospital: hospital || null,
    department: department || null,
    doctor: doctor || null,
    diagnosis: null,
    diagnosisWestern: null,
    diagnosisTcm: null,
    prescription: null,
    examFindings: null,
    labs: [],
    advice: null,
    warnings: [
      `由 ${opts?.engineLabel || "PaddleOCR"} 提取全文，字段为规则抽取，请人工核对后再保存。`,
    ],
  };

  if (isExamHint(hint)) {
    base.documentType = "exam_lab";
    base.examFindings = text;
    base.prescription = null;
  } else if (isPrescriptionHint(hint) || /处方|Rp|RP|用药|剂数|共\s*\d+\s*剂/.test(text)) {
    base.documentType =
      hint === "prescription_tcm" || /配方颗粒|水煎|中药/.test(text)
        ? hint === "prescription_western"
          ? "prescription_western"
          : "prescription_tcm"
        : hint.startsWith("prescription")
          ? hint
          : "prescription";
    base.prescription = text;
    // 简单诊断行
    const diag = extractNearKeyword(text, ["诊断", "中医诊断", "西医诊断", "证候"], 80);
    if (diag) {
      if (/中医|证候|证型/.test(text)) base.diagnosisTcm = diag;
      else base.diagnosisWestern = diag;
      base.diagnosis = diag;
    }
  } else {
    base.diagnosis = text.slice(0, 2000);
    // 全文也放 notes 区：用 prescription 暂存长文不合适；用 diagnosis 摘要 + examFindings 全文
    if (text.length > 80) {
      base.examFindings = text;
    }
  }

  return normalizeOcrStructured(base, hint);
}

/**
 * 药盒全文 → MedicineOcrStructured
 */
export function structureMedicineFromOcrText(
  rawText: string,
  opts?: { avgScore?: number },
): MedicineOcrStructured {
  const text = (rawText || "").trim().slice(0, 15000);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // 药名：优先「通用名称」「药品名称」；否则取较短的前几行候选
  let name =
    extractNearKeyword(text, ["通用名称", "药品名称", "商品名称", "品名"], 40) || undefined;
  if (!name) {
    name = lines.find((l) => l.length >= 2 && l.length <= 30 && !/说明书|批准|国药准字|OTC/.test(l));
  }

  const brand = extractNearKeyword(text, ["生产企业", "生产厂家", "厂家", "持有人", "品牌"], 40);
  const spec = extractNearKeyword(
    text,
    ["规格", "包装规格"],
    40,
  );
  const usageText =
    extractNearKeyword(text, ["用法用量", "用法", "用量", "服用方法"], 200) ||
    undefined;
  const efficacy =
    extractNearKeyword(text, ["功能主治", "适应症", "主治", "功效"], 300) || undefined;
  const form = extractNearKeyword(text, ["剂型"], 20);

  // 有效期至
  let expiryDate: string | undefined;
  const expM =
    text.match(/有效期至[：:\s]*(\d{4})[年./\-](\d{1,2})[月./\-](\d{1,2})/) ||
    text.match(/有效期至[：:\s]*(\d{4}-\d{2}-\d{2})/) ||
    text.match(/至\s*(\d{4})[年./\-](\d{1,2})[月./\-](\d{1,2})日?/);
  if (expM) {
    if (expM[0].includes("-") && expM.length === 2) {
      expiryDate = normalizeDateOnly(expM[1]) || undefined;
    } else {
      const y = expM[1];
      const mo = String(expM[2]).padStart(2, "0");
      const d = String(expM[3]).padStart(2, "0");
      expiryDate = normalizeDateOnly(`${y}-${mo}-${d}`) || undefined;
    }
  }

  const category = /颗粒|饮片|中成药|丸剂|膏方/.test(text)
    ? /饮片|配方颗粒/.test(text)
      ? "tcm_herb"
      : "tcm_patent"
    : /软膏|乳膏|外用|喷雾/.test(text)
      ? "topical"
      : "western";

  return normalizeMedicineOcrStructured({
    name: name || null,
    brand: brand || null,
    category,
    spec: spec || null,
    usageText: usageText || null,
    efficacy: efficacy || null,
    form: form || null,
    expiryDate: expiryDate || null,
    medicineSystem: category.startsWith("tcm") ? "tcm" : "western",
    confidence: opts?.avgScore != null ? Math.min(0.9, Math.max(0.4, opts.avgScore)) : 0.7,
    warnings: ["由 PaddleOCR 提取，药名字段请重点核对。"],
  });
}
