import type Database from "better-sqlite3";
import { minorToYuanString } from "./amount.js";

export function exportCsv(db: Database.Database, ledgerId: string): string {
  const rows = db
    .prepare(
      `SELECT t.date, t.time, t.payee, t.narration, t.source, t.sourceRef, t.tagsJson,
              p.amountMinor, p.currency, a.name AS accountName, a.type AS accountType
       FROM finance_transactions t
       JOIN finance_postings p ON p.transactionId = t.id
       JOIN finance_accounts a ON a.id = p.accountId
       WHERE t.ledgerId = ?
       ORDER BY t.date ASC, t.time ASC, t.id, p.sortOrder`,
    )
    .all(ledgerId) as Array<{
    date: string;
    time: string | null;
    payee: string | null;
    narration: string | null;
    source: string | null;
    sourceRef: string | null;
    tagsJson: string | null;
    amountMinor: number;
    currency: string;
    accountName: string;
    accountType: string;
  }>;

  const header = [
    "date",
    "time",
    "payee",
    "narration",
    "account",
    "account_type",
    "amount",
    "currency",
    "source",
    "source_ref",
    "tags",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [
      r.date,
      r.time || "",
      csvEscape(r.payee || ""),
      csvEscape(r.narration || ""),
      csvEscape(r.accountName),
      r.accountType,
      minorToYuanString(r.amountMinor),
      r.currency,
      r.source || "",
      csvEscape(r.sourceRef || ""),
      csvEscape(r.tagsJson || "[]"),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n") + "\n";
}

function csvEscape(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 导出 Beancount 文本（兼容 bean-query / beancount-gs 导入）
 */
export function exportBeancount(db: Database.Database, ledgerId: string): string {
  const ledger = db
    .prepare(`SELECT * FROM finance_ledgers WHERE id = ?`)
    .get(ledgerId) as {
    title: string;
    operatingCurrency: string;
    startDate: string;
  };

  const accounts = db
    .prepare(`SELECT * FROM finance_accounts WHERE ledgerId = ? ORDER BY name`)
    .all(ledgerId) as Array<{ name: string; type: string; isOpen: number }>;

  const txs = db
    .prepare(
      `SELECT * FROM finance_transactions WHERE ledgerId = ? ORDER BY date ASC, time ASC, createdAt ASC`,
    )
    .all(ledgerId) as Array<{
    id: string;
    date: string;
    payee: string | null;
    narration: string | null;
    tagsJson: string | null;
  }>;

  const getPostings = db.prepare(
    `SELECT p.amountMinor, p.currency, a.name AS accountName
     FROM finance_postings p
     JOIN finance_accounts a ON a.id = p.accountId
     WHERE p.transactionId = ?
     ORDER BY p.sortOrder`,
  );

  const lines: string[] = [];
  lines.push(`;; Super Note finance export: ${ledger.title}`);
  lines.push(`option "title" "${escapeBean(ledger.title)}"`);
  lines.push(`option "operating_currency" "${ledger.operatingCurrency}"`);
  lines.push("");

  for (const a of accounts) {
    const openDate = ledger.startDate || "1970-01-01";
    lines.push(`${openDate} open ${a.name} ${ledger.operatingCurrency}`);
    if (!a.isOpen) {
      lines.push(`${openDate} close ${a.name}`);
    }
  }
  lines.push("");

  for (const t of txs) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(t.tagsJson || "[]");
    } catch {
      tags = [];
    }
    const tagStr = tags.map((x) => `#${x.replace(/\s+/g, "_")}`).join(" ");
    const payee = t.payee ? `"${escapeBean(t.payee)}"` : '""';
    const narr = t.narration ? `"${escapeBean(t.narration)}"` : '""';
    lines.push(`${t.date} * ${payee} ${narr}${tagStr ? " " + tagStr : ""}`);

    const posts = getPostings.all(t.id) as Array<{
      amountMinor: number;
      currency: string;
      accountName: string;
    }>;
    for (const p of posts) {
      const amt = minorToYuanString(p.amountMinor);
      // beancount: 两空格缩进；金额右对齐风格简化
      lines.push(`  ${p.accountName}  ${amt} ${p.currency}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escapeBean(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
