import re

with open('backend/src/routes/tasks.ts', 'r') as f:
    content = f.read()

import_tasks = """import { createMentions } from "../lib/mentions.js";"""
new_import_tasks = """import { createMentions } from "../lib/mentions.js";
import { calculateRemindAt } from "../lib/reminders.js";
import { getNextOccurrenceString } from "../lib/recurrence.js";"""
if "calculateRemindAt" not in content:
    content = content.replace(import_tasks, new_import_tasks)

post_tasks_match = """  const { title, workspaceId, priority = 2, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule, tagIds, dependencies } = body;

  if (!title) return c.json({ error: "Title is required" }, 400);

  const id = uuid();
  const effectiveWorkspaceId = workspaceId || null;

  let calculatedRemindAt = remindAt;
  if (dueDate && !remindAt) {
    try {
      const date = new Date(dueDate);
      date.setDate(date.getDate() - 1);
      calculatedRemindAt = date.toISOString().split("T")[0];
    } catch {}
  }

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, userId, workspaceId, title, isCompleted, status, priority, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, effectiveWorkspaceId, title.trim(), priority, dueDate, calculatedRemindAt, noteId, parentId, isRecurring, recurrenceRule);"""

post_tasks_replace = """  const { title, workspaceId, priority = 2, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule, tagIds, dependencies, reminderOffsetValue = 1, reminderOffsetUnit = 'day', recurrenceEndDate = null } = body;

  if (!title) return c.json({ error: "Title is required" }, 400);

  const id = uuid();
  const effectiveWorkspaceId = workspaceId || null;

  let calculatedDueDate = dueDate;
  if (isRecurring && recurrenceRule) {
    try {
       let rule = typeof recurrenceRule === 'string' ? JSON.parse(recurrenceRule) : recurrenceRule;
       const now = new Date();
       const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
       calculatedDueDate = getNextOccurrenceString(todayStr, rule);
    } catch (e) {
      console.warn("Failed to calculate initial recurring due date", e);
    }
  }

  let calculatedRemindAt = remindAt;
  if (calculatedDueDate && (!remindAt || isRecurring)) {
    try {
       calculatedRemindAt = calculateRemindAt(calculatedDueDate, reminderOffsetValue, reminderOffsetUnit);
    } catch (e) {
       console.warn("Failed to calculate remind at", e);
    }
  }

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO tasks (id, userId, workspaceId, title, isCompleted, status, priority, dueDate, remindAt, noteId, parentId, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate)
      VALUES (?, ?, ?, ?, 0, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, effectiveWorkspaceId, title.trim(), priority, calculatedDueDate, calculatedRemindAt, noteId, parentId, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate);"""

if "calculatedDueDate" not in content:
   content = content.replace(post_tasks_match, post_tasks_replace)

put_tasks_match = """    const dueDate = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    let remindAt = body.remindAt !== undefined ? body.remindAt : existing.remindAt;
    const noteId = body.noteId !== undefined ? body.noteId : existing.noteId;
    const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
    const sortOrder = body.sortOrder ?? existing.sortOrder;
    const isRecurring = body.isRecurring ?? existing.isRecurring;
    const recurrenceRule = body.recurrenceRule !== undefined ? body.recurrenceRule : existing.recurrenceRule;
    const tagIds = body.tagIds;
    const dependencies = body.dependencies;

    if (dueDate && !remindAt && body.dueDate !== undefined) {
      try {
        const date = new Date(dueDate);
        date.setDate(date.getDate() - 1);
        remindAt = date.toISOString().split("T")[0];
      } catch {}
    } else if (!dueDate) {
      remindAt = null;
    }"""

