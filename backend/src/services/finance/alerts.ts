import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import { listBudgets } from "./budget.js";

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
      /* optional */
    }
  } catch (e) {
    console.warn("[finance-alerts] notify failed:", e);
  }
}

function shouldAlert(db: Database.Database, ledgerId: string, alertKey: string): boolean {
  const exists = db
    .prepare(`SELECT id FROM finance_alert_log WHERE ledgerId = ? AND alertKey = ?`)
    .get(ledgerId, alertKey);
  if (exists) return false;
  db.prepare(
    `INSERT INTO finance_alert_log (id, ledgerId, alertKey, createdAt)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(uuidv4(), ledgerId, alertKey);
  return true;
}

/**
 * 扫描所有账本当月预算，接近/超支时通知所有者（每月每预算每档仅一次）
 */
export function processBudgetAlerts(db: Database.Database): { sent: number } {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ledgers = db
    .prepare(`SELECT id, ownerUserId, workspaceId, title FROM finance_ledgers`)
    .all() as Array<{
    id: string;
    ownerUserId: string;
    workspaceId: string | null;
    title: string;
  }>;

  let sent = 0;
  for (const l of ledgers) {
    let budgets;
    try {
      budgets = listBudgets(db, l.id, ym);
    } catch {
      continue;
    }
    const recipients = new Set<string>([l.ownerUserId]);
    if (l.workspaceId) {
      const members = db
        .prepare(`SELECT userId FROM workspace_members WHERE workspaceId = ?`)
        .all(l.workspaceId) as Array<{ userId: string }>;
      for (const m of members) recipients.add(m.userId);
    }
    for (const b of budgets) {
      const label = b.accountName || "总支出";
      if (b.ratio > 1) {
        const key = `budget:over:${ym}:${b.id}`;
        if (shouldAlert(db, l.id, key)) {
          for (const uid of recipients) {
            notify(
              db,
              uid,
              "finance_budget_over",
              b.id,
              `「${l.title}」${label} 已超预算（${(b.ratio * 100).toFixed(0)}%）`,
            );
            sent++;
          }
        }
      } else if (b.ratio >= 0.85) {
        const key = `budget:near:${ym}:${b.id}`;
        if (shouldAlert(db, l.id, key)) {
          for (const uid of recipients) {
            notify(
              db,
              uid,
              "finance_budget_warn",
              b.id,
              `「${l.title}」${label} 已用 ${(b.ratio * 100).toFixed(0)}% 预算`,
            );
            sent++;
          }
        }
      }
    }
  }
  return { sent };
}
