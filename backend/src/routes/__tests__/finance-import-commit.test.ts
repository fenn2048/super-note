/**
 * PR1: import commit mode / partial / mutation guards
 * Run: cd backend && npx tsx --test src/routes/__tests__/finance-import-commit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";

const testDbPath = path.join(process.cwd(), "data", "test-finance-import-commit.db");
process.env.DB_PATH = testDbPath;

for (const ext of ["", "-wal", "-shm"]) {
  const p = testDbPath + ext;
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ignore */
    }
  }
}

test("Finance import commit (PR1)", async (t) => {
  const { getDb, closeDb } = await import("../../db/schema.js");
  const { default: financeRouter } = await import("../finance.js");
  const {
    recomputeImportStats,
    countActionableResidual,
    nextBatchStatusAfterCommit,
    nextBatchStatusAfterIgnore,
  } = await import("../../services/finance/importBatch.js");

  const app = new Hono();
  app.route("/api/finance", financeRouter);

  const db = getDb();
  const uid = "user-import-commit";
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, passwordHash, email) VALUES (?, ?, ?, ?)",
  ).run(uid, "importuser", "pwd", "import@test.com");

  const headers = {
    "X-User-Id": uid,
    "Content-Type": "application/json",
  };

  // Create ledger without password
  const createRes = await app.request("/api/finance/ledgers", {
    method: "POST",
    headers,
    body: JSON.stringify({ title: "Import Commit Test" }),
  });
  if (createRes.status !== 200 && createRes.status !== 201) {
    assert.fail(`create ledger failed: ${createRes.status} ${await createRes.text()}`);
  }
  const ledger = (await createRes.json()) as { id: string };
  const ledgerId = ledger.id;

  const expense = db
    .prepare(
      `SELECT id FROM finance_accounts WHERE ledgerId = ? AND type = 'EXPENSES' LIMIT 1`,
    )
    .get(ledgerId) as { id: string };
  const asset = db
    .prepare(
      `SELECT id FROM finance_accounts WHERE ledgerId = ? AND type = 'ASSETS' LIMIT 1`,
    )
    .get(ledgerId) as { id: string };
  assert.ok(expense?.id);
  assert.ok(asset?.id);

  function insertRow(opts: {
    batchId: string;
    rowIndex: number;
    status: string;
    sourceId: string;
    selected?: boolean;
    target?: string | null;
    method?: string | null;
    amountMinor?: number;
  }) {
    const id = uuidv4();
    const amountMinor = opts.amountMinor ?? -1000;
    const parsed = {
      sourceId: opts.sourceId,
      date: "2026-07-01",
      time: "12:00",
      payee: "TestPayee",
      item: "item",
      amountMinor,
      direction: amountMinor < 0 ? "out" : "in",
      rawItems: {},
    };
    const draft = {
      payee: parsed.payee,
      narration: parsed.item,
      date: parsed.date,
      time: parsed.time,
      amountMinor,
      direction: parsed.direction,
      targetAccountId: opts.target === undefined ? expense.id : opts.target,
      methodAccountId: opts.method === undefined ? asset.id : opts.method,
      selected: opts.selected !== false,
    };
    db.prepare(
      `INSERT INTO finance_import_rows
        (id, batchId, rowIndex, status, confidence, parsedJson, draftJson, matchRuleId, duplicateTxId)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL)`,
    ).run(
      id,
      opts.batchId,
      opts.rowIndex,
      opts.status,
      JSON.stringify(parsed),
      JSON.stringify(draft),
    );
    return id;
  }

  function newBatch(status = "preview") {
    const batchId = uuidv4();
    db.prepare(
      `INSERT INTO finance_import_batches
        (id, ledgerId, channel, fileName, status, statsJson, createdAt, expiresAt)
       VALUES (?, ?, 'alipay', 'test.csv', ?, '{}', datetime('now'), datetime('now', '+1 day'))`,
    ).run(batchId, ledgerId, status);
    return batchId;
  }

  async function commit(batchId: string, body: Record<string, unknown> = {}) {
    return app.request(
      `/api/finance/ledgers/${ledgerId}/import/batches/${batchId}/commit`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  }

  async function bulk(batchId: string, body: Record<string, unknown>) {
    return app.request(
      `/api/finance/ledgers/${ledgerId}/import/batches/${batchId}/bulk`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  }

  async function patchRow(batchId: string, rowId: string, body: Record<string, unknown>) {
    return app.request(
      `/api/finance/ledgers/${ledgerId}/import/batches/${batchId}/rows/${rowId}`,
      { method: "PATCH", headers, body: JSON.stringify(body) },
    );
  }

  async function getBatch(batchId: string) {
    return app.request(
      `/api/finance/ledgers/${ledgerId}/import/batches/${batchId}`,
      { method: "GET", headers },
    );
  }

  await t.test("unit: nextBatchStatusAfterCommit", () => {
    assert.equal(nextBatchStatusAfterCommit("preview", 0, 5), "preview");
    assert.equal(nextBatchStatusAfterCommit("preview", 1, 2), "partial");
    assert.equal(nextBatchStatusAfterCommit("preview", 1, 0), "committed");
    assert.equal(nextBatchStatusAfterCommit("partial", 1, 1), "partial"); // only dups residual
  });

  await t.test("unit: nextBatchStatusAfterIgnore", () => {
    assert.equal(nextBatchStatusAfterIgnore("partial", 0, 3), "committed");
    assert.equal(nextBatchStatusAfterIgnore("preview", 0, 0), "preview");
    assert.equal(nextBatchStatusAfterIgnore("partial", 2, 1), "partial");
  });

  await t.test("invalid mode → 400", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: "m1" });
    const res = await commit(batchId, { mode: "nope" });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, "invalid mode");
  });

  await t.test("default {} ≡ ready_only: skips needs_review", async () => {
    const batchId = newBatch();
    const readyId = insertRow({
      batchId,
      rowIndex: 0,
      status: "ready",
      sourceId: `ready-${uuidv4()}`,
    });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "needs_review",
      sourceId: `rev-${uuidv4()}`,
    });
    const res = await commit(batchId, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.committed, 1);
    assert.equal(body.batchStatus, "partial");
    assert.ok(body.remaining >= 1);

    const ready = db
      .prepare(`SELECT status FROM finance_import_rows WHERE id = ?`)
      .get(readyId) as { status: string };
    assert.equal(ready.status, "committed");

    const review = db
      .prepare(
        `SELECT status FROM finance_import_rows WHERE batchId = ? AND status = 'needs_review'`,
      )
      .get(batchId) as { status: string };
    assert.equal(review.status, "needs_review");
  });

  await t.test("include_review commits ready + needs_review", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `r-${uuidv4()}` });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "needs_review",
      sourceId: `n-${uuidv4()}`,
    });
    const res = await commit(batchId, { mode: "include_review" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.committed, 2);
    assert.equal(body.batchStatus, "committed");
    assert.equal(body.remaining, 0);
  });

  await t.test("ready_only with only needs_review + duplicate: committed 0, status unchanged", async () => {
    const batchId = newBatch("preview");
    insertRow({
      batchId,
      rowIndex: 0,
      status: "needs_review",
      sourceId: `n-${uuidv4()}`,
    });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `d-${uuidv4()}`,
    });
    const res = await commit(batchId, { mode: "ready_only" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.committed, 0);
    assert.equal(body.batchStatus, "preview");
    const b = db
      .prepare(`SELECT status FROM finance_import_batches WHERE id = ?`)
      .get(batchId) as { status: string };
    assert.equal(b.status, "preview");
  });

  await t.test("ready_only success leaving only duplicate → partial", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `r-${uuidv4()}` });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `d-${uuidv4()}`,
    });
    const res = await commit(batchId, { mode: "ready_only" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.committed, 1);
    assert.equal(body.batchStatus, "partial");
    assert.equal(body.remaining, 1);
    assert.equal(body.stats.duplicate, 1);
  });

  await t.test("mode ∩ rowIds: ready_only ignores needs_review id", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `r-${uuidv4()}` });
    const reviewId = insertRow({
      batchId,
      rowIndex: 1,
      status: "needs_review",
      sourceId: `n-${uuidv4()}`,
    });
    const res = await commit(batchId, {
      mode: "ready_only",
      rowIds: [reviewId],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.committed, 0);
    const row = db
      .prepare(`SELECT status FROM finance_import_rows WHERE id = ?`)
      .get(reviewId) as { status: string };
    assert.equal(row.status, "needs_review");
  });

  await t.test("second commit does not re-import committed rows; UNIQUE defense", async () => {
    const batchId = newBatch();
    const sourceId = `uniq-${uuidv4()}`;
    const rowId = insertRow({
      batchId,
      rowIndex: 0,
      status: "ready",
      sourceId,
    });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `dup-${uuidv4()}`,
    });
    let res = await commit(batchId, { mode: "ready_only" });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).batchStatus, "partial");

    // Force row status back to ready without deleting tx — would hit UNIQUE if re-inserted
    db.prepare(`UPDATE finance_import_rows SET status = 'ready' WHERE id = ?`).run(rowId);
    res = await commit(batchId, { mode: "ready_only" });
    assert.equal(res.status, 200);
    const body = await res.json();
    // insert fails UNIQUE → skipped; row not marked committed again from this path if insert fails
    // (status still ready after failed insert — defense is UNIQUE + error)
    assert.equal(body.committed, 0);
    assert.ok(body.skipped >= 1 || body.errors?.length >= 1);

    const txCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM finance_transactions WHERE ledgerId = ? AND sourceRef = ?`,
      )
      .get(ledgerId, sourceId) as { c: number };
    assert.equal(txCount.c, 1);
  });

  await t.test("force residual duplicate then commit → committed", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `r-${uuidv4()}` });
    const dupId = insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `d-${uuidv4()}`,
    });
    let res = await commit(batchId, { mode: "ready_only" });
    assert.equal((await res.json()).batchStatus, "partial");

    res = await bulk(batchId, {
      rowIds: [dupId],
      forceImportDuplicates: true,
      targetAccountId: expense.id,
      methodAccountId: asset.id,
    });
    assert.equal(res.status, 200);
    const afterForce = db
      .prepare(`SELECT status FROM finance_import_rows WHERE id = ?`)
      .get(dupId) as { status: string };
    assert.equal(afterForce.status, "ready"); // both accounts → ready

    res = await commit(batchId, { mode: "ready_only" });
    const body = await res.json();
    assert.equal(body.committed, 1);
    assert.equal(body.batchStatus, "committed");
    assert.equal(body.remaining, 0);
  });

  await t.test("bulk skips committed rows; PATCH rejects committed", async () => {
    const batchId = newBatch();
    const rowId = insertRow({
      batchId,
      rowIndex: 0,
      status: "ready",
      sourceId: `c-${uuidv4()}`,
    });
    let res = await commit(batchId, { mode: "ready_only" });
    assert.equal((await res.json()).batchStatus, "committed");

    res = await bulk(batchId, {
      rowIds: [rowId],
      targetAccountId: expense.id,
    });
    assert.equal(res.status, 400); // terminal batch

    // Manual partial batch with committed row + open row for skip test
    const batch2 = newBatch("partial");
    const committedId = insertRow({
      batchId: batch2,
      rowIndex: 0,
      status: "committed",
      sourceId: `cm-${uuidv4()}`,
    });
    const openId = insertRow({
      batchId: batch2,
      rowIndex: 1,
      status: "needs_review",
      sourceId: `op-${uuidv4()}`,
      target: null,
      method: asset.id,
    });
    res = await bulk(batch2, {
      rowIds: [committedId, openId],
      targetAccountId: expense.id,
      methodAccountId: asset.id,
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.updated, 1);
    assert.equal(b.skippedCommitted, 1);

    const still = db
      .prepare(`SELECT status FROM finance_import_rows WHERE id = ?`)
      .get(committedId) as { status: string };
    assert.equal(still.status, "committed");

    res = await patchRow(batch2, committedId, { targetAccountId: expense.id });
    assert.equal(res.status, 400);
  });

  await t.test("GET legacy committed batch returns readOnly", async () => {
    const batchId = newBatch("committed");
    // legacy: batch committed but row still ready
    insertRow({
      batchId,
      rowIndex: 0,
      status: "ready",
      sourceId: `leg-${uuidv4()}`,
    });
    const res = await getBatch(batchId);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.readOnly, true);
    assert.equal(body.batch.readOnly, true);
    assert.equal(body.batch.status, "committed");
    // raw row status preserved (no backfill)
    assert.equal(body.rows[0].status, "ready");
  });

  await t.test("markIgnored clears residual duplicates → batch committed", async () => {
    const batchId = newBatch();
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `r-${uuidv4()}` });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `d1-${uuidv4()}`,
    });
    insertRow({
      batchId,
      rowIndex: 2,
      status: "duplicate",
      sourceId: `d2-${uuidv4()}`,
    });
    let res = await commit(batchId, { mode: "ready_only" });
    assert.equal((await res.json()).batchStatus, "partial");

    res = await bulk(batchId, { markIgnored: true });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.updated, 2);
    assert.equal(body.batchStatus, "committed");
    assert.equal(body.remaining, 0);
    assert.equal(body.stats.duplicate, 0);
    assert.equal(body.stats.ignored, 2);

    // terminal: further bulk rejected
    res = await bulk(batchId, { markIgnored: true });
    assert.equal(res.status, 400);
  });

  await t.test("selected=false on duplicate still counts as residual", async () => {
    const batchId = newBatch("partial");
    insertRow({
      batchId,
      rowIndex: 0,
      status: "committed",
      sourceId: `c-${uuidv4()}`,
    });
    insertRow({
      batchId,
      rowIndex: 1,
      status: "duplicate",
      sourceId: `d-${uuidv4()}`,
      selected: false,
    });
    const residual = countActionableResidual(db, batchId);
    assert.equal(residual, 1);
    const stats = recomputeImportStats(db, batchId, {});
    assert.equal(stats.duplicate, 1);
  });

  await t.test("discarded batch rejects commit", async () => {
    const batchId = newBatch("discarded");
    insertRow({ batchId, rowIndex: 0, status: "ready", sourceId: `x-${uuidv4()}` });
    const res = await commit(batchId, { mode: "ready_only" });
    assert.equal(res.status, 400);
  });

  t.after(() => {
    try {
      closeDb();
    } catch {
      /* ignore */
    }
    for (const ext of ["", "-wal", "-shm"]) {
      const p = testDbPath + ext;
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  });
});
