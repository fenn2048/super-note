/**
 * 记账模块 API
 * ---------------------------------------------------------------------------
 * 前缀：/api/finance
 * 鉴权：全局 JWT → X-User-Id
 * 敏感操作：X-Finance-Unlock header（有密码的账本）
 */
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";
import { getDb } from "../db/schema.js";
import {
  DEFAULT_ACCOUNTS,
  CHANNEL_DEFAULT_ASSET,
  FALLBACK_ASSET,
  FALLBACK_EXPENSE,
  FALLBACK_INCOME,
} from "../services/finance/defaults.js";
import { seedDefaultRules } from "../services/finance/defaultRules.js";
import {
  checkUnlockRateLimit,
  clearUnlockFailures,
  createBioToken,
  createUnlockSession,
  hasBioToken,
  recordUnlockFailure,
  revokeBioToken,
  revokeUnlockSession,
  verifyBioToken,
  verifyUnlockToken,
} from "../services/finance/unlock.js";
import { exportBeancount, exportCsv } from "../services/finance/export.js";
import {
  deleteTransaction,
  getTransaction,
  insertTransaction,
  listLedgerTags,
  listTransactions,
  updateTransaction,
} from "../services/finance/transactions.js";
import {
  evaluateRules,
  flattenRule,
  splitRuleBody,
} from "../services/finance/rules.js";
import {
  budgetInsights,
  buildRuleInsights,
  fillDailyTrend,
  looksLikeRepayment,
  statsBalanceSeries,
  statsExpenseBreakdown,
  statsExpenseStructure,
  statsIncomeBreakdown,
  statsMonthSeries,
  statsPayees,
  statsSummary,
  statsTagBreakdown,
  statsTrend,
} from "../services/finance/stats.js";
import { parseBill } from "../services/finance/parsers/index.js";
import type { AccountRow, ImportChannel, ImportEntry, LedgerRow } from "../services/finance/types.js";
import { yuanToMinor } from "../services/finance/amount.js";
import {
  buildExactRefMap,
  findDuplicate,
  loadRecentTxIndex,
} from "../services/finance/dedup.js";
import {
  countActionableResidual,
  isTerminalBatchStatus,
  nextBatchStatusAfterCommit,
  nextBatchStatusAfterIgnore,
  parsePriorStats,
  recomputeImportStats,
} from "../services/finance/importBatch.js";
import { listBudgets } from "../services/finance/budget.js";
import { nextRunAfter, processDueRecurring, type RecurringRuleType } from "../services/finance/recurring.js";
import { processBudgetAlerts } from "../services/finance/alerts.js";
import { getUserWorkspaceRole, hasRole } from "../middleware/acl.js";
import type { ImportCommitMode } from "../services/finance/types.js";

const finance = new Hono();

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;

function userId(c: any): string {
  return c.req.header("X-User-Id") || "";
}

/**
 * 账本访问：
 * - 个人账本（workspaceId IS NULL）：仅 ownerUserId
 * - 共享账本：创建者 或 工作区任意成员
 * - canManage（删除/改密）：创建者 或 工作区 admin/owner
 * - canWrite：成员均可记账（家庭账本语义）；viewer 也可写以避免权限过碎
 */
function getLedgerAccess(
  ledgerId: string,
  uid: string,
): { ledger: LedgerRow; canManage: boolean; canWrite: boolean } | null {
  const db = getDb();
  const ledger = db
    .prepare(`SELECT * FROM finance_ledgers WHERE id = ?`)
    .get(ledgerId) as LedgerRow | undefined;
  if (!ledger) return null;

  if (!ledger.workspaceId) {
    if (ledger.ownerUserId !== uid) return null;
    return { ledger, canManage: true, canWrite: true };
  }

  if (ledger.ownerUserId === uid) {
    return { ledger, canManage: true, canWrite: true };
  }
  const role = getUserWorkspaceRole(ledger.workspaceId, uid);
  if (!role) return null;
  return {
    ledger,
    canManage: hasRole(role, "admin"),
    canWrite: true,
  };
}

/** 可读即可返回账本；无权限 null */
function getLedgerOwned(ledgerId: string, uid: string): LedgerRow | null {
  return getLedgerAccess(ledgerId, uid)?.ledger ?? null;
}

function hasPassword(ledger: LedgerRow): boolean {
  return !!(ledger.passwordHash && ledger.passwordHash.length > 0);
}

/** 校验解锁；无密码账本直接通过 */
function requireUnlock(c: any, ledger: LedgerRow): Response | null {
  if (!hasPassword(ledger)) return null;
  const token = c.req.header("X-Finance-Unlock") || "";
  const db = getDb();
  if (!verifyUnlockToken(db, ledger.id, userId(c), token)) {
    return c.json({ error: "账本已锁定，请先解锁", code: "FINANCE_LOCKED" }, 403);
  }
  return null;
}

function publicLedger(
  ledger: LedgerRow,
  unlocked: boolean,
  extra?: { canManage?: boolean; workspaceName?: string | null },
) {
  return {
    id: ledger.id,
    title: ledger.title,
    operatingCurrency: ledger.operatingCurrency,
    startDate: ledger.startDate,
    icon: ledger.icon,
    sortOrder: ledger.sortOrder,
    hasPassword: hasPassword(ledger),
    locked: hasPassword(ledger) && !unlocked,
    workspaceId: ledger.workspaceId,
    ownerUserId: ledger.ownerUserId,
    isShared: !!ledger.workspaceId,
    canManage: extra?.canManage ?? ledger.ownerUserId !== undefined,
    workspaceName: extra?.workspaceName ?? null,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  };
}

function listAccessibleLedgers(uid: string): LedgerRow[] {
  const db = getDb();
  const personal = db
    .prepare(
      `SELECT * FROM finance_ledgers WHERE ownerUserId = ? AND workspaceId IS NULL`,
    )
    .all(uid) as LedgerRow[];
  const shared = db
    .prepare(
      `SELECT l.* FROM finance_ledgers l
       INNER JOIN workspace_members m ON m.workspaceId = l.workspaceId AND m.userId = ?
       WHERE l.workspaceId IS NOT NULL`,
    )
    .all(uid) as LedgerRow[];
  // 去重（创建者既是 owner 又是成员）
  const map = new Map<string, LedgerRow>();
  for (const l of [...personal, ...shared]) map.set(l.id, l);
  return [...map.values()].sort((a, b) =>
    (a.createdAt || "").localeCompare(b.createdAt || ""),
  );
}