put_tasks_replace = """    const dueDate = body.dueDate !== undefined ? body.dueDate : existing.dueDate;
    let calculatedRemindAt = body.remindAt !== undefined ? body.remindAt : existing.remindAt;
    const noteId = body.noteId !== undefined ? body.noteId : existing.noteId;
    const parentId = body.parentId !== undefined ? body.parentId : existing.parentId;
    const sortOrder = body.sortOrder ?? existing.sortOrder;
    const isRecurring = body.isRecurring ?? existing.isRecurring;
    const recurrenceRule = body.recurrenceRule !== undefined ? body.recurrenceRule : existing.recurrenceRule;
    const finalOffsetValue = body.reminderOffsetValue !== undefined ? body.reminderOffsetValue : existing.reminderOffsetValue;
    const finalOffsetUnit = body.reminderOffsetUnit !== undefined ? body.reminderOffsetUnit : existing.reminderOffsetUnit;
    const recurrenceEndDate = body.recurrenceEndDate !== undefined ? body.recurrenceEndDate : existing.recurrenceEndDate;
    const tagIds = body.tagIds;
    const dependencies = body.dependencies;

    if (dueDate && body.dueDate !== undefined && (!calculatedRemindAt || isRecurring)) {
        try {
           calculatedRemindAt = calculateRemindAt(dueDate, finalOffsetValue, finalOffsetUnit);
        } catch(e) { console.warn("Failed to update calculated remind at", e); }
    } else if (!dueDate && body.dueDate === null) {
      calculatedRemindAt = null;
    }"""
if "finalOffsetValue" not in content:
    content = content.replace(put_tasks_match, put_tasks_replace)

put_tasks_update_match = """      db.prepare(`
        UPDATE tasks SET title = ?, isCompleted = ?, status = ?, priority = ?, dueDate = ?, remindAt = ?,
          noteId = ?, parentId = ?, sortOrder = ?, isRecurring = ?, recurrenceRule = ?, updatedAt = datetime('now')
        WHERE id = ?
      `).run(title, isCompleted, status, priority, dueDate, remindAt, noteId, parentId, sortOrder, isRecurring, recurrenceRule, id);"""

put_tasks_update_replace = """      db.prepare(`
        UPDATE tasks SET title = ?, isCompleted = ?, status = ?, priority = ?, dueDate = ?, remindAt = ?,
          noteId = ?, parentId = ?, sortOrder = ?, isRecurring = ?, recurrenceRule = ?, reminderOffsetValue = ?, reminderOffsetUnit = ?, recurrenceEndDate = ?, updatedAt = datetime('now')
        WHERE id = ?
      `).run(title, isCompleted, status, priority, dueDate, calculatedRemindAt, noteId, parentId, sortOrder, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), finalOffsetValue, finalOffsetUnit, recurrenceEndDate, id);"""
if "reminderOffsetValue = ?" not in content:
    content = content.replace(put_tasks_update_match, put_tasks_update_replace)

with open('backend/src/routes/tasks.ts', 'w') as f:
    f.write(content)

with open('backend/src/routes/projects.ts', 'r') as f:
    content = f.read()

import_projects = """import { handleRecurringTask } from "../lib/recurrence.js";"""
new_import_projects = """import { handleRecurringTask, getNextOccurrenceString } from "../lib/recurrence.js";
import { calculateRemindAt } from "../lib/reminders.js";"""
if "calculateRemindAt" not in content:
    content = content.replace(import_projects, new_import_projects)

post_projects_match = """  const { stageId, title, description = "", assigneeId = null, startDate = null, endDate = null, cover = "", participants = [], tags = [], priority = 2, remindAt = null, titleColor = null, progress = 0, isRecurring = 0, recurrenceRule = null, dependencies = [], status = 'pending' } = body;
  if (!title) return c.json({ error: "任务标题不能为空" }, 400);
  if (!stageId) return c.json({ error: "必须指定任务阶段" }, 400);

  const taskId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_tasks WHERE stageId = ?").get(stageId) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  db.prepare(`
    INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate, description, cover, sortOrder, creatorId, modifierId, priority, remindAt, titleColor, progress, isRecurring, recurrenceRule)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, id, stageId, title, status, assigneeId, startDate, endDate, description, cover, sortOrder, userId, userId, priority, remindAt, titleColor, progress, isRecurring, recurrenceRule);"""

