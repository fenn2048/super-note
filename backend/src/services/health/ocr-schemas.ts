import {
  normalizeDateOnly,
  normalizeMedicineSystem,
  type HealthLabItem,
  type HealthOcrStructured,
  type MedicineSystem,
} from "./types.js";

/** 从模型输出中提取 JSON 对象 */
export function extractJsonObject(text: string): any | null {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fallthrough */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fallthrough */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function clamp01(n: any): number {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0.5;
  return Math.max(0, Math.min(1, x));
}

function str(v: any, max = 4000): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

export function parseCostToMinor(v: any): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.round(v * 100);
  }
  const s = String(v).replace(/[,，\s]/g, "").replace(/元|￥|¥/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function inferMedicineSystem(
  documentHint: string | undefined,
  documentType: string,
  textBlob: string,
  explicit?: string,
): MedicineSystem {
  if (explicit) return normalizeMedicineSystem(explicit);
  const hint = (documentHint || documentType || "").toLowerCase();
  if (hint.includes("prescription_tcm") || hint === "tcm") return "tcm";
  if (hint.includes("prescription_western") || hint === "western") return "western";
  if (hint.includes("exam_lab") || hint.includes("invoice")) return "western";

  const tcm =
    /配方颗粒|水煎|共\s*\d+\s*剂|付\)|中医|证候|证型|饮片|汤剂|冲服|辨证|君臣/.test(
      textBlob,
    );
  const west =
    /\bmg\b|毫克|胶囊|片剂|静滴|血常规|西医|每日三次|一日\s*\d/i.test(textBlob);
  if (tcm && west) return "integrated";
  if (tcm) return "tcm";
  if (west) return "western";
  if (hint.includes("prescription")) return "unknown";
  return "unknown";
}

