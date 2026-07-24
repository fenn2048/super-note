import type Database from "better-sqlite3";

export function statsSummary(
  db: Database.Database,
  ledgerId: string,
  year: string,
  month?: string,
) {
  let from: string;
  let to: string;
  if (month) {
    const m = month.padStart(2, "0");
    from = `${year}-${m}-01`;
    // next month
    const d = new Date(Number(year), Number(m), 0); // last day of month
    to = `${year}-${m}-${String(d.getDate()).padStart(2, "0")}`;
  } else {
    from = `${year}-01-01`;
    to = `${year}-12-31`;
  }

  const income = (
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN p.amountMinor < 0 THEN -p.amountMinor ELSE 0 END), 0) AS v
         FROM finance_postings p
         JOIN finance_accounts a ON a.id = p.accountId
         JOIN finance_transactions t ON t.id = p.transactionId
         WHERE p.ledgerId = ? AND a.type = 'INCOME' AND t.date >= ? AND t.date <= ?`,
      )
      .get(ledgerId, from, to) as { v: number }
  ).v;

  const expenses = (
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

  const assets = (
    db
      .prepare(
        `SELECT COALESCE(SUM(p.amountMinor), 0) AS v
         FROM finance_postings p
         JOIN finance_accounts a ON a.id = p.accountId
         WHERE p.ledgerId = ? AND a.type = 'ASSETS'`,
      )
      .get(ledgerId) as { v: number }
  ).v;

  const liabilities = (
    db
      .prepare(
        `SELECT COALESCE(SUM(p.amountMinor), 0) AS v
         FROM finance_postings p
         JOIN finance_accounts a ON a.id = p.accountId
         WHERE p.ledgerId = ? AND a.type = 'LIABILITIES'`,
      )
      .get(ledgerId) as { v: number }
  ).v;

  return {
    from,
    to,
    incomeMinor: income,
    expensesMinor: expenses,
    netMinor: income - expenses,
    assetsMinor: assets,
    liabilitiesMinor: liabilities,
    netWorthMinor: assets + liabilities,
  };
}

export function statsExpenseBreakdown(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
) {
  return db
    .prepare(
      `SELECT a.id AS accountId, a.name AS accountName,
              SUM(CASE WHEN p.amountMinor > 0 THEN p.amountMinor ELSE 0 END) AS amountMinor
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       JOIN finance_transactions t ON t.id = p.transactionId
       WHERE p.ledgerId = ? AND a.type = 'EXPENSES' AND t.date >= ? AND t.date <= ?
       GROUP BY a.id
       HAVING amountMinor > 0
       ORDER BY amountMinor DESC`,
    )
    .all(ledgerId, from, to);
}

export function statsTrend(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
  bucket: "day" | "month" = "day",
) {
  const expr = bucket === "month" ? `substr(t.date, 1, 7)` : `t.date`;
  return db
    .prepare(
      `SELECT ${expr} AS bucket,
         SUM(CASE WHEN a.type = 'INCOME' AND p.amountMinor < 0 THEN -p.amountMinor ELSE 0 END) AS incomeMinor,
         SUM(CASE WHEN a.type = 'EXPENSES' AND p.amountMinor > 0 THEN p.amountMinor ELSE 0 END) AS expensesMinor
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       JOIN finance_transactions t ON t.id = p.transactionId
       WHERE p.ledgerId = ? AND t.date >= ? AND t.date <= ?
         AND a.type IN ('INCOME', 'EXPENSES')
       GROUP BY bucket
       ORDER BY bucket`,
    )
    .all(ledgerId, from, to);
}

export function statsPayees(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
  limit = 20,
) {
  return db
    .prepare(
      `SELECT COALESCE(t.payee, '(无)') AS payee,
              COUNT(DISTINCT t.id) AS count,
              SUM(CASE WHEN a.type = 'EXPENSES' AND p.amountMinor > 0 THEN p.amountMinor ELSE 0 END) AS expenseMinor
       FROM finance_transactions t
       JOIN finance_postings p ON p.transactionId = t.id
       JOIN finance_accounts a ON a.id = p.accountId
       WHERE t.ledgerId = ? AND t.date >= ? AND t.date <= ?
       GROUP BY payee
       HAVING expenseMinor > 0
       ORDER BY expenseMinor DESC
       LIMIT ?`,
    )
    .all(ledgerId, from, to, limit) as Array<{
    payee: string;
    count: number;
    expenseMinor: number;
  }>;
}

/** 多月收支序列（对齐 beancount-web month/total） */
export function statsMonthSeries(db: Database.Database, ledgerId: string, months = 18) {
  const rows = db
    .prepare(
      `SELECT substr(t.date, 1, 7) AS month,
         SUM(CASE WHEN a.type = 'INCOME' AND p.amountMinor < 0 THEN -p.amountMinor ELSE 0 END) AS incomeMinor,
         SUM(CASE WHEN a.type = 'EXPENSES' AND p.amountMinor > 0 THEN p.amountMinor ELSE 0 END) AS expensesMinor
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       JOIN finance_transactions t ON t.id = p.transactionId
       WHERE p.ledgerId = ? AND a.type IN ('INCOME', 'EXPENSES')
       GROUP BY month
       ORDER BY month DESC
       LIMIT ?`,
    )
    .all(ledgerId, months) as Array<{
    month: string;
    incomeMinor: number;
    expensesMinor: number;
  }>;
  return rows.reverse();
}

/**
 * 按日累计资产/负债余额序列（简化：从历史最早到截止日期的 running sum）
 * type: ASSETS | LIABILITIES
 */
export function statsBalanceSeries(
  db: Database.Database,
  ledgerId: string,
  accountType: "ASSETS" | "LIABILITIES" | "EXPENSES" | "INCOME",
  from: string,
  to: string,
) {
  // 起始日之前的累计余额
  const opening = (
    db
      .prepare(
        `SELECT COALESCE(SUM(p.amountMinor), 0) AS v
         FROM finance_postings p
         JOIN finance_accounts a ON a.id = p.accountId
         JOIN finance_transactions t ON t.id = p.transactionId
         WHERE p.ledgerId = ? AND a.type = ? AND t.date < ?`,
      )
      .get(ledgerId, accountType, from) as { v: number }
  ).v;

  const daily = db
    .prepare(
      `SELECT t.date AS date,
              SUM(p.amountMinor) AS deltaMinor
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       JOIN finance_transactions t ON t.id = p.transactionId
       WHERE p.ledgerId = ? AND a.type = ? AND t.date >= ? AND t.date <= ?
       GROUP BY t.date
       ORDER BY t.date`,
    )
    .all(ledgerId, accountType, from, to) as Array<{ date: string; deltaMinor: number }>;

  let bal = opening;
  return daily.map((d) => {
    bal += d.deltaMinor;
    return { date: d.date, balanceMinor: bal, deltaMinor: d.deltaMinor };
  });
}

/** 收入分类占比 */
export function statsIncomeBreakdown(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
) {
  return db
    .prepare(
      `SELECT a.id AS accountId, a.name AS accountName,
              SUM(CASE WHEN p.amountMinor < 0 THEN -p.amountMinor ELSE 0 END) AS amountMinor
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       JOIN finance_transactions t ON t.id = p.transactionId
       WHERE p.ledgerId = ? AND a.type = 'INCOME' AND t.date >= ? AND t.date <= ?
       GROUP BY a.id
       HAVING amountMinor > 0
       ORDER BY amountMinor DESC`,
    )
    .all(ledgerId, from, to);
}

/**
 * 按标签汇总支出（交易 tagsJson 数组内每个标签分摊整笔支出金额一次）
 */
export function statsTagBreakdown(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
): Array<{ tag: string; amountMinor: number; count: number }> {
  const rows = db
    .prepare(
      `SELECT t.id, t.tagsJson,
         (SELECT COALESCE(SUM(CASE WHEN p.amountMinor > 0 THEN p.amountMinor ELSE 0 END), 0)
          FROM finance_postings p
          JOIN finance_accounts a ON a.id = p.accountId
          WHERE p.transactionId = t.id AND a.type = 'EXPENSES') AS expenseMinor
       FROM finance_transactions t
       WHERE t.ledgerId = ? AND t.date >= ? AND t.date <= ?
         AND t.tagsJson IS NOT NULL AND t.tagsJson != '[]' AND t.tagsJson != 'null'`,
    )
    .all(ledgerId, from, to) as Array<{ id: string; tagsJson: string; expenseMinor: number }>;

  const map = new Map<string, { amountMinor: number; count: number }>();
  for (const r of rows) {
    if (!r.expenseMinor) continue;
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tagsJson || "[]");
    } catch {
      continue;
    }
    for (const raw of tags) {
      const tag = String(raw || "").trim();
      if (!tag) continue;
      const cur = map.get(tag) || { amountMinor: 0, count: 0 };
      cur.amountMinor += r.expenseMinor;
      cur.count += 1;
      map.set(tag, cur);
    }
  }
  return [...map.entries()]
    .map(([tag, v]) => ({ tag, ...v }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
}

/** 日趋势补全日历空日（无交易日为 0） */
export function fillDailyTrend(
  from: string,
  to: string,
  rows: Array<{ bucket: string; incomeMinor: number; expensesMinor: number }>,
): Array<{ bucket: string; incomeMinor: number; expensesMinor: number }> {
  const by = new Map(rows.map((r) => [r.bucket, r]));
  const out: Array<{ bucket: string; incomeMinor: number; expensesMinor: number }> = [];
  const start = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return rows;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${day}`;
    const hit = by.get(key);
    out.push({
      bucket: key,
      incomeMinor: hit?.incomeMinor || 0,
      expensesMinor: hit?.expensesMinor || 0,
    });
  }
  return out;
}

