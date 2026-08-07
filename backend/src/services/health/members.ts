import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";
import type { HealthBookRow, HealthMemberRow } from "./types.js";

export function listMembers(
  db: Database.Database,
  workspaceId: string,
  opts?: { includeArchived?: boolean },
): HealthMemberRow[] {
  if (opts?.includeArchived) {
    return db
      .prepare(
        `SELECT * FROM health_members WHERE workspaceId = ?
         ORDER BY sortOrder ASC, createdAt ASC`,
      )
      .all(workspaceId) as HealthMemberRow[];
  }
  return db
    .prepare(
      `SELECT * FROM health_members WHERE workspaceId = ? AND isArchived = 0
       ORDER BY sortOrder ASC, createdAt ASC`,
    )
    .all(workspaceId) as HealthMemberRow[];
}

export function getMember(db: Database.Database, id: string): HealthMemberRow | undefined {
  return db.prepare(`SELECT * FROM health_members WHERE id = ?`).get(id) as
    | HealthMemberRow
    | undefined;
}

export interface CreateMemberInput {
  workspaceId: string;
  displayName: string;
  relationship?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  bloodType?: string | null;
  allergies?: string | null;
  chronicNotes?: string | null;
  linkedUserId?: string | null;
  createdBy: string;
  /** 是否自动创建默认病历本，默认 true */
  withDefaultBook?: boolean;
}

export function createMember(
  db: Database.Database,
  input: CreateMemberInput,
): { member: HealthMemberRow; book: HealthBookRow | null } {
  const id = uuid();
  const name = input.displayName.trim();
  if (!name) throw new Error("displayName 不能为空");

  const maxSort = db
    .prepare(
      `SELECT COALESCE(MAX(sortOrder), 0) AS m FROM health_members WHERE workspaceId = ?`,
    )
    .get(input.workspaceId) as { m: number };

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `INSERT INTO health_members (
      id, workspaceId, displayName, relationship, birthDate, gender, bloodType,
      allergies, chronicNotes, linkedUserId, sortOrder, createdBy, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.workspaceId,
    name,
    input.relationship ?? null,
    input.birthDate ?? null,
    input.gender ?? null,
    input.bloodType ?? null,
    input.allergies ?? null,
    input.chronicNotes ?? null,
    input.linkedUserId ?? null,
    (maxSort?.m ?? 0) + 1,
    input.createdBy,
    now,
    now,
  );

  let book: HealthBookRow | null = null;
  if (input.withDefaultBook !== false) {
    const bookId = uuid();
    db.prepare(
      `INSERT INTO health_books (
        id, workspaceId, memberId, title, description, createdBy, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bookId,
      input.workspaceId,
      id,
      "默认病历本",
      null,
      input.createdBy,
      now,
      now,
    );
    book = db.prepare(`SELECT * FROM health_books WHERE id = ?`).get(bookId) as HealthBookRow;
  }

  const member = getMember(db, id)!;
  return { member, book };
}

export interface UpdateMemberInput {
  displayName?: string;
  relationship?: string | null;
  birthDate?: string | null;
  gender?: string | null;
  bloodType?: string | null;
  allergies?: string | null;
  chronicNotes?: string | null;
  linkedUserId?: string | null;
  sortOrder?: number;
}

export function updateMember(
  db: Database.Database,
  id: string,
  input: UpdateMemberInput,
): HealthMemberRow {
  const existing = getMember(db, id);
  if (!existing) throw new Error("成员不存在");

  const displayName =
    input.displayName !== undefined ? input.displayName.trim() : existing.displayName;
  if (!displayName) throw new Error("displayName 不能为空");

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(
    `UPDATE health_members SET
      displayName = ?,
      relationship = ?,
      birthDate = ?,
      gender = ?,
      bloodType = ?,
      allergies = ?,
      chronicNotes = ?,
      linkedUserId = ?,
      sortOrder = ?,
      updatedAt = ?
     WHERE id = ?`,
  ).run(
    displayName,
    input.relationship !== undefined ? input.relationship : existing.relationship,
    input.birthDate !== undefined ? input.birthDate : existing.birthDate,
    input.gender !== undefined ? input.gender : existing.gender,
    input.bloodType !== undefined ? input.bloodType : existing.bloodType,
    input.allergies !== undefined ? input.allergies : existing.allergies,
    input.chronicNotes !== undefined ? input.chronicNotes : existing.chronicNotes,
    input.linkedUserId !== undefined ? input.linkedUserId : existing.linkedUserId,
    input.sortOrder !== undefined ? input.sortOrder : existing.sortOrder,
    now,
    id,
  );
  return getMember(db, id)!;
}

export function archiveMember(db: Database.Database, id: string, archived = true): HealthMemberRow {
  const existing = getMember(db, id);
  if (!existing) throw new Error("成员不存在");
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  db.prepare(`UPDATE health_members SET isArchived = ?, updatedAt = ? WHERE id = ?`).run(
    archived ? 1 : 0,
    now,
    id,
  );
  return getMember(db, id)!;
}