post_projects_replace = """  const { stageId, title, description = "", assigneeId = null, startDate = null, endDate = null, cover = "", participants = [], tags = [], priority = 2, remindAt = null, titleColor = null, progress = 0, isRecurring = 0, recurrenceRule = null, dependencies = [], status = 'pending', reminderOffsetValue = 1, reminderOffsetUnit = 'day', recurrenceEndDate = null } = body;
  if (!title) return c.json({ error: "任务标题不能为空" }, 400);
  if (!stageId) return c.json({ error: "必须指定任务阶段" }, 400);

  const taskId = uuid();
  const maxSort = db.prepare("SELECT MAX(sortOrder) as max FROM project_tasks WHERE stageId = ?").get(stageId) as { max: number | null };
  const sortOrder = (maxSort.max ?? -1) + 1;

  let calculatedEndDate = endDate;
  if (isRecurring && recurrenceRule) {
    try {
       let rule = typeof recurrenceRule === 'string' ? JSON.parse(recurrenceRule) : recurrenceRule;
       const now = new Date();
       const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
       calculatedEndDate = getNextOccurrenceString(todayStr, rule);
    } catch (e) {
      console.warn("Failed to calculate initial recurring end date", e);
    }
  }

  let calculatedRemindAt = remindAt;
  if (calculatedEndDate && (!remindAt || isRecurring)) {
    try {
       calculatedRemindAt = calculateRemindAt(calculatedEndDate, reminderOffsetValue, reminderOffsetUnit);
    } catch (e) {
       console.warn("Failed to calculate remind at", e);
    }
  }

  db.prepare(`
    INSERT INTO project_tasks (id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate, description, cover, sortOrder, creatorId, modifierId, priority, remindAt, titleColor, progress, isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate)
    VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, id, stageId, title, status, assigneeId, startDate, calculatedEndDate, description, cover, sortOrder, userId, userId, priority, calculatedRemindAt, titleColor, progress, isRecurring, typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule), reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate);"""

if "calculatedEndDate" not in content:
   content = content.replace(post_projects_match, post_projects_replace)

put_projects_match = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies } = body;

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as any;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const finalIsCompleted = isCompleted !== undefined ? isCompleted : task.isCompleted;
  const finalProgress = progress !== undefined ? progress : task.progress;"""

put_projects_replace = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate } = body;

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as any;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const finalIsCompleted = isCompleted !== undefined ? isCompleted : task.isCompleted;
  const finalProgress = progress !== undefined ? progress : task.progress;

  let calculatedRemindAt = remindAt !== undefined ? remindAt : task.remindAt;
  const finalOffsetValue = reminderOffsetValue !== undefined ? reminderOffsetValue : task.reminderOffsetValue;
  const finalOffsetUnit = reminderOffsetUnit !== undefined ? reminderOffsetUnit : task.reminderOffsetUnit;

  if (endDate && body.endDate !== undefined && (!calculatedRemindAt || isRecurring)) {
      try {
         calculatedRemindAt = calculateRemindAt(endDate, finalOffsetValue, finalOffsetUnit);
      } catch(e) { console.warn("Failed to update calculated remind at", e); }
  } else if (!endDate && body.endDate === null) {
    calculatedRemindAt = null;
  }"""
if "calculatedRemindAt =" not in content:
   content = content.replace(put_projects_match, put_projects_replace)

put_projects_update_match = """  if (priority !== undefined) { updates.push("priority = ?"); params.push(priority); }
  if (remindAt !== undefined) { updates.push("remindAt = ?"); params.push(remindAt); }
  if (titleColor !== undefined) { updates.push("titleColor = ?"); params.push(titleColor); }
  if (finalProgress !== undefined) { updates.push("progress = ?"); params.push(finalProgress); }
  if (isRecurring !== undefined) { updates.push("isRecurring = ?"); params.push((isRecurring === 1 || isRecurring === true) ? 1 : 0); }
  if (recurrenceRule !== undefined) { updates.push("recurrenceRule = ?"); params.push(recurrenceRule); }"""