function seedDefaultAccounts(db: ReturnType<typeof getDb>, ledgerId: string, currency: string) {
  const ins = db.prepare(
    `INSERT INTO finance_accounts (id, ledgerId, name, type, currency, icon, isOpen, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
  );
  for (const a of DEFAULT_ACCOUNTS) {
    ins.run(uuidv4(), ledgerId, a.name, a.type, currency, a.icon || null);
  }
}

function findAccountByName(db: ReturnType<typeof getDb>, ledgerId: string, name: string): AccountRow | null {
  return (
    (db
      .prepare(`SELECT * FROM finance_accounts WHERE ledgerId = ? AND name = ?`)
      .get(ledgerId, name) as AccountRow | undefined) || null
  );
}

// ========== Ledgers ==========

finance.get("/ledgers", (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "未授权" }, 401);
  const db = getDb();
  const rows = listAccessibleLedgers(uid);
  const unlockHeader = c.req.header("X-Finance-Unlock") || "";

  const wsNames = new Map<string, string>();
  for (const l of rows) {
    if (l.workspaceId && !wsNames.has(l.workspaceId)) {
      const w = db
        .prepare(`SELECT name FROM workspaces WHERE id = ?`)
        .get(l.workspaceId) as { name: string } | undefined;
      if (w) wsNames.set(l.workspaceId, w.name);
    }
  }

  return c.json(
    rows.map((l) => {
      const access = getLedgerAccess(l.id, uid);
      const unlocked =
        !hasPassword(l) || verifyUnlockToken(db, l.id, uid, unlockHeader);
      return publicLedger(l, unlocked, {
        canManage: access?.canManage ?? false,
        workspaceName: l.workspaceId ? wsNames.get(l.workspaceId) || null : null,
      });
    }),
  );
});

finance.post("/ledgers", async (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "未授权" }, 401);
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    password?: string;
    operatingCurrency?: string;
    startDate?: string;
    icon?: string;
    /** 绑定工作区则为共享账本；空/不传 = 个人 */
    workspaceId?: string | null;
  };
  const title = (body.title || "").trim();
  if (!title) return c.json({ error: "请填写账本名称" }, 400);

  let workspaceId: string | null = body.workspaceId?.trim() || null;
  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, uid);
    // 创建共享账本：至少 editor
    if (!hasRole(role, "editor")) {
      return c.json({ error: "无权在该工作区创建共享账本（需要编辑者及以上）" }, 403);
    }
  }

  const currency = (body.operatingCurrency || "CNY").trim() || "CNY";
  const startDate =
    body.startDate || new Date().toISOString().slice(0, 10);
  let passwordHash: string | null = null;
  if (body.password) {
    passwordHash = await bcrypt.hash(body.password, 10);
  }

  const id = uuidv4();
  const db = getDb();
  db.prepare(
    `INSERT INTO finance_ledgers
      (id, ownerUserId, workspaceId, title, operatingCurrency, startDate, passwordHash, icon, sortOrder, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))`,
  ).run(id, uid, workspaceId, title, currency, startDate, passwordHash, body.icon || "📒");

  seedDefaultAccounts(db, id, currency);
  seedDefaultRules(db, id);

  const ledger = getLedgerOwned(id, uid)!;
  let unlockToken: string | undefined;
  let expiresAt: string | undefined;
  if (hasPassword(ledger) && body.password) {
    const s = createUnlockSession(db, id, uid);
    unlockToken = s.token;
    expiresAt = s.expiresAt;
  }

  let workspaceName: string | null = null;
  if (workspaceId) {
    const w = db.prepare(`SELECT name FROM workspaces WHERE id = ?`).get(workspaceId) as
      | { name: string }
      | undefined;
    workspaceName = w?.name || null;
  }

  return c.json(
    {
      ...publicLedger(ledger, true, { canManage: true, workspaceName }),
      unlockToken,
      expiresAt,
    },
    201,
  );
});

finance.get("/ledgers/:id", (c) => {
  const uid = userId(c);
  const access = getLedgerAccess(c.req.param("id"), uid);
  if (!access) return c.json({ error: "账本不存在" }, 404);
  const { ledger } = access;
  const db = getDb();
  const token = c.req.header("X-Finance-Unlock") || "";
  const unlocked = !hasPassword(ledger) || verifyUnlockToken(db, ledger.id, uid, token);
  let workspaceName: string | null = null;
  if (ledger.workspaceId) {
    const w = db
      .prepare(`SELECT name FROM workspaces WHERE id = ?`)
      .get(ledger.workspaceId) as { name: string } | undefined;
    workspaceName = w?.name || null;
  }
  return c.json(
    publicLedger(ledger, unlocked, {
      canManage: access.canManage,
      workspaceName,
    }),
  );
});

finance.patch("/ledgers/:id", async (c) => {
  const uid = userId(c);
  const access = getLedgerAccess(c.req.param("id"), uid);
  if (!access) return c.json({ error: "账本不存在" }, 404);
  if (!access.canWrite) return c.json({ error: "无权修改" }, 403);
  const ledger = access.ledger;
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    icon?: string;
    startDate?: string;
  };
  const db = getDb();
  db.prepare(
    `UPDATE finance_ledgers SET
      title = COALESCE(?, title),
      icon = COALESCE(?, icon),
      startDate = COALESCE(?, startDate),
      updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(body.title ?? null, body.icon ?? null, body.startDate ?? null, ledger.id);

  return c.json(
    publicLedger(getLedgerOwned(ledger.id, uid)!, true, { canManage: access.canManage }),
  );
});

finance.delete("/ledgers/:id", async (c) => {
  const uid = userId(c);
  const access = getLedgerAccess(c.req.param("id"), uid);
  if (!access) return c.json({ error: "账本不存在" }, 404);
  if (!access.canManage) {
    return c.json({ error: "仅账本创建者或工作区管理员可删除" }, 403);
  }
  const ledger = access.ledger;

  if (hasPassword(ledger)) {
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    if (!body.password || !(await bcrypt.compare(body.password, ledger.passwordHash!))) {
      return c.json({ error: "密码错误，无法删除账本" }, 403);
    }
  }

  const db = getDb();
  // 先删分录与交易等（FK cascade 可能未覆盖全部顺序）
  db.prepare(`DELETE FROM finance_postings WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_transactions WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_import_rows WHERE batchId IN (SELECT id FROM finance_import_batches WHERE ledgerId = ?)`).run(ledger.id);
  db.prepare(`DELETE FROM finance_import_batches WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_import_rules WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_unlock_sessions WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_tx_templates WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_budgets WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_bio_tokens WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_recurring WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_alert_log WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_accounts WHERE ledgerId = ?`).run(ledger.id);
  db.prepare(`DELETE FROM finance_ledgers WHERE id = ?`).run(ledger.id);
  return c.json({ ok: true });
});

finance.post("/ledgers/:id/unlock", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);

  if (!hasPassword(ledger)) {
    return c.json({ unlockToken: null, expiresAt: null, message: "账本未设置密码" });
  }

  const rate = checkUnlockRateLimit(ledger.id, uid);
  if (rate) return c.json({ error: rate }, 429);

  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  if (!body.password) return c.json({ error: "请输入密码" }, 400);

  const ok = await bcrypt.compare(body.password, ledger.passwordHash!);
  if (!ok) {
    recordUnlockFailure(ledger.id, uid);
    return c.json({ error: "密码错误" }, 403);
  }

  clearUnlockFailures(ledger.id, uid);
  const db = getDb();
  const session = createUnlockSession(db, ledger.id, uid);
  return c.json({
    unlockToken: session.token,
    expiresAt: session.expiresAt,
    bioEnabled: hasBioToken(db, ledger.id, uid),
  });
});

/** 生物识别解锁：用长期 bioToken 换短期 unlockToken */
finance.post("/ledgers/:id/unlock-bio", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  if (!hasPassword(ledger)) {
    return c.json({ unlockToken: null, expiresAt: null, message: "账本未设置密码" });
  }

  const rate = checkUnlockRateLimit(ledger.id, uid);
  if (rate) return c.json({ error: rate }, 429);

  const body = (await c.req.json().catch(() => ({}))) as { bioToken?: string };
  const db = getDb();
  if (!verifyBioToken(db, ledger.id, uid, body.bioToken)) {
    recordUnlockFailure(ledger.id, uid);
    return c.json({ error: "生物识别凭证无效，请使用密码解锁后重新启用" }, 403);
  }
  clearUnlockFailures(ledger.id, uid);
  const session = createUnlockSession(db, ledger.id, uid);
  return c.json({ unlockToken: session.token, expiresAt: session.expiresAt });
});

/** 在已解锁状态下启用生物识别（返回 bioToken 明文一次） */
finance.post("/ledgers/:id/bio-enable", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  if (!hasPassword(ledger)) return c.json({ error: "未设密码的账本无需生物识别" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { password?: string };
  // 需已解锁 或 提供正确密码
  const locked = requireUnlock(c, ledger);
  if (locked) {
    if (!body.password || !(await bcrypt.compare(body.password, ledger.passwordHash!))) {
      return locked;
    }
  }

  const db = getDb();
  const bioToken = createBioToken(db, ledger.id, uid);
  return c.json({ bioToken, enabled: true });
});

finance.get("/ledgers/:id/bio-status", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  return c.json({
    enabled: hasPassword(ledger) && hasBioToken(getDb(), ledger.id, uid),
    hasPassword: hasPassword(ledger),
  });
});

finance.delete("/ledgers/:id/bio-enable", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  revokeBioToken(getDb(), ledger.id, uid);
  return c.json({ ok: true, enabled: false });
});

finance.post("/ledgers/:id/lock", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  revokeUnlockSession(getDb(), ledger.id, uid);
  return c.json({ ok: true });
});

