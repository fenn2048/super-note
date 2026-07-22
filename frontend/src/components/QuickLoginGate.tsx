/**
 * 启动时自动尝试快速登录
 * ============================================================================
 *
 * 渲染策略
 * ----------------------------------------------------------------------------
 * - 平台不支持（Web / Electron）→ 立即调 onSettled(false)，UI 走原密码登录路径。
 * - 未启用快速登录 → 同上。
 * - 已启用 → 渲染一个全屏占位 + 唤起生物识别。
 *   - 认证成功：把 token 写回 localStorage，调 /auth/verify 拉用户信息后
 *     onSettled(true) + 调 onLogin 让 AuthGate 直接进主界面。
 *   - 认证失败 / token 已被吊销：清掉 secure storage 中的镜像，onSettled(false)
 *     回到密码登录页。
 *
 * 为什么不直接放在 AuthGate 内？
 * ----------------------------------------------------------------------------
 * AuthGate 已经有 verify token / storage 监听 / clientMode 判定 等大量逻辑。
 * 把"启动时唤起生物识别"独立成一个小组件，方便单独维护，也避免每次 storage
 * 事件都触发认证。本组件只在 AuthGate 第一次确认 isAuthenticated=false 时
 * 挂载一次，处理完后再 unmount。
 */

import React, { useEffect, useRef, useState } from "react";
import { Loader2, Fingerprint } from "lucide-react";
import {
  isQuickLoginPlatformSupported,
  isQuickLoginEnabled,
  attemptQuickLogin,
  disableQuickLogin,
  getQuickLoginUsername,
} from "@/lib/quickLogin";
import { setServerUrl, getServerUrl } from "@/lib/api";
import { verifyAuthToken } from "@/lib/authVerify";
import type { User } from "@/types";

interface Props {
  /** 是否处于客户端模式（Electron / Capacitor / 曾配置过服务器地址） */
  isClientMode: boolean;
  /**
   * 询问 / 处理完毕时回调：
   *   - usedQuickLogin=true 且带 user：表示已通过快速登录，AuthGate 直接进主界面
   *   - usedQuickLogin=false：未启用 / 用户取消 / 失败，AuthGate 走常规密码流程
   */
  onSettled: (
    usedQuickLogin: boolean,
    payload?: { token: string; user: User },
  ) => void;
}

type Phase = "probing" | "authenticating" | "verifying" | "fallback";

function normalizeServerUrl(url: string): string {
  return (url || "").trim().replace(/\/+$/, "");
}

