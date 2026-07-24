/**
 * 跨渠道账单去重
 * ---------------------------------------------------------------------------
 * 1) 同源：source + sourceRef 精确匹配
 * 2) 跨源（微信/支付宝/京东 vs 银行卡）：日期相同 + 金额绝对值相同
 *    + 可选时间接近（±3 分钟）或 payee 有公共子串
 *
 * 避免误杀：仅标记为 duplicate 建议跳过，用户仍可勾选强制导入。
 */

import type Database from "better-sqlite3";
import type { ImportEntry } from "./types.js";

export interface DupHit {
  txId: string;
  reason: "source_ref" | "amount_date" | "amount_date_time" | "amount_date_payee";
  confidence: number;
  existingPayee?: string | null;
  existingSource?: string | null;
  existingDate?: string | null;
  existingTime?: string | null;
}

function normalizePayee(s: string | null | undefined): string {
  return (s || "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .toLowerCase();
}

function payeeOverlap(a: string, b: string): boolean {
  const x = normalizePayee(a);
  const y = normalizePayee(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  // 公共子串 ≥ 4
  const minLen = Math.min(x.length, y.length);
  if (minLen < 4) return x === y;
  for (let len = Math.min(8, minLen); len >= 4; len--) {
    for (let i = 0; i <= x.length - len; i++) {
      if (y.includes(x.slice(i, i + len))) return true;
    }
  }
  return false;
}

function timeToMinutes(t?: string | null): number | null {
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function timeClose(a?: string | null, b?: string | null, windowMin = 3): boolean {
  const ma = timeToMinutes(a);
  const mb = timeToMinutes(b);
  if (ma == null || mb == null) return false;
  return Math.abs(ma - mb) <= windowMin;
}

/**
 * 预加载账本近期交易用于跨源匹配（默认 400 天窗口）
 */
export function loadRecentTxIndex(
  db: Database.Database,
  ledgerId: string,
  fromDate?: string,
): Array<{
  id: string;
  date: string;
  time: string | null;
  payee: string | null;
  source: string | null;
  sourceRef: string | null;
  amountAbs: number;
}> {
  const from = fromDate || "1970-01-01";
  // 取支出/收入腿上的 |amount| 用 posting 绝对值最大值近似交易金额
  const rows = db
    .prepare(
      `SELECT t.id, t.date, t.time, t.payee, t.source, t.sourceRef,
              (SELECT MAX(ABS(p.amountMinor)) FROM finance_postings p WHERE p.transactionId = t.id) AS amountAbs
       FROM finance_transactions t
       WHERE t.ledgerId = ? AND t.date >= ?
       ORDER BY t.date DESC
       LIMIT 50000`,
    )
    .all(ledgerId, from) as Array<{
    id: string;
    date: string;
    time: string | null;
    payee: string | null;
    source: string | null;
    sourceRef: string | null;
    amountAbs: number | null;
  }>;

  return rows.map((r) => ({
    ...r,
    amountAbs: r.amountAbs || 0,
  }));
}

export function findDuplicate(
  entry: ImportEntry,
  channel: string,
  index: ReturnType<typeof loadRecentTxIndex>,
  exactByRef: Map<string, string>, // key = source\0sourceRef -> txId
): DupHit | null {
  // 1) 同源流水号
  if (entry.sourceId) {
    const key = `${channel}\0${entry.sourceId}`;
    const id = exactByRef.get(key);
    if (id) {
      return { txId: id, reason: "source_ref", confidence: 1 };
    }
    // 任意源相同 sourceRef（少见但有）
    for (const [k, txId] of exactByRef) {
      if (k.endsWith(`\0${entry.sourceId}`)) {
        return { txId, reason: "source_ref", confidence: 0.98, existingSource: k.split("\0")[0] };
      }
    }
  }

  const abs = Math.abs(entry.amountMinor);
  if (!abs || !entry.date) return null;

  const candidates = index.filter((t) => t.date === entry.date && t.amountAbs === abs);
  if (!candidates.length) return null;

  // 同渠道已在 source_ref 处理；跨渠道优先
  const cross = candidates.filter((t) => t.source !== channel);

  // 时间接近
  for (const t of cross.length ? cross : candidates) {
    if (timeClose(entry.time, t.time, 5)) {
      return {
        txId: t.id,
        reason: "amount_date_time",
        confidence: 0.92,
        existingPayee: t.payee,
        existingSource: t.source,
        existingDate: t.date,
        existingTime: t.time,
      };
    }
  }

  // payee 重叠
  for (const t of cross.length ? cross : candidates) {
    if (payeeOverlap(entry.payee, t.payee || "") || payeeOverlap(entry.item, t.payee || "")) {
      return {
        txId: t.id,
        reason: "amount_date_payee",
        confidence: 0.85,
        existingPayee: t.payee,
        existingSource: t.source,
        existingDate: t.date,
        existingTime: t.time,
      };
    }
  }

  // 仅跨源：同日同额唯一候选 → 中等置信建议重复
  if (cross.length === 1) {
    return {
      txId: cross[0].id,
      reason: "amount_date",
      confidence: 0.7,
      existingPayee: cross[0].payee,
      existingSource: cross[0].source,
      existingDate: cross[0].date,
      existingTime: cross[0].time,
    };
  }

  // 同日同额多候选但仅 1 个非本源+无时间信息 → 仍提示
  if (cross.length > 1 && !entry.time) {
    // 不自动判重，避免误杀
    return null;
  }

  return null;
}

export function buildExactRefMap(
  db: Database.Database,
  ledgerId: string,
): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT id, source, sourceRef FROM finance_transactions
       WHERE ledgerId = ? AND sourceRef IS NOT NULL AND sourceRef != ''`,
    )
    .all(ledgerId) as Array<{ id: string; source: string | null; sourceRef: string }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(`${r.source || ""}\0${r.sourceRef}`, r.id);
  }
  return map;
}