finance.post("/ledgers/:id/password", async (c) => {
  const uid = userId(c);
  const access = getLedgerAccess(c.req.param("id"), uid);
  if (!access) return c.json({ error: "账本不存在" }, 404);
  if (!access.canManage) {
    return c.json({ error: "仅账本创建者或工作区管理员可修改密码" }, 403);
  }
  const ledger = access.ledger;

  const body = (await c.req.json().catch(() => ({}))) as {
    oldPassword?: string;
    newPassword?: string | null;
  };

  if (hasPassword(ledger)) {
    if (!body.oldPassword || !(await bcrypt.compare(body.oldPassword, ledger.passwordHash!))) {
      return c.json({ error: "原密码错误" }, 403);
    }
  }

  const db = getDb();
  if (!body.newPassword) {
    db.prepare(
      `UPDATE finance_ledgers SET passwordHash = NULL, updatedAt = datetime('now') WHERE id = ?`,
    ).run(ledger.id);
    revokeUnlockSession(db, ledger.id, uid);
    revokeBioToken(db, ledger.id, uid);
    return c.json({ ok: true, hasPassword: false });
  }

  const hash = await bcrypt.hash(body.newPassword, 10);
  db.prepare(
    `UPDATE finance_ledgers SET passwordHash = ?, updatedAt = datetime('now') WHERE id = ?`,
  ).run(hash, ledger.id);
  revokeUnlockSession(db, ledger.id, uid);
  revokeBioToken(db, ledger.id, uid);
  return c.json({ ok: true, hasPassword: true });
});

// ========== Export ==========

finance.get("/ledgers/:id/export", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const format = (c.req.query("format") || "csv").toLowerCase();
  const db = getDb();
  const safeName = ledger.title.replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40);

  if (format === "beancount" || format === "bean") {
    const body = exportBeancount(db, ledger.id);
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName}.bean"`,
      },
    });
  }

  const body = exportCsv(db, ledger.id);
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}.csv"`,
    },
  });
});

// ========== Accounts ==========

finance.get("/ledgers/:id/accounts", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const db = getDb();
  const accounts = db
    .prepare(
      `SELECT a.*,
         COALESCE((SELECT SUM(p.amountMinor) FROM finance_postings p WHERE p.accountId = a.id), 0) AS balanceMinor
       FROM finance_accounts a
       WHERE a.ledgerId = ?
       ORDER BY a.type, a.name`,
    )
    .all(ledger.id);
  return c.json(accounts);
});

finance.post("/ledgers/:id/accounts", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    type?: string;
    icon?: string;
    currency?: string;
    notes?: string;
  };
  const name = (body.name || "").trim();
  const type = (body.type || "").toUpperCase();
  if (!name || !["ASSETS", "LIABILITIES", "EQUITY", "INCOME", "EXPENSES"].includes(type)) {
    return c.json({ error: "账户名称与类型必填" }, 400);
  }

  const id = uuidv4();
  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO finance_accounts (id, ledgerId, name, type, currency, icon, notes, isOpen, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))`,
    ).run(
      id,
      ledger.id,
      name,
      type,
      body.currency || ledger.operatingCurrency,
      body.icon || null,
      body.notes || null,
    );
  } catch (e: any) {
    if (String(e?.message || "").includes("UNIQUE")) {
      return c.json({ error: "账户名称已存在" }, 409);
    }
    throw e;
  }
  const row = db.prepare(`SELECT * FROM finance_accounts WHERE id = ?`).get(id);
  return c.json(row, 201);
});

finance.patch("/ledgers/:id/accounts/:accountId", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    icon?: string;
    notes?: string;
    isOpen?: boolean;
  };
  const db = getDb();
  const acct = db
    .prepare(`SELECT * FROM finance_accounts WHERE id = ? AND ledgerId = ?`)
    .get(c.req.param("accountId"), ledger.id);
  if (!acct) return c.json({ error: "账户不存在" }, 404);

  db.prepare(
    `UPDATE finance_accounts SET
      name = COALESCE(?, name),
      icon = COALESCE(?, icon),
      notes = COALESCE(?, notes),
      isOpen = COALESCE(?, isOpen),
      updatedAt = datetime('now')
     WHERE id = ?`,
  ).run(
    body.name ?? null,
    body.icon ?? null,
    body.notes ?? null,
    body.isOpen === undefined ? null : body.isOpen ? 1 : 0,
    c.req.param("accountId"),
  );
  return c.json(db.prepare(`SELECT * FROM finance_accounts WHERE id = ?`).get(c.req.param("accountId")));
});

finance.post("/ledgers/:id/accounts/:accountId/close", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const db = getDb();
  db.prepare(
    `UPDATE finance_accounts SET isOpen = 0, updatedAt = datetime('now') WHERE id = ? AND ledgerId = ?`,
  ).run(c.req.param("accountId"), ledger.id);
  return c.json({ ok: true });
});

// ========== Transactions ==========

finance.get("/ledgers/:id/transactions", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const result = listTransactions(getDb(), ledger.id, {
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    q: c.req.query("q") || undefined,
    tag: c.req.query("tag") || undefined,
    accountId: c.req.query("accountId") || undefined,
    accountPrefix: c.req.query("accountPrefix") || undefined,
    payee: c.req.query("payee") || undefined,
    limit: Number(c.req.query("limit") || 50),
    offset: Number(c.req.query("offset") || 0),
  });
  return c.json(result);
});

/** 标签列表：预设 + 账本已用（对齐 beancount-gs /api/auth/tags） */
finance.get("/ledgers/:id/tags", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  return c.json(listLedgerTags(getDb(), ledger.id));
});

finance.get("/ledgers/:id/transactions/:txId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const tx = getTransaction(getDb(), ledger.id, c.req.param("txId"));
  if (!tx) return c.json({ error: "交易不存在" }, 404);
  return c.json(tx);
});

function resolvePostingsFromBody(body: {
  kind?: "expense" | "income" | "transfer";
  amountYuan?: number | string;
  fromAccountId?: string;
  toAccountId?: string;
  postings?: Array<{ accountId: string; amountMinor?: number; amountYuan?: number | string }>;
}): Array<{ accountId: string; amountMinor: number }> | { error: string } {
  let postings = body.postings?.map((p) => ({
    accountId: p.accountId,
    amountMinor:
      p.amountMinor !== undefined ? p.amountMinor : yuanToMinor(p.amountYuan ?? 0),
  }));

  if ((!postings || postings.length < 2) && body.kind && body.amountYuan !== undefined) {
    const abs = Math.abs(yuanToMinor(body.amountYuan));
    if (!body.fromAccountId || !body.toAccountId) {
      return { error: "请选择账户" };
    }
    if (body.kind === "expense") {
      postings = [
        { accountId: body.toAccountId, amountMinor: abs },
        { accountId: body.fromAccountId, amountMinor: -abs },
      ];
    } else if (body.kind === "income") {
      postings = [
        { accountId: body.toAccountId, amountMinor: abs },
        { accountId: body.fromAccountId, amountMinor: -abs },
      ];
    } else {
      postings = [
        { accountId: body.toAccountId, amountMinor: abs },
        { accountId: body.fromAccountId, amountMinor: -abs },
      ];
    }
  }

  if (!postings || postings.length < 2) {
    return { error: "请提供有效分录" };
  }
  return postings;
}

finance.post("/ledgers/:id/transactions", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    date?: string;
    time?: string;
    payee?: string;
    narration?: string;
    tags?: string[];
    kind?: "expense" | "income" | "transfer";
    amountYuan?: number | string;
    fromAccountId?: string;
    toAccountId?: string;
    postings?: Array<{ accountId: string; amountMinor?: number; amountYuan?: number | string }>;
  };

  const db = getDb();
  try {
    const postings = resolvePostingsFromBody(body);
    if ("error" in postings) return c.json({ error: postings.error }, 400);

    const run = db.transaction(() => {
      return insertTransaction(db, ledger.id, {
        date: body.date || new Date().toISOString().slice(0, 10),
        time: body.time,
        payee: body.payee,
        narration: body.narration,
        tags: body.tags,
        source: "manual",
        postings,
      });
    });
    const txId = run();
    return c.json(getTransaction(db, ledger.id, txId), 201);
  } catch (e: any) {
    return c.json({ error: e?.message || "保存失败" }, 400);
  }
});

finance.patch("/ledgers/:id/transactions/:txId", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    date?: string;
    time?: string;
    payee?: string;
    narration?: string;
    tags?: string[];
    kind?: "expense" | "income" | "transfer";
    amountYuan?: number | string;
    fromAccountId?: string;
    toAccountId?: string;
    postings?: Array<{ accountId: string; amountMinor?: number; amountYuan?: number | string }>;
  };

  const db = getDb();
  try {
    let postings: Array<{ accountId: string; amountMinor: number }> | undefined;
    if (
      body.postings ||
      (body.kind && body.amountYuan !== undefined && body.fromAccountId && body.toAccountId)
    ) {
      const resolved = resolvePostingsFromBody(body);
      if ("error" in resolved) return c.json({ error: resolved.error }, 400);
      postings = resolved;
    }

    const ok = db.transaction(() => {
      return updateTransaction(db, ledger.id, c.req.param("txId"), {
        date: body.date,
        time: body.time,
        payee: body.payee,
        narration: body.narration,
        tags: body.tags,
        postings,
      });
    })();
    if (!ok) return c.json({ error: "交易不存在" }, 404);
    return c.json(getTransaction(db, ledger.id, c.req.param("txId")));
  } catch (e: any) {
    return c.json({ error: e?.message || "更新失败" }, 400);
  }
});

finance.delete("/ledgers/:id/transactions/:txId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const ok = deleteTransaction(getDb(), ledger.id, c.req.param("txId"));
  if (!ok) return c.json({ error: "交易不存在" }, 404);
  return c.json({ ok: true });
});

// ========== Templates ==========

finance.get("/ledgers/:id/templates", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const rows = getDb()
    .prepare(
      `SELECT * FROM finance_tx_templates WHERE ledgerId = ? ORDER BY createdAt DESC`,
    )
    .all(ledger.id) as any[];
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      payload: JSON.parse(r.payloadJson || "{}"),
      createdAt: r.createdAt,
    })),
  );
});

finance.post("/ledgers/:id/templates", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    payload?: Record<string, unknown>;
  };
  if (!body.name?.trim()) return c.json({ error: "模板名称必填" }, 400);
  const id = uuidv4();
  getDb()
    .prepare(
      `INSERT INTO finance_tx_templates (id, ledgerId, name, payloadJson, createdAt)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(id, ledger.id, body.name.trim(), JSON.stringify(body.payload || {}));
  return c.json({ id, name: body.name.trim(), payload: body.payload || {} }, 201);
});

