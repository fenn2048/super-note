/**
 * 健康档案 OCR
 * ---------------------------------------------------------------------------
 * 1) 优先：Vision 多模态模型（image_url）直接结构化
 * 2) 回退：当前模型不支持图片时 → 本地 Tesseract 提字 → 文本 LLM 结构化
 * 3) 智谱 GLM 等纯文本模型（如 glm-4.7-flash）走回退路径
 */
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { getAttachmentsDir } from "../../routes/attachments.js";
import type {
  HealthAttachmentRow,
  HealthOcrStructured,
  MedicineOcrStructured,
} from "./types.js";
import {
  buildMedicineOcrPrompt,
  buildOcrSystemPrompt,
  extractJsonObject,
  mergeHealthOcrStructured,
  normalizeMedicineOcrStructured,
  normalizeOcrStructured,
} from "./ocr-schemas.js";

export interface AiConfig {
  ai_provider: string;
  ai_api_url: string;
  ai_api_key: string;
  ai_model: string;
}

export function loadAiConfig(db: Database.Database): AiConfig | null {
  const settings = db
    .prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('ai_provider','ai_api_url','ai_api_key','ai_model')`,
    )
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value || "";
  if (!map.ai_api_url || !map.ai_model) return null;
  return {
    ai_provider: map.ai_provider || "",
    ai_api_url: map.ai_api_url,
    ai_api_key: map.ai_api_key || "",
    ai_model: map.ai_model,
  };
}

function mimeToDataUrl(mime: string, buf: Buffer): string {
  const b64 = buf.toString("base64");
  return `data:${mime || "application/octet-stream"};base64,${b64}`;
}

const MAX_OCR_BYTES = 12 * 1024 * 1024;

/** 常见纯文本模型：跳过 vision，直接本地 OCR + 文本结构化 */
function looksLikeTextOnlyModel(model: string): boolean {
  const m = (model || "").toLowerCase();
  if (!m) return false;
  // 明确含 vision / 4v / vl 的视为多模态
  if (/(4v|vision|vl-|vl_|-vl|omni|gpt-4o|gpt-4\.1|gemini.*flash|gemini.*pro|qwen.*vl|qwen2\.5-vl)/i.test(m)) {
    return false;
  }
  // 常见纯文本
  if (/flash|turbo|plus|air|lite|mini|haiku|sonnet|opus|deepseek|glm-4(?!v)|glm-3|qwen2\.5(?!-vl)|qwen-max|qwen-plus|qwen-turbo/i.test(m)) {
    // glm-4.7-flash 等
    if (/glm-4v|glm-4\.?\d*v|gpt-4o|claude-3|claude-4/i.test(m)) return false;
    if (/glm-4v|4v-|vl/i.test(m)) return false;
    // flash without vision markers often text-only on Zhipu
    if (/glm-.*flash|glm-4\.\d+-flash|glm-4-flash/i.test(m)) return true;
    if (/deepseek|qwen-plus|qwen-turbo|qwen-max(?!-vl)/i.test(m)) return true;
  }
  return false;
}

function isVisionUnsupportedError(msg: string): boolean {
  const s = (msg || "").toLowerCase();
  return (
    s.includes("content.type") ||
    s.includes("参数非法") ||
    s.includes("取值范围") ||
    s.includes("image_url") ||
    s.includes("does not support") ||
    s.includes("not support") ||
    s.includes("unsupported") ||
    s.includes("invalid content") ||
    s.includes("multimodal") ||
    s.includes("vision") ||
    s.includes("only text") ||
    s.includes("only support text") ||
    /code["\s:]*1210/.test(s)
  );
}

/**
 * 智谱等厂商：当前模型不支持图时，尝试同账号下常见 vision 模型名
 * （失败则忽略，走 Tesseract 回退）
 */
function candidateVisionModels(cfg: AiConfig): string[] {
  const current = cfg.ai_model;
  const provider = (cfg.ai_provider || "").toLowerCase();
  const url = (cfg.ai_api_url || "").toLowerCase();
  const isZhipu =
    provider === "glm" ||
    provider === "zhipu" ||
    url.includes("bigmodel.cn") ||
    url.includes("zhipuai");

  const list: string[] = [];
  if (!looksLikeTextOnlyModel(current)) {
    list.push(current);
  }
  if (isZhipu) {
    for (const m of ["glm-4.6v", "glm-4v-flash", "glm-4v-plus", "glm-4v"]) {
      if (m !== current && !list.includes(m)) list.push(m);
    }
  }
  // 总是把当前模型放最后再试一次（若前面因 text-only 跳过）
  if (!list.includes(current)) list.push(current);
  return list;
}

async function callChatCompletions(
  cfg: AiConfig,
  opts: {
    model?: string;
    system: string;
    userContent: any; // string | content parts array
    temperature?: number;
  },
): Promise<{ text: string; model: string }> {
  const model = opts.model || cfg.ai_model;
  const url = cfg.ai_api_url.replace(/\/+$/, "");
  const endpoint = url.endsWith("/chat/completions") ? url : `${url}/chat/completions`;

  const body = {
    model,
    temperature: opts.temperature ?? 0.15,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.userContent },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.ai_api_key ? { Authorization: `Bearer ${cfg.ai_api_key}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI 调用失败 (${res.status}): ${t.slice(0, 400)}`);
  }
  const raw = (await res.json()) as any;
  // 兼容部分模型 content 为数组
  let text = raw?.choices?.[0]?.message?.content || "";
  if (Array.isArray(text)) {
    text = text
      .map((p: any) => (typeof p === "string" ? p : p?.text || ""))
      .join("\n");
  }
  if (!String(text).trim()) throw new Error("AI 返回空内容");
  return { text: String(text), model };
}

/** 预处理图片提升本地 OCR 效果（中文处方常有噪点/倾斜） */
async function preprocessImageForOcr(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf)
      .rotate() // EXIF
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: false })
      .grayscale()
      .normalize()
      .sharpen()
      .png()
      .toBuffer();
  } catch {
    return buf;
  }
}

/** 本地 Tesseract 提字（chi_sim+eng） */
async function runLocalImageOcr(buf: Buffer): Promise<string> {
  const processed = await preprocessImageForOcr(buf);
  // 动态加载，避免未安装时拖垮启动
  const Tesseract = (await import("tesseract.js")).default;
  const result = await Tesseract.recognize(processed, "chi_sim+eng", {
    logger: () => {
      /* quiet */
    },
  });
  const text = (result?.data?.text || "").trim();
  if (!text || text.length < 4) {
    throw new Error("本地 OCR 未能识别出有效文字，请换更清晰的图片或配置多模态 Vision 模型");
  }
  return text.slice(0, 20000);
}

async function structureFromText(
  cfg: AiConfig,
  rawText: string,
  documentHint?: string,
  sourceNote?: string,
): Promise<{ rawText: string; structured: HealthOcrStructured; model: string }> {
  const system = buildOcrSystemPrompt(documentHint);
  const userText =
    `${sourceNote || "以下是从医疗单据中提取的文字，请结构化为 JSON（不要编造看不到的信息）："}\n\n` +
    rawText;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text, model } = await callChatCompletions(cfg, {
        system,
        userContent:
          attempt === 0
            ? userText
            : userText + "\n\n请只输出合法 JSON 对象，不要其它文字。",
        temperature: 0.1,
      });
      const parsed = extractJsonObject(text);
      if (!parsed) {
        lastErr = new Error("模型未返回可解析 JSON");
        continue;
      }
      const structured = normalizeOcrStructured(parsed, documentHint);
      // 回退路径置信度略降
      if (sourceNote?.includes("本地 OCR")) {
        structured.confidence = Math.min(structured.confidence, 0.72);
        structured.warnings = [
          ...(structured.warnings || []),
          "当前 AI 模型不支持直接识图，已使用本地 OCR + 文本模型结构化；处方类建议改用多模态模型（如智谱 glm-4v-flash / glm-4.6v）以提高准确率。",
        ];
      }
      return { rawText: text, structured, model: `${model}+local-ocr` };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("结构化失败");
}

async function tryVisionStructure(
  cfg: AiConfig,
  imageDataUrl: string,
  documentHint?: string,
): Promise<{ rawText: string; structured: HealthOcrStructured; model: string }> {
  const system = buildOcrSystemPrompt(documentHint);
  const userText = "请从附件图片中抽取医疗相关字段，严格输出 JSON。";
  const models = candidateVisionModels(cfg);
  let lastErr: Error | null = null;

  for (const model of models) {
    // 纯文本模型跳过 vision 尝试（避免必然 400）
    if (looksLikeTextOnlyModel(model) && model === cfg.ai_model && models.length > 1) {
      continue;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { text, model: used } = await callChatCompletions(cfg, {
          model,
          system,
          userContent: [
            {
              type: "text",
              text:
                attempt === 0
                  ? userText
                  : userText + "\n请只输出合法 JSON 对象，不要其它文字。",
            },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        });
        const parsed = extractJsonObject(text);
        if (!parsed) {
          lastErr = new Error("模型未返回可解析 JSON");
          continue;
        }
        const structured = normalizeOcrStructured(parsed, documentHint);
        return { rawText: text, structured, model: used };
      } catch (e: any) {
        const err = e instanceof Error ? e : new Error(String(e));
        lastErr = err;
        if (isVisionUnsupportedError(err.message)) {
          // 换下一个候选模型
          break;
        }
        // 其它错误也尝试重试一次
      }
    }
  }
  throw lastErr || new Error("Vision OCR 失败");
}

export async function runHealthOcr(
  db: Database.Database,
  attachment: HealthAttachmentRow,
  documentHint?: string,
): Promise<{
  rawText: string;
  structured: HealthOcrStructured;
  model: string;
}> {
  const cfg = loadAiConfig(db);
  if (!cfg) {
    throw new Error("未配置 AI 服务。请在设置中配置 AI 模型后再试。");
  }

  const absPath = path.join(getAttachmentsDir(), attachment.path);
  if (!fs.existsSync(absPath)) {
    throw new Error("附件文件丢失");
  }
  const buf = fs.readFileSync(absPath);
  if (buf.length > MAX_OCR_BYTES) {
    throw new Error("附件过大（>12MB），请压缩后再识别");
  }

  const mime = (attachment.mimeType || "").toLowerCase();
  const isImage = mime.startsWith("image/");
  const isPdf = mime === "application/pdf";

  // ── 图片：Vision 优先，失败则本地 OCR + 文本 LLM ──
  if (isImage) {
    // 压缩过长边，控制 data URL 体积
    let visionBuf: Buffer = buf;
    try {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      visionBuf = Buffer.from(out);
    } catch {
      visionBuf = buf;
    }
    const imageDataUrl = mimeToDataUrl("image/jpeg", visionBuf);

    // 若当前模型几乎肯定不支持 vision，且无 zhipu 候选，直接本地 OCR
    const skipVision =
      looksLikeTextOnlyModel(cfg.ai_model) &&
      candidateVisionModels(cfg).every((m) => looksLikeTextOnlyModel(m) || m === cfg.ai_model) &&
      !["glm", "zhipu"].includes((cfg.ai_provider || "").toLowerCase()) &&
      !cfg.ai_api_url.includes("bigmodel.cn");

    if (!skipVision) {
      try {
        return await tryVisionStructure(cfg, imageDataUrl, documentHint);
      } catch (e: any) {
        const msg = e?.message || String(e);
        // 非 vision 不支持类错误：若完全失败再抛；vision 不支持则回退
        if (!isVisionUnsupportedError(msg) && !looksLikeTextOnlyModel(cfg.ai_model)) {
          // 网络/鉴权等：仍尝试本地 OCR 兜底
          console.warn("[health.ocr] vision failed, fallback to local OCR:", msg.slice(0, 200));
        } else {
          console.warn("[health.ocr] model has no vision, fallback to local OCR:", msg.slice(0, 200));
        }
      }
    }

    // 本地 OCR 回退
    const ocrText = await runLocalImageOcr(buf);
    return structureFromText(
      cfg,
      ocrText,
      documentHint,
      "以下文字由本地 OCR 从图片提取（当前配置的 AI 模型不支持直接识图）。请结构化为 JSON，不要编造原文中没有的信息：",
    );
  }

  // ── PDF：抽文本 → 结构化；失败提示转图 ──
  if (isPdf) {
    let pdfText = "";
    try {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const doc = await getDocumentProxy(new Uint8Array(buf));
      const result = (await extractText(doc, { mergePages: false })) as
        | { text: string[] | string }
        | string[]
        | string;
      let pages: string[];
      if (Array.isArray(result)) {
        pages = result.map(String);
      } else if (typeof result === "string") {
        pages = [result];
      } else if (result && typeof result === "object" && "text" in result) {
        const t = result.text;
        pages = Array.isArray(t) ? t.map(String) : [String(t)];
      } else {
        pages = [];
      }
      pdfText = pages.filter(Boolean).join("\n").trim().slice(0, 20000);
    } catch {
      pdfText = "";
    }
    if (pdfText.length > 40) {
      return structureFromText(cfg, pdfText, documentHint, "以下是从 PDF 提取的文本，请结构化为 JSON：");
    }
    throw new Error(
      "该 PDF 无可提取文本（可能是扫描件）。请将关键页导出为图片后上传识别。",
    );
  }

  if (mime.startsWith("text/") || mime === "application/json") {
    return structureFromText(
      cfg,
      buf.toString("utf8").slice(0, 20000),
      documentHint,
      "以下是文档文本，请结构化为 JSON：",
    );
  }

  throw new Error(`暂不支持该文件类型的 OCR: ${mime || "unknown"}`);
}

/**
 * 病历多图 OCR（检查报告多页等，最多 6 张）
 * 优先一次多图 Vision；失败则逐张识别再合并
 */
export async function runHealthOcrMulti(
  db: Database.Database,
  attachments: HealthAttachmentRow[],
  documentHint?: string,
): Promise<{
  rawText: string;
  structured: HealthOcrStructured;
  model: string;
  attachmentIds: string[];
}> {
  if (!attachments.length) throw new Error("请至少上传一张图片");
  const limited = attachments.slice(0, 6);
  const cfg = loadAiConfig(db);
  if (!cfg) {
    throw new Error("未配置 AI 服务。请在设置中配置 AI 模型后再试。");
  }

  const prepared: Array<{ id: string; dataUrl: string; buf: Buffer; mime: string }> = [];
  for (const att of limited) {
    const absPath = path.join(getAttachmentsDir(), att.path);
    if (!fs.existsSync(absPath)) throw new Error(`附件文件丢失: ${att.id}`);
    const buf = fs.readFileSync(absPath);
    if (buf.length > MAX_OCR_BYTES) {
      throw new Error("附件过大（>12MB）");
    }
    const mime = (att.mimeType || "").toLowerCase();
    if (!mime.startsWith("image/")) {
      // 非图片仍可单张走原逻辑
      if (limited.length === 1) {
        const one = await runHealthOcr(db, att, documentHint);
        return { ...one, attachmentIds: [att.id] };
      }
      throw new Error("多图 OCR 目前仅支持图片；PDF 请单独识别或导出为图片");
    }
    let visionBuf: Buffer = buf;
    try {
      const out = await sharp(buf)
        .rotate()
        .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      visionBuf = Buffer.from(out);
    } catch {
      visionBuf = buf;
    }
    prepared.push({
      id: att.id,
      dataUrl: mimeToDataUrl("image/jpeg", visionBuf),
      buf,
      mime,
    });
  }

  const system = buildOcrSystemPrompt(documentHint);
  const multiHint =
    prepared.length > 1
      ? `用户提供了同一份医疗单据的 ${prepared.length} 张照片（可能是报告多页、检查单正反面）。请综合所有图片抽取字段，互补缺漏；检查类请填 examFindings 与 labs，不要占用 prescription。`
      : "请从附件图片中抽取医疗相关字段，严格输出 JSON。";

  const models = candidateVisionModels(cfg);
  let lastErr: Error | null = null;

  for (const model of models) {
    if (looksLikeTextOnlyModel(model) && model === cfg.ai_model && models.length > 1) {
      continue;
    }
    try {
      const userContent: any[] = [{ type: "text", text: multiHint }];
      for (const p of prepared) {
        userContent.push({ type: "image_url", image_url: { url: p.dataUrl } });
      }
      const { text, model: used } = await callChatCompletions(cfg, {
        model,
        system,
        userContent,
      });
      const parsed = extractJsonObject(text);
      if (!parsed) {
        lastErr = new Error("模型未返回可解析 JSON");
        continue;
      }
      const structured = normalizeOcrStructured(parsed, documentHint);
      if (prepared.length > 1) {
        structured.warnings = [
          ...(structured.warnings || []),
          `已综合 ${prepared.length} 张图片识别，请核对检查项目与结论。`,
        ];
      }
      return {
        rawText: text,
        structured,
        model: used,
        attachmentIds: prepared.map((p) => p.id),
      };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn("[health.ocr] multi-vision fail:", lastErr.message.slice(0, 200));
    }
  }

  // 逐张回退再合并
  const partials: HealthOcrStructured[] = [];
  const rawParts: string[] = [];
  let usedModel = cfg.ai_model;

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    let done = false;
    for (const model of models) {
      if (looksLikeTextOnlyModel(model) && model === cfg.ai_model && models.length > 1) {
        continue;
      }
      try {
        const { text, model: used } = await callChatCompletions(cfg, {
          model,
          system,
          userContent: [
            {
              type: "text",
              text: `这是同一单据的第 ${i + 1}/${prepared.length} 张，请抽取可见字段为 JSON。`,
            },
            { type: "image_url", image_url: { url: p.dataUrl } },
          ],
        });
        const parsed = extractJsonObject(text);
        if (parsed) {
          partials.push(normalizeOcrStructured(parsed, documentHint));
          rawParts.push(`--- 图${i + 1} ---\n${text}`);
          usedModel = used;
          done = true;
          break;
        }
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (!done) {
      try {
        const ocrText = await runLocalImageOcr(p.buf);
        const r = await structureFromText(
          cfg,
          ocrText,
          documentHint,
          `第 ${i + 1}/${prepared.length} 张本地 OCR 文本，请结构化为 JSON：`,
        );
        partials.push(r.structured);
        rawParts.push(`--- 图${i + 1} local ---\n${r.rawText}`);
        usedModel = r.model;
        done = true;
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  if (!partials.length) throw lastErr || new Error("多图 OCR 均失败");

  return {
    rawText: rawParts.join("\n\n").slice(0, 100000),
    structured: mergeHealthOcrStructured(partials, documentHint),
    model: usedModel,
    attachmentIds: prepared.map((p) => p.id),
  };
}

export function persistOcrResult(
  db: Database.Database,
  attachmentId: string,
  result: { rawText: string; structured: HealthOcrStructured; model: string } | null,
  error?: string,
) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  if (error) {
    db.prepare(
      `UPDATE health_attachments SET
        ocrStatus = 'failed', ocrError = ?, ocrAt = ?
       WHERE id = ?`,
    ).run(error.slice(0, 500), now, attachmentId);
    return;
  }
  db.prepare(
    `UPDATE health_attachments SET
      ocrStatus = 'done',
      ocrRawText = ?,
      ocrStructuredJson = ?,
      ocrModel = ?,
      ocrError = NULL,
      ocrAt = ?
     WHERE id = ?`,
  ).run(
    result!.rawText.slice(0, 100000),
    JSON.stringify(result!.structured),
    result!.model,
    now,
    attachmentId,
  );
}

export function setOcrProcessing(db: Database.Database, attachmentId: string) {
  db.prepare(
    `UPDATE health_attachments SET ocrStatus = 'processing', ocrError = NULL WHERE id = ?`,
  ).run(attachmentId);
}

async function imageAttachmentToDataUrl(
  attachment: HealthAttachmentRow,
): Promise<{ dataUrl: string; buf: Buffer }> {
  const absPath = path.join(getAttachmentsDir(), attachment.path);
  if (!fs.existsSync(absPath)) throw new Error(`附件文件丢失: ${attachment.id}`);
  const buf = fs.readFileSync(absPath);
  if (buf.length > MAX_OCR_BYTES) {
    throw new Error("附件过大（>12MB），请压缩后再识别");
  }
  const mime = (attachment.mimeType || "").toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new Error("药盒 OCR 请上传图片（药盒/说明书照片）");
  }
  let visionBuf: Buffer = buf;
  try {
    const out = await sharp(buf)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    visionBuf = Buffer.from(out);
  } catch {
    visionBuf = buf;
  }
  return { dataUrl: mimeToDataUrl("image/jpeg", visionBuf), buf };
}

/** 多图识别结果合并：非空字段互补，长文本取更长者 */
export function mergeMedicineOcrResults(
  parts: MedicineOcrStructured[],
): MedicineOcrStructured {
  if (!parts.length) {
    return { confidence: 0, warnings: ["无识别结果"] };
  }
  if (parts.length === 1) return parts[0];

  const pick = (key: keyof MedicineOcrStructured): any => {
    let best: any = undefined;
    for (const p of parts) {
      const v = p[key];
      if (v == null || v === "") continue;
      if (typeof v === "string") {
        if (!best || String(v).length > String(best).length) best = v;
      } else if (best == null) {
        best = v;
      }
    }
    return best;
  };

  const tags = new Set<string>();
  for (const p of parts) {
    for (const t of p.suggestedTags || []) {
      if (t?.trim()) tags.add(t.trim());
    }
  }
  const warnings = new Set<string>();
  for (const p of parts) {
    for (const w of p.warnings || []) warnings.add(w);
  }
  warnings.add(`已合并 ${parts.length} 张药盒/说明书照片的识别结果，请核对。`);

  const confs = parts.map((p) => p.confidence).filter((c) => Number.isFinite(c));
  const confidence = confs.length
    ? confs.reduce((a, b) => a + b, 0) / confs.length
    : 0.6;

  return {
    name: pick("name"),
    brand: pick("brand"),
    category: pick("category") || "western",
    spec: pick("spec"),
    usageText: pick("usageText"),
    efficacy: pick("efficacy"),
    form: pick("form"),
    unit: pick("unit"),
    quantityRemain: pick("quantityRemain"),
    expiryDate: pick("expiryDate"),
    medicineSystem: pick("medicineSystem") || "unknown",
    suggestedTags: tags.size ? [...tags].slice(0, 10) : undefined,
    confidence,
    fieldsConfidence: parts[0].fieldsConfidence,
    warnings: [...warnings],
  };
}

/** 药盒 OCR（单图） */
export async function runMedicineOcr(
  db: Database.Database,
  attachment: HealthAttachmentRow,
): Promise<{
  rawText: string;
  structured: MedicineOcrStructured;
  model: string;
  attachmentIds: string[];
}> {
  return runMedicineOcrMulti(db, [attachment]);
}

/**
 * 药盒多图 OCR：同一次识别综合多张照片（正面/侧面/说明书页）
 * 优先单次 Vision 多图；失败则逐张识别再合并字段
 */
export async function runMedicineOcrMulti(
  db: Database.Database,
  attachments: HealthAttachmentRow[],
): Promise<{
  rawText: string;
  structured: MedicineOcrStructured;
  model: string;
  attachmentIds: string[];
}> {
  if (!attachments.length) throw new Error("请至少上传一张药盒照片");
  const limited = attachments.slice(0, 6); // 防止 token 过大
  const cfg = loadAiConfig(db);
  if (!cfg) {
    throw new Error("未配置 AI 服务。请在设置中配置 AI 模型后再试。");
  }

  const prepared: Array<{ id: string; dataUrl: string; buf: Buffer }> = [];
  for (const att of limited) {
    const { dataUrl, buf } = await imageAttachmentToDataUrl(att);
    prepared.push({ id: att.id, dataUrl, buf });
  }

  const system = buildMedicineOcrPrompt();
  const multiHint =
    prepared.length > 1
      ? `用户提供了同一药品的 ${prepared.length} 张照片（可能是药盒正面、侧面、说明书等）。请综合所有图片信息填写字段，互补缺漏，不要编造。`
      : "请从药盒/说明书图片抽取字段，严格输出 JSON。";

  const models = candidateVisionModels(cfg);
  let lastErr: Error | null = null;

  // 1) 一次请求多图
  for (const model of models) {
    if (looksLikeTextOnlyModel(model) && model === cfg.ai_model && models.length > 1) {
      continue;
    }
    try {
      const userContent: any[] = [{ type: "text", text: multiHint }];
      for (const p of prepared) {
        userContent.push({ type: "image_url", image_url: { url: p.dataUrl } });
      }
      const { text, model: used } = await callChatCompletions(cfg, {
        model,
        system,
        userContent,
      });
      const parsed = extractJsonObject(text);
      if (!parsed) {
        lastErr = new Error("模型未返回可解析 JSON");
        continue;
      }
      const structured = normalizeMedicineOcrStructured(parsed);
      if (prepared.length > 1) {
        structured.warnings = [
          ...(structured.warnings || []),
          `已综合 ${prepared.length} 张照片识别，请核对名称、规格与有效期。`,
        ];
      }
      return {
        rawText: text,
        structured,
        model: used,
        attachmentIds: prepared.map((p) => p.id),
      };
    } catch (e: any) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.warn(
        "[health.medicine-ocr] multi-vision fail:",
        lastErr.message.slice(0, 200),
      );
    }
  }

  // 2) 逐张 Vision / 本地 OCR，再合并
  const partials: MedicineOcrStructured[] = [];
  const rawParts: string[] = [];
  let usedModel = cfg.ai_model;

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    let done = false;
    for (const model of models) {
      if (looksLikeTextOnlyModel(model) && model === cfg.ai_model && models.length > 1) {
        continue;
      }
      try {
        const { text, model: used } = await callChatCompletions(cfg, {
          model,
          system,
          userContent: [
            {
              type: "text",
              text: `这是同一药品的第 ${i + 1}/${prepared.length} 张照片，请抽取可见字段为 JSON。`,
            },
            { type: "image_url", image_url: { url: p.dataUrl } },
          ],
        });
        const parsed = extractJsonObject(text);
        if (parsed) {
          partials.push(normalizeMedicineOcrStructured(parsed));
          rawParts.push(`--- 图${i + 1} ---\n${text}`);
          usedModel = used;
          done = true;
          break;
        }
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
    if (!done) {
      try {
        const ocrText = await runLocalImageOcr(p.buf);
        const { text, model } = await callChatCompletions(cfg, {
          system,
          userContent: `第 ${i + 1}/${prepared.length} 张药盒本地 OCR 文本，结构化为 JSON：\n\n${ocrText}`,
          temperature: 0.1,
        });
        const parsed = extractJsonObject(text);
        if (parsed) {
          partials.push(normalizeMedicineOcrStructured(parsed));
          rawParts.push(`--- 图${i + 1} local ---\n${text}`);
          usedModel = `${model}+local-ocr`;
          done = true;
        }
      } catch (e: any) {
        lastErr = e instanceof Error ? e : new Error(String(e));
      }
    }
  }

  if (!partials.length) {
    throw lastErr || new Error("多图 OCR 均失败");
  }

  const structured = mergeMedicineOcrResults(partials);
  return {
    rawText: rawParts.join("\n\n").slice(0, 100000),
    structured,
    model: usedModel,
    attachmentIds: prepared.map((p) => p.id),
  };
}
