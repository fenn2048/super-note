/**
 * 导入批次：stats 重算、可操作残差、终态判定
 * 见 docs/superpowers/specs/finance-import-p0-efficient-review.md
 */
import type Database from "better-sqlite3";
import type { ImportBatchStatus } from "./types.js";

export interface ImportBatchStats {
  total: number;
  ready: number;
  needs_review: number;
  duplicate: number;
  ignored: number;
  committed: number;
  error: number;
  crossDup?: number;
  channel?: string;
  detectConfidence?: number;
  /** 最近一次 commit 的计数（可选保留） */
  lastCommitted?: number;
  lastSkipped?: number;
}

const ACTIONABLE = new Set(["ready", "needs_review", "duplicate"]);

export function recomputeImportStats(
  db: Database.Database,
  batchId: string,
  prior?: Record<string, unknown> | null,
): ImportBatchStats {
  const rows = db
    .prepare(`SELECT status FROM finance_import_rows WHERE batchId = ?`)
    .all(batchId) as Array<{ status: string }>;

  const stats: ImportBatchStats = {
    total: rows.length,
    ready: 0,
    needs_review: 0,
    duplicate: 0,
    ignored: 0,
    committed: 0,
    error: 0,
  };

  for (const r of rows) {
    const s = r.status || "";
    if (s === "ready") stats.ready++;
    else if (s === "needs_review") stats.needs_review++;
    else if (s === "duplicate") stats.duplicate++;
    else if (s === "ignored") stats.ignored++;
    else if (s === "committed") stats.committed++;
    else if (s === "error") stats.error++;
  }

  const p = prior || {};
  if (typeof p.crossDup === "number") stats.crossDup = p.crossDup;
  if (typeof p.channel === "string") stats.channel = p.channel;
  if (typeof p.detectConfidence === "number") stats.detectConfidence = p.detectConfidence;

  return stats;
}

/** actionable residual = ready + needs_review + duplicate（含假阳性 duplicate） */
export function countActionableResidual(db: Database.Database, batchId: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM finance_import_rows
       WHERE batchId = ? AND status IN ('ready','needs_review','duplicate')`,
    )
    .get(batchId) as { c: number };
  return Number(row?.c || 0);
}

export function isTerminalBatchStatus(status: string): boolean {
  return status === "committed" || status === "discarded";
}

/**
 * commit 成功写入若干行后的 batch 状态。
 * - justCommitted === 0 → 保持不变
 * - residual > 0 → partial（含仅剩 duplicate）
 * - residual === 0 → committed
 */
export function nextBatchStatusAfterCommit(
  prevStatus: string,
  justCommitted: number,
  residual: number,
): ImportBatchStatus {
  if (justCommitted <= 0) {
    if (prevStatus === "partial") return "partial";
    if (prevStatus === "committed") return "committed";
    if (prevStatus === "discarded") return "discarded";
    return "preview";
  }
  if (residual > 0) return "partial";
  return "committed";
}

/**
 * markIgnored 等 mutation 清空 residual 后：
 * residual === 0 且（已有 committed 行 或 原为 partial）→ committed
 */
export function nextBatchStatusAfterIgnore(
  prevStatus: string,
  residual: number,
  committedRowCount: number,
): ImportBatchStatus {
  if (isTerminalBatchStatus(prevStatus) && prevStatus === "discarded") return "discarded";
  if (residual > 0) {
    if (prevStatus === "partial" || committedRowCount > 0) return "partial";
    return prevStatus === "committed" ? "committed" : "preview";
  }
  // residual 0
  if (committedRowCount > 0 || prevStatus === "partial") return "committed";
  if (prevStatus === "committed") return "committed";
  return "preview";
}

export function parsePriorStats(statsJson: string | null | undefined): Record<string, unknown> {
  try {
    return JSON.parse(statsJson || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function isActionableRowStatus(status: string): boolean {
  return ACTIONABLE.has(status);
}