finance.delete("/ledgers/:id/templates/:templateId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  getDb()
    .prepare(`DELETE FROM finance_tx_templates WHERE id = ? AND ledgerId = ?`)
    .run(c.req.param("templateId"), ledger.id);
  return c.json({ ok: true });
});

// ========== Import rules ==========

finance.get("/ledgers/:id/import/rules", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const rules = getDb()
    .prepare(
      `SELECT * FROM finance_import_rules WHERE ledgerId = ? ORDER BY priority DESC, updatedAt DESC`,
    )
    .all(ledger.id) as any[];
  return c.json(rules.map((r) => flattenRule(r)));
});

finance.post("/ledgers/:id/import/rules", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const raw = (await c.req.json().catch(() => ({}))) as Record<string, any>;
  const parsed = splitRuleBody(raw);
  if (!parsed.name) return c.json({ error: "规则名称必填" }, 400);

  const db = getDb();
  const id = raw.id || uuidv4();
  const existing = raw.id
    ? db
        .prepare(`SELECT id FROM finance_import_rules WHERE id = ? AND ledgerId = ?`)
        .get(raw.id, ledger.id)
    : null;

  // 新建时若未指定 priority，取当前最大 +10
  let priority = parsed.priority;
  if (!existing && (raw.priority == null || raw.priority === "")) {
    const maxP = db
      .prepare(
        `SELECT COALESCE(MAX(priority), 0) AS m FROM finance_import_rules WHERE ledgerId = ?`,
      )
      .get(ledger.id) as { m: number };
    priority = (maxP?.m || 0) + 10;
  }

  if (existing) {
    db.prepare(
      `UPDATE finance_import_rules SET name = ?, priority = ?, enabled = ?, matchJson = ?, actionJson = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(
      parsed.name,
      priority,
      parsed.enabled ? 1 : 0,
      JSON.stringify(parsed.match),
      JSON.stringify(parsed.action),
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO finance_import_rules (id, ledgerId, name, priority, enabled, matchJson, actionJson, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(
      id,
      ledger.id,
      parsed.name,
      priority,
      parsed.enabled ? 1 : 0,
      JSON.stringify(parsed.match),
      JSON.stringify(parsed.action),
    );
  }
  const row = db.prepare(`SELECT * FROM finance_import_rules WHERE id = ?`).get(id) as any;
  return c.json(flattenRule(row));
});

finance.delete("/ledgers/:id/import/rules/:ruleId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  getDb()
    .prepare(`DELETE FROM finance_import_rules WHERE id = ? AND ledgerId = ?`)
    .run(c.req.param("ruleId"), ledger.id);
  return c.json({ ok: true });
});

/** 调整优先级：body.ids 从高到低 */
finance.post("/ledgers/:id/import/rules/reorder", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const body = (await c.req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = body.ids || [];
  const db = getDb();
  const upd = db.prepare(
    `UPDATE finance_import_rules SET priority = ?, updatedAt = datetime('now') WHERE id = ? AND ledgerId = ?`,
  );
  const run = db.transaction(() => {
    ids.forEach((id, i) => {
      upd.run((ids.length - i) * 10, id, ledger.id);
    });
  });
  run();
  return c.json({ ok: true });
});

/** 试跑规则：对一条虚拟 entry 返回匹配结果 */
finance.post("/ledgers/:id/import/rules/test", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    payee?: string;
    item?: string;
    type?: string;
    category?: string;
    method?: string;
    amountYuan?: number;
    direction?: "in" | "out";
    time?: string;
    tags?: string[];
    ruleIds?: string[];
  };
  const db = getDb();
  const expense = findAccountByName(db, ledger.id, FALLBACK_EXPENSE);
  const income = findAccountByName(db, ledger.id, FALLBACK_INCOME);
  const asset = findAccountByName(db, ledger.id, FALLBACK_ASSET);
  const rules = db
    .prepare(
      `SELECT * FROM finance_import_rules WHERE ledgerId = ? AND enabled = 1 ORDER BY priority DESC, updatedAt DESC`,
    )
    .all(ledger.id) as any[];

  const amountYuan = Number(body.amountYuan || 0);
  const dir = body.direction || (amountYuan < 0 ? "out" : "in");
  const amountMinor = Math.round(Math.abs(amountYuan) * 100) * (dir === "out" ? -1 : 1);

  const entry = {
    sourceId: "test",
    date: new Date().toISOString().slice(0, 10),
    time: body.time,
    payee: body.payee || "",
    item: body.item || "",
    type: body.type,
    category: body.category,
    method: body.method,
    amountMinor,
    direction: dir as "in" | "out",
    tags: Array.isArray(body.tags) ? body.tags.map(String) : undefined,
    rawItems: {},
  };

  const result = evaluateRules(
    entry,
    rules,
    {
      expenseAccountId: expense?.id,
      incomeAccountId: income?.id,
      assetAccountId: asset?.id,
    },
    body.ruleIds,
  );
  return c.json(result);
});

// ========== Import pipeline ==========

finance.post("/ledgers/:id/import/detect-parse", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const form = await c.req.parseBody();
  const file = form["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "请上传账单文件" }, 400);
  }
  const f = file as File;
  const ab = await f.arrayBuffer();
  if (ab.byteLength > MAX_IMPORT_BYTES) {
    return c.json({ error: "文件过大（上限 15MB）" }, 400);
  }
  const buffer = Buffer.from(ab);
  const channelOverride = (form["channel"] as string) || null;

  // 规则过滤：ruleIds 可为 "ALL" 或逗号分隔 / 多字段
  let selectedRuleIds: string[] | null = null;
  const rawRuleIds = form["ruleIds"];
  if (Array.isArray(rawRuleIds)) {
    selectedRuleIds = rawRuleIds.map(String);
  } else if (typeof rawRuleIds === "string" && rawRuleIds.trim()) {
    selectedRuleIds = rawRuleIds.split(",").map((s) => s.trim()).filter(Boolean);
  }

  let parsed: Awaited<ReturnType<typeof parseBill>>;
  try {
    parsed = await parseBill(buffer, f.name || "bill", channelOverride as ImportChannel | null);
  } catch (e: any) {
    return c.json({ error: `解析失败: ${e?.message || e}` }, 400);
  }

  if (parsed.channel === "unknown" || parsed.entries.length === 0) {
    return c.json({
      error: "无法识别账单格式或无有效交易，请手动选择渠道后重试",
      channel: parsed.channel,
      detectConfidence: parsed.detectConfidence,
      count: parsed.entries.length,
    }, 400);
  }

  const db = getDb();
  const expense = findAccountByName(db, ledger.id, FALLBACK_EXPENSE);
  const income = findAccountByName(db, ledger.id, FALLBACK_INCOME);
  const assetName = CHANNEL_DEFAULT_ASSET[parsed.channel] || FALLBACK_ASSET;
  const asset =
    findAccountByName(db, ledger.id, assetName) || findAccountByName(db, ledger.id, FALLBACK_ASSET);

  const rules = db
    .prepare(
      `SELECT * FROM finance_import_rules WHERE ledgerId = ? AND enabled = 1 ORDER BY priority DESC, updatedAt DESC`,
    )
    .all(ledger.id) as any[];

  const batchId = uuidv4();
  const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString();

  const insertRow = db.prepare(
    `INSERT INTO finance_import_rows
      (id, batchId, rowIndex, status, confidence, parsedJson, draftJson, matchRuleId, duplicateTxId)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // 跨源去重索引
  const dates = parsed.entries.map((e) => e.date).filter(Boolean).sort();
  const minDate = dates[0] || "1970-01-01";
  const txIndex = loadRecentTxIndex(db, ledger.id, minDate);
  const exactRefMap = buildExactRefMap(db, ledger.id);

  let ready = 0,
    needs_review = 0,
    duplicate = 0,
    ignored = 0,
    crossDup = 0;

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO finance_import_batches (id, ledgerId, channel, fileName, status, statsJson, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, 'preview', NULL, datetime('now'), ?)`,
    ).run(batchId, ledger.id, parsed.channel, f.name || "bill", expiresAt);

    parsed.entries.forEach((entry: ImportEntry, rowIndex: number) => {
      const evalResult = evaluateRules(
        entry,
        rules,
        {
          expenseAccountId: expense?.id,
          incomeAccountId: income?.id,
          assetAccountId: asset?.id,
        },
        selectedRuleIds,
      );

      let status: string = "needs_review";
      let duplicateTxId: string | null = null;
      let dupMeta: {
        txId: string;
        reason: string;
        confidence: number;
        existingPayee?: string | null;
        existingSource?: string | null;
      } | null = null;

      if (evalResult.ignore) {
        status = "ignored";
        ignored++;
      } else {
        const hit = findDuplicate(entry, parsed.channel, txIndex, exactRefMap);
        if (hit) {
          status = "duplicate";
          duplicateTxId = hit.txId;
          duplicate++;
          if (hit.reason !== "source_ref") crossDup++;
          dupMeta = hit;
        } else if (
          evalResult.confidence >= 0.9 &&
          evalResult.targetAccountId &&
          evalResult.methodAccountId
        ) {
          status = "ready";
          ready++;
        } else {
          status = "needs_review";
          needs_review++;
        }
      }

      const repayHint = looksLikeRepayment(entry.payee, entry.item, entry.method);
      // 还款类：建议转账（资产↔负债），勿记支出；强制待确认
      if (repayHint && status === "ready") {
        status = "needs_review";
        ready = Math.max(0, ready - 1);
        needs_review++;
      } else if (repayHint && status !== "ignored" && status !== "duplicate" && status !== "needs_review") {
        status = "needs_review";
        needs_review++;
      }

      const draft = {
        payee: entry.payee,
        narration: entry.item,
        date: entry.date,
        time: entry.time,
        tags: evalResult.tags,
        targetAccountId: repayHint ? null : evalResult.targetAccountId,
        methodAccountId: evalResult.methodAccountId,
        amountMinor: entry.amountMinor,
        direction: entry.direction,
        selected: status === "ready" || status === "needs_review",
        matchedRuleId: evalResult.matchedRuleId,
        matchedRuleName: evalResult.matchedRuleName,
        // 跨源重复默认不勾选；用户可手动勾选强制导入
        dup: dupMeta,
        suggestTransfer: repayHint || undefined,
        reviewHint: repayHint
          ? "疑似信用卡/贷款还款：建议记为转账（资产→负债），勿计入支出"
          : undefined,
      };

      insertRow.run(
        uuidv4(),
        batchId,
        rowIndex,
        status,
        evalResult.confidence,
        JSON.stringify(entry),
        JSON.stringify(draft),
        evalResult.matchedRuleId,
        duplicateTxId,
      );
    });

    const stats = {
      total: parsed.entries.length,
      ready,
      needs_review,
      duplicate,
      crossDup,
      ignored,
      channel: parsed.channel,
      detectConfidence: parsed.detectConfidence,
    };
    db.prepare(`UPDATE finance_import_batches SET statsJson = ? WHERE id = ?`).run(
      JSON.stringify(stats),
      batchId,
    );
    return stats;
  });

  const stats = run();
  return c.json({
    batchId,
    channel: parsed.channel,
    detectConfidence: parsed.detectConfidence,
    fileName: f.name,
    stats,
  });
});

finance.get("/ledgers/:id/import/batches/:batchId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const db = getDb();
  const batch = db
    .prepare(`SELECT * FROM finance_import_batches WHERE id = ? AND ledgerId = ?`)
    .get(c.req.param("batchId"), ledger.id) as any;
  if (!batch) return c.json({ error: "导入批次不存在" }, 404);

  const statusFilter = c.req.query("status");
  const onlySelected = c.req.query("onlySelected") === "1";
  let rows = db
    .prepare(
      `SELECT * FROM finance_import_rows WHERE batchId = ? ORDER BY rowIndex ASC`,
    )
    .all(batch.id) as any[];

  if (statusFilter) {
    rows = rows.filter((r) => r.status === statusFilter);
  }

  const readOnly = isTerminalBatchStatus(batch.status);
  const mapped = rows
    .map((r) => {
      const draft = JSON.parse(r.draftJson || "{}");
      const parsed = JSON.parse(r.parsedJson || "{}");
      if (onlySelected && draft.selected === false) return null;
      return {
        id: r.id,
        rowIndex: r.rowIndex,
        status: r.status,
        confidence: r.confidence,
        matchRuleId: r.matchRuleId,
        duplicateTxId: r.duplicateTxId,
        parsed,
        draft,
      };
    })
    .filter(Boolean);

  const prior = parsePriorStats(batch.statsJson);
  const stats = recomputeImportStats(db, batch.id, prior);

  return c.json({
    batch: {
      id: batch.id,
      channel: batch.channel,
      fileName: batch.fileName,
      status: batch.status,
      stats,
      createdAt: batch.createdAt,
      readOnly,
    },
    rows: mapped,
    readOnly,
  });
});

/** 批量改导入行（分类账户 / 资产账户 / selected / force / markIgnored） */
finance.post("/ledgers/:id/import/batches/:batchId/bulk", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    rowIds?: string[];
    targetAccountId?: string;
    methodAccountId?: string;
    selected?: boolean;
    /** 将 duplicate 行强制改为可选导入 */
    forceImportDuplicates?: boolean;
    /** 将 duplicate 行标记为 ignored（假阳性出口，K18） */
    markIgnored?: boolean;
  };

  const db = getDb();
  const batch = db
    .prepare(`SELECT * FROM finance_import_batches WHERE id = ? AND ledgerId = ?`)
    .get(c.req.param("batchId"), ledger.id) as any;
  if (!batch) return c.json({ error: "批次不存在" }, 404);
  if (isTerminalBatchStatus(batch.status)) {
    return c.json({ error: "批次已结束，不可修改" }, 400);
  }

  let rows = db
    .prepare(`SELECT * FROM finance_import_rows WHERE batchId = ?`)
    .all(batch.id) as any[];
  if (body.rowIds?.length) {
    const set = new Set(body.rowIds);
    rows = rows.filter((r) => set.has(r.id));
  }

  const upd = db.prepare(
    `UPDATE finance_import_rows SET draftJson = ?, status = ? WHERE id = ?`,
  );
  let updated = 0;
  let skippedCommitted = 0;
  const run = db.transaction(() => {
    for (const r of rows) {
      if (r.status === "committed") {
        skippedCommitted++;
        continue;
      }
      const draft = JSON.parse(r.draftJson || "{}");
      let status = r.status as string;

      if (body.markIgnored) {
        // P0: 仅 duplicate → ignored
        if (status !== "duplicate") continue;
        status = "ignored";
        draft.selected = false;
        upd.run(JSON.stringify(draft), status, r.id);
        updated++;
        continue;
      }

      if (body.targetAccountId !== undefined) draft.targetAccountId = body.targetAccountId;
      if (body.methodAccountId !== undefined) draft.methodAccountId = body.methodAccountId;
      if (body.selected !== undefined) draft.selected = body.selected;
      if (body.forceImportDuplicates && status === "duplicate") {
        status = "needs_review";
        draft.selected = true;
        draft.forceImport = true;
      }
      if (
        draft.targetAccountId &&
        draft.methodAccountId &&
        status === "needs_review"
      ) {
        status = "ready";
      }
      upd.run(JSON.stringify(draft), status, r.id);
      updated++;
    }
  });
  run();

  const prior = parsePriorStats(batch.statsJson);
  const stats = recomputeImportStats(db, batch.id, prior);
  const residual = countActionableResidual(db, batch.id);
  let batchStatus = batch.status as string;

  if (body.markIgnored) {
    batchStatus = nextBatchStatusAfterIgnore(batch.status, residual, stats.committed);
    db.prepare(`UPDATE finance_import_batches SET status = ?, statsJson = ? WHERE id = ?`).run(
      batchStatus,
      JSON.stringify(stats),
      batch.id,
    );
  }

  return c.json({
    updated,
    skippedCommitted,
    batchStatus,
    stats,
    remaining: residual,
  });
});

finance.patch("/ledgers/:id/import/batches/:batchId/rows/:rowId", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const db = getDb();
  const batch = db
    .prepare(`SELECT * FROM finance_import_batches WHERE id = ? AND ledgerId = ?`)
    .get(c.req.param("batchId"), ledger.id) as any;
  if (!batch) return c.json({ error: "批次不存在" }, 404);
  if (isTerminalBatchStatus(batch.status)) {
    return c.json({ error: "批次已结束，不可修改" }, 400);
  }

  const row = db
    .prepare(
      `SELECT r.* FROM finance_import_rows r
       WHERE r.id = ? AND r.batchId = ?`,
    )
    .get(c.req.param("rowId"), c.req.param("batchId")) as any;
  if (!row) return c.json({ error: "行不存在" }, 404);
  if (row.status === "committed") {
    return c.json({ error: "行已导入，不可修改" }, 400);
  }

  // 禁止客户端把行直接标为 committed
  const draftBody = { ...body };
  delete draftBody.status;

  const draft = { ...JSON.parse(row.draftJson || "{}"), ...draftBody };
  let status = row.status as string;
  if (body.status === "ignored" && status !== "committed") {
    status = "ignored";
  } else if (draft.selected === false) {
    /* keep status */
  } else if (draft.targetAccountId && draft.methodAccountId && status === "needs_review") {
    status = "ready";
  }

  db.prepare(`UPDATE finance_import_rows SET draftJson = ?, status = ? WHERE id = ?`).run(
    JSON.stringify(draft),
    status,
    row.id,
  );
  return c.json({ id: row.id, status, draft });
});

finance.post("/ledgers/:id/import/batches/:batchId/commit", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    mode?: string;
    rowIds?: string[];
  };
  const mode = (body.mode ?? "ready_only") as ImportCommitMode | string;
  if (mode !== "ready_only" && mode !== "include_review") {
    return c.json({ error: "invalid mode" }, 400);
  }

  const db = getDb();
  const batch = db
    .prepare(`SELECT * FROM finance_import_batches WHERE id = ? AND ledgerId = ?`)
    .get(c.req.param("batchId"), ledger.id) as any;
  if (!batch) return c.json({ error: "批次不存在" }, 404);
  if (isTerminalBatchStatus(batch.status)) {
    return c.json({ error: "批次不可提交" }, 400);
  }

  let candidates = db
    .prepare(`SELECT * FROM finance_import_rows WHERE batchId = ?`)
    .all(batch.id) as any[];

  // 永不直接提交 duplicate / ignored / error / committed
  candidates = candidates.filter((r) => {
    if (
      r.status === "committed" ||
      r.status === "ignored" ||
      r.status === "error" ||
      r.status === "duplicate"
    ) {
      return false;
    }
    if (mode === "ready_only") return r.status === "ready";
    return r.status === "ready" || r.status === "needs_review";
  });

  candidates = candidates.filter((r) => {
    const draft = JSON.parse(r.draftJson || "{}");
    return (
      draft.selected !== false &&
      draft.targetAccountId &&
      draft.methodAccountId
    );
  });

  if (body.rowIds?.length) {
    const set = new Set(body.rowIds);
    candidates = candidates.filter((r) => set.has(r.id));
  }

  const prior = parsePriorStats(batch.statsJson);

  // Zero candidates: no-op, do not change batch status
  if (candidates.length === 0) {
    const stats = recomputeImportStats(db, batch.id, prior);
    const remaining = countActionableResidual(db, batch.id);
    return c.json({
      committed: 0,
      skipped: 0,
      errors: [],
      batchStatus: batch.status,
      stats,
      remaining,
    });
  }

  let committed = 0;
  let skipped = 0;
  const errors: string[] = [];
  let batchStatus = batch.status as string;
  let stats = recomputeImportStats(db, batch.id, prior);
  let remaining = 0;

  const markRowCommitted = db.prepare(
    `UPDATE finance_import_rows SET status = 'committed' WHERE id = ?`,
  );

  const run = db.transaction(() => {
    for (const r of candidates) {
      const draft = JSON.parse(r.draftJson || "{}");
      const parsed = JSON.parse(r.parsedJson || "{}") as ImportEntry;
      if (!draft.targetAccountId || !draft.methodAccountId) {
        skipped++;
        errors.push(`行 ${r.rowIndex + 1}: 缺少账户`);
        continue;
      }
      const amountMinor = Math.abs(Number(draft.amountMinor || parsed.amountMinor || 0));
      if (!amountMinor) {
        skipped++;
        errors.push(`行 ${r.rowIndex + 1}: 金额无效`);
        continue;
      }
      const direction = draft.direction || parsed.direction;
      // 支出：expense +, asset -
      // 收入：asset +, income -
      let postings;
      if (direction === "in" || (draft.amountMinor || parsed.amountMinor) > 0) {
        postings = [
          { accountId: draft.methodAccountId, amountMinor },
          { accountId: draft.targetAccountId, amountMinor: -amountMinor },
        ];
      } else {
        postings = [
          { accountId: draft.targetAccountId, amountMinor },
          { accountId: draft.methodAccountId, amountMinor: -amountMinor },
        ];
      }

      try {
        insertTransaction(db, ledger.id, {
          date: draft.date || parsed.date,
          time: draft.time || parsed.time,
          payee: draft.payee ?? parsed.payee,
          narration: draft.narration ?? parsed.item,
          tags: draft.tags || [],
          source: batch.channel,
          sourceRef: parsed.sourceId,
          importBatchId: batch.id,
          meta: { rawItems: parsed.rawItems },
          postings,
        });
        markRowCommitted.run(r.id);
        committed++;
      } catch (e: any) {
        skipped++;
        errors.push(`行 ${r.rowIndex + 1}: ${e?.message || e}`);
      }
    }

    stats = recomputeImportStats(db, batch.id, prior);
    remaining = countActionableResidual(db, batch.id);
    batchStatus = nextBatchStatusAfterCommit(batch.status, committed, remaining);
    stats.lastCommitted = committed;
    stats.lastSkipped = skipped;

    db.prepare(
      `UPDATE finance_import_batches SET status = ?, statsJson = ? WHERE id = ?`,
    ).run(batchStatus, JSON.stringify(stats), batch.id);
  });

  try {
    run();
  } catch (e: any) {
    return c.json({ error: e?.message || "提交失败" }, 400);
  }

  return c.json({
    committed,
    skipped,
    errors: errors.slice(0, 20),
    batchStatus,
    stats,
    remaining,
  });
});

finance.post("/ledgers/:id/import/batches/:batchId/discard", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const db = getDb();
  db.prepare(
    `UPDATE finance_import_batches SET status = 'discarded' WHERE id = ? AND ledgerId = ?`,
  ).run(c.req.param("batchId"), ledger.id);
  return c.json({ ok: true });
});

// ========== Stats & advice ==========

finance.get("/ledgers/:id/stats/summary", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = c.req.query("month") || undefined;
  return c.json(statsSummary(getDb(), ledger.id, year, month));
});

finance.get("/ledgers/:id/stats/breakdown", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = `${year}-${month}-${String(last).padStart(2, "0")}`;
  return c.json(statsExpenseBreakdown(getDb(), ledger.id, from, to));
});

finance.get("/ledgers/:id/stats/trend", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const from = c.req.query("from") || `${new Date().getFullYear()}-01-01`;
  const to = c.req.query("to") || new Date().toISOString().slice(0, 10);
  const bucket = (c.req.query("bucket") as "day" | "month") || "day";
  const fill = c.req.query("fill") !== "0";
  const rows = statsTrend(getDb(), ledger.id, from, to, bucket) as Array<{
    bucket: string;
    incomeMinor: number;
    expensesMinor: number;
  }>;
  if (bucket === "day" && fill) {
    return c.json(fillDailyTrend(from, to, rows));
  }
  return c.json(rows);
});

finance.get("/ledgers/:id/stats/payees", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = `${year}-${month}-${String(last).padStart(2, "0")}`;
  const rows = statsPayees(getDb(), ledger.id, from, to, 25);
  return c.json(
    rows.map((r) => ({
      ...r,
      avgMinor: r.count > 0 ? Math.round(r.expenseMinor / r.count) : 0,
    })),
  );
});

/** 多月收支（折线） */
finance.get("/ledgers/:id/stats/months", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const months = Math.min(36, Math.max(6, Number(c.req.query("months") || 18)));
  return c.json(statsMonthSeries(getDb(), ledger.id, months));
});

/** 资产负债/收支累计曲线 */
finance.get("/ledgers/:id/stats/balance-series", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = c.req.query("from") || `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = c.req.query("to") || `${year}-${month}-${String(last).padStart(2, "0")}`;
  const type = (c.req.query("type") || "ASSETS").toUpperCase() as
    | "ASSETS"
    | "LIABILITIES"
    | "EXPENSES"
    | "INCOME";
  if (!["ASSETS", "LIABILITIES", "EXPENSES", "INCOME"].includes(type)) {
    return c.json({ error: "type 无效" }, 400);
  }
  return c.json(statsBalanceSeries(getDb(), ledger.id, type, from, to));
});

/** 收入分类占比 */
finance.get("/ledgers/:id/stats/income-breakdown", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = `${year}-${month}-${String(last).padStart(2, "0")}`;
  return c.json(statsIncomeBreakdown(getDb(), ledger.id, from, to));
});

