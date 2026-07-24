/**
 * 记账后台任务：定期记账落库 + 预算告警
 * 与 embedding-worker 类似，进程内 setInterval，失败不拖垮主服务。
 */
import { getDb } from "../db/schema.js";
import { processDueRecurring } from "./finance/recurring.js";
import { processBudgetAlerts } from "./finance/alerts.js";

const INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

function tick() {
  if (running) return;
  running = true;
  try {
    const db = getDb();
    // 表可能尚未迁移
    const has = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='finance_recurring'`,
      )
      .get();
    if (!has) return;

    const rec = processDueRecurring(db);
    if (rec.posted || rec.notified || rec.errors.length) {
      console.log(
        `[finance-worker] recurring posted=${rec.posted} notified=${rec.notified} errors=${rec.errors.length}`,
      );
      if (rec.errors.length) console.warn("[finance-worker] errors:", rec.errors.slice(0, 5));
    }

    const hasAlert = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='finance_alert_log'`,
      )
      .get();
    if (hasAlert) {
      const al = processBudgetAlerts(db);
      if (al.sent) console.log(`[finance-worker] budget alerts sent=${al.sent}`);
    }
  } catch (e) {
    console.warn("[finance-worker] tick failed:", e);
  } finally {
    running = false;
  }
}

export function startFinanceWorker() {
  if (timer) return;
  // 启动后 20s 先跑一轮，再按间隔
  setTimeout(() => tick(), 20_000);
  timer = setInterval(tick, INTERVAL_MS);
  timer.unref?.();
  console.log("[finance-worker] started (interval 10m)");
}

export function stopFinanceWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 供管理/测试手动触发 */
export function runFinanceWorkerOnce() {
  tick();
}