export function normalizeOcrStructured(
  raw: any,
  documentHint?: string,
): HealthOcrStructured {
  const src = raw && typeof raw === "object" ? raw : {};
  const documentType =
    str(src.documentType, 40) ||
    str(src.type, 40) ||
    documentHint ||
    "auto";

  const fieldsConfidence: Record<string, number> = {};
  if (src.fieldsConfidence && typeof src.fieldsConfidence === "object") {
    for (const [k, v] of Object.entries(src.fieldsConfidence)) {
      fieldsConfidence[k] = clamp01(v);
    }
  }

  const stagesIn = Array.isArray(src.stages) ? src.stages : [];
  const stages = stagesIn
    .map((s: any) => {
      const symptoms = str(s?.symptoms || s?.symptom || s?.description, 2000);
      if (!symptoms) return null;
      return {
        stageDate: normalizeDateOnly(s?.stageDate || s?.date) || undefined,
        label: str(s?.label || s?.title, 80),
        symptoms,
        notes: str(s?.notes, 1000),
      };
    })
    .filter(Boolean) as HealthOcrStructured["stages"];

  const warnings: string[] = [];
  if (Array.isArray(src.warnings)) {
    for (const w of src.warnings) {
      const t = str(w, 200);
      if (t) warnings.push(t);
    }
  }

  const occurredAt =
    normalizeDateOnly(src.occurredAt || src.date || src.visitDate || src.issueDate) ||
    undefined;

  const costMinor =
    src.costMinor != null &&
    Number.isFinite(Number(src.costMinor)) &&
    Number(src.costMinor) > 1000
      ? Math.round(Number(src.costMinor))
      : parseCostToMinor(src.costMinor ?? src.amount ?? src.totalAmount ?? src.cost);

  const diagnosisWestern = str(
    src.diagnosisWestern || src.westernDiagnosis || src.icdDiagnosis,
    2000,
  );
  const diagnosisTcm = str(
    src.diagnosisTcm ||
      src.tcmDiagnosis ||
      src.syndrome ||
      src.pattern ||
      src.zhenghou,
    2000,
  );
  const diagnosisLegacy = str(
    src.diagnosis || src.impression || src.conclusion || src.diagnosisName,
    2000,
  );

  const isExam =
    (documentType || "").toLowerCase().includes("exam") ||
    (documentHint || "").toLowerCase().includes("exam_lab");

  // 处方：检查单绝不占用 prescription
  let prescription = str(
    src.prescription || src.rx || src.medications || src.herbalFormula,
    4000,
  );
  let examFindings = str(
    src.examFindings ||
      src.findings ||
      src.impression ||
      src.labSummary ||
      src.reportConclusion,
    4000,
  );

  // 化验项目列表
  const labsRaw = Array.isArray(src.labs)
    ? src.labs
    : Array.isArray(src.items)
      ? src.items
      : Array.isArray(src.indicators)
        ? src.indicators
        : [];
  const labs: HealthLabItem[] = labsRaw
    .map((it: any) => {
      const name = str(it?.name || it?.item || it?.test || it?.project, 120);
      if (!name) return null;
      return {
        name,
        value: str(it?.value || it?.result || it?.val, 80),
        unit: str(it?.unit, 40),
        refRange: str(it?.refRange || it?.reference || it?.ref || it?.range, 80),
        flag: str(it?.flag || it?.abnormal || it?.hint, 40),
      } as HealthLabItem;
    })
    .filter(Boolean) as HealthLabItem[];

  if (isExam) {
    // 若模型仍把指标塞进 prescription，挪到 examFindings
    if (!examFindings && prescription) {
      examFindings = prescription;
    }
    if (!examFindings && labs.length) {
      examFindings = labs
        .map((l) => {
          const flag = l.flag ? ` [${l.flag}]` : "";
          return `${l.name}: ${l.value || ""}${l.unit || ""}${flag}`;
        })
        .join("；");
    }
    prescription = undefined;
  }

  const blob = [
    diagnosisWestern,
    diagnosisTcm,
    diagnosisLegacy,
    prescription,
    examFindings,
    str(src.title, 200),
  ]
    .filter(Boolean)
    .join("\n");

  const medicineSystem = inferMedicineSystem(
    documentHint,
    documentType || "",
    blob,
    src.medicineSystem || src.system || src.medicine_type,
  );

  // 按体系把 legacy diagnosis 归到对应侧
  let dw = diagnosisWestern;
  let dt = diagnosisTcm;
  if (diagnosisLegacy) {
    if (!dw && !dt) {
      if (medicineSystem === "tcm") dt = diagnosisLegacy;
      else if (medicineSystem === "western") dw = diagnosisLegacy;
      else dw = diagnosisLegacy;
    } else if (!dw && medicineSystem !== "tcm") {
      dw = diagnosisLegacy;
    } else if (!dt && medicineSystem === "tcm") {
      dt = diagnosisLegacy;
    }
  }

  // 检查单：结论优先放 examFindings，diagnosisWestern 可放简短项目名
  if (isExam && !dw && examFindings) {
    // 不把长指标列表当诊断
    if ((examFindings?.length || 0) < 80) dw = examFindings;
  }

  const diagnosis =
    [dw, dt].filter(Boolean).join("；") ||
    (isExam ? undefined : diagnosisLegacy) ||
    undefined;

  const result: HealthOcrStructured = {
    documentType: isExam ? "exam_lab" : documentType || "auto",
    confidence: clamp01(src.confidence ?? 0.7),
    medicineSystem: isExam ? medicineSystem || "western" : medicineSystem,
    title: str(
      src.title ||
        src.diagnosisName ||
        src.disease ||
        (isExam ? "检查化验" : undefined) ||
        dt ||
        dw,
      200,
    ),
    occurredAt,
    hospital: str(src.hospital || src.hospitalName || src.clinic, 200),
    department: str(src.department || src.dept, 100),
    doctor: str(src.doctor || src.doctorName || src.physician, 80),
    diagnosis,
    diagnosisWestern: dw,
    diagnosisTcm: dt,
    prescription,
    examFindings,
    labs: labs.length ? labs : undefined,
    advice: str(src.advice || src.suggestion || src.doctorAdvice, 2000),
    costMinor,
    stages: stages?.length ? stages : undefined,
    fieldsConfidence: Object.keys(fieldsConfidence).length
      ? fieldsConfidence
      : undefined,
    warnings: warnings.length ? warnings : undefined,
  };

  if (result.fieldsConfidence) {
    for (const [k, c] of Object.entries(result.fieldsConfidence)) {
      if (c < 0.55) {
        warnings.push(`字段「${k}」置信度较低（${Math.round(c * 100)}%），请人工核对`);
      }
    }
  }
  if (!result.occurredAt) warnings.push("未能可靠识别就诊日期，请手动填写");
  if (warnings.length)
    result.warnings = [...new Set([...(result.warnings || []), ...warnings])];

  return result;
}

