/**
 * PaddleOCR 侧车 HTTP 客户端
 * 环境变量：
 *   PADDLEOCR_URL          例 http://paddleocr:8868
 *   PADDLEOCR_TIMEOUT_MS   默认 60000
 */

export interface PaddleOcrLine {
  text: string;
  score?: number;
  box?: unknown;
}

export interface PaddleOcrResult {
  text: string;
  lines: PaddleOcrLine[];
  avgScore: number;
  engine: string;
  lang?: string;
}

export function getPaddleOcrUrl(): string {
  return (process.env.PADDLEOCR_URL || "").replace(/\/+$/, "");
}

export function isPaddleOcrConfigured(): boolean {
  return !!getPaddleOcrUrl();
}

export function getPaddleOcrTimeoutMs(): number {
  const n = Number(process.env.PADDLEOCR_TIMEOUT_MS || "60000");
  if (!Number.isFinite(n) || n < 5000) return 60000;
  return Math.min(n, 300000);
}

/** HEALTH_OCR_ENGINE: paddle | vision | auto  默认 paddle */
export function getHealthOcrEngine(): "paddle" | "vision" | "auto" {
  const v = (process.env.HEALTH_OCR_ENGINE || "paddle").toLowerCase().trim();
  if (v === "vision" || v === "vl" || v === "llm") return "vision";
  if (v === "auto") return "auto";
  return "paddle";
}

function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

export async function callPaddleOcr(
  imageBuf: Buffer,
  opts?: { mime?: string },
): Promise<PaddleOcrResult> {
  const base = getPaddleOcrUrl();
  if (!base) {
    throw new Error(
      "未配置 PADDLEOCR_URL。请启动 PaddleOCR 侧车并设置环境变量，例如 PADDLEOCR_URL=http://paddleocr:8868",
    );
  }

  const endpoint = `${base}/ocr`;
  const timeoutMs = getPaddleOcrTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: bufferToBase64(imageBuf),
        mime: opts?.mime || "image/jpeg",
      }),
      signal: controller.signal,
    });

    const raw = (await res.json().catch(() => ({}))) as any;
    if (res.status === 422) {
      throw new Error(raw?.error || "PaddleOCR 未识别到文字，请换更清晰的图片");
    }
    if (!res.ok) {
      const detail = raw?.detail || raw?.error || (await safeText(res));
      throw new Error(
        `PaddleOCR 调用失败 (${res.status}): ${String(detail).slice(0, 300)}`,
      );
    }

    const text = String(raw?.text || "").trim();
    if (!text) {
      throw new Error("PaddleOCR 返回空文本");
    }

    const lines: PaddleOcrLine[] = Array.isArray(raw?.lines)
      ? raw.lines.map((l: any) => ({
          text: String(l?.text || "").trim(),
          score: typeof l?.score === "number" ? l.score : undefined,
          box: l?.box,
        }))
      : text.split("\n").map((t: string) => ({ text: t }));

    const scores = lines
      .map((l) => l.score)
      .filter((s): s is number => typeof s === "number" && Number.isFinite(s));
    const avgScore =
      typeof raw?.avg_score === "number"
        ? raw.avg_score
        : scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0.75;

    return {
      text: text.slice(0, 100000),
      lines,
      avgScore,
      engine: String(raw?.engine || "paddleocr"),
      lang: raw?.lang,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error(`PaddleOCR 超时（>${Math.round(timeoutMs / 1000)}s）`);
    }
    if (e?.message?.includes("fetch failed") || e?.cause?.code === "ECONNREFUSED") {
      throw new Error(
        `无法连接 PaddleOCR 服务（${base}）。请确认侧车已启动：docker compose up -d paddleocr`,
      );
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function checkPaddleOcrHealth(): Promise<{
  ok: boolean;
  ready?: boolean;
  error?: string;
}> {
  const base = getPaddleOcrUrl();
  if (!base) return { ok: false, error: "PADDLEOCR_URL 未设置" };
  try {
    const res = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as any;
    return { ok: !!j?.ok, ready: !!j?.ready, error: j?.error };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
