/**
 * 银行账单解析：EML 信用卡 / PDF 储蓄卡 / XLS 建行
 * 移植自 beancount-gs py_parsers/bank_parser.py 的核心逻辑
 */
import * as XLSX from "xlsx";
import type { ImportEntry } from "../types.js";
import { parseAmountString, yuanToMinor } from "../amount.js";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\r/g, "");
}

/** 从 EML 提取 HTML body（兼容 gbk / quoted-printable / base64） */
function extractEmlHtml(buffer: Buffer): string {
  // 用 binary 保留 8bit，再按 charset 解码
  const raw = buffer.toString("binary");
  const charsetMatch = raw.match(/Content-Type:\s*text\/html[^;]*;\s*charset=["']?([\w-]+)/i);
  const charset = (charsetMatch?.[1] || "utf-8").toLowerCase();

  const htmlHeaderIdx = raw.search(/Content-Type:\s*text\/html/i);
  if (htmlHeaderIdx < 0) {
    return tryDecodeBuffer(buffer, charset);
  }

  const afterHeader = raw.slice(htmlHeaderIdx);
  const bodyStart = afterHeader.search(/\r?\n\r?\n/);
  if (bodyStart < 0) return tryDecodeBuffer(buffer, charset);

  const headers = afterHeader.slice(0, bodyStart);
  let body = afterHeader.slice(bodyStart).replace(/^\r?\n\r?\n/, "");
  // 截断到下一个 boundary
  const boundaryMatch = raw.match(/boundary=["']?([^"'\s;]+)/i);
  if (boundaryMatch) {
    const b = boundaryMatch[1];
    const cut = body.indexOf(`--${b}`);
    if (cut > 0) body = body.slice(0, cut);
  }

  const cte = (headers.match(/Content-Transfer-Encoding:\s*(\S+)/i)?.[1] || "").toLowerCase();
  let bytes: Buffer;
  if (cte === "base64") {
    bytes = Buffer.from(body.replace(/\s+/g, ""), "base64");
  } else if (cte === "quoted-printable") {
    const qp = body
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
    bytes = Buffer.from(qp, "binary");
  } else {
    bytes = Buffer.from(body, "binary");
  }

  return tryDecodeBuffer(bytes, charset);
}

function tryDecodeBuffer(buf: Buffer, charset: string): string {
  const cs = charset.replace(/"/g, "").toLowerCase();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const iconv = require("iconv-lite") as typeof import("iconv-lite");
    if (cs.includes("gb") || cs.includes("gbk") || cs.includes("gb2312") || cs.includes("gb18030")) {
      return iconv.decode(buf, "gb18030");
    }
    if (iconv.encodingExists(cs)) return iconv.decode(buf, cs);
  } catch {
    /* fall through */
  }
  return buf.toString("utf8");
}

function pushEntry(
  list: ImportEntry[],
  opts: {
    id: string;
    date: string;
    payee: string;
    item: string;
    amountMinor: number;
    raw: Record<string, string>;
  },
) {
  if (!opts.date || opts.amountMinor === 0) return;
  list.push({
    sourceId: opts.id,
    date: opts.date,
    payee: opts.payee,
    item: opts.item,
    amountMinor: opts.amountMinor,
    direction: opts.amountMinor < 0 ? "out" : "in",
    rawItems: opts.raw,
  });
}

export function parseIcbcCreditEml(buffer: Buffer): ImportEntry[] {
  const html = extractEmlHtml(buffer);
  const text = stripHtml(html);
  const entries: ImportEntry[] = [];
  // 行：卡号末四 交易日 记账日 摘要 商户 交易金额 结算金额
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 6) continue;
    const dateCell = cells.find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c));
    if (!dateCell) continue;
    const amountCell = cells[cells.length - 1] || "";
    let amountMinor = parseAmountString(amountCell.split("/")[0]);
    if (amountCell.includes("支出") || amountCell.includes("(支出)")) {
      amountMinor = -Math.abs(amountMinor);
    } else if (amountCell.includes("存入") || amountCell.includes("(存入)")) {
      amountMinor = Math.abs(amountMinor);
    } else {
      // 信用卡默认支出
      amountMinor = -Math.abs(amountMinor);
    }
    const payee = cells[4] || cells[3] || "";
    const item = cells[3] || "";
    pushEntry(entries, {
      id: `icbc_${dateCell}_${Math.abs(amountMinor)}_${entries.length}`,
      date: dateCell,
      payee,
      item,
      amountMinor,
      raw: { line },
    });
  }
  return entries;
}