export function buildOcrSystemPrompt(documentHint?: string): string {
  const hint = documentHint || "auto";
  const typeHint =
    hint !== "auto"
      ? `文档类型提示：${hint}
（medical_record=病历, invoice=发票, exam_lab=检查化验,
prescription=通用处方, prescription_tcm=中药方笺/颗粒方, prescription_western=西药处方）`
      : "请自动判断文档类型与医疗体系（西医/中医/中西医结合）";

  let specialty = "";
  if (hint === "prescription_tcm" || hint === "prescription") {
    specialty = `
中药方笺规则：
- medicineSystem 填 "tcm"（若明显中西药混方则 "integrated"）
- diagnosisTcm：中医病名/证候（如「小儿咳嗽病（痰热壅肺证）」）
- diagnosisWestern：仅当单据同时写了西医诊断时填写
- prescription：完整药味列表（药名+克数），保留原顺序；写明剂数/付数、煎法、服法
- title 可用证候简称
`;
  }
  if (hint === "prescription_western") {
    specialty = `
西药处方规则：
- medicineSystem 填 "western"
- diagnosisWestern：西医诊断
- diagnosisTcm：一般 null
- prescription：药品名、规格、用法用量、天数
`;
  }
  if (hint === "exam_lab") {
    specialty = `
化验/检查/影像报告规则（重要）：
- documentType 填 "exam_lab"；medicineSystem 倾向 "western"
- examFindings：检查结论、影像所见、总评（专用字段）
- labs：数组，每项 { name, value, unit, refRange, flag }，flag 可为 高/低/↑/↓/正常
- title：如「血常规」「胸片」「肝功」
- diagnosisWestern：仅当报告写了临床诊断时填写；否则可填检查项目简称
- prescription 必须为 null（禁止把化验指标写入处方字段）
- 多页报告时综合所有可见项目，异常项优先列入 labs
`;
  }

  return `你是中文医疗票据/病历结构化抽取助手。家庭用户会同时看中医与西医。
根据图片或文本提取字段，只输出一个 JSON 对象，不要 Markdown 说明。
${typeHint}
${specialty}

JSON 字段（未知填 null，不要编造）：
{
  "documentType": "medical_record|invoice|exam_lab|prescription|prescription_tcm|prescription_western|other",
  "medicineSystem": "western|tcm|integrated|unknown",
  "confidence": 0.0-1.0,
  "title": "短标题",
  "occurredAt": "YYYY-MM-DD",
  "hospital": "医院或诊所",
  "department": "科室",
  "doctor": "医生姓名",
  "diagnosis": "诊断摘要（可拼接）",
  "diagnosisWestern": "西医诊断",
  "diagnosisTcm": "中医病名或证候",
  "prescription": "处方/用药全文（检查单必须 null）",
  "examFindings": "检查结论/影像所见/总评（检查单专用）",
  "labs": [{"name":"项目","value":"数值","unit":"单位","refRange":"参考范围","flag":"高|低|正常"}],
  "advice": "医嘱或建议",
  "amount": "金额元",
  "stages": [{"stageDate":"YYYY-MM-DD","label":"阶段","symptoms":"症状"}],
  "fieldsConfidence": {"diagnosisTcm":0.9,"doctor":0.8},
  "warnings": []
}

规则：
- 中医证候与西医诊断分字段存放，不要互相覆盖
- 检查/化验结果只用 examFindings + labs，禁止占用 prescription
- 日期 YYYY-MM-DD；金额用人民币元
- 禁止输出诊断性医疗建议，只做文字抽取
- 模糊字段 fieldsConfidence 给低分`;
}

/** 合并多份病历 OCR 结构化结果（多图报告） */
export function mergeHealthOcrStructured(
  parts: HealthOcrStructured[],
  documentHint?: string,
): HealthOcrStructured {
  if (!parts.length) {
    return {
      documentType: documentHint || "auto",
      confidence: 0,
      warnings: ["无识别结果"],
    };
  }
  if (parts.length === 1) return parts[0];

  const pickStr = (key: keyof HealthOcrStructured): string | undefined => {
    let best: string | undefined;
    for (const p of parts) {
      const v = p[key];
      if (typeof v === "string" && v.trim()) {
        if (!best || v.length > best.length) best = v;
      }
    }
    return best;
  };

  const labsMap = new Map<string, HealthLabItem>();
  for (const p of parts) {
    for (const lab of p.labs || []) {
      const k = (lab.name || "").trim();
      if (!k) continue;
      const prev = labsMap.get(k);
      labsMap.set(k, prev ? { ...prev, ...lab } : lab);
    }
  }
  const labs = [...labsMap.values()];

  const findings = parts
    .map((p) => p.examFindings)
    .filter(Boolean)
    .map(String);
  const examFindings =
    findings.length > 0
      ? [...new Set(findings)].join("\n")
      : undefined;

  const warnings = new Set<string>();
  for (const p of parts) {
    for (const w of p.warnings || []) warnings.add(w);
  }
  warnings.add(`已合并 ${parts.length} 张报告图片的识别结果，请核对。`);

  const confs = parts.map((p) => p.confidence).filter((c) => Number.isFinite(c));
  const isExam =
    (documentHint || "").includes("exam") ||
    parts.some((p) => (p.documentType || "").includes("exam"));

  const base: HealthOcrStructured = {
    documentType: isExam
      ? "exam_lab"
      : pickStr("documentType") || documentHint || "auto",
    confidence: confs.length
      ? confs.reduce((a, b) => a + b, 0) / confs.length
      : 0.6,
    medicineSystem: (pickStr("medicineSystem") as any) || parts[0].medicineSystem,
    title: pickStr("title"),
    occurredAt: pickStr("occurredAt"),
    hospital: pickStr("hospital"),
    department: pickStr("department"),
    doctor: pickStr("doctor"),
    diagnosis: pickStr("diagnosis"),
    diagnosisWestern: pickStr("diagnosisWestern"),
    diagnosisTcm: pickStr("diagnosisTcm"),
    prescription: isExam ? undefined : pickStr("prescription"),
    examFindings,
    labs: labs.length ? labs : undefined,
    advice: pickStr("advice"),
    costMinor: parts.map((p) => p.costMinor).find((c) => c != null),
    warnings: [...warnings],
  };
  return normalizeOcrStructured(base, documentHint || base.documentType);
}

