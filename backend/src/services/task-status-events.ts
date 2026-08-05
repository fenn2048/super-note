/**
 * 任务状态事件 + completedAt 维护
 * 用于 Cycle Time / Active Time 统计
 */
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";

export type TaskStatus = "pending" | "in_progress" | "paused" | "completed" | string;

export function recordTaskStatusEvent(
  db: Database.Database,
  params: {
    taskId: string;
    userId: string;
    fromStatus: string | null | undefined;
    toStatus: string;
    at?: string;
  },
): void {
  if (!params.taskId || !params.toStatus) return;
  const from = params.fromStatus ?? null;
  if (from === params.toStatus) return;
  try {
    db.prepare(
      `INSERT INTO task_status_events (id, taskId, userId, fromStatus, toStatus, at)
       VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    ).run(uuid(), params.taskId, params.userId, from, params.toStatus, params.at || null);
  } catch (e) {
    console.warn("[task-status-events] insert failed", e);
  }
}

/**
 * 在更新 project_tasks 时同步 completedAt 与状态事件。
 * 在实际 UPDATE 之前调用，传入变更前的 task 行与即将写入的字段。
 */
export function applyTaskLifecycleHooks(
  db: Database.Database,
  opts: {
    taskId: string;
    userId: string;
    prev: {
      status?: string | null;
      isCompleted?: number | null;
    };
    next: {
      status?: string | null;
      isCompleted?: number | boolean | null;
    };
  },
): { completedAtSql: string | null; completedAtValue: string | null } {
  const prevCompleted = Number(opts.prev.isCompleted || 0) === 1;
  const nextCompletedRaw = opts.next.isCompleted;
  const nextCompleted =
    nextCompletedRaw === undefined || nextCompletedRaw === null
      ? prevCompleted
      : nextCompletedRaw === true || nextCompletedRaw === 1 || String(nextCompletedRaw) === "1";

  let prevStatus = (opts.prev.status || (prevCompleted ? "completed" : "pending")) as string;
  let nextStatus =
    opts.next.status !== undefined && opts.next.status !== null
      ? String(opts.next.status)
      : prevStatus;

  // 完成勾选时强制对齐 status
  if (nextCompleted && !prevCompleted) {
    nextStatus = "completed";
  } else if (!nextCompleted && prevCompleted) {
    if (nextStatus === "completed") nextStatus = "pending";
  }

  if (nextStatus !== prevStatus) {
    recordTaskStatusEvent(db, {
      taskId: opts.taskId,
      userId: opts.userId,
      fromStatus: prevStatus,
      toStatus: nextStatus,
    });
  }

  // completedAt 维护
  if (nextCompleted && !prevCompleted) {
    return { completedAtSql: "completedAt = datetime('now')", completedAtValue: "set" };
  }
  if (!nextCompleted && prevCompleted) {
    return { completedAtSql: "completedAt = NULL", completedAtValue: "clear" };
  }
  return { completedAtSql: null, completedAtValue: null };
}

/** 从 status events 汇总 Active Time（分钟）：in_progress 区间之和 */
export function computeActiveMinutes(
  db: Database.Database,
  taskId: string,
  rangeFrom?: string | null,
  rangeTo?: string | null,
): number {
  const events = db
    .prepare(
      `SELECT toStatus, at FROM task_status_events
       WHERE taskId = ?
       ORDER BY at ASC`,
    )
    .all(taskId) as { toStatus: string; at: string }[];

  if (events.length === 0) return 0;

  let activeMs = 0;
  let openStart: number | null = null;
  const fromMs = rangeFrom ? Date.parse(rangeFrom.replace(" ", "T")) : null;
  const toMs = rangeTo ? Date.parse(rangeTo.replace(" ", "T")) : null;

  const clip = (start: number, end: number) => {
    let s = start;
    let e = end;
    if (fromMs != null && e < fromMs) return 0;
    if (toMs != null && s > toMs) return 0;
    if (fromMs != null) s = Math.max(s, fromMs);
    if (toMs != null) e = Math.min(e, toMs);
    return Math.max(0, e - s);
  };

  for (const ev of events) {
    const t = Date.parse(String(ev.at).replace(" ", "T"));
    if (Number.isNaN(t)) continue;
    if (ev.toStatus === "in_progress") {
      if (openStart == null) openStart = t;
    } else if (openStart != null) {
      activeMs += clip(openStart, t);
      openStart = null;
    }
  }
  // 仍在进行中：算到 rangeTo 或 now
  if (openStart != null) {
    const end = toMs != null ? toMs : Date.now();
    activeMs += clip(openStart, end);
  }

  return Math.round(activeMs / 60000);
}

/** 首次进入 in_progress 的时间；无则 null */
export function firstInProgressAt(db: Database.Database, taskId: string): string | null {
  const row = db
    .prepare(
      `SELECT at FROM task_status_events
       WHERE taskId = ? AND toStatus = 'in_progress'
       ORDER BY at ASC LIMIT 1`,
    )
    .get(taskId) as { at: string } | undefined;
  return row?.at || null;
}