/** 按标签支出汇总 */
finance.get("/ledgers/:id/stats/tags", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = `${year}-${month}-${String(last).padStart(2, "0")}`;
  return c.json(statsTagBreakdown(getDb(), ledger.id, from, to));
});

/** 固定/可变/家庭支出结构 */
finance.get("/ledgers/:id/stats/structure", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = (c.req.query("month") || String(now.getMonth() + 1)).padStart(2, "0");
  const from = `${year}-${month}-01`;
  const last = new Date(Number(year), Number(month), 0).getDate();
  const to = `${year}-${month}-${String(last).padStart(2, "0")}`;
  return c.json(statsExpenseStructure(getDb(), ledger.id, from, to));
});

/** 导入批次历史 */
finance.get("/ledgers/:id/import/batches", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const limit = Math.min(20, Math.max(1, Number(c.req.query("limit") || 10)));
  const rows = getDb()
    .prepare(
      `SELECT id, channel, fileName, status, statsJson, createdAt, expiresAt
       FROM finance_import_batches
       WHERE ledgerId = ?
       ORDER BY createdAt DESC
       LIMIT ?`,
    )
    .all(ledger.id, limit) as any[];
  return c.json(
    rows.map((r) => ({
      ...r,
      stats: (() => {
        try {
          return JSON.parse(r.statsJson || "{}");
        } catch {
          return {};
        }
      })(),
      statsJson: undefined,
    })),
  );
});

