/**
 * 应用内启动门（仅原生 APP）
 * ---------------------------------------------------------------------------
 * 冷启动 / 热恢复共用：读本地工作区闪屏缓存 → SplashOverlay。
 * - 有缓存且未过期 → 自定义图 + 跳过倒计时
 * - 否则 → 品牌默认短门
 * 倒计时不依赖鉴权完成（ready 默认 true）；鉴权 UI 由 AuthGate 在闪屏结束后再展示。
 */
import { useEffect, useState } from "react";
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

  // 桌面 Web / Electron：不展示
  if (!native) return null;
  if (gateDone) return null;

  // 读缓存中：纯色遮罩，避免下层「正在验证」露出来
  if (customUrl === undefined) {
    return (
      <div
        className="fixed inset-0 z-[300]"
        style={{ backgroundColor: "#F5F3EE" }}
        aria-hidden
      />
    );
  }

  return (
    <SplashOverlay
      imageUrl={customUrl}
      durationSec={durationSec}
      minMs={minMs}
      ready={ready}
      zIndex={300}
      onHidden={() => {
        setGateDone(true);
        onHidden?.();
      }}
    />
  );
}
