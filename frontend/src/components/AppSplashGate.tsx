/**
 * 应用内启动门（仅原生 APP）
 * ---------------------------------------------------------------------------
 * 冷启动展示「上次同步」到本地的工作区闪屏缓存：
 *   缓存就绪且未过期 → 全屏图 + 圆形倒计时跳过 + 可配置时长
 *   否则 → 品牌默认短淡出
 * 不在此处等网络；云端同步由 splashSync 在登录后 / 热启动时完成，供下次冷启动用。
 */
import { useEffect, useState } from "react";
import { getCurrentWorkspace } from "@/lib/api";
import { getReadySplashForDisplay } from "@/lib/splashCache";
import { isNativePlatform } from "@/hooks/useCapacitor";
import SplashOverlay from "@/components/SplashOverlay";

export type AppSplashGateProps = {
  /** true 时表示应用数据就绪 */
  ready: boolean;
  minMs?: number;
  onHidden?: () => void;
};

export default function AppSplashGate({ ready, minMs = 600, onHidden }: AppSplashGateProps) {
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

  // 桌面 Web / Electron：不展示自定义闪屏门
  if (!native) return null;
  if (gateDone) return null;
  // 缓存尚未读完：仍挂一层避免下层内容闪一下（SplashOverlay 会淡入）
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
