/**
 * Smoke: dual reminder slots (client logic mirrored) + server worker due day
 * Run: ./node_modules/.bin/tsx src/lib/__tests__/smoke-dual-reminder.ts
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

// --- server fire times ---
const adv = resolveRemindFireTime("2026-08-31");
assert(adv && adv.getDate() === 31 && adv.getHours() === 9, "advance date-only 09:00");
const due = resolveRemindFireTime("2026-09-01");
assert(due && due.getDate() === 1 && due.getHours() === 9, "due date-only 09:00");

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE notifications (
    id TEXT PRIMARY KEY, userId TEXT, type TEXT, sourceType TEXT, sourceId TEXT,
    sourceTitle TEXT, actorId TEXT, actorName TEXT, createdAt TEXT, readAt TEXT
  );
  CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY, title TEXT, isCompleted INTEGER DEFAULT 0,
    assigneeId TEXT, creatorId TEXT, endDate TEXT, remindAt TEXT,
    reminderFiredAt TEXT, dueReminderFiredAt TEXT, updatedAt TEXT
  );
`);

const uid = "u1";
const id = crypto.randomUUID();
// credit card: due Sep 1, advance Aug 31
db.prepare(
  `INSERT INTO project_tasks (id, title, isCompleted, assigneeId, creatorId, endDate, remindAt, reminderFiredAt, dueReminderFiredAt)
   VALUES (?, '还信用卡', 0, ?, ?, '2026-09-01', '2026-08-31', NULL, NULL)`,
).run(id, uid, uid);

// T1: Aug 31 10:00 — advance should fire, due not yet
const t1 = new Date(2026, 7, 31, 10, 0, 0).getTime();
const r1 = processDueTaskReminders(db, t1);
console.log("Aug31 10:00", r1);
assert(r1.fired === 1, "advance only");
const n1 = db.prepare("SELECT * FROM notifications").all() as any[];
assert(n1.length === 1 && n1[0].actorName === "任务提醒", "advance notif");

// T2: Sep 1 10:00 — due should fire
const t2 = new Date(2026, 8, 1, 10, 0, 0).getTime();
const r2 = processDueTaskReminders(db, t2);
console.log("Sep1 10:00", r2);
assert(r2.fired === 1, "due only");
const n2 = db.prepare("SELECT * FROM notifications ORDER BY createdAt").all() as any[];
assert(n2.length === 2, "two notifs");
assert(n2[1].actorName === "截止提醒", "due actor");
assert(String(n2[1].sourceTitle).includes("今天截止"), "due title");

// T3: idempotent
const r3 = processDueTaskReminders(db, t2);
assert(r3.fired === 0, "no double");

// Same-minute dedupe: remindAt = due day 09:00
const id2 = crypto.randomUUID();
db.prepare(
  `INSERT INTO project_tasks (id, title, isCompleted, assigneeId, creatorId, endDate, remindAt, reminderFiredAt, dueReminderFiredAt)
   VALUES (?, '同刻', 0, ?, ?, '2026-10-01', '2026-10-01', NULL, NULL)`,
).run(id2, uid, uid);
const t4 = new Date(2026, 9, 1, 10, 0, 0).getTime();
const r4 = processDueTaskReminders(db, t4);
// advance fires + due skips notify but marks
assert(r4.fired === 1, "dedupe one notify got " + r4.fired);
const same = db
  .prepare("SELECT COUNT(*) as c FROM notifications WHERE sourceId = ?")
  .get(id2) as { c: number };
assert(same.c === 1, "only one notif for same-minute");

console.log("ALL ASSERTIONS PASSED");
