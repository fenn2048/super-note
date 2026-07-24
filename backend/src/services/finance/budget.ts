import type Database from "better-sqlite3";

export interface BudgetRow {
  id: string;
  ledgerId: string;
  yearMonth: string; // YYYY-MM
  accountId: string | null; // null = 总支出预算
  amountMinor: number;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetProgress extends BudgetRow {
  accountName: string | null;
  spentMinor: number;
  remainingMinor: number;
  ratio: number; // spent/budget, may > 1
}

function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

export function listBudgets(
  db: Database.Database,
  ledgerId: string,
  yearMonth: string,
): BudgetProgress[] {
  const rows = db
    .prepare(
      `SELECT b.*, a.name AS accountName
       FROM finance_budgets b
       LEFT JOIN finance_accounts a ON a.id = b.accountId
       WHERE b.ledgerId = ? AND b.yearMonth = ?
       ORDER BY b.accountId IS NOT NULL, a.name`,
    )
    .all(ledgerId, yearMonth) as Array<BudgetRow & { accountName: string | null }>;

  const { from, to } = monthRange(yearMonth);

  return rows.map((b) => {
    let spentMinor = 0;
    if (b.accountId) {
      spentMinor = (
        db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN p.amountMinor > 0 THEN p.amountMinor ELSE 0 END), 0) AS v
             FROM finance_postings p
             JOIN finance_transactions t ON t.id = p.transactionId
             WHERE p.ledgerId = ? AND p.accountId = ? AND t.date >= ? AND t.date <= ?`,
          )
          .get(ledgerId, b.accountId, from, to) as { v: number }
      ).v;
    } else {
      spentMinor = (
        db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN p.amountMinor > 0 THEN p.amountMinor ELSE 0 END), 0) AS v
             FROM finance_postings p
             JOIN finance_accounts a ON a.id = p.accountId
             JOIN finance_transactions t ON t.id = p.transactionId
             WHERE p.ledgerId = ? AND a.type = 'EXPENSES' AND t.date >= ? AND t.date <= ?`,
          )
          .get(ledgerId, from, to) as { v: number }
      ).v;
    }
    const remainingMinor = b.amountMinor - spentMinor;
    const ratio = b.amountMinor > 0 ? spentMinor / b.amountMinor : 0;
    return {
      ...b,
      spentMinor,
      remainingMinor,
      ratio,
    };
  });
}