/** 药盒 / 说明书 OCR */
export function buildMedicineOcrPrompt(): string {
  return `你是中文药品包装/说明书信息抽取助手。只输出一个 JSON 对象，不要 Markdown。
从药盒或说明书提取家庭药箱登记字段。未知填 null，不要编造。

{
  "name": "通用名或商品名",
  "brand": "品牌或厂家",
  "category": "western|tcm_patent|tcm_herb|topical|supplement|other",
  "spec": "规格，如 0.5g×24片/盒",
  "usageText": "用法用量原文摘要",
  "efficacy": "功能主治/适应症摘要",
  "form": "剂型：片剂/胶囊/颗粒/口服液/软膏…",
  "unit": "常用计数单位：片/粒/袋/ml/瓶",
  "quantityRemain": null,
  "expiryDate": "YYYY-MM-DD 有效期至",
  "medicineSystem": "western|tcm|unknown",
  "suggestedTags": ["退烧","儿童"],
  "confidence": 0.0-1.0,
  "fieldsConfidence": {"name":0.9,"expiryDate":0.7},
  "warnings": []
}

规则：
- name 优先通用名；商品名可放 brand 或 name 括号
- 中成药 category=tcm_patent；中药饮片/颗粒 tcm_herb；外用 topical
- expiryDate 只取「有效期至」类日期，生产日期不要当过期日
- suggestedTags 给 0～4 个短标签（适应症或人群）
- 禁止给出用药医嘱建议，只做包装文字抽取`;
}

export function normalizeMedicineOcrStructured(raw: any): import("./types.js").MedicineOcrStructured {
  const src = raw && typeof raw === "object" ? raw : {};
  const warnings: string[] = [];
  if (Array.isArray(src.warnings)) {
    for (const w of src.warnings) {
      const t = str(w, 200);
      if (t) warnings.push(t);
    }
  }
  const fieldsConfidence: Record<string, number> = {};
  if (src.fieldsConfidence && typeof src.fieldsConfidence === "object") {
    for (const [k, v] of Object.entries(src.fieldsConfidence)) {
      fieldsConfidence[k] = clamp01(v);
    }
  }
  const suggestedTags = Array.isArray(src.suggestedTags)
    ? src.suggestedTags.map((t: any) => String(t).trim()).filter(Boolean).slice(0, 8)
    : undefined;

  let quantityRemain: number | undefined;
  if (src.quantityRemain != null && src.quantityRemain !== "") {
    const n = Number(src.quantityRemain);
    if (Number.isFinite(n)) quantityRemain = n;
  }

  const name = str(src.name || src.drugName || src.productName, 200);
  if (!name) warnings.push("未能识别药品名称，请手动填写");

  const expiryDate =
    normalizeDateOnly(src.expiryDate || src.expireDate || src.validUntil) || undefined;

  return {
    name,
    brand: str(src.brand || src.manufacturer || src.factory, 120),
    category: str(src.category, 40) || "western",
    spec: str(src.spec || src.specification, 200),
    usageText: str(src.usageText || src.usage || src.dosage, 2000),
    efficacy: str(src.efficacy || src.indication || src.functions, 2000),
    form: str(src.form || src.dosageForm, 80),
    unit: str(src.unit, 20),
    quantityRemain,
    expiryDate,
    medicineSystem: normalizeMedicineSystem(
      src.medicineSystem || (String(src.category || "").includes("tcm") ? "tcm" : "western"),
    ),
    suggestedTags,
    confidence: clamp01(src.confidence ?? 0.7),
    fieldsConfidence: Object.keys(fieldsConfidence).length ? fieldsConfidence : undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}
