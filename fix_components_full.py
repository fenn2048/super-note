import re

# Database Schema
with open('backend/src/db/schema.ts', 'r') as f:
    content = f.read()

schema_task_match = """      parentId TEXT,
      isRecurring INTEGER DEFAULT 0,
      recurrenceRule TEXT,
      sortOrder INTEGER DEFAULT 0,"""
schema_task_replace = """      parentId TEXT,
      isRecurring INTEGER DEFAULT 0,
      recurrenceRule TEXT,
      reminderOffsetValue INTEGER DEFAULT 1,
      reminderOffsetUnit TEXT DEFAULT 'day',
      recurrenceEndDate TEXT,
      sortOrder INTEGER DEFAULT 0,"""
if "reminderOffsetValue" not in schema_task_match and "reminderOffsetValue" not in content:
   content = content.replace(schema_task_match, schema_task_replace)

schema_project_task_match = """      cover TEXT DEFAULT '',
      isRecurring INTEGER DEFAULT 0,
      recurrenceRule TEXT,
      sortOrder INTEGER DEFAULT 0,"""
schema_project_task_replace = """      cover TEXT DEFAULT '',
      isRecurring INTEGER DEFAULT 0,
      recurrenceRule TEXT,
      reminderOffsetValue INTEGER DEFAULT 1,
      reminderOffsetUnit TEXT DEFAULT 'day',
      recurrenceEndDate TEXT,
      sortOrder INTEGER DEFAULT 0,"""
if "reminderOffsetValue" not in schema_project_task_match and "recurrenceEndDate TEXT," not in content:
   content = content.replace(schema_project_task_match, schema_project_task_replace)
with open('backend/src/db/schema.ts', 'w') as f:
    f.write(content)

# Database Migrations
with open('backend/src/db/migrations.ts', 'r') as f:
    content = f.read()

migration_match = """    },
  },
];

/** 当前代码已知的最高 schema 版本（== MIGRATIONS 里 max(version)）。 */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce("""
migration_replace = """    },
  },
  {
    version: 31,
    name: "add-reminder-offset-and-recurrence-end",
    up: (db) => {
      const tasksCols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!tasksCols.some(c => c.name === "reminderOffsetValue")) {
        db.exec("ALTER TABLE tasks ADD COLUMN reminderOffsetValue INTEGER DEFAULT 1;");
        db.exec("ALTER TABLE tasks ADD COLUMN reminderOffsetUnit TEXT DEFAULT 'day';");
      }
      if (!tasksCols.some(c => c.name === "recurrenceEndDate")) {
        db.exec("ALTER TABLE tasks ADD COLUMN recurrenceEndDate TEXT;");
      }

      const projectTasksCols = db.prepare("PRAGMA table_info(project_tasks)").all() as { name: string }[];
      if (!projectTasksCols.some(c => c.name === "reminderOffsetValue")) {
        db.exec("ALTER TABLE project_tasks ADD COLUMN reminderOffsetValue INTEGER DEFAULT 1;");
        db.exec("ALTER TABLE project_tasks ADD COLUMN reminderOffsetUnit TEXT DEFAULT 'day';");
      }
      if (!projectTasksCols.some(c => c.name === "recurrenceEndDate")) {
        db.exec("ALTER TABLE project_tasks ADD COLUMN recurrenceEndDate TEXT;");
      }
    },
  },
];

/** 当前代码已知的最高 schema 版本（== MIGRATIONS 里 max(version)）。 */
export const CURRENT_SCHEMA_VERSION: number = MIGRATIONS.reduce("""
if "version: 31" not in content:
   content = content.replace(migration_match, migration_replace)
with open('backend/src/db/migrations.ts', 'w') as f:
    f.write(content)
