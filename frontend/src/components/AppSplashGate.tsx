/**
 * 应用内启动门（仅原生 APP）
 * ---------------------------------------------------------------------------
 * 冷启动 / 热恢复共用：读本地工作区闪屏缓存 → SplashOverlay。
 * - 有缓存且未过期 → 自定义图 + 跳过倒计时
 * - 否则 → 品牌默认短门
 * 倒计时不依赖鉴权完成（ready 默认 true）；鉴权 UI 由 AuthGate 在闪屏结束后再展示。
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWorkspace } from "@/lib/api";
import { getReadySplashForDisplay } from "@/lib/splashCache";
import { isNativePlatform, hideSplashScreen } from "@/hooks/useCapacitor";
import SplashOverlay from "@/components/SplashOverlay";

export type AppSplashGateProps = {
  /**
   * 应用数据是否就绪。冷/热闪屏默认 true：倒计时结束后即可收起，不等 verify。
   * 预留兼容。
   */
  ready?: boolean;
  minMs?: number;
  onHidden?: () => void;
  /**
   * 缓存已解析、即将展示内容时回调（用于尽早 hide 原生 Capacitor Splash）。
   */
  onContentReady?: () => void;
};

export default function AppSplashGate({
  ready = true,
  minMs = 600,
  onHidden,
  onContentReady,
}: AppSplashGateProps) {
  const native = isNativePlatform();
  /** undefined = 仍在读缓存；null = 无自定义图；string = data URL */
  const [customUrl, setCustomUrl] = useState<string | null | undefined>(
    () => (native ? undefined : null),
  );
  const [durationSec, setDurationSec] = useState(5);
  const [gateDone, setGateDone] = useState(false);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    (async () => {
      try {
        const ws = getCurrentWorkspace();
        const readySplash = ws ? await getReadySplashForDisplay(ws) : null;
        if (cancelled) return;
        if (readySplash) {
          setCustomUrl(readySplash.dataUrl);
          setDurationSec(readySplash.displayDurationSec || 5);
        } else {
          setCustomUrl(null);
        }
      } catch {
        if (!cancelled) setCustomUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  // 缓存解析完毕：尽早藏原生 Splash，避免长时间卡在品牌打包图
  useEffect(() => {
    if (!native || customUrl === undefined) return;
    try {
      hideSplashScreen();
    } catch {
      /* ignore */
    }
    onContentReady?.();
  }, [native, customUrl, onContentReady]);

  // 闪屏展示期间：html[data-splash-active] 强制藏媒体 titlebar portal / 迷你播放器
  // （仅靠 z-index 在 Android WebView 上仍会被后挂载的 fixed 层压住）
  useEffect(() => {
    if (!native || gateDone) return;
    const root = document.documentElement;
    root.setAttribute("data-splash-active", "true");
    return () => {
      root.removeAttribute("data-splash-active");
    };
  }, [native, gateDone]);

  // 桌面 Web / Electron：不展示
  if (!native) return null;
  if (gateDone) return null;

  // 读缓存中：纯色遮罩（同 SplashOverlay：portal + z-system，盖住媒体库 chrome）
  if (customUrl === undefined) {
    const underlay = (
      <div
        className="fixed inset-0 isolate"
        data-splash-overlay
        style={{ backgroundColor: "#F5F3EE", zIndex: 1100 }}
        aria-hidden
      />
    );
    if (typeof document === "undefined") return underlay;
    return createPortal(underlay, document.body);
  }

  return (
    <SplashOverlay
      imageUrl={customUrl}
      durationSec={durationSec}
      minMs={minMs}
      ready={ready}
      zIndex={1000}
      onHidden={() => {
        setGateDone(true);
        onHidden?.();
      }}
    />
  );
}