// ========== Budgets ==========

finance.get("/ledgers/:id/budgets", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const now = new Date();
  const ym =
    c.req.query("yearMonth") ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}$/.test(ym)) return c.json({ error: "yearMonth 格式应为 YYYY-MM" }, 400);
  return c.json(listBudgets(getDb(), ledger.id, ym));
});

finance.post("/ledgers/:id/budgets", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    yearMonth?: string;
    accountId?: string | null;
    amountYuan?: number | string;
    amountMinor?: number;
    note?: string;
    id?: string;
  };
  const ym = body.yearMonth || "";
  if (!/^\d{4}-\d{2}$/.test(ym)) return c.json({ error: "yearMonth 格式应为 YYYY-MM" }, 400);
  const amountMinor =
    body.amountMinor !== undefined
      ? Math.round(Number(body.amountMinor))
      : yuanToMinor(body.amountYuan ?? 0);
  if (amountMinor <= 0) return c.json({ error: "预算金额须大于 0" }, 400);

  const accountId = body.accountId || null;
  if (accountId) {
    const a = getDb()
      .prepare(`SELECT id FROM finance_accounts WHERE id = ? AND ledgerId = ?`)
      .get(accountId, ledger.id);
    if (!a) return c.json({ error: "账户不存在" }, 400);
  }

  const db = getDb();
  // upsert by ledger+ym+account
  const existing = db
    .prepare(
      `SELECT id FROM finance_budgets
       WHERE ledgerId = ? AND yearMonth = ?
         AND ((accountId IS NULL AND ? IS NULL) OR accountId = ?)`,
    )
    .get(ledger.id, ym, accountId, accountId) as { id: string } | undefined;

  const id = body.id || existing?.id || uuidv4();
  if (existing || body.id) {
    db.prepare(
      `UPDATE finance_budgets SET amountMinor = ?, note = ?, updatedAt = datetime('now') WHERE id = ? AND ledgerId = ?`,
    ).run(amountMinor, body.note || null, id, ledger.id);
  } else {
    db.prepare(
      `INSERT INTO finance_budgets (id, ledgerId, yearMonth, accountId, amountMinor, note, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(id, ledger.id, ym, accountId, amountMinor, body.note || null);
  }
  return c.json(listBudgets(db, ledger.id, ym).find((b) => b.id === id) || { id });
});

finance.delete("/ledgers/:id/budgets/:budgetId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  getDb()
    .prepare(`DELETE FROM finance_budgets WHERE id = ? AND ledgerId = ?`)
    .run(c.req.param("budgetId"), ledger.id);
  return c.json({ ok: true });
});

/** 从上月复制预算到指定月（默认下月或当前月） */
finance.post("/ledgers/:id/budgets/copy", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    fromYearMonth?: string;
    toYearMonth?: string;
    overwrite?: boolean;
  };

  const now = new Date();
  const toYm =
    body.toYearMonth ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let fromYm = body.fromYearMonth;
  if (!fromYm) {
    const [y, m] = toYm.split("-").map(Number);
    const d = new Date(y, m - 2, 1); // previous month
    fromYm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}$/.test(fromYm) || !/^\d{4}-\d{2}$/.test(toYm)) {
    return c.json({ error: "yearMonth 格式错误" }, 400);
  }
  if (fromYm === toYm) return c.json({ error: "源月与目标月不能相同" }, 400);

  const db = getDb();
  const source = db
    .prepare(`SELECT * FROM finance_budgets WHERE ledgerId = ? AND yearMonth = ?`)
    .all(ledger.id, fromYm) as any[];
  if (!source.length) return c.json({ error: `${fromYm} 没有预算可复制` }, 404);

  let copied = 0;
  let skipped = 0;
  const run = db.transaction(() => {
    for (const s of source) {
      const exist = db
        .prepare(
          `SELECT id FROM finance_budgets
           WHERE ledgerId = ? AND yearMonth = ?
             AND ((accountId IS NULL AND ? IS NULL) OR accountId = ?)`,
        )
        .get(ledger.id, toYm, s.accountId, s.accountId) as { id: string } | undefined;
      if (exist) {
        if (body.overwrite) {
          db.prepare(
            `UPDATE finance_budgets SET amountMinor = ?, note = ?, updatedAt = datetime('now') WHERE id = ?`,
          ).run(s.amountMinor, s.note, exist.id);
          copied++;
        } else {
          skipped++;
        }
      } else {
        db.prepare(
          `INSERT INTO finance_budgets (id, ledgerId, yearMonth, accountId, amountMinor, note, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        ).run(uuidv4(), ledger.id, toYm, s.accountId, s.amountMinor, s.note);
        copied++;
      }
    }
  });
  run();
  return c.json({
    fromYearMonth: fromYm,
    toYearMonth: toYm,
    copied,
    skipped,
    budgets: listBudgets(db, ledger.id, toYm),
  });
});

