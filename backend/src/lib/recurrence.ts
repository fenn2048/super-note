import crypto from "crypto";

export interface RecurrenceRule {
  type: "weekly" | "interval" | "weekday" | "custom_weekdays" | "monthly" | "annually";
  value?: number; // for interval
  day?: number; // for weekly (0=Sun, 1=Mon, ..., 6=Sat) or monthly (1-31) or annually (1-31)
  days?: number[]; // for custom_weekdays
  month?: number; // for annually (1-12)
}

export function getNextOccurrence(baseDate: Date, rule: RecurrenceRule): Date {
  const next = new Date(baseDate.getTime());
  // Start checking from tomorrow to prevent getting stuck
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
    const currentMonth = next.getMonth();
    const currentYear = next.getFullYear();

    const candidate = new Date(currentYear, currentMonth, targetDay, baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
    if (candidate.getTime() <= baseDate.getTime()) {
      next.setMonth(next.getMonth() + 1);
    }

    const targetMonth = next.getMonth();
    const targetYear = next.getFullYear();
    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const actualDay = Math.min(targetDay, lastDay);
    next.setFullYear(targetYear, targetMonth, actualDay);
    return next;
  }

  if (rule.type === "annually") {
    const targetMonth = (rule.month ?? 1) - 1; // 0-indexed month
    const targetDay = rule.day ?? 1;
    let targetYear = next.getFullYear();

    const candidate = new Date(targetYear, targetMonth, targetDay, baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
    if (candidate.getTime() <= baseDate.getTime()) {
      targetYear += 1;
    }

    const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
    const actualDay = Math.min(targetDay, lastDay);
    next.setFullYear(targetYear, targetMonth, actualDay);
    return next;
  }

  return next;
}

import { calculateRemindAt } from './reminders.js';

export function getNextOccurrenceString(baseStr: string, rule: RecurrenceRule): string {
  if (!baseStr) return "";
  const isIso = baseStr.includes("T") || baseStr.includes("Z");
  const hasTime = baseStr.includes(" ") || baseStr.includes("T");

  let baseDate = new Date(baseStr);
  if (isNaN(baseDate.getTime())) {
    baseDate = new Date();
  }

  const nextDate = getNextOccurrence(baseDate, rule);

  if (isIso) {
    return nextDate.toISOString();
  } else if (hasTime) {
    const yyyy = nextDate.getFullYear();
    const MM = String(nextDate.getMonth() + 1).padStart(2, '0');
    const dd = String(nextDate.getDate()).padStart(2, '0');
    const hh = String(nextDate.getHours()).padStart(2, '0');
    const mm = String(nextDate.getMinutes()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
  } else {
    const yyyy = nextDate.getFullYear();
    const MM = String(nextDate.getMonth() + 1).padStart(2, '0');
    const dd = String(nextDate.getDate()).padStart(2, '0');
    return `${yyyy}-${MM}-${dd}`;
  }
}

export function handleRecurringTask(db: any, taskId: string, isProjectTask: boolean): void {
  try {
    if (isProjectTask) {
      const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId);
      if (!task || !task.isRecurring || !task.recurrenceRule) return;

      let rule: RecurrenceRule;
      try {
        rule = JSON.parse(task.recurrenceRule);
      } catch {
        return;
      }

      if (!task.endDate) return;

      const nextEndDate = getNextOccurrenceString(task.endDate, rule);

      if (task.recurrenceEndDate) {
          const recurEnd = new Date(task.recurrenceEndDate).getTime();
          const nextEnd = new Date(nextEndDate).getTime();
          if (!isNaN(recurEnd) && !isNaN(nextEnd) && nextEnd > recurEnd) {
             return;
          }
      }

      let nextRemindAt = null;

      if (task.remindAt) {
          if (task.reminderOffsetValue !== undefined && task.reminderOffsetValue !== null && task.reminderOffsetUnit) {
               nextRemindAt = calculateRemindAt(nextEndDate, task.reminderOffsetValue, task.reminderOffsetUnit);
          } else {
              const dueTime = new Date(task.endDate).getTime();
              const remindTime = new Date(task.remindAt).getTime();
              const diff = dueTime - remindTime;
              if (!isNaN(diff)) {
                const nextDueTime = new Date(nextEndDate).getTime();
                const remDate = new Date(nextDueTime - diff);
                if (task.remindAt.includes('T') || task.remindAt.includes('Z')) {
                  nextRemindAt = remDate.toISOString();
                } else if (task.remindAt.includes(' ')) {
                  const yyyy = remDate.getFullYear();
                  const MM = String(remDate.getMonth() + 1).padStart(2, '0');
                  const dd = String(remDate.getDate()).padStart(2, '0');
                  const hh = String(remDate.getHours()).padStart(2, '0');
                  const mm = String(remDate.getMinutes()).padStart(2, '0');
                  nextRemindAt = `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
                } else {
                  const yyyy = remDate.getFullYear();
                  const MM = String(remDate.getMonth() + 1).padStart(2, '0');
                  const dd = String(remDate.getDate()).padStart(2, '0');
                  nextRemindAt = `${yyyy}-${MM}-${dd}`;
                }
              }
          }
      }

      const newId = crypto.randomUUID();

      let targetStageId = task.stageId;
      const stages = db.prepare("SELECT * FROM project_stages WHERE projectId = ? ORDER BY sortOrder ASC").all(task.projectId) as any[];
      if (stages && stages.length > 0) {
         const inProgressStage = stages.find(s => s.name === '进行中');
         if (inProgressStage) {
            targetStageId = inProgressStage.id;
         } else {
            const firstValidStage = stages.find(s => s.name !== '已完成');
            if (firstValidStage) {
               targetStageId = firstValidStage.id;
            }
         }
      }

      // Copy project_task
      db.prepare(`
        INSERT INTO project_tasks (
          id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate,
          description, cover, sortOrder, creatorId, modifierId, priority, remindAt,
          titleColor, progress, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        newId, task.projectId, targetStageId, task.title, task.assigneeId, task.startDate,
        nextEndDate, task.description, task.cover, task.sortOrder, task.creatorId,
        task.modifierId, task.priority, nextRemindAt, task.titleColor, task.recurrenceRule, task.reminderOffsetValue, task.reminderOffsetUnit, task.recurrenceEndDate
      );

      // Copy participants
      const members = db.prepare("SELECT userId FROM project_task_members WHERE taskId = ?").all(taskId) as { userId: string }[];
      const insertMember = db.prepare("INSERT OR IGNORE INTO project_task_members (taskId, userId) VALUES (?, ?)");
      for (const m of members) {
        insertMember.run(newId, m.userId);
      }

      // Copy tags
      const tags = db.prepare("SELECT tagId FROM project_task_tags WHERE taskId = ?").all(taskId) as { tagId: string }[];
      const insertTag = db.prepare("INSERT OR IGNORE INTO project_task_tags (taskId, tagId) VALUES (?, ?)");
      for (const t of tags) {
        insertTag.run(newId, t.tagId);
      }

      // Copy checklists (reset isCompleted = 0)
      const checklists = db.prepare("SELECT title, sortOrder FROM project_task_checklists WHERE taskId = ?").all(taskId) as { title: string, sortOrder: number }[];
      const insertChecklist = db.prepare("INSERT INTO project_task_checklists (id, taskId, title, isCompleted, sortOrder) VALUES (?, ?, ?, 0, ?)");
      for (const cl of checklists) {
        insertChecklist.run(crypto.randomUUID(), newId, cl.title, cl.sortOrder);
      }

    } else {
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (!task || !task.isRecurring || !task.recurrenceRule) return;

      let rule: RecurrenceRule;
      try {
        rule = JSON.parse(task.recurrenceRule);
      } catch {
        return;
      }

      if (!task.dueDate) return;

      const nextDueDate = getNextOccurrenceString(task.dueDate, rule);

      if (task.recurrenceEndDate) {
          const recurEnd = new Date(task.recurrenceEndDate).getTime();
          const nextEnd = new Date(nextDueDate).getTime();
          if (!isNaN(recurEnd) && !isNaN(nextEnd) && nextEnd > recurEnd) {
             return;
          }
      }

      let nextRemindAt = null;

      if (task.remindAt) {
          if (task.reminderOffsetValue !== undefined && task.reminderOffsetValue !== null && task.reminderOffsetUnit) {
               nextRemindAt = calculateRemindAt(nextDueDate, task.reminderOffsetValue, task.reminderOffsetUnit);
          } else {
              const dueTime = new Date(task.dueDate).getTime();
              const remindTime = new Date(task.remindAt).getTime();
              const diff = dueTime - remindTime;
              if (!isNaN(diff)) {
                const nextDueTime = new Date(nextDueDate).getTime();
                const remDate = new Date(nextDueTime - diff);
                if (task.remindAt.includes('T') || task.remindAt.includes('Z')) {
                  nextRemindAt = remDate.toISOString();
                } else if (task.remindAt.includes(' ')) {
                  const yyyy = remDate.getFullYear();
                  const MM = String(remDate.getMonth() + 1).padStart(2, '0');
                  const dd = String(remDate.getDate()).padStart(2, '0');
                  const hh = String(remDate.getHours()).padStart(2, '0');
                  const mm = String(remDate.getMinutes()).padStart(2, '0');
                  nextRemindAt = `${yyyy}-${MM}-${dd} ${hh}:${mm}`;
                } else {
                  const yyyy = remDate.getFullYear();
                  const MM = String(remDate.getMonth() + 1).padStart(2, '0');
                  const dd = String(remDate.getDate()).padStart(2, '0');
                  nextRemindAt = `${yyyy}-${MM}-${dd}`;
                }
              }
          }
      }

      const newId = crypto.randomUUID();

      // Copy task
      db.prepare(`
        INSERT INTO tasks (
          id, userId, workspaceId, title, isCompleted, status, priority, dueDate, remindAt,
          noteId, parentId, sortOrder, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(
        newId, task.userId, task.workspaceId, task.title, task.priority, nextDueDate,
        nextRemindAt, task.noteId, task.parentId, task.sortOrder, task.recurrenceRule, task.reminderOffsetValue, task.reminderOffsetUnit, task.recurrenceEndDate
      );

      // Copy tags
      const tags = db.prepare("SELECT tagId FROM task_tags WHERE taskId = ?").all(taskId) as { tagId: string }[];
      const insertTag = db.prepare("INSERT OR IGNORE INTO task_tags (taskId, tagId) VALUES (?, ?)");
      for (const t of tags) {
        insertTag.run(newId, t.tagId);
      }
    }
  } catch (err) {
    console.error("Error handling recurrence:", err);
  }
}
