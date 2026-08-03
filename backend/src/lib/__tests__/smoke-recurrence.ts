import {
  calculateRemindAt,
  parseTaskDateTime,
} from "../reminders.js";
import {
  getNextOccurrenceString,
  handleRecurringTask,
} from "../recurrence.js";
import Database from "better-sqlite3";
import crypto from "crypto";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(parseTaskDateTime("2026-08-01")?.day === 1, "date-only day");
assert(parseTaskDateTime("2026-08-01 14:30")?.hour === 14, "local time");
assert(parseTaskDateTime("2026-07-31T00:00:00.000Z") !== null, "iso parse");

assert(calculateRemindAt("2026-09-01", 1, "day") === "2026-08-31", "1 day before");
const rIso = calculateRemindAt("2026-09-01T00:00:00.000Z", 1, "day");
assert(rIso && !rIso.includes("T") && !rIso.endsWith("Z"), "no ISO out: " + rIso);

assert(
  getNextOccurrenceString("2026-07-15", { type: "monthly", day: 1 }) === "2026-08-01",
  "mid to 1st",
);
assert(
  getNextOccurrenceString("2026-08-01", { type: "monthly", day: 1 }) === "2026-09-01",
  "1st to next",
);
const nextIso = getNextOccurrenceString("2026-08-01T00:00:00.000Z", {
  type: "monthly",
  day: 1,
});
assert(!nextIso.includes("T"), "next local format: " + nextIso);

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE project_stages (id TEXT PRIMARY KEY, projectId TEXT, name TEXT, sortOrder INTEGER);
  CREATE TABLE project_tasks (
    id TEXT PRIMARY KEY, projectId TEXT, stageId TEXT, title TEXT, isCompleted INTEGER,
    status TEXT, assigneeId TEXT, startDate TEXT, endDate TEXT, description TEXT, cover TEXT,
    sortOrder INTEGER, creatorId TEXT, modifierId TEXT, priority INTEGER, remindAt TEXT,
    titleColor TEXT, progress INTEGER, isRecurring INTEGER, recurrenceRule TEXT,
    reminderOffsetValue INTEGER, reminderOffsetUnit TEXT, recurrenceEndDate TEXT,
    createdAt TEXT, updatedAt TEXT
  );
  CREATE TABLE project_task_members (taskId TEXT, userId TEXT);
  CREATE TABLE project_task_tags (taskId TEXT, tagId TEXT);
  CREATE TABLE project_task_checklists (id TEXT, taskId TEXT, title TEXT, isCompleted INTEGER, sortOrder INTEGER);
`);
const pid = crypto.randomUUID();
const sid = crypto.randomUUID();
const tid = crypto.randomUUID();
db.prepare("INSERT INTO project_stages VALUES (?,?,?,?)").run(sid, pid, "进行中", 0);
db.prepare(`INSERT INTO project_tasks (
  id, projectId, stageId, title, isCompleted, status, assigneeId, startDate, endDate,
  description, cover, sortOrder, creatorId, modifierId, priority, remindAt, titleColor, progress,
  isRecurring, recurrenceRule, reminderOffsetValue, reminderOffsetUnit, recurrenceEndDate, createdAt, updatedAt
) VALUES (?,?,?,?,1,'completed',NULL,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
  tid,
  pid,
  sid,
  "还信用卡",
  "2026-08-01",
  "",
  "",
  0,
  "u1",
  "u1",
  2,
  "2026-07-31",
  null,
  100,
  1,
  JSON.stringify({ type: "monthly", day: 1 }),
  1,
  "day",
  null,
);

const rec = handleRecurringTask(db, tid, true);
console.log("recurrence result", rec);
assert(rec.created === true, "should create");
assert(rec.nextDueDate === "2026-09-01", "next due " + rec.nextDueDate);
assert(rec.nextRemindAt === "2026-08-31", "next remind " + rec.nextRemindAt);

const row = db.prepare("SELECT * FROM project_tasks WHERE id=?").get(rec.newTaskId!) as any;
assert(row && row.isCompleted === 0, "new pending");
assert(row.endDate === "2026-09-01", "endDate");
assert(row.remindAt === "2026-08-31", "remindAt local");

console.log("ALL ASSERTIONS PASSED");
