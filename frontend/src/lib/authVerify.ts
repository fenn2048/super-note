/**
 * 登录态 verify 共用逻辑（密码冷启动 / 生物识别快速登录共用）
 * ----------------------------------------------------------------------------
 * 设计目标
 *   1) 统一拼 URL：始终走 getBaseUrl()（= `${server}/api` 或同源 `/api`），
 *      避免各调用点手写 `${server}/api/auth/verify` 时与 getServerUrl 语义漂移。
 *   2) 网络失败可重试：Android 指纹弹窗关闭后 WebView 偶发首包失败，
 *      给一次短延迟重试可消掉大部分"指纹过了却报网络异常"。
 *   3) 离线缓存兜底：与 AuthGate.checkAuth 一致——网络不可达时，用上次
 *      缓存的 user / JWT 解码结果进入主界面，不清 token。
 */

import { getBaseUrl, getServerUrl } from "@/lib/api";
import type { User } from "@/types";

const AUTH_USER_CACHE_PREFIX = "super-auth-user:";

function normalizeAuthUrl(url: string): string {
  return url.replace(/\/+$/, "").toLowerCase();
}

function isLoopbackAuthUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
  } catch {
    return false;
  }
}

/** 与 App.tsx AuthGate 保持同一 scope 规则，保证缓存可互相命中 */
export function getAuthCacheScope(serverUrl: string): string {
  const origin =
    typeof window !== "undefined" && window.location.origin.startsWith("http")
      ? window.location.origin
      : "";
  const isDesktop =
    typeof window !== "undefined" && !!(window as any).superDesktop?.isDesktop;
  if (
    isDesktop &&
    ((serverUrl && isLoopbackAuthUrl(serverUrl)) ||
      (!serverUrl && origin && isLoopbackAuthUrl(origin)))
  ) {
    return "local-desktop";
  }
  if (serverUrl) return normalizeAuthUrl(serverUrl);
  if (origin) return normalizeAuthUrl(origin);
  return "same-origin";
}

function getAuthUserCacheKey(scope: string): string {
  return `${AUTH_USER_CACHE_PREFIX}${scope}`;
}

export function saveCachedAuthUser(scope: string, token: string, user: User): void {
  try {
    localStorage.setItem(
      getAuthUserCacheKey(scope),
      JSON.stringify({ token, user, cachedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function decodeUserFromToken(token: string): User | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")))
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    const data = JSON.parse(json) as { userId?: string; username?: string };
    if (!data.userId || !data.username) return null;
    return {
      id: data.userId,
      username: data.username,
      email: null,
      avatarUrl: null,
      displayName: data.username,
      createdAt: new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export function loadCachedAuthUser(scope: string, token: string): User | null {
  try {
    const raw = localStorage.getItem(getAuthUserCacheKey(scope));
    if (raw) {
      const cached = JSON.parse(raw) as { token?: string; user?: User };
      const decoded = decodeUserFromToken(token);
      if (
        cached.user?.id &&
        (cached.token === token || cached.user.id === decoded?.id)
      ) {
        return cached.user;
      }
    }
  } catch {
    /* ignore */
  }
  return decodeUserFromToken(token);
}

export type VerifyAuthResult =
  | { ok: true; user: User; fromCache?: boolean }
  | {
      ok: false;
      reason: "auth_invalid" | "network" | "no_server" | "bad_response";
      message?: string;
      status?: number;
    };

export interface VerifyAuthOptions {
  /** 总尝试次数，默认 2（首试 + 指纹后常见的一次重试） */
  attempts?: number;
  /** 重试间隔 ms，默认 450 */
  retryDelayMs?: number;
  /** 单次超时 ms，默认 8000 */
  timeoutMs?: number;
  /** 网络失败时是否用本地缓存兜底，默认 true */
  allowCacheFallback?: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 用 token 调 /auth/verify。
 * - 鉴权失败（401/403 明确 code）→ auth_invalid
 * - 网络/超时/5xx → 可重试；仍失败则尝试缓存
 * - 成功 → { ok:true, user }
 */
export async function verifyAuthToken(
  token: string,
  options: VerifyAuthOptions = {},
): Promise<VerifyAuthResult> {
  if (!token) {
    return { ok: false, reason: "auth_invalid", message: "缺少登录凭证" };
  }

  const attempts = Math.max(1, options.attempts ?? 2);
  const retryDelayMs = options.retryDelayMs ?? 450;
  const timeoutMs = options.timeoutMs ?? 8000;
  const allowCacheFallback = options.allowCacheFallback !== false;

  const serverUrl = getServerUrl();
  const isCap =
    typeof window !== "undefined" &&
    !!(window as any).Capacitor?.isNativePlatform?.();
  // 原生端必须有 serverUrl，否则会打到 https://localhost/api 必然失败
  if (isCap && !serverUrl) {
    return {
      ok: false,
      reason: "no_server",
      message: "未找到服务器地址，请使用密码登录并重新填写",
    };
  }

  const verifyUrl = `${getBaseUrl()}/auth/verify`;
  const scope = getAuthCacheScope(serverUrl);

  let lastNetworkMessage = "网络异常，请使用密码登录";

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(retryDelayMs);

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(verifyUrl, {
          headers: { Authorization: `Bearer ${token}` },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        let data: any = null;
        try {
          data = await res.json();
        } catch {
          lastNetworkMessage = "服务器响应异常";
          continue;
        }
        if (data?.user) {
          saveCachedAuthUser(scope, token, data.user as User);
          return { ok: true, user: data.user as User };
        }
        lastNetworkMessage = "服务器未返回用户信息";
        continue;
      }

      let body: any = {};
      try {
        body = await res.clone().json();
      } catch {
        /* ignore */
      }
      const code = body?.code as string | undefined;
      const authInvalid =
        res.status === 401 ||
        code === "ACCOUNT_DISABLED" ||
        code === "TOKEN_REVOKED" ||
        code === "USER_NOT_FOUND" ||
        code === "TOKEN_INVALID" ||
        code === "SESSION_REVOKED" ||
        code === "UNAUTHENTICATED";

      if (authInvalid) {
        return {
          ok: false,
          reason: "auth_invalid",
          message: body?.error || "登录态已失效，请重新输入密码",
          status: res.status,
        };
      }

      // 5xx / 其它非鉴权失败：当作网络类，可重试
      lastNetworkMessage =
        body?.error || `服务器暂时不可用 (${res.status})`;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        lastNetworkMessage = "服务器无响应，请检查网络";
      } else {
        lastNetworkMessage = e?.message
          ? `网络异常：${String(e.message).slice(0, 80)}`
          : "网络异常，请使用密码登录";
      }
    }
  }

  if (allowCacheFallback) {
    const cached = loadCachedAuthUser(scope, token);
    if (cached) {
      return { ok: true, user: cached, fromCache: true };
    }
  }

  return {
    ok: false,
    reason: "network",
    message: lastNetworkMessage,
  };
}
