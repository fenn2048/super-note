/**
 * 热恢复锁屏覆盖层
 *
 * 与启动时 QuickLoginGate 不同：本组件叠在已登录主界面之上，
 * 不卸载 AppLayout / GlobalMusicPlayer，避免音频被中断。
 * 认证成功仅关闭遮罩；失败可回退到密码登录（真正登出）。
 *
 * Portal 到 document.body + 高 z-index：避免与 GlobalMusicPlayer 的 body portal
 * 迷你条发生层叠上下文竞争（否则迷你播放器会漏在蒙层之上）。
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Fingerprint, Loader2 } from "lucide-react";
import {
  attemptQuickLogin,
  getQuickLoginUsername,
  isQuickLoginEnabled,
  isQuickLoginPlatformSupported,
} from "@/lib/quickLogin";

interface Props {
  /** 解锁成功：保持登录态，仅关闭遮罩 */
  onUnlocked: () => void;
  /**
   * 用户取消 / 生物识别失败 / 不可用：
   * 调用方应走密码登录（可选择是否清 session）
   */
  onFallbackToPassword: () => void;
}

type Phase = "probing" | "authenticating" | "fallback";

export default function AppLockOverlay({
  onUnlocked,
  onFallbackToPassword,
}: Props) {
  const [phase, setPhase] = useState<Phase>("probing");
  const [username, setUsername] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const startedRef = useRef(false);
  const onUnlockedRef = useRef(onUnlocked);
  const onFallbackRef = useRef(onFallbackToPassword);
  onUnlockedRef.current = onUnlocked;
  onFallbackRef.current = onFallbackToPassword;

  // 锁定期间隐藏全局播放器 UI（音频继续），避免迷你条/全屏层漏出
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-app-locked", "true");
    return () => {
      root.removeAttribute("data-app-locked");
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let alive = true;
    (async () => {
      if (!isQuickLoginPlatformSupported()) {
        onFallbackRef.current();
        return;
      }
      const enabled = await isQuickLoginEnabled();
      if (!alive) return;
      if (!enabled) {
        onFallbackRef.current();
        return;
      }

      try {
        const u = await getQuickLoginUsername();
        if (alive && u) setUsername(u);
      } catch {
        /* ignore */
      }

      if (!alive) return;
      setPhase("authenticating");

      const result = await attemptQuickLogin();
      if (!alive) return;

      if (result.ok) {
        // 热恢复时 token 本就在 localStorage；生物识别通过即可解锁，
        // 无需再次 verify（避免网络抖动导致误踢回登录页、中断音频）
        onUnlockedRef.current();
        return;
      }

      // 用户取消 / 暂时失败：留在遮罩层可重试，**不要**直接踢到密码登录页
      // （旧逻辑 user_cancel → onFallback 会 setIsAuthenticated(false)，会话被清感觉像"掉登录"）
      if (result.reason === "user_cancel") {
        setErrorMsg("已取消，请重试指纹解锁");
        setPhase("fallback");
        return;
      }

      if (
        result.reason === "not_enabled" ||
        result.reason === "unsupported"
      ) {
        // 未启用快速登录：无需锁屏，直接放行
        onUnlockedRef.current();
        return;
      }

      if (result.reason === "biometry_unavailable") {
        setErrorMsg(result.message || "生物识别暂不可用，请重试或使用密码");
        setPhase("fallback");
        return;
      }

      setErrorMsg(result.message || "解锁失败，请重试或使用密码登录");
      setPhase("fallback");
    })();

    return () => {
      alive = false;
    };
  }, []);

  const retry = () => {
    startedRef.current = false;
    setErrorMsg("");
    setPhase("probing");
    // 重新挂载流程：用 key 更干净，这里直接再跑一轮
    startedRef.current = true;
    setPhase("authenticating");
    void (async () => {
      const result = await attemptQuickLogin();
      if (result.ok) {
        onUnlockedRef.current();
        return;
      }
      if (result.reason === "not_enabled" || result.reason === "unsupported") {
        onUnlockedRef.current();
        return;
      }
      if (result.reason === "user_cancel") {
        setErrorMsg("已取消，请重试指纹解锁");
        setPhase("fallback");
        return;
      }
      setErrorMsg(result.message || "解锁失败，请重试或使用密码登录");
      setPhase("fallback");
    })();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-zinc-950/95 backdrop-blur-md px-5"
      style={{
        paddingTop: "var(--safe-area-top)",
        paddingBottom: "var(--safe-area-bottom)",
      }}
      // 拦截下层点击，避免误操作已挂载的主界面
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="w-full max-w-[360px] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl p-6 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-500/10 dark:bg-indigo-500/15 mb-3">
          <Fingerprint
            size={26}
            className="text-indigo-600 dark:text-indigo-400"
          />
        </div>

        {(phase === "probing" || phase === "authenticating") && (
          <>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              正在解锁
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              请验证你的指纹 / 人脸 / 锁屏密码
              {username ? `，登录账号 ${username}` : ""}
            </p>
            <div className="mt-4 flex justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
            </div>
          </>
        )}

        {phase === "fallback" && (
          <>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              解锁失败
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1.5">
              {errorMsg || "请重试或使用密码登录"}
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={retry}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
              >
                重试
              </button>
              <button
                type="button"
                onClick={() => onFallbackRef.current()}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              >
                使用密码登录
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
