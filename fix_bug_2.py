import re

with open('backend/src/routes/projects.ts', 'r') as f:
    content = f.read()

# Fix ReferenceError: calculatedRemindAt is not defined around line 700

old_put_block = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies } = body;

  const task = db.prepare("SELECT * FROM project_tasks WHERE id = ?").get(taskId) as any;
  if (!task) return c.json({ error: "任务不存在" }, 404);

  const finalIsCompleted = isCompleted !== undefined ? isCompleted : task.isCompleted;
  const finalProgress = progress !== undefined ? progress : task.progress;

  if (finalIsCompleted === 1 || finalIsCompleted === true) {
    if (task.isCompleted === 0) {"""

new_put_block = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate } = body;

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
  }

  if (finalIsCompleted === 1 || finalIsCompleted === true) {
    if (task.isCompleted === 0) {"""

content = content.replace(old_put_block, new_put_block)

with open('backend/src/routes/projects.ts', 'w') as f:
    f.write(content)
