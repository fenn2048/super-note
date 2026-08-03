/**
 * Smoke: task-reminder-worker due scan + idempotency
 * Run: ./node_modules/.bin/tsx src/lib/__tests__/smoke-task-reminder-worker.ts
 */
import Database from "better-sqlite3";
import crypto from "crypto";
import {
  processDueTaskReminders,
  resolveRemindFireTime,
} from "../../services/task-reminder-worker.js";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// resolveRemindFireTime
const dOnly = resolveRemindFireTime("2026-08-31");
assert(dOnly && dOnly.getHours() === 9, "date-only → 09:00");
const dTime = resolveRemindFireTime("2026-08-31 14:30");
assert(dTime && dTime.getHours() === 14 && dTime.getMinutes() === 30, "wall clock");
const dIso = resolveRemindFireTime("2026-08-31T01:00:00.000Z");
assert(dIso && !isNaN(dIso.getTime()), "iso parseable");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT,
    sourceType TEXT,
    sourceId TEXT,
    sourceTitle TEXT,
    actorId TEXT,
    actorName TEXT,
    createdAt TEXT,
    readAt TEXT
  );
  CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY,
    projectId TEXT,
    stageId TEXT,
    title TEXT,
    isCompleted INTEGER DEFAULT 0,
    status TEXT,
    assigneeId TEXT,
    creatorId TEXT,
    endDate TEXT,
    remindAt TEXT,
    reminderFiredAt TEXT,
    updatedAt TEXT
  );
`);

const uid = "user-1";
const pastId = crypto.randomUUID();
const futureId = crypto.randomUUID();
const doneId = crypto.randomUUID();

// past due (date-only yesterday relative to fixed now)
const now = new Date(2026, 7, 3, 12, 0, 0); // Aug 3 2026 12:00 local
const pastRemind = "2026-08-02"; // 09:00 on Aug 2 < now
const futureRemind = "2026-08-10";

db.prepare(
  `INSERT INTO project_tasks (id, title, isCompleted, assigneeId, creatorId, remindAt, reminderFiredAt, updatedAt)
   VALUES (?, '还信用卡', 0, ?, ?, ?, NULL, datetime('now'))`,
).run(pastId, uid, uid, pastRemind);

db.prepare(
  `INSERT INTO project_tasks (id, title, isCompleted, assigneeId, creatorId, remindAt, reminderFiredAt, updatedAt)
   VALUES (?, '未来任务', 0, ?, ?, ?, NULL, datetime('now'))`,
).run(futureId, uid, uid, futureRemind);

db.prepare(
  `INSERT INTO project_tasks (id, title, isCompleted, assigneeId, creatorId, remindAt, reminderFiredAt, updatedAt)
   VALUES (?, '已完成', 1, ?, ?, ?, NULL, datetime('now'))`,
).run(doneId, uid, uid, pastRemind);

const r1 = processDueTaskReminders(db, now.getTime());
console.log("first run", r1);
assert(r1.fired === 1, "should fire exactly one");
const notifs = db.prepare("SELECT * FROM notifications").all() as any[];
assert(notifs.length === 1, "one notification");
assert(notifs[0].type === "task_reminder", "type");
assert(notifs[0].sourceId === pastId, "source");
assert(notifs[0].sourceTitle === "还信用卡", "title");

const firedRow = db.prepare("SELECT reminderFiredAt FROM project_tasks WHERE id=?").get(pastId) as any;
assert(firedRow.reminderFiredAt, "marked fired");

const r2 = processDueTaskReminders(db, now.getTime());
assert(r2.fired === 0, "idempotent second run");
const notifs2 = db.prepare("SELECT COUNT(*) as c FROM notifications").get() as { c: number };
assert(notifs2.c === 1, "still one notification");

// clear fired + change remindAt to past → can fire again
db.prepare("UPDATE project_tasks SET reminderFiredAt = NULL, remindAt = ? WHERE id = ?").run(
  "2026-08-01 08:00",
  pastId,
);
const r3 = processDueTaskReminders(db, now.getTime());
assert(r3.fired === 1, "re-fire after reset");

console.log("ALL ASSERTIONS PASSED");
