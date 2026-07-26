/**
 * 导入提交预览合计（PR2）
 * 主 CTA 只计 ready∩selected∩双账户；次级计 needs_review
 */

export type ImportRowLike = {
  id?: string;
  status?: string;
  draft?: {
    selected?: boolean;
    targetAccountId?: string | null;
    methodAccountId?: string | null;
    amountMinor?: number;
    direction?: string;
  } | null;
  parsed?: {
    amountMinor?: number;
    direction?: string;
  } | null;
};

export type CommitPreviewSplit = {
  readySelectedCount: number;
  reviewSelectedCount: number;
  readyExpense: number;
  readyIncome: number;
  reviewExpense: number;
  reviewIncome: number;
  /** @deprecated use readySelectedCount for primary CTA */
  count: number;
  expense: number;
  income: number;
};

function rowEligible(r: ImportRowLike): boolean {
  if (r.draft?.selected === false) return false;
  if (!r.draft?.targetAccountId || !r.draft?.methodAccountId) return false;
  if (r.status === "ignored" || r.status === "duplicate" || r.status === "committed" || r.status === "error") {
    return false;
  }
  return true;
}

function amountParts(r: ImportRowLike): { expense: number; income: number } {
  const m = Number(r.draft?.amountMinor ?? r.parsed?.amountMinor ?? 0);
  const dir = r.draft?.direction || r.parsed?.direction;
  if (dir === "in" || m > 0) return { expense: 0, income: Math.abs(m) };
  return { expense: Math.abs(m), income: 0 };
}

export function computeCommitPreview(rows: ImportRowLike[]): CommitPreviewSplit {
  let readySelectedCount = 0;
  let reviewSelectedCount = 0;
  let readyExpense = 0;
  let readyIncome = 0;
  let reviewExpense = 0;
  let reviewIncome = 0;

  for (const r of rows) {
    if (!rowEligible(r)) continue;
    const { expense, income } = amountParts(r);
    if (r.status === "ready") {
      readySelectedCount++;
      readyExpense += expense;
      readyIncome += income;
    } else if (r.status === "needs_review") {
      reviewSelectedCount++;
      reviewExpense += expense;
      reviewIncome += income;
    }
  }

  return {
    readySelectedCount,
    reviewSelectedCount,
    readyExpense,
    readyIncome,
    reviewExpense,
    reviewIncome,
    count: readySelectedCount,
    expense: readyExpense,
    income: readyIncome,
  };
}

export function statusCounts(rows: ImportRowLike[]): Record<string, number> {
  const c: Record<string, number> = {
    all: rows.length,
    ready: 0,
    needs_review: 0,
    duplicate: 0,
    ignored: 0,
    committed: 0,
  };
  for (const r of rows) {
    const s = r.status || "";
    if (s in c) c[s]++;
  }
  return c;
}