export function parseCmbCreditEml(buffer: Buffer): ImportEntry[] {
  const html = extractEmlHtml(buffer);
  const text = stripHtml(html);
  const yearMatch = text.match(/(\d{4})\/\d{2}\/\d{2}-\d{4}\/\d{2}\/\d{2}/);
  const year = yearMatch ? yearMatch[1] : String(new Date().getFullYear());
  const entries: ImportEntry[] = [];
  const lines = text.split("\n").map((l) => l.trim());
  for (const line of lines) {
    const cells = line.split("\t").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 5) continue;
    // TransDate MMDD
    const mmdd = cells.find((c) => /^\d{4}$/.test(c) && Number(c.slice(0, 2)) <= 12);
    if (!mmdd) continue;
    const date = `${year}-${mmdd.slice(0, 2)}-${mmdd.slice(2)}`;
    const amountCell = cells[cells.length - 1] || cells[cells.length - 2] || "";
    let amountMinor = parseAmountString(amountCell);
    // 招行：支出通常无符号在金额列，收入可能有负号或标记
    if (!amountCell.includes("-") && !amountCell.includes("存入")) {
      amountMinor = -Math.abs(amountMinor);
    } else if (amountCell.includes("-")) {
      // 有的账单退货为负支出 = 收入
      amountMinor = Math.abs(parseAmountString(amountCell.replace("-", "")));
    }
    const item = cells[3] || cells[2] || "";
    pushEntry(entries, {
      id: `cmb_cc_${date}_${Math.abs(amountMinor)}_${entries.length}`,
      date,
      payee: item,
      item,
      amountMinor,
      raw: { line },
    });
  }
  return entries;
}

export function parseCgbCreditEml(buffer: Buffer): ImportEntry[] {
  const html = extractEmlHtml(buffer);
  const entries: ImportEntry[] = [];
  // 对齐 beancount-gs：7 列 TransDate / SetDate / Summary / TransAmt / TransCurr / SetAmt / SetCurr
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const tds = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) =>
      x[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
    );
    if (tds.length !== 7) continue;
    if (!/^\d{4}\/\d{2}\/\d{2}/.test(tds[0])) continue;
    const date = tds[0].replace(/\//g, "-");
    const item = tds[2] || "";
    // 结算金额（入账）
    let amountMinor = parseAmountString(tds[5] || tds[3] || "0");
    // 账单里支出多为正数、还款为负数；记账：支出负、还款/退货正
    if (amountMinor > 0 && !/还款|退货|退款|调整/.test(item)) {
      amountMinor = -Math.abs(amountMinor);
    }
    // 0 元年费提示等可跳过
    if (amountMinor === 0 && !item) continue;
    if (amountMinor === 0) continue;

    pushEntry(entries, {
      id: `cgb_${date}_${Math.abs(amountMinor)}_${entries.length}`,
      date,
      payee: item,
      item,
      amountMinor,
      raw: {
        交易日期: tds[0],
        结算日期: tds[1],
        交易摘要: tds[2],
        交易金额: tds[3],
        交易币种: tds[4],
        结算金额: tds[5],
        结算币种: tds[6],
      },
    });
  }
  return entries;
}

async function pdfToText(buffer: Buffer): Promise<string> {
  const { extractText: extract, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(buffer));
  const result = (await extract(doc, { mergePages: false })) as
    | { text: string[] | string }
    | string[]
    | string;
  if (Array.isArray(result)) return result.map(String).join("\n");
  if (typeof result === "string") return result;
  const t = result?.text;
  if (Array.isArray(t)) return t.map(String).join("\n");
  return String(t || "");
}

function parseGenericBankPdfLines(text: string, prefix: string): ImportEntry[] {
  const entries: ImportEntry[] = [];
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  // 匹配：日期 摘要 金额
  const dateRe = /(\d{4}[-\/]\d{2}[-\/]\d{2})/;
  const amountRe = /([+-]?[\d,]+\.\d{2})/g;

  for (const line of lines) {
    const dm = line.match(dateRe);
    if (!dm) continue;
    let date = dm[1].replace(/\//g, "-");
    const amounts = [...line.matchAll(amountRe)].map((m) => m[1]);
    if (!amounts.length) continue;
    // 取最后一个金额作交易额
    const last = amounts[amounts.length - 1];
    let amountMinor = yuanToMinor(last.replace(/,/g, ""));
    // 启发式：含 贷/存/转入/收入 → 正；借/支/转出/支出 → 负
    if (/贷|存入|转入|收入|汇入/.test(line) && !/手续费/.test(line)) {
      amountMinor = Math.abs(amountMinor);
    } else if (/借|支取|转出|支出|消费/.test(line)) {
      amountMinor = -Math.abs(amountMinor);
    } else if (!last.startsWith("+") && !last.startsWith("-")) {
      amountMinor = -Math.abs(amountMinor);
    }
    const payee = line.replace(dateRe, "").replace(amountRe, "").replace(/\s+/g, " ").trim().slice(0, 80);
    pushEntry(entries, {
      id: `${prefix}_${date}_${Math.abs(amountMinor)}_${entries.length}`,
      date,
      payee,
      item: payee,
      amountMinor,
      raw: { line },
    });
  }
  return entries;
}

export async function parseCmbDebitPdf(buffer: Buffer): Promise<ImportEntry[]> {
  const text = await pdfToText(buffer);
  // 优先按分行字段解析；失败再走通用行解析
  const structured = parseCmbDebitTxt(Buffer.from(text, "utf8"));
  if (structured.length > 0) return structured;
  return parseGenericBankPdfLines(text, "cmb_debit");
}

/** 招行流水 TXT/PDF 文本：字段分行 — 日期 / 货币 / 金额 / 余额 / 摘要 / 对手 */
export function parseCmbDebitTxt(buffer: Buffer): ImportEntry[] {
  const text = buffer.toString("utf8");
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const entries: ImportEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(lines[i])) {
      const date = lines[i];
      // 跳过表头区重复的 Date 等
      if (i + 2 < lines.length && /[\d,]+\.\d{2}/.test(lines[i + 2].replace(/[+\-]/g, ""))) {
        const amountMinor = yuanToMinor(lines[i + 2].replace(/,/g, ""));
        const item = lines[i + 4] || "";
        const payee = lines[i + 5] || item;
        // 跳过非交易头（货币/Date 英文）
        if (lines[i + 1] === "CNY" || lines[i + 1] === "货币" || /^[A-Z]{3}$/.test(lines[i + 1])) {
          pushEntry(entries, {
            id: `cmb_debit_${date}_${Math.abs(amountMinor)}_${entries.length}`,
            date,
            payee,
            item,
            amountMinor,
            raw: {
              记账日期: date,
              交易金额: lines[i + 2],
              交易摘要: item,
              对手信息: payee,
            },
          });
          i += 6;
          continue;
        }
      }
    }
    i++;
  }
  return entries;
}