/**
 * 固定/可变/家庭支出结构（按账户路径启发式）
 */
export function statsExpenseStructure(
  db: Database.Database,
  ledgerId: string,
  from: string,
  to: string,
): Array<{ bucket: string; label: string; amountMinor: number }> {
  const rows = statsExpenseBreakdown(db, ledgerId, from, to) as Array<{
    accountName: string;
    amountMinor: number;
  }>;
  const buckets: Record<string, number> = {
    fixed: 0,
    variable: 0,
    family: 0,
    other: 0,
  };
  for (const r of rows) {
    const n = r.accountName || "";
    let key = "other";
    if (
      /MortgageInterest|Utilities:Property|Insurance:|Childcare:Salary|HouseProvidingFund|Tax:/.test(
        n,
      )
    ) {
      key = "fixed";
    } else if (/Family:|Parents:|Childcare:|Social|Kids:/.test(n)) {
      key = "family";
    } else if (
      /DailyLiving:|Transportation:|Entertainment:|HouseholdGoods:|Subscriptions|Meals|Groceries/.test(
        n,
      )
    ) {
      key = "variable";
    }
    buckets[key] += r.amountMinor || 0;
  }
  return [
    { bucket: "fixed", label: "固定成本", amountMinor: buckets.fixed },
    { bucket: "variable", label: "可变生活", amountMinor: buckets.variable },
    { bucket: "family", label: "家庭代际人情", amountMinor: buckets.family },
    { bucket: "other", label: "其他", amountMinor: buckets.other },
  ].filter((b) => b.amountMinor > 0);
}

