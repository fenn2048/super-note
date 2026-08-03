/**
 * 任务提醒到点 Worker（云端兜底 · 双提醒）
 * ---------------------------------------------------------------------------
 * 1) 提前量：remindAt → reminderFiredAt
 * 2) 截止日：endDate/dueDate → dueReminderFiredAt
 *
 * 客户端 LocalNotifications 为主路径；本 worker 写入 notifications + WS 兜底。
 */
import crypto from "crypto";
import type Database from "better-sqlite3";
import { getDb } from "../db/schema.js";
import {
  parseTaskDateTime,
  taskDatePartsToDate,
} from "../lib/reminders.js";

const INTERVAL_MS = 60 * 1000; // 1 分钟
const BATCH_LIMIT = 200;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export type TaskReminderProcessResult = {
  scanned: number;
  fired: number;
  errors: string[];
};

/**
 * 将 remindAt / due 字符串转为触发时刻的本地 Date。
 * date-only → 当天 09:00（与客户端 LocalNotifications 默认一致）
 */
export function resolveRemindFireTime(remindAt: string): Date | null {
  const parts = parseTaskDateTime(remindAt);
  if (!parts) {
    const d = new Date(remindAt);
    return isNaN(d.getTime()) ? null : d;
  }
  if (!parts.hasTime) {
    return new Date(parts.year, parts.month - 1, parts.day, 9, 0, 0, 0);
  }
  return taskDatePartsToDate(parts);
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

function notifyTaskReminder(
  db: Database.Database,
  userId: string,
  taskId: string,
  title: string,
  kind: "advance" | "due",
) {
  const id = crypto.randomUUID();
  const actorName = kind === "due" ? "截止提醒" : "任务提醒";
  const sourceTitle =
    kind === "due" ? `【今天截止】${title || "待办"}` : title || "待办提醒";

  db.prepare(
    `INSERT INTO notifications (id, userId, type, sourceType, sourceId, sourceTitle, actorId, actorName, createdAt)
     VALUES (?, ?, 'task_reminder', 'task', ?, ?, NULL, ?, datetime('now'))`,
  ).run(id, userId, taskId, sourceTitle, actorName);

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { broadcastToUser } = require("./realtime.js");
    let unreadCount = 0;
    try {
      const row = db
        .prepare(
          "SELECT COUNT(*) as count FROM notifications WHERE userId = ? AND readAt IS NULL",
        )
        .get(userId) as { count: number };
      unreadCount = row?.count ?? 0;
    } catch {
      /* ignore */
    }
    broadcastToUser(userId, {
      type: "notification:received",
      unreadCount,
      notification: {
        id,
        type: "task_reminder",
        sourceType: "task",
        sourceId: taskId,
        sourceTitle,
        actorName,
        kind,
      },
    });
  } catch {
    /* realtime optional during tests */
  }
}

function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

/**
 * 扫描并触发到期任务提醒（提前量 + 截止日）
 */