export async function parseBocomDebitPdf(buffer: Buffer): Promise<ImportEntry[]> {
  const text = await pdfToText(buffer);
  return parseGenericBankPdfLines(text, "bocom");
}

export async function parseIcbcDebitPdf(buffer: Buffer): Promise<ImportEntry[]> {
  const text = await pdfToText(buffer);
  const countMatch = text.match(/本页交易笔数[：:]\s*(\d+)/);
  const amounts = [...text.matchAll(/([+-][\d,]+\.\d{2})/g)].map((m) => yuanToMinor(m[1].replace(/,/g, "")));
  const dates = [...text.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  const count = countMatch ? Number(countMatch[1]) : Math.min(amounts.length, dates.length);
  if (count > 0 && amounts.length > 0) {
    const useDates = dates.length > count ? dates.slice(-count) : dates;
    const useAmounts = amounts.slice(0, count);
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const payees: string[] = [];
    for (const line of lines) {
      if (
        line.length > 2 &&
        !/^[\d\-+.,\s:]+$/.test(line) &&
        !/人民币|活期|余额|摘要|日期|业务|笔数|第|页|共|收入|支出|合计/.test(line)
      ) {
        payees.push(line);
      }
    }
    const entries: ImportEntry[] = [];
    for (let i = 0; i < count; i++) {
      const date = useDates[i] || useDates[useDates.length - 1] || "";
      const amountMinor = useAmounts[i] || 0;
      const payee = payees[i] || "";
      if (!date || !amountMinor) continue;
      pushEntry(entries, {
        id: `icbc_debit_${date}_${Math.abs(amountMinor)}_${i}`,
        date,
        payee,
        item: payee,
        amountMinor,
        raw: {},
      });
    }
    if (entries.length) return entries;
  }
  return parseGenericBankPdfLines(text, "icbc_debit");
}

export function parseCcbDebitXls(buffer: Buffer): ImportEntry[] {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false }) as string[][];
  const entries: ImportEntry[] = [];
  let headerRow = -1;
  let headers: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => String(c || "").trim());
    if (r.some((c) => c.includes("交易日期")) && r.some((c) => c.includes("交易金额") || c.includes("金额"))) {
      headerRow = i;
      headers = r;
      break;
    }
  }
  if (headerRow < 0) return entries;

  const iDate = headers.findIndex((h) => h.includes("交易日期"));
  const iAmt = headers.findIndex((h) => h.includes("交易金额") || h === "金额");
  const iSummary = headers.findIndex((h) => h.includes("摘要"));
  const iPlace = headers.findIndex((h) => h.includes("交易地点") || h.includes("附言"));
  const iPeer = headers.findIndex((h) => h.includes("对方"));

  for (let i = headerRow + 1; i < rows.length; i++) {
    const cols = rows[i].map((c) => String(c || "").trim());
    const dateRaw = iDate >= 0 ? cols[iDate] : "";
    if (!dateRaw) continue;
    let date = dateRaw;
    // 建行：20250424
    if (/^\d{8}$/.test(dateRaw)) {
      date = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
    } else {
      date = dateRaw.slice(0, 10).replace(/\//g, "-");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    const amtRaw = iAmt >= 0 ? cols[iAmt] : "0";
    // 带符号：-30.00 支出，20.00 收入
    const amountMinor = yuanToMinor(String(amtRaw).replace(/,/g, ""));
    if (amountMinor === 0) continue;

    const item = iPlace >= 0 ? cols[iPlace] : iSummary >= 0 ? cols[iSummary] : "";
    const payee = iPeer >= 0 ? cols[iPeer] : item;
    pushEntry(entries, {
      id: `ccb_${date}_${Math.abs(amountMinor)}_${i}`,
      date,
      payee: payee || item,
      item: item || (iSummary >= 0 ? cols[iSummary] : ""),
      amountMinor,
      raw: { row: cols.join("|") },
    });
  }
  return entries;
}