/** 是否像信用卡/贷款还款（应用层启发） */
export function looksLikeRepayment(payee: string, item: string, method?: string): boolean {
  const text = `${payee || ""} ${item || ""} ${method || ""}`;
  return /还款|还信用卡|自动还款|账单还款|最低还款|偿还|还贷|房贷扣款|信用卡还款/.test(text);
}

export interface Insight {
  id: string;
  level: "info" | "warn" | "good";
  title: string;
  detail: string;
  metric?: string;
}

export function buildRuleInsights(
  summary: ReturnType<typeof statsSummary>,
  breakdown: Array<{ accountName: string; amountMinor: number }>,
  prevSummary?: ReturnType<typeof statsSummary> | null,
): Insight[] {
  const insights: Insight[] = [];
  const income = summary.incomeMinor;
  const expenses = summary.expensesMinor;

  if (income > 0) {
    const rate = (income - expenses) / income;
    const pct = (rate * 100).toFixed(1);
    if (rate < 0.1) {
      insights.push({
        id: "savings-low",
        level: "warn",
        title: "储蓄率偏低",
        detail: `本月储蓄率约 ${pct}%，建议控制非必要开支或增加收入。`,
        metric: `${pct}%`,
      });
    } else if (rate >= 0.3) {
      insights.push({
        id: "savings-good",
        level: "good",
        title: "储蓄表现良好",
        detail: `本月储蓄率约 ${pct}%，继续保持。`,
        metric: `${pct}%`,
      });
    } else {
      insights.push({
        id: "savings-ok",
        level: "info",
        title: "储蓄率正常",
        detail: `本月储蓄率约 ${pct}%。`,
        metric: `${pct}%`,
      });
    }
  } else if (expenses > 0) {
    insights.push({
      id: "no-income",
      level: "info",
      title: "本月暂无收入记录",
      detail: "可检查是否未导入工资/收入账单，或手动补记。",
    });
  }

  if (breakdown.length) {
    const totalExp = breakdown.reduce((s, b) => s + b.amountMinor, 0) || 1;
    const top = breakdown[0];
    const share = ((top.amountMinor / totalExp) * 100).toFixed(1);
    if (top.amountMinor / totalExp > 0.4) {
      insights.push({
        id: "category-dominant",
        level: "warn",
        title: `${top.accountName} 占比较高`,
        detail: `该分类约占支出 ${share}%，可考虑是否有优化空间。`,
        metric: `${share}%`,
      });
    }
    const other = breakdown.find((b) => b.accountName.endsWith(":Other") || b.accountName.includes("Other"));
    if (other && other.amountMinor / totalExp > 0.25) {
      insights.push({
        id: "uncategorized",
        level: "info",
        title: "未细分支出较多",
        detail: "「其他」类占比较高，建议完善导入规则以自动归类。",
      });
    }
  }

  if (prevSummary && prevSummary.expensesMinor > 0) {
    const delta = expenses - prevSummary.expensesMinor;
    const ratio = delta / prevSummary.expensesMinor;
    if (ratio > 0.3 && delta > 50000) {
      insights.push({
        id: "expense-up",
        level: "warn",
        title: "支出环比上升明显",
        detail: `较上月支出增加约 ${(ratio * 100).toFixed(0)}%，可查看分类明细定位原因。`,
      });
    }
  }

  if (summary.liabilitiesMinor < -100000) {
    insights.push({
      id: "liability",
      level: "info",
      title: "关注负债余额",
      detail: "信用卡/花呗等负债余额较高，建议预留还款资金。",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "empty",
      level: "info",
      title: "继续记账以获得洞察",
      detail: "导入账单或手动记账后，将生成储蓄率与分类建议。",
    });
  }

  return insights;
}

/** 预算超支洞察（可选） */
export function budgetInsights(
  budgets: Array<{
    accountName: string | null;
    amountMinor: number;
    spentMinor: number;
    ratio: number;
  }>,
): Insight[] {
  const out: Insight[] = [];
  for (const b of budgets) {
    if (b.ratio > 1) {
      out.push({
        id: `budget-over-${b.accountName || "total"}`,
        level: "warn",
        title: `${b.accountName || "总支出"} 预算已超支`,
        detail: `已用 ${(b.ratio * 100).toFixed(0)}%，建议控制该分类剩余开支。`,
        metric: `${(b.ratio * 100).toFixed(0)}%`,
      });
    } else if (b.ratio >= 0.85) {
      out.push({
        id: `budget-near-${b.accountName || "total"}`,
        level: "info",
        title: `${b.accountName || "总支出"} 接近预算上限`,
        detail: `已使用 ${(b.ratio * 100).toFixed(0)}% 的月度预算。`,
        metric: `${(b.ratio * 100).toFixed(0)}%`,
      });
    }
  }
  return out;
}
