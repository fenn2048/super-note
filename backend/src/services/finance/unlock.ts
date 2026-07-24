import { createHash, randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";

const UNLOCK_TTL_MINUTES = 15;
const FAIL_WINDOW_MS = 60_000;
const FAIL_MAX = 5;

/** 内存限流：ledgerId+userId → 失败计数 */
const failMap = new Map<string, { count: number; resetAt: number }>();

function failKey(ledgerId: string, userId: string) {
  return `${ledgerId}:${userId}`;
}

export function checkUnlockRateLimit(ledgerId: string, userId: string): string | null {
  const key = failKey(ledgerId, userId);
  const now = Date.now();
  const entry = failMap.get(key);
  if (entry && entry.resetAt > now && entry.count >= FAIL_MAX) {
    return "密码尝试过于频繁，请 1 分钟后再试";
  }
  return null;
}

export function recordUnlockFailure(ledgerId: string, userId: string) {
  const key = failKey(ledgerId, userId);
  const now = Date.now();
  const entry = failMap.get(key);
  if (entry && entry.resetAt > now) {
    entry.count++;
  } else {
    failMap.set(key, { count: 1, resetAt: now + FAIL_WINDOW_MS });
  }
}

export function clearUnlockFailures(ledgerId: string, userId: string) {
  failMap.delete(failKey(ledgerId, userId));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createUnlockSession(
  db: Database.Database,
  ledgerId: string,
  userId: string,
): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60_000).toISOString();

  // 清理过期 + 同用户同账本旧会话
  db.prepare(
    `DELETE FROM finance_unlock_sessions WHERE ledgerId = ? AND userId = ?`,
  ).run(ledgerId, userId);
  db.prepare(
    `DELETE FROM finance_unlock_sessions WHERE expiresAt < datetime('now')`,
  ).run();

  db.prepare(
    `INSERT INTO finance_unlock_sessions (id, ledgerId, userId, tokenHash, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
  ).run(id, ledgerId, userId, tokenHash, expiresAt);

  return { token, expiresAt };
}

export function verifyUnlockToken(
  db: Database.Database,
  ledgerId: string,
  userId: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT id, expiresAt FROM finance_unlock_sessions
       WHERE ledgerId = ? AND userId = ? AND tokenHash = ?`,
    )
    .get(ledgerId, userId, tokenHash) as { id: string; expiresAt: string } | undefined;

  if (!row) return false;
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare(`DELETE FROM finance_unlock_sessions WHERE id = ?`).run(row.id);
    return false;
  }

  // 活动续期
  const newExp = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60_000).toISOString();
  db.prepare(`UPDATE finance_unlock_sessions SET expiresAt = ? WHERE id = ?`).run(newExp, row.id);
  return true;
}

export function revokeUnlockSession(
  db: Database.Database,
  ledgerId: string,
  userId: string,
) {
  db.prepare(
    `DELETE FROM finance_unlock_sessions WHERE ledgerId = ? AND userId = ?`,
  ).run(ledgerId, userId);
}

/** 启用生物识别解锁：签发长期 bioToken（明文返回一次，库内存 hash） */
export function createBioToken(
  db: Database.Database,
  ledgerId: string,
  userId: string,
): string {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const id = uuidv4();
  db.prepare(`DELETE FROM finance_bio_tokens WHERE ledgerId = ? AND userId = ?`).run(
    ledgerId,
    userId,
  );
  db.prepare(
    `INSERT INTO finance_bio_tokens (id, ledgerId, userId, tokenHash, createdAt)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run(id, ledgerId, userId, tokenHash);
  return token;
}

export function verifyBioToken(
  db: Database.Database,
  ledgerId: string,
  userId: string,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const row = db
    .prepare(
      `SELECT id FROM finance_bio_tokens WHERE ledgerId = ? AND userId = ? AND tokenHash = ?`,
    )
    .get(ledgerId, userId, tokenHash) as { id: string } | undefined;
  if (!row) return false;
  db.prepare(
    `UPDATE finance_bio_tokens SET lastUsedAt = datetime('now') WHERE id = ?`,
  ).run(row.id);
  return true;
}

export function hasBioToken(
  db: Database.Database,
  ledgerId: string,
  userId: string,
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM finance_bio_tokens WHERE ledgerId = ? AND userId = ?`,
    )
    .get(ledgerId, userId);
  return !!row;
}

export function revokeBioToken(
  db: Database.Database,
  ledgerId: string,
  userId: string,
) {
  db.prepare(`DELETE FROM finance_bio_tokens WHERE ledgerId = ? AND userId = ?`).run(
    ledgerId,
    userId,
  );
}