export default function QuickLoginGate({ isClientMode, onSettled }: Props) {
  const [phase, setPhase] = useState<Phase>("probing");
  const [username, setUsername] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  // 父组件常传内联 onSettled；splash 淡出等会触发重渲染换引用。
  // 若把 onSettled 放进 effect deps，指纹认证中途会 cleanup→cancelled，
  // 解锁成功后结果被丢弃，表现为「指纹过了却进密码页」。
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const isClientModeRef = useRef(isClientMode);
  isClientModeRef.current = isClientMode;
  /** 本会话是否已发起过认证（防 StrictMode / 重渲染二次弹窗） */
  const startedRef = useRef(false);

  // 仅挂载时跑一轮；结算一律走 ref，避免依赖变化中断指纹后的 verify。
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let alive = true;
    (async () => {
      const settle = (
        used: boolean,
        payload?: { token: string; user: User },
      ) => {
        if (!alive) return;
        onSettledRef.current(used, payload);
      };

      if (!isQuickLoginPlatformSupported()) {
        settle(false);
        return;
      }
      if (!isClientModeRef.current) {
        settle(false);
        return;
      }
      const enabled = await isQuickLoginEnabled();
      if (!alive) return;
      if (!enabled) {
        settle(false);
        return;
      }

      // 取一下用户名，UI 上能展示"以 xxx 身份解锁"
      try {
        const u = await getQuickLoginUsername();
        if (alive && u) setUsername(u);
      } catch {
        /* ignore */
      }

      if (!alive) return;
      setPhase("authenticating");

      const result = await attemptQuickLogin();
      // 指纹已出结果：即使组件即将卸载也尽量完成登录，避免 silent drop
      if (!result.ok) {
        // 取消 / 硬件暂时不可用 / 未启用：回密码页，但 **不要** disableQuickLogin
        // （旧逻辑在 biometry_unavailable 时清掉指纹配置，导致过一会儿只能输密码）
        if (
          result.reason === "user_cancel" ||
          result.reason === "biometry_unavailable" ||
          result.reason === "not_enabled" ||
          result.reason === "unsupported"
        ) {
          settle(false);
          return;
        }
        if (!alive) {
          settle(false);
          return;
        }
        setErrorMsg(result.message || "解锁失败，请使用密码登录");
        setPhase("fallback");
        return;
      }

      // 取到 token → 恢复 serverUrl 后 verify（此阶段不再因 unmount 丢弃成功结果）
      if (alive) setPhase("verifying");

      const ssServer = normalizeServerUrl(result.serverUrl);
      const lsServer = normalizeServerUrl(getServerUrl());
      if (ssServer) {
        if (ssServer !== lsServer) {
          setServerUrl(ssServer);
        }
      } else if (!lsServer) {
        if (alive) {
          setErrorMsg("未找到服务器地址，请使用密码登录");
          setPhase("fallback");
        } else {
          settle(false);
        }
        return;
      }

      try {
        localStorage.setItem("super-token", result.token);
      } catch {
        /* ignore */
      }

      const verified = await verifyAuthToken(result.token, {
        attempts: 3,
        retryDelayMs: 500,
        timeoutMs: 10000,
        allowCacheFallback: true,
      });

      if (verified.ok) {
        // 成功：即使用户界面已切走也写入登录态
        onSettledRef.current(true, {
          token: result.token,
          user: verified.user,
        });
        return;
      }

      if (verified.reason === "auth_invalid") {
        await disableQuickLogin();
        try {
          localStorage.removeItem("super-token");
        } catch {
          /* ignore */
        }
        if (alive) {
          setErrorMsg(verified.message || "登录态已失效，请重新输入密码");
          setPhase("fallback");
        } else {
          settle(false);
        }
        return;
      }

      if (verified.reason === "no_server") {
        if (alive) {
          setErrorMsg(verified.message || "未找到服务器地址，请使用密码登录");
          setPhase("fallback");
        } else {
          settle(false);
        }
        return;
      }

      if (alive) {
        setErrorMsg(verified.message || "网络异常，请使用密码登录");
        setPhase("fallback");
      } else {
        // 网络失败且组件已卸载：不要 silent，交给密码页
        settle(false);
      }
    })();

    return () => {
      alive = false;
    };
    // 故意只跑一次：指纹流程不可因父组件重渲染重启
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "probing") {
    // 还在探测，避免视觉闪烁，渲染一个最小 loading
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // authenticating / verifying / fallback 都是"已经决定要展示快速登录 UI"，
  // 渲染一个统一的占位卡片。fallback 时给用户一个手动按钮可以直接关闭并回密码页。
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-5"
      style={{
        paddingTop: "var(--safe-area-top)",
        paddingBottom: "var(--safe-area-bottom)",
      }}
    >
      <div className="w-full max-w-[360px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-xl p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 mb-3">
          <Fingerprint
            size={26}
            className="text-indigo-600 dark:text-indigo-400"
          />
        </div>

        {phase === "authenticating" && (
          <>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              正在解锁
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              请验证你的指纹 / 人脸 / 锁屏密码
              {username ? `，登录账号 ${username}` : ""}
            </p>
          </>
        )}

        {phase === "verifying" && (
          <>
            <div className="flex items-center justify-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              正在登录…
            </div>
          </>
        )}

        {phase === "fallback" && (
          <>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              快速登录失败
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              {errorMsg || "请使用密码登录"}
            </p>
            <button
              type="button"
              onClick={() => onSettledRef.current(false)}
              className="mt-4 w-full py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
            >
              使用密码登录
            </button>
          </>
        )}
      </div>
    </div>
  );
}
