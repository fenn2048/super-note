/**
 * 热恢复（退后台再回前台）共享阈值
 * ---------------------------------------------------------------------------
 * 同时用于：
 *   - 应用内闪屏再次展示
 *   - 指纹 / 快速登录锁屏（AppLockOverlay）
 * 用户可在设置中自定义（分钟），默认 5 分钟；本机 localStorage 即时可读。
 */

/** 默认：退后台满 5 分钟后再回前台才触发闪屏 / 指纹锁 */
export const DEFAULT_BACKGROUND_RESUME_MINUTES = 5;

/** 设置页可选分钟数 */
export const BACKGROUND_RESUME_MINUTE_OPTIONS = [1, 2, 5, 10, 15, 30, 60] as const;

const PREFS_STORAGE_KEY = "super.user-prefs.v1";

export function clampBackgroundResumeMinutes(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_RESUME_MINUTES;
  // 1 分钟～24 小时
  return Math.min(24 * 60, Math.max(1, Math.round(n)));
}

/**
 * 从本机偏好读取阈值（毫秒）。
 * AuthGate 的 appStateChange 在 React 树外也可用，不依赖 Provider。
 */
export function getBackgroundResumeThresholdMs(): number {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { backgroundResumeMinutes?: unknown };
      if (parsed.backgroundResumeMinutes != null) {
        return clampBackgroundResumeMinutes(parsed.backgroundResumeMinutes) * 60 * 1000;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BACKGROUND_RESUME_MINUTES * 60 * 1000;
}

export function getBackgroundResumeMinutes(): number {
  return Math.round(getBackgroundResumeThresholdMs() / 60_000);
}
