import re

with open('backend/src/routes/projects.ts', 'r') as f:
    content = f.read()

# Fix ReferenceError: calculatedRemindAt is not defined around line 700

old_put_block = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies } = body;

  let finalIsCompleted = isCompleted;
  let finalProgress = progress;"""

new_put_block = """  const { title, description, isCompleted, status, assigneeId, startDate, endDate, cover, stageId, sortOrder, checklists, participants, tags, priority, remindAt, titleColor, progress, projectId, isRecurring, recurrenceRule, dependencies, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate } = body;

  let finalIsCompleted = isCompleted;
  let finalProgress = progress;

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

content = content.replace(old_put_block, new_put_block)

with open('backend/src/routes/projects.ts', 'w') as f:
    f.write(content)
