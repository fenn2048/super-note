import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { HealthBookRow } from "./types.js";
import { getMember } from "./members.js";

export function listBooks(
  db: Database.Database,
  memberId: string,
  opts?: { includeArchived?: boolean },
): HealthBookRow[] {
  if (opts?.includeArchived) {
    return db
      .prepare(`SELECT * FROM health_books WHERE memberId = ? ORDER BY createdAt ASC`)
      .all(memberId) as HealthBookRow[];
  }
  return db
    .prepare(
      `SELECT * FROM health_books WHERE memberId = ? AND isArchived = 0 ORDER BY createdAt ASC`,
    )
    .all(memberId) as HealthBookRow[];
}

export function getBook(db: Database.Database, id: string): HealthBookRow | undefined {
  return db.prepare(`SELECT * FROM health_books WHERE id = ?`).get(id) as
    | HealthBookRow
    | undefined;
}

export function createBook(
  db: Database.Database,
  input: {
    memberId: string;
    title: string;
    description?: string | null;
    color?: string | null;
    createdBy: string;
  },
): HealthBookRow {
  const member = getMember(db, input.memberId);
  if (!member) throw new Error("成员不存在");
  const title = input.title.trim();
  if (!title) throw new Error("title 不能为空");

  const id = uuid();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `INSERT INTO health_books (
      id, workspaceId, memberId, title, description, color, createdBy, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    member.workspaceId,
    input.memberId,
    title,
    input.description ?? null,
    input.color ?? null,
    input.createdBy,
    now,
    now,
  );
  return getBook(db, id)!;
}

export function updateBook(
  db: Database.Database,
  id: string,
  input: {
    title?: string;
    description?: string | null;
    color?: string | null;
    isArchived?: boolean;
  },
): HealthBookRow {
  const existing = getBook(db, id);
  if (!existing) throw new Error("病历本不存在");
  const title = input.title !== undefined ? input.title.trim() : existing.title;
  if (!title) throw new Error("title 不能为空");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `UPDATE health_books SET
      title = ?, description = ?, color = ?, isArchived = ?, updatedAt = ?
     WHERE id = ?`,
  ).run(
    title,
    input.description !== undefined ? input.description : existing.description,
    input.color !== undefined ? input.color : existing.color,
    input.isArchived !== undefined ? (input.isArchived ? 1 : 0) : existing.isArchived,
    now,
    id,
  );
  return getBook(db, id)!;
}