export function processDueTaskReminders(
  db: Database.Database,
  nowMs: number = Date.now(),
): TaskReminderProcessResult {
  const result: TaskReminderProcessResult = { scanned: 0, fired: 0, errors: [] };

  if (!hasColumn(db, "project_tasks", "reminderFiredAt")) {
    return result;
  }
  const hasDueFired = hasColumn(db, "project_tasks", "dueReminderFiredAt");

  // ---- 提前量提醒 ----
  try {
    const candidates = db
      .prepare(
        `
      SELECT id, title, remindAt, endDate, assigneeId, creatorId
      FROM project_tasks
      WHERE COALESCE(isCompleted, 0) = 0
        AND remindAt IS NOT NULL
        AND TRIM(remindAt) != ''
        AND reminderFiredAt IS NULL
      ORDER BY remindAt ASC
      LIMIT ?
    `,
      )
      .all(BATCH_LIMIT) as Array<{
      id: string;
      title: string;
      remindAt: string;
      endDate: string | null;
      assigneeId: string | null;
      creatorId: string | null;
    }>;

    result.scanned += candidates.length;

    const markFired = db.prepare(
      `UPDATE project_tasks SET reminderFiredAt = datetime('now'), updatedAt = datetime('now')
       WHERE id = ? AND reminderFiredAt IS NULL AND COALESCE(isCompleted, 0) = 0`,
    );

    for (const task of candidates) {
      try {
        const fireAt = resolveRemindFireTime(task.remindAt);
        if (!fireAt || fireAt.getTime() > nowMs) continue;

        const userId = task.assigneeId || task.creatorId;
        if (!userId) {
          markFired.run(task.id);
          continue;
        }

        const info = markFired.run(task.id);
        if (info.changes === 0) continue;

        notifyTaskReminder(db, userId, task.id, task.title, "advance");
        result.fired += 1;
      } catch (e: any) {
        result.errors.push(`${task.id}: ${e?.message || e}`);
      }
    }
  } catch (e: any) {
    result.errors.push(`advance-query: ${e?.message || e}`);
  }

  // ---- 截止日当天提醒 ----
  if (hasDueFired) {
    try {
      const dueCandidates = db
        .prepare(
          `
        SELECT id, title, remindAt, endDate, assigneeId, creatorId
        FROM project_tasks
        WHERE COALESCE(isCompleted, 0) = 0
          AND endDate IS NOT NULL
          AND TRIM(endDate) != ''
          AND dueReminderFiredAt IS NULL
        ORDER BY endDate ASC
        LIMIT ?
      `,
        )
        .all(BATCH_LIMIT) as Array<{
        id: string;
        title: string;
        remindAt: string | null;
        endDate: string;
        assigneeId: string | null;
        creatorId: string | null;
      }>;

      result.scanned += dueCandidates.length;

      const markDue = db.prepare(
        `UPDATE project_tasks SET dueReminderFiredAt = datetime('now'), updatedAt = datetime('now')
         WHERE id = ? AND dueReminderFiredAt IS NULL AND COALESCE(isCompleted, 0) = 0`,
      );

      for (const task of dueCandidates) {
        try {
          const dueAt = resolveRemindFireTime(task.endDate);
          if (!dueAt || dueAt.getTime() > nowMs) continue;

          // 若提前量与截止同一分钟且已（或将）由 advance 覆盖，截止侧只标记不重复文案
          // 仍标记 dueReminderFiredAt 防反复扫描
          let skipNotify = false;
          if (task.remindAt) {
            const adv = resolveRemindFireTime(task.remindAt);
            if (adv && sameMinute(adv, dueAt)) {
              skipNotify = true;
            }
          }

          const userId = task.assigneeId || task.creatorId;
          if (!userId) {
            markDue.run(task.id);
            continue;
          }

          const info = markDue.run(task.id);
          if (info.changes === 0) continue;

          if (!skipNotify) {
            notifyTaskReminder(db, userId, task.id, task.title, "due");
            result.fired += 1;
          }
        } catch (e: any) {
          result.errors.push(`due:${task.id}: ${e?.message || e}`);
        }
      }
    } catch (e: any) {
      result.errors.push(`due-query: ${e?.message || e}`);
    }
  }

  // legacy tasks 表（提前量 only；dueDate 若有且列存在）
  if (hasColumn(db, "tasks", "reminderFiredAt")) {
    try {
      const legacy = db
        .prepare(
          `
        SELECT id, title, remindAt, dueDate, userId
        FROM tasks
        WHERE COALESCE(isCompleted, 0) = 0
          AND remindAt IS NOT NULL
          AND TRIM(remindAt) != ''
          AND reminderFiredAt IS NULL
        LIMIT ?
      `,
        )
        .all(Math.min(50, BATCH_LIMIT)) as Array<{
        id: string;
        title: string;
        remindAt: string;
        dueDate: string | null;
        userId: string;
      }>;

      const markLegacy = db.prepare(
        `UPDATE tasks SET reminderFiredAt = datetime('now'), updatedAt = datetime('now')
         WHERE id = ? AND reminderFiredAt IS NULL AND COALESCE(isCompleted, 0) = 0`,
      );

      for (const task of legacy) {
        try {
          const fireAt = resolveRemindFireTime(task.remindAt);
          if (!fireAt || fireAt.getTime() > nowMs) continue;
          if (!task.userId) {
            markLegacy.run(task.id);
            continue;
          }
          const info = markLegacy.run(task.id);
          if (info.changes === 0) continue;
          notifyTaskReminder(db, task.userId, task.id, task.title, "advance");
          result.fired += 1;
          result.scanned += 1;
        } catch (e: any) {
          result.errors.push(`legacy:${task.id}: ${e?.message || e}`);
        }
      }

      if (hasColumn(db, "tasks", "dueReminderFiredAt")) {
        const legacyDue = db
          .prepare(
            `
          SELECT id, title, remindAt, dueDate, userId
          FROM tasks
          WHERE COALESCE(isCompleted, 0) = 0
            AND dueDate IS NOT NULL
            AND TRIM(dueDate) != ''
            AND dueReminderFiredAt IS NULL
          LIMIT ?
        `,
          )
          .all(Math.min(50, BATCH_LIMIT)) as Array<{
          id: string;
          title: string;
          remindAt: string | null;
          dueDate: string;
          userId: string;
        }>;

        const markLegacyDue = db.prepare(
          `UPDATE tasks SET dueReminderFiredAt = datetime('now'), updatedAt = datetime('now')
           WHERE id = ? AND dueReminderFiredAt IS NULL AND COALESCE(isCompleted, 0) = 0`,
        );

        for (const task of legacyDue) {
          try {
            const dueAt = resolveRemindFireTime(task.dueDate);
            if (!dueAt || dueAt.getTime() > nowMs) continue;
            let skipNotify = false;
            if (task.remindAt) {
              const adv = resolveRemindFireTime(task.remindAt);
              if (adv && sameMinute(adv, dueAt)) skipNotify = true;
            }
            if (!task.userId) {
              markLegacyDue.run(task.id);
              continue;
            }
            const info = markLegacyDue.run(task.id);
            if (info.changes === 0) continue;
            if (!skipNotify) {
              notifyTaskReminder(db, task.userId, task.id, task.title, "due");
              result.fired += 1;
            }
            result.scanned += 1;
          } catch (e: any) {
            result.errors.push(`legacy-due:${task.id}: ${e?.message || e}`);
          }
        }
      }
    } catch {
      /* legacy table may not exist */
    }
  }

  return result;
}

function tick() {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    const r = processDueTaskReminders(db);
    if (r.fired || r.errors.length) {
      console.log(
        `[task-reminder-worker] scanned=${r.scanned} fired=${r.fired} errors=${r.errors.length}`,
      );
      if (r.errors.length) {
        console.warn("[task-reminder-worker] errors:", r.errors.slice(0, 5));
      }
    }
  } catch (e) {
    console.warn("[task-reminder-worker] tick failed:", e);
  } finally {
    running = false;
  }
}

export function startTaskReminderWorker() {
  if (timer) return;
  setTimeout(() => tick(), 15_000);
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  console.log("[task-reminder-worker] started (interval 1m, dual reminder)");
}

export function stopTaskReminderWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function runTaskReminderWorkerOnce() {
  tick();
}