put_projects_update_replace = """  if (priority !== undefined) { updates.push("priority = ?"); params.push(priority); }
  updates.push("remindAt = ?"); params.push(calculatedRemindAt);
  if (titleColor !== undefined) { updates.push("titleColor = ?"); params.push(titleColor); }
  if (finalProgress !== undefined) { updates.push("progress = ?"); params.push(finalProgress); }
  if (isRecurring !== undefined) { updates.push("isRecurring = ?"); params.push((isRecurring === 1 || isRecurring === true) ? 1 : 0); }
  if (recurrenceRule !== undefined) { updates.push("recurrenceRule = ?"); params.push(typeof recurrenceRule === 'string' ? recurrenceRule : JSON.stringify(recurrenceRule)); }
  if (reminderOffsetValue !== undefined) { updates.push("reminderOffsetValue = ?"); params.push(reminderOffsetValue); }
  if (reminderOffsetUnit !== undefined) { updates.push("reminderOffsetUnit = ?"); params.push(reminderOffsetUnit); }
  if (recurrenceEndDate !== undefined) { updates.push("recurrenceEndDate = ?"); params.push(recurrenceEndDate); }"""

if "reminderOffsetValue = ?" not in content:
   content = content.replace(put_projects_update_match, put_projects_update_replace)

with open('backend/src/routes/projects.ts', 'w') as f:
    f.write(content)


with open('backend/src/lib/recurrence.ts', 'r') as f:
    content = f.read()

recur_import = """export function getNextOccurrenceString(baseStr: string, rule: RecurrenceRule): string {"""
recur_import_replace = """import { calculateRemindAt } from './reminders.js';

export function getNextOccurrenceString(baseStr: string, rule: RecurrenceRule): string {"""
if "calculateRemindAt" not in content:
   content = content.replace(recur_import, recur_import_replace)

recur_project_match = """      if (!task.endDate) return;

      const nextEndDate = getNextOccurrenceString(task.endDate, rule);
      let nextRemindAt = null;

      if (task.remindAt) {
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

      const newId = crypto.randomUUID();

      // Copy project_task
      db.prepare(`
        INSERT INTO project_tasks (
          id, projectId, stageId, title, isCompleted, assigneeId, startDate, endDate,
          description, cover, sortOrder, creatorId, modifierId, priority, remindAt,
          titleColor, progress, isRecurring, recurrenceRule, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, datetime('now'), datetime('now'))
      `).run(
        newId, task.projectId, task.stageId, task.title, task.assigneeId, task.startDate,
        nextEndDate, task.description, task.cover, task.sortOrder, task.creatorId,
        task.modifierId, task.priority, nextRemindAt, task.titleColor, task.recurrenceRule
      );"""

recur_project_replace = """      if (!task.endDate) return;

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
      );"""

if "task.recurrenceEndDate" not in content:
   content = content.replace(recur_project_match, recur_project_replace)

recur_task_match = """      if (!task.dueDate) return;

      const nextDueDate = getNextOccurrenceString(task.dueDate, rule);
      let nextRemindAt = null;

      if (task.remindAt) {
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

      const newId = crypto.randomUUID();

      // Copy task
      db.prepare(`
        INSERT INTO tasks (
          id, userId, workspaceId, title, isCompleted, priority, dueDate, remindAt,
          noteId, parentId, sortOrder, isRecurring, recurrenceRule, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 1, ?, datetime('now'), datetime('now'))
      `).run(
        newId, task.userId, task.workspaceId, task.title, task.priority, nextDueDate,
        nextRemindAt, task.noteId, task.parentId, task.sortOrder, task.recurrenceRule
      );"""

recur_task_replace = """      if (!task.dueDate) return;

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
      );"""

if "task.recurrenceEndDate" not in recur_task_match and "reminderOffsetValue" not in recur_task_match:
   content = content.replace(recur_task_match, recur_task_replace)

with open('backend/src/lib/recurrence.ts', 'w') as f:
    f.write(content)
