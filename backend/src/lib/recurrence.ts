import crypto from "crypto";
import {
  calculateRemindAt,
  formatTaskDateTime,
  parseTaskDateTime,
  taskDatePartsToDate,
} from "./reminders.js";

export interface RecurrenceRule {
  type: "weekly" | "interval" | "weekday" | "custom_weekdays" | "monthly" | "annually";
  value?: number; // for interval
  day?: number; // for weekly (0=Sun, 1=Mon, ..., 6=Sat) or monthly (1-31) or annually (1-31)
  days?: number[]; // for custom_weekdays
  month?: number; // for annually (1-12)
}

export type RecurrenceResult = {
  created: boolean;
  newTaskId?: string;
  nextDueDate?: string;
  nextRemindAt?: string | null;
  reason?: string;
};

export function getNextOccurrence(baseDate: Date, rule: RecurrenceRule): Date {
  const next = new Date(baseDate.getTime());
  // Start checking from tomorrow to prevent getting stuck on the same day
  next.setDate(next.getDate() + 1);

  if (rule.type === "interval") {
    const days = rule.value || 1;
    const result = new Date(baseDate.getTime());
    result.setDate(result.getDate() + days);
    return result;
  }

  if (rule.type === "weekday") {
    while (next.getDay() === 0 || next.getDay() === 6) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (rule.type === "weekly") {
    const targetDay = rule.day ?? 1;
    while (next.getDay() !== targetDay) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (rule.type === "custom_weekdays") {
    const targetDays = Array.isArray(rule.days) ? rule.days.map(Number) : [];
    if (targetDays.length === 0) {
      return next;
    }
    while (!targetDays.includes(next.getDay())) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  if (rule.type === "monthly") {
    const targetDay = rule.day ?? 1; // 1 to 31
    // Work in calendar months from the base occurrence month
    let year = baseDate.getFullYear();
    let month = baseDate.getMonth(); // 0-11

    // Always advance at least one month from base's calendar month when base day >= target,
    // otherwise stay in current month if target day is still ahead... 
    // Spec: next occurrence strictly after baseDate.
    const tryDate = (y: number, m: number) => {
      const lastDay = new Date(y, m + 1, 0).getDate();
      const actualDay = Math.min(targetDay, lastDay);
      return new Date(y, m, actualDay, baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
    };

    // Start from base's month; if that day is not after base, go to next months
    let candidate = tryDate(year, month);
    if (candidate.getTime() <= baseDate.getTime()) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = tryDate(year, month);
    }
    // Safety: if still not after (shouldn't happen), keep advancing
    let guard = 0;
    while (candidate.getTime() <= baseDate.getTime() && guard < 24) {
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      candidate = tryDate(year, month);
      guard += 1;
    }
    return candidate;
  }

  if (rule.type === "annually") {
    const targetMonth = (rule.month ?? 1) - 1; // 0-indexed month
    const targetDay = rule.day ?? 1;
    let targetYear = baseDate.getFullYear();

    const make = (y: number) => {
      const lastDay = new Date(y, targetMonth + 1, 0).getDate();
      const actualDay = Math.min(targetDay, lastDay);
      return new Date(y, targetMonth, actualDay, baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
    };

    let candidate = make(targetYear);
    if (candidate.getTime() <= baseDate.getTime()) {
      targetYear += 1;
      candidate = make(targetYear);
    }
    return candidate;
  }

  return next;
}

/** Next occurrence as local wall-clock string (never bare UTC ISO). */
export function getNextOccurrenceString(baseStr: string, rule: RecurrenceRule): string {
  if (!baseStr) return "";

  const parts = parseTaskDateTime(baseStr);
  let baseDate: Date;
  let withTime = false;

  if (parts) {
    baseDate = taskDatePartsToDate(parts);
    withTime = parts.hasTime;
  } else {
    baseDate = new Date(baseStr);
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date();
    }
    withTime = baseStr.includes("T") || baseStr.includes(" ") || baseStr.includes("Z");
  }

  const nextDate = getNextOccurrence(baseDate, rule);
  return formatTaskDateTime(nextDate, withTime);
}

function computeNextRemindAt(
  task: {
    remindAt?: string | null;
    endDate?: string | null;
    dueDate?: string | null;
    reminderOffsetValue?: number | null;
    reminderOffsetUnit?: string | null;
  },
  nextDue: string,
): string | null {
  if (!task.remindAt) return null;

  if (
    task.reminderOffsetValue !== undefined &&
    task.reminderOffsetValue !== null &&
    task.reminderOffsetUnit
  ) {
    return calculateRemindAt(nextDue, task.reminderOffsetValue, task.reminderOffsetUnit);
  }

  // Fallback: preserve offset duration from original due/remind pair
  const dueStr = task.endDate || task.dueDate;
  if (!dueStr) return null;
  const dueParts = parseTaskDateTime(dueStr);
  const remindParts = parseTaskDateTime(task.remindAt);
  if (!dueParts || !remindParts) return null;
  const diff =
    taskDatePartsToDate(dueParts).getTime() - taskDatePartsToDate(remindParts).getTime();
  if (isNaN(diff)) return null;
  const nextParts = parseTaskDateTime(nextDue);
  if (!nextParts) return null;
  const remDate = new Date(taskDatePartsToDate(nextParts).getTime() - diff);
  return formatTaskDateTime(remDate, remindParts.hasTime || nextParts.hasTime);
}

/**
 * On complete of a recurring task: insert the next occurrence.
 * Returns structured result (never throws to caller for expected skips).
 */
export function handleRecurringTask(
  db: any,
  taskId: string,
  isProjectTask: boolean,
): RecurrenceResult {
  try {
    if (isProjectTask) {
      const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId);
      if (!task) return { created: false, reason: "task_not_found" };
      if (!task.isRecurring || !task.recurrenceRule) {
        return { created: false, reason: "not_recurring" };
      }

      let rule: RecurrenceRule;
      try {
        rule =
          typeof task.recurrenceRule === "string"
            ? JSON.parse(task.recurrenceRule)
            : task.recurrenceRule;
      } catch {
        return { created: false, reason: "invalid_recurrence_rule" };
      }
      if (!rule || !rule.type) {
        return { created: false, reason: "invalid_recurrence_rule" };
      }

      if (!task.endDate) return { created: false, reason: "missing_end_date" };

      const nextEndDate = getNextOccurrenceString(task.endDate, rule);
      if (!nextEndDate) return { created: false, reason: "next_date_failed" };

      if (task.recurrenceEndDate) {
        const recurEnd = new Date(task.recurrenceEndDate).getTime();
        const nextEnd = new Date(nextEndDate.includes("T") || nextEndDate.includes(" ")
          ? nextEndDate.replace(" ", "T")
          : `${nextEndDate}T00:00:00`).getTime();
        // Compare via parseTaskDateTime for local consistency
        const nextParts = parseTaskDateTime(nextEndDate);
        const endParts = parseTaskDateTime(task.recurrenceEndDate);
        if (nextParts && endParts) {
          if (taskDatePartsToDate(nextParts).getTime() > taskDatePartsToDate(endParts).getTime()) {
            return { created: false, reason: "past_recurrence_end" };
          }
        } else if (!isNaN(recurEnd) && !isNaN(nextEnd) && nextEnd > recurEnd) {
          return { created: false, reason: "past_recurrence_end" };
        }
      }

      const nextRemindAt = computeNextRemindAt(task, nextEndDate);
      const newId = crypto.randomUUID();

      let targetStageId = task.stageId;
      const stages = db
        .prepare("SELECT * FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC")
        .all(task.projectId) as any[];
      if (stages && stages.length > 0) {
        const inProgressStage = stages.find((s) => s.name === "进行中");
        if (inProgressStage) {
          targetStageId = inProgressStage.id;
        } else {
          const firstValidStage = stages.find((s) => s.name !== "已完成");
          if (firstValidStage) {
            targetStageId = firstValidStage.id;
          }
        }
      }

      db.prepare(
        `
        INSERT INTO project_tasks (
          id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate,
          description, cover, sortOrder, creatorId, modifierId, priority, remindAt,
          titleColor, progress, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `,
      ).run(
        newId,
        task.projectId,
        targetStageId,
        task.title,
        task.assigneeId,
        task.startDate,
        nextEndDate,
        task.description,
        task.cover,
        task.sortOrder,
        task.creatorId,
        task.modifierId,
        task.priority,
        nextRemindAt,
        task.titleColor,
        task.recurrenceRule,
        task.reminderOffsetValue,
        task.reminderOffsetUnit,
        task.recurrenceEndDate,
      );

      const members = db
        .prepare("SELECT userId FROM project_task_members WHERE taskId = ?")
        .all(taskId) as { userId: string }[];
      const insertMember = db.prepare(
        "INSERT OR IGNORE INTO project_task_members (taskId, userId) VALUES (?, ?)",
      );
      for (const m of members) {
        insertMember.run(newId, m.userId);
      }

      const tags = db
        .prepare("SELECT tagId FROM project_task_tags WHERE taskId = ?")
        .all(taskId) as { tagId: string }[];
      const insertTag = db.prepare(
        "INSERT OR IGNORE INTO project_task_tags (taskId, tagId) VALUES (?, ?)",
      );
      for (const t of tags) {
        insertTag.run(newId, t.tagId);
      }

      const checklists = db
        .prepare("SELECT title, sortOrder FROM project_task_checklists WHERE taskId = ?")
        .all(taskId) as { title: string; sortOrder: number }[];
      const insertChecklist = db.prepare(
        "INSERT INTO project_task_checklists (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, 0, ?)",
      );
      for (const cl of checklists) {
        insertChecklist.run(crypto.randomUUID(), newId, cl.title, cl.sortOrder);
      }

      return {
        created: true,
        newTaskId: newId,
        nextDueDate: nextEndDate,
        nextRemindAt,
      };
    }

    // legacy tasks table
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (!task) return { created: false, reason: "task_not_found" };
    if (!task.isRecurring || !task.recurrenceRule) {
      return { created: false, reason: "not_recurring" };
    }

    let rule: RecurrenceRule;
    try {
      rule =
        typeof task.recurrenceRule === "string"
          ? JSON.parse(task.recurrenceRule)
          : task.recurrenceRule;
    } catch {
      return { created: false, reason: "invalid_recurrence_rule" };
    }
    if (!rule || !rule.type) {
      return { created: false, reason: "invalid_recurrence_rule" };
    }

    if (!task.dueDate) return { created: false, reason: "missing_end_date" };

    const nextDueDate = getNextOccurrenceString(task.dueDate, rule);
    if (!nextDueDate) return { created: false, reason: "next_date_failed" };

    if (task.recurrenceEndDate) {
      const nextParts = parseTaskDateTime(nextDueDate);
      const endParts = parseTaskDateTime(task.recurrenceEndDate);
      if (nextParts && endParts) {
        if (taskDatePartsToDate(nextParts).getTime() > taskDatePartsToDate(endParts).getTime()) {
          return { created: false, reason: "past_recurrence_end" };
        }
      }
    }

    const nextRemindAt = computeNextRemindAt(
      { ...task, endDate: task.dueDate },
      nextDueDate,
    );
    const newId = crypto.randomUUID();

    db.prepare(
      `
      INSERT INTO tasks (
        id, userId, workspaceId, title, isCompleted, status, priority, dueDate, remindAt,
        noteId, parentId, sortOrder, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `,
    ).run(
      newId,
      task.userId,
      task.workspaceId,
      task.title,
      task.priority,
      nextDueDate,
      nextRemindAt,
      task.noteId,
      task.parentId,
      task.sortOrder,
      task.recurrenceRule,
      task.reminderOffsetValue,
      task.reminderOffsetUnit,
      task.recurrenceEndDate,
    );

    const tags = db
      .prepare("SELECT tagId FROM task_tags WHERE taskId = ?")
      .all(taskId) as { tagId: string }[];
    const insertTag = db.prepare(
      "INSERT OR IGNORE INTO task_tags (taskId, tagId) VALUES (?, ?)",
    );
    for (const t of tags) {
      insertTag.run(newId, t.tagId);
    }

    return {
      created: true,
      newTaskId: newId,
      nextDueDate,
      nextRemindAt,
    };
  } catch (err) {
    console.error("Error handling recurrence:", err);
    return {
      created: false,
      reason: `error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
