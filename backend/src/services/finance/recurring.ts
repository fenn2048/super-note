import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import { yuanToMinor } from "./amount.js";
import { insertTransaction } from "./transactions.js";

export type RecurringRuleType = "monthly" | "weekly" | "interval";

export interface RecurringRule {
  /** monthly: 每月第几天 1-28；weekly: 0=周日..6=周六；interval: 每 N 天 */
  day?: number;
  days?: number;
  weekday?: number;
}

export interface RecurringPayload {
  kind?: "expense" | "income" | "transfer";
  amountYuan?: number | string;
  fromAccountId?: string;
  toAccountId?: string;
  payee?: string;
  narration?: string;
  tags?: string[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

/** 计算下一次执行日（严格晚于 fromDate 的日历日） */
export function nextRunAfter(
  fromDateYmd: string,
  ruleType: RecurringRuleType,
  rule: RecurringRule,
): string {
  const from = parseYmd(fromDateYmd);

  if (ruleType === "interval") {
    const n = Math.max(1, rule.days || rule.day || 1);
    const next = new Date(from);
    next.setDate(next.getDate() + n);
    return ymd(next);
  }

  if (ruleType === "weekly") {
    const target = rule.weekday ?? rule.day ?? 1;
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    while (next.getDay() !== target) {
      next.setDate(next.getDate() + 1);
    }
    return ymd(next);
  }

  // monthly
  const targetDay = Math.min(28, Math.max(1, rule.day || 1));
  let y = from.getFullYear();
  let m = from.getMonth(); // 0-based
  // 本月目标日
  let candidate = new Date(y, m, targetDay, 12, 0, 0);
  if (candidate.getTime() <= from.getTime()) {
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    candidate = new Date(y, m, targetDay, 12, 0, 0);
  }
  return ymd(candidate);
}

function buildPostings(payload: RecurringPayload): Array<{ accountId: string; amountMinor: number }> {
  const abs = Math.abs(yuanToMinor(payload.amountYuan ?? 0));
  if (!abs || !payload.fromAccountId || !payload.toAccountId) {
    throw new Error("定期记账缺少金额或账户");
  }
  const kind = payload.kind || "expense";
  if (kind === "expense" || kind === "transfer" || kind === "income") {
    return [
      { accountId: payload.toAccountId, amountMinor: abs },
      { accountId: payload.fromAccountId, amountMinor: -abs },
    ];
  }
  return [
    { accountId: payload.toAccountId, amountMinor: abs },
    { accountId: payload.fromAccountId, amountMinor: -abs },
  ];
}

function notify(
  db: Database.Database,
  userId: string,
  type: string,
  sourceId: string,
  sourceTitle: string,
) {
  const id = uuidv4();
  try {
    db.prepare(
      `INSERT INTO notifications (id, userId, type, sourceType, sourceId, sourceTitle, actorId, actorName, createdAt)
       VALUES (?, ?, ?, 'finance', ?, ?, NULL, '记账', datetime('now'))`,
    ).run(id, userId, type, sourceId, sourceTitle);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { broadcastToUser } = require("../realtime.js");
      broadcastToUser(userId, {
        type: "notification:received",
        notification: {
          id,
          type,
          sourceType: "finance",
          sourceId,
          sourceTitle,
          actorName: "记账",
        },
      });
    } catch {
      /* realtime optional */
    }
  } catch (e) {
    console.warn("[finance-recurring] notify failed:", e);
  }
}

export interface ProcessResult {
  posted: number;
  notified: number;
  errors: string[];
}

/** 处理所有到期的定期记账（系统任务，不需要 unlock） */
export function processDueRecurring(db: Database.Database, todayYmd?: string): ProcessResult {
  const today = todayYmd || ymd(new Date());
  const rows = db
    .prepare(
      `SELECT r.*, l.ownerUserId, l.workspaceId, l.title AS ledgerTitle
       FROM finance_recurring r
       JOIN finance_ledgers l ON l.id = r.ledgerId
       WHERE r.enabled = 1 AND r.nextRunDate <= ?`,
    )
    .all(today) as Array<{
    id: string;
    ledgerId: string;
    name: string;
    ruleType: RecurringRuleType;
    ruleJson: string;
    payloadJson: string;
    nextRunDate: string;
    endDate: string | null;
    autoPost: number;
    ownerUserId: string;
    workspaceId: string | null;
    ledgerTitle: string;
  }>;

  let posted = 0;
  let notified = 0;
  const errors: string[] = [];

  const notifyLedgerUsers = (
    ownerUserId: string,
    workspaceId: string | null,
    type: string,
    sourceId: string,
    title: string,
  ) => {
    const userIds = new Set<string>([ownerUserId]);
    if (workspaceId) {
      const members = db
        .prepare(`SELECT userId FROM workspace_members WHERE workspaceId = ?`)
        .all(workspaceId) as Array<{ userId: string }>;
      for (const m of members) userIds.add(m.userId);
    }
    for (const uid of userIds) notify(db, uid, type, sourceId, title);
  };

  for (const r of rows) {
    try {
      if (r.endDate && r.endDate < today) {
        db.prepare(
          `UPDATE finance_recurring SET enabled = 0, updatedAt = datetime('now') WHERE id = ?`,
        ).run(r.id);
        continue;
      }

      let rule: RecurringRule = {};
      try {
        rule = JSON.parse(r.ruleJson || "{}");
      } catch {
        rule = {};
      }
      let payload: RecurringPayload = {};
      try {
        payload = JSON.parse(r.payloadJson || "{}");
      } catch {
        payload = {};
      }

      if (r.autoPost) {
        const postings = buildPostings(payload);
        insertTransaction(db, r.ledgerId, {
          date: r.nextRunDate > today ? today : r.nextRunDate,
          payee: payload.payee || r.name,
          narration: payload.narration || `定期：${r.name}`,
          tags: payload.tags || ["recurring"],
          source: "recurring",
          sourceRef: `recurring:${r.id}:${r.nextRunDate}`,
          postings,
        });
        posted++;
        notifyLedgerUsers(
          r.ownerUserId,
          r.workspaceId,
          "finance_recurring_posted",
          r.id,
          `「${r.ledgerTitle}」已自动记账：${r.name}`,
        );
      } else {
        notified++;
        notifyLedgerUsers(
          r.ownerUserId,
          r.workspaceId,
          "finance_recurring_due",
          r.id,
          `「${r.ledgerTitle}」定期提醒：${r.name}（请手动确认记账）`,
        );
      }

      const next = nextRunAfter(r.nextRunDate, r.ruleType, rule);
      // 若 next 仍 ≤ today（例如积压），连续推进直到未来
      let nextDate = next;
      let guard = 0;
      while (nextDate <= today && guard < 400) {
        nextDate = nextRunAfter(nextDate, r.ruleType, rule);
        guard++;
      }

      db.prepare(
        `UPDATE finance_recurring SET
          nextRunDate = ?,
          lastRunAt = datetime('now'),
          updatedAt = datetime('now')
         WHERE id = ?`,
      ).run(nextDate, r.id);
    } catch (e: any) {
      errors.push(`${r.name}: ${e?.message || e}`);
    }
  }

  return { posted, notified, errors };
}
