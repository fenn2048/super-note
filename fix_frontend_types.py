import re

with open('frontend/src/types/index.ts', 'r') as f:
    content = f.read()

task_match = """  isRecurring?: number;
  recurrenceRule?: string | null;"""

task_replace = """  isRecurring?: number;
  recurrenceRule?: string | null;
  reminderOffsetValue?: number;
  reminderOffsetUnit?: 'minute' | 'hour' | 'day' | 'month' | 'year';
  recurrenceEndDate?: string | null;"""

if "reminderOffsetValue?: number;" not in content:
   content = content.replace(task_match, task_replace)

project_task_match = """  progress: number;
  isRecurring?: number;
  recurrenceRule?: string | null;"""

project_task_replace = """  progress: number;
  isRecurring?: number;
  recurrenceRule?: string | null;
  reminderOffsetValue?: number;
  reminderOffsetUnit?: 'minute' | 'hour' | 'day' | 'month' | 'year';
  recurrenceEndDate?: string | null;"""

if "reminderOffsetUnit?: 'minute' | 'hour' | 'day' | 'month' | 'year';" not in content.split("export interface ProjectTask")[1]:
   content = content.replace(project_task_match, project_task_replace)

with open('frontend/src/types/index.ts', 'w') as f:
    f.write(content)