// ========== Recurring ==========

finance.get("/ledgers/:id/recurring", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  const rows = getDb()
    .prepare(
      `SELECT * FROM finance_recurring WHERE ledgerId = ? ORDER BY nextRunDate ASC, createdAt DESC`,
    )
    .all(ledger.id) as any[];
  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: !!r.enabled,
      ruleType: r.ruleType,
      rule: JSON.parse(r.ruleJson || "{}"),
      payload: JSON.parse(r.payloadJson || "{}"),
      nextRunDate: r.nextRunDate,
      lastRunAt: r.lastRunAt,
      endDate: r.endDate,
      autoPost: !!r.autoPost,
      createdAt: r.createdAt,
    })),
  );
});

finance.post("/ledgers/:id/recurring", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    enabled?: boolean;
    ruleType?: RecurringRuleType;
    rule?: { day?: number; days?: number; weekday?: number };
    payload?: Record<string, unknown>;
    nextRunDate?: string;
    endDate?: string | null;
    autoPost?: boolean;
  };

  if (!body.name?.trim()) return c.json({ error: "名称必填" }, 400);
  const ruleType = body.ruleType || "monthly";
  if (!["monthly", "weekly", "interval"].includes(ruleType)) {
    return c.json({ error: "ruleType 无效" }, 400);
  }
  const payload = body.payload || {};
  if (!payload.amountYuan || !payload.fromAccountId || !payload.toAccountId) {
    return c.json({ error: "请填写金额与账户" }, 400);
  }

  const today = new Date().toISOString().slice(0, 10);
  const nextRunDate =
    body.nextRunDate ||
    nextRunAfter(today, ruleType, body.rule || { day: 1 });

  const db = getDb();
  const id = body.id || uuidv4();
  const existing = body.id
    ? db
        .prepare(`SELECT id FROM finance_recurring WHERE id = ? AND ledgerId = ?`)
        .get(body.id, ledger.id)
    : null;

  if (existing) {
    db.prepare(
      `UPDATE finance_recurring SET
        name = ?, enabled = ?, ruleType = ?, ruleJson = ?, payloadJson = ?,
        nextRunDate = ?, endDate = ?, autoPost = ?, updatedAt = datetime('now')
       WHERE id = ?`,
    ).run(
      body.name.trim(),
      body.enabled === false ? 0 : 1,
      ruleType,
      JSON.stringify(body.rule || {}),
      JSON.stringify(payload),
      nextRunDate,
      body.endDate || null,
      body.autoPost === false ? 0 : 1,
      id,
    );
  } else {
    db.prepare(
      `INSERT INTO finance_recurring
        (id, ledgerId, name, enabled, ruleType, ruleJson, payloadJson, nextRunDate, endDate, autoPost, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
    ).run(
      id,
      ledger.id,
      body.name.trim(),
      body.enabled === false ? 0 : 1,
      ruleType,
      JSON.stringify(body.rule || {}),
      JSON.stringify(payload),
      nextRunDate,
      body.endDate || null,
      body.autoPost === false ? 0 : 1,
    );
  }

  const row = db.prepare(`SELECT * FROM finance_recurring WHERE id = ?`).get(id) as any;
  return c.json({
    id: row.id,
    name: row.name,
    enabled: !!row.enabled,
    ruleType: row.ruleType,
    rule: JSON.parse(row.ruleJson || "{}"),
    payload: JSON.parse(row.payloadJson || "{}"),
    nextRunDate: row.nextRunDate,
    endDate: row.endDate,
    autoPost: !!row.autoPost,
  });
});

finance.delete("/ledgers/:id/recurring/:recurringId", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;
  getDb()
    .prepare(`DELETE FROM finance_recurring WHERE id = ? AND ledgerId = ?`)
    .run(c.req.param("recurringId"), ledger.id);
  return c.json({ ok: true });
});

/** 立即跑一轮到期定期记账（当前用户所有账本 / 或指定账本） */
finance.post("/recurring/run-due", (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "未授权" }, 401);
  const db = getDb();
  const result = processDueRecurring(db);
  return c.json(result);
});

finance.post("/alerts/run-budget", (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "未授权" }, 401);
  return c.json(processBudgetAlerts(getDb()));
});

/** 首页概览：不要求解锁；有密码账本仅返回元数据 */
finance.get("/overview", (c) => {
  const uid = userId(c);
  if (!uid) return c.json({ error: "未授权" }, 401);
  const db = getDb();
  const unlockHeader = c.req.header("X-Finance-Unlock") || "";
  const rows = listAccessibleLedgers(uid);

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1);

  const ledgers = rows.map((l) => {
    const unlocked =
      !hasPassword(l) || verifyUnlockToken(db, l.id, uid, unlockHeader);
    const base = {
      id: l.id,
      title: l.title,
      icon: l.icon,
      hasPassword: hasPassword(l),
      locked: hasPassword(l) && !unlocked,
      workspaceId: l.workspaceId,
      isShared: !!l.workspaceId,
    };
    if (!unlocked) return base;
    try {
      const s = statsSummary(db, l.id, year, month);
      return {
        ...base,
        monthIncomeMinor: s.incomeMinor,
        monthExpenseMinor: s.expensesMinor,
        monthNetMinor: s.netMinor,
      };
    } catch {
      return base;
    }
  });

  return c.json({
    ledgers,
    year,
    month: Number(month),
  });
});

finance.get("/ledgers/:id/advice", (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const db = getDb();
  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = c.req.query("month") || String(now.getMonth() + 1);
  const summary = statsSummary(db, ledger.id, year, month);
  const breakdown = statsExpenseBreakdown(db, ledger.id, summary.from, summary.to) as any[];

  let prev: ReturnType<typeof statsSummary> | null = null;
  const m = Number(month);
  if (m > 1) {
    prev = statsSummary(db, ledger.id, year, String(m - 1));
  } else {
    prev = statsSummary(db, ledger.id, String(Number(year) - 1), "12");
  }

  const ym = `${year}-${String(Number(month)).padStart(2, "0")}`;
  const budgets = listBudgets(db, ledger.id, ym);
  const insights = [
    ...buildRuleInsights(summary, breakdown, prev),
    ...budgetInsights(budgets),
  ];

  return c.json({
    summary,
    insights,
    budgets,
  });
});

finance.post("/ledgers/:id/advice/ai", async (c) => {
  const uid = userId(c);
  const ledger = getLedgerOwned(c.req.param("id"), uid);
  if (!ledger) return c.json({ error: "账本不存在" }, 404);
  const locked = requireUnlock(c, ledger);
  if (locked) return locked;

  const db = getDb();
  const now = new Date();
  const year = c.req.query("year") || String(now.getFullYear());
  const month = c.req.query("month") || String(now.getMonth() + 1);
  const summary = statsSummary(db, ledger.id, year, month);
  const breakdown = statsExpenseBreakdown(db, ledger.id, summary.from, summary.to) as any[];
  const insights = buildRuleInsights(summary, breakdown, null);

  const settings = db
    .prepare(
      `SELECT key, value FROM system_settings WHERE key IN ('ai_provider','ai_api_url','ai_api_key','ai_model')`,
    )
    .all() as { key: string; value: string }[];
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  if (!map.ai_api_url || !map.ai_model) {
    return c.json({
      insights,
      aiText: null,
      message: "未配置 AI，仅返回规则建议",
    });
  }

  const prompt = `你是私人财务顾问。根据以下月度汇总（金额单位：分，100分=1元）给出 3-5 条简洁中文建议，避免说教，可执行：
账本：${ledger.title}
区间：${summary.from} ~ ${summary.to}
收入分：${summary.incomeMinor}
支出分：${summary.expensesMinor}
净资产分：${summary.netWorthMinor}
分类支出：${JSON.stringify(breakdown.slice(0, 10))}
规则洞察：${JSON.stringify(insights)}`;

  try {
    const url = map.ai_api_url.replace(/\/+$/, "");
    const res = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(map.ai_api_key ? { Authorization: `Bearer ${map.ai_api_key}` } : {}),
      },
      body: JSON.stringify({
        model: map.ai_model,
        messages: [
          { role: "system", content: "你是简洁务实的私人财务顾问，用中文回答。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return c.json({ insights, aiText: null, message: `AI 调用失败: ${t.slice(0, 200)}` });
    }
    const data = (await res.json()) as any;
    const aiText = data?.choices?.[0]?.message?.content || null;
    return c.json({ insights, aiText });
  } catch (e: any) {
    return c.json({ insights, aiText: null, message: e?.message || "AI 调用异常" });
  }
});

export default finance;
