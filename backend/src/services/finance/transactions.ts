import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import { assertBalanced } from "./amount.js";
import type { CreateTransactionInput } from "./types.js";

export function insertTransaction(
  db: Database.Database,
  ledgerId: string,
  input: CreateTransactionInput,
): string {
  if (!input.postings || input.postings.length < 2) {
    throw new Error("至少需要两条分录");
  }
  assertBalanced(input.postings.map((p) => p.amountMinor));

  // 校验账户属于本账本
  for (const p of input.postings) {
    const acct = db
      .prepare(`SELECT id FROM finance_accounts WHERE id = ? AND ledgerId = ?`)
      .get(p.accountId, ledgerId);
    if (!acct) throw new Error(`账户不存在: ${p.accountId}`);
  }

  const txId = uuidv4();
  const tagsJson = JSON.stringify(input.tags || []);
  const metaJson = input.meta ? JSON.stringify(input.meta) : null;

  db.prepare(
    `INSERT INTO finance_transactions
      (id, ledgerId, date, time, payee, narration, tagsJson, source, sourceRef, importBatchId, metaJson, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    txId,
    ledgerId,
    input.date,
    input.time || null,
    input.payee || null,
    input.narration || null,
    tagsJson,
    input.source || "manual",
    input.sourceRef || null,
    input.importBatchId || null,
    metaJson,
  );

  const insertPosting = db.prepare(
    `INSERT INTO finance_postings (id, transactionId, ledgerId, accountId, amountMinor, currency, sortOrder)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  input.postings.forEach((p, i) => {
    insertPosting.run(
      uuidv4(),
      txId,
      ledgerId,
      p.accountId,
      p.amountMinor,
      p.currency || "CNY",
      i,
    );
  });

  return txId;
}

export function deleteTransaction(db: Database.Database, ledgerId: string, txId: string): boolean {
  const row = db
    .prepare(`SELECT id FROM finance_transactions WHERE id = ? AND ledgerId = ?`)
    .get(txId, ledgerId);
  if (!row) return false;
  // postings CASCADE
  db.prepare(`DELETE FROM finance_transactions WHERE id = ?`).run(txId);
  return true;
}

/**
 * 更新交易：替换头字段 + 可选整表替换分录（仍需平衡）
 */
export function updateTransaction(
  db: Database.Database,
  ledgerId: string,
  txId: string,
  input: Partial<CreateTransactionInput> & { postings?: CreateTransactionInput["postings"] },
): boolean {
  const existing = db
    .prepare(`SELECT id FROM finance_transactions WHERE id = ? AND ledgerId = ?`)
    .get(txId, ledgerId);
  if (!existing) return false;

  if (input.postings) {
    if (input.postings.length < 2) throw new Error("至少需要两条分录");
    assertBalanced(input.postings.map((p) => p.amountMinor));
    for (const p of input.postings) {
      const acct = db
        .prepare(`SELECT id FROM finance_accounts WHERE id = ? AND ledgerId = ?`)
        .get(p.accountId, ledgerId);
      if (!acct) throw new Error(`账户不存在: ${p.accountId}`);
    }
    db.prepare(`DELETE FROM finance_postings WHERE transactionId = ?`).run(txId);
    const insertPosting = db.prepare(
      `INSERT INTO finance_postings (id, transactionId, ledgerId, accountId, amountMinor, currency, sortOrder)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    input.postings.forEach((p, i) => {
      insertPosting.run(
        uuidv4(),
        txId,
        ledgerId,
        p.accountId,
        p.amountMinor,
        p.currency || "CNY",
        i,
      );
    });
  }

  const row = db
    .prepare(`SELECT * FROM finance_transactions WHERE id = ?`)
    .get(txId) as Record<string, unknown>;

  const tagsJson =
    input.tags !== undefined ? JSON.stringify(input.tags) : (row.tagsJson as string);
  const metaJson =
    input.meta !== undefined
      ? input.meta
        ? JSON.stringify(input.meta)
        : null
      : (row.metaJson as string | null);

  db.prepare(
    `UPDATE finance_transactions SET
      date = ?,
      time = ?,
      payee = ?,
      narration = ?,
      tagsJson = ?,
      metaJson = ?,
      updatedAt = datetime('now')
     WHERE id = ? AND ledgerId = ?`,
  ).run(
    input.date ?? row.date,
    input.time !== undefined ? input.time || null : row.time,
    input.payee !== undefined ? input.payee || null : row.payee,
    input.narration !== undefined ? input.narration || null : row.narration,
    tagsJson,
    metaJson,
    txId,
    ledgerId,
  );

  return true;
}

export interface TxListFilters {
  from?: string;
  to?: string;
  q?: string;
  /** 精确标签（JSON 数组内包含） */
  tag?: string;
  accountId?: string;
  /** 账户名路径前缀（如 Expenses:Transportation），匹配该前缀下所有账户 */
  accountPrefix?: string;
  /** 对方包含（归一前原始 LIKE） */
  payee?: string;
  limit?: number;
  offset?: number;
}

/** 账本预设标签（与 beancount-web 占位一致 + 常用中文） */
export const DEFAULT_PRESET_TAGS = [
  "旅行",
  "计划",
  "学习",
  "餐饮",
  "交通",
  "购物",
  "房租",
  "工资",
  "订阅",
  "医疗",
  "娱乐",
  "报销",
  "转账",
  "理财",
  "家庭",
  "工作",
];

/**
 * 聚合标签：预设 + 账本已用标签（去重，已用优先排前）
 */
export function listLedgerTags(db: Database.Database, ledgerId: string): {
  tags: string[];
  presets: string[];
  used: string[];
} {
  const rows = db
    .prepare(`SELECT tagsJson FROM finance_transactions WHERE ledgerId = ? AND tagsJson IS NOT NULL AND tagsJson != '[]'`)
    .all(ledgerId) as Array<{ tagsJson: string }>;
  const usedSet = new Set<string>();
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.tagsJson || "[]") as string[];
      for (const t of arr) {
        const s = String(t || "").trim();
        if (s) usedSet.add(s);
      }
    } catch {
      /* ignore */
    }
  }
  const used = [...usedSet].sort((a, b) => a.localeCompare(b, "zh"));
  const presets = DEFAULT_PRESET_TAGS.filter((t) => !usedSet.has(t));
  // 已用在前，预设补全在后
  const tags = [...used, ...presets];
  return { tags, presets: DEFAULT_PRESET_TAGS, used };
}

export function listTransactions(
  db: Database.Database,
  ledgerId: string,
  filters: TxListFilters = {},
) {
  const limit = Math.min(Math.max(filters.limit || 50, 1), 200);
  const offset = Math.max(filters.offset || 0, 0);
  const params: unknown[] = [ledgerId];
  let where = `t.ledgerId = ?`;

  if (filters.from) {
    where += ` AND t.date >= ?`;
    params.push(filters.from);
  }
  if (filters.to) {
    where += ` AND t.date <= ?`;
    params.push(filters.to);
  }
  if (filters.q) {
    where += ` AND (t.payee LIKE ? OR t.narration LIKE ? OR t.tagsJson LIKE ?)`;
    const like = `%${filters.q}%`;
    params.push(like, like, like);
  }
  if (filters.tag) {
    // JSON 数组包含 "tag" 字符串（简单可靠的 SQLite 匹配）
    const tag = filters.tag.trim();
    where += ` AND (
      t.tagsJson LIKE ? OR t.tagsJson LIKE ? OR t.tagsJson LIKE ? OR t.tagsJson = ?
    )`;
    params.push(
      `%\"${tag}\"%`,
      `%\"${tag}\",%`,
      `%,\"${tag}\"%`,
      JSON.stringify([tag]),
    );
  }
  if (filters.accountId) {
    where += ` AND EXISTS (
      SELECT 1 FROM finance_postings p WHERE p.transactionId = t.id AND p.accountId = ?
    )`;
    params.push(filters.accountId);
  }
  if (filters.accountPrefix) {
    const prefix = filters.accountPrefix.trim();
    if (prefix) {
      where += ` AND EXISTS (
        SELECT 1 FROM finance_postings p
        JOIN finance_accounts a ON a.id = p.accountId
        WHERE p.transactionId = t.id AND (a.name = ? OR a.name LIKE ?)
      )`;
      params.push(prefix, `${prefix}:%`);
    }
  }
  if (filters.payee) {
    where += ` AND t.payee LIKE ?`;
    params.push(`%${filters.payee}%`);
  }

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM finance_transactions t WHERE ${where}`).get(...params) as {
      c: number;
    }
  ).c;

  const rows = db
    .prepare(
      `SELECT t.* FROM finance_transactions t
       WHERE ${where}
       ORDER BY t.date DESC, t.time DESC, t.createdAt DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const getPostings = db.prepare(
    `SELECT p.*, a.name AS accountName, a.type AS accountType
     FROM finance_postings p
     JOIN finance_accounts a ON a.id = p.accountId
     WHERE p.transactionId = ?
     ORDER BY p.sortOrder`,
  );

  const items = rows.map((t) => {
    const postings = getPostings.all(t.id as string);
    let tags: string[] = [];
    try {
      tags = JSON.parse((t.tagsJson as string) || "[]");
    } catch {
      tags = [];
    }
    return { ...t, tags, tagsJson: undefined, postings };
  });

  return { items, total, limit, offset };
}

export function getTransaction(db: Database.Database, ledgerId: string, txId: string) {
  const t = db
    .prepare(`SELECT * FROM finance_transactions WHERE id = ? AND ledgerId = ?`)
    .get(txId, ledgerId) as Record<string, unknown> | undefined;
  if (!t) return null;
  const postings = db
    .prepare(
      `SELECT p.*, a.name AS accountName, a.type AS accountType
       FROM finance_postings p
       JOIN finance_accounts a ON a.id = p.accountId
       WHERE p.transactionId = ?
       ORDER BY p.sortOrder`,
    )
    .all(txId);
  let tags: string[] = [];
  try {
    tags = JSON.parse((t.tagsJson as string) || "[]");
  } catch {
    tags = [];
  }
  return { ...t, tags, tagsJson: undefined, postings };
}
