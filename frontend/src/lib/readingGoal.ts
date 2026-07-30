/**
 * 每日阅读目标 + 今日阅读分钟（客户端累计）
 * - 目标：localStorage 缓存 + 可同步 user_preferences.dailyReadingGoalMinutes
 * - 今日分钟：按本地日期 key 存 localStorage，BookReader 可见时累加
 */

export const DEFAULT_DAILY_READING_GOAL_MINUTES = 120;
export const MIN_DAILY_READING_GOAL = 5;
export const MAX_DAILY_READING_GOAL = 600;

const GOAL_LS_KEY = "super-daily-reading-goal-minutes";

function todayKey(userId?: string | null): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const date = `${y}-${m}-${day}`;
  return userId ? `super-reading-minutes:${userId}:${date}` : `super-reading-minutes:${date}`;
}

export function clampDailyReadingGoal(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAILY_READING_GOAL_MINUTES;
  return Math.min(MAX_DAILY_READING_GOAL, Math.max(MIN_DAILY_READING_GOAL, Math.round(n)));
}

export function getCachedDailyReadingGoal(): number {
  try {
    const raw = localStorage.getItem(GOAL_LS_KEY);
    if (raw == null) return DEFAULT_DAILY_READING_GOAL_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_DAILY_READING_GOAL_MINUTES;
    return clampDailyReadingGoal(n);
  } catch {
    return DEFAULT_DAILY_READING_GOAL_MINUTES;
  }
}

export function setCachedDailyReadingGoal(minutes: number): number {
  const v = clampDailyReadingGoal(minutes);
  try {
    localStorage.setItem(GOAL_LS_KEY, String(v));
  } catch {
    /* ignore quota */
  }
  return v;
}

export function getTodayReadingMinutes(userId?: string | null): number {
  try {
    const raw = localStorage.getItem(todayKey(userId));
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** 累加今日阅读秒数（内部用秒存储，展示时转分钟） */
export function addTodayReadingSeconds(seconds: number, userId?: string | null): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return getTodayReadingMinutes(userId);
  const key = todayKey(userId);
  try {
    const secKey = key + ":sec";
    const prevSec = Number(localStorage.getItem(secKey) || "0") || 0;
    const nextSec = prevSec + seconds;
    localStorage.setItem(secKey, String(nextSec));
    const minutes = nextSec / 60;
    localStorage.setItem(key, String(minutes));
    return minutes;
  } catch {
    return getTodayReadingMinutes(userId);
  }
}

export function remainingGoalMinutes(todayMin: number, goalMin: number): number {
  const g = clampDailyReadingGoal(goalMin);
  const t = Math.max(0, todayMin);
  return Math.max(0, Math.ceil(g - t));
}

export function goalProgressRatio(todayMin: number, goalMin: number): number {
  const g = clampDailyReadingGoal(goalMin);
  if (g <= 0) return 0;
  return Math.min(1, Math.max(0, todayMin / g));
}

/** 将「已读分钟」格式化为 H:MM（参考图中心显示） */
export function formatReadingClock(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function parseGoalFromPrefs(prefs: Record<string, unknown> | null | undefined): number | null {
  if (!prefs) return null;
  const v = prefs.dailyReadingGoalMinutes;
  if (typeof v === "number" && Number.isFinite(v)) return clampDailyReadingGoal(v);
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return clampDailyReadingGoal(n);
  }
  return null;
}
