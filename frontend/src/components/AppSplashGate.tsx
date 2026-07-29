/**
 * 应用内启动门（仅原生 APP）
 * ---------------------------------------------------------------------------
 * 冷启动展示「上次同步」到本地的工作区闪屏缓存：
 *   缓存就绪且未过期 → 全屏图 + 右上角跳过 + 可配置时长
 *   否则 → 品牌默认短淡出
 * 不在此处等网络；云端同步由 splashSync 在登录后 / 热启动时完成，供下次冷启动用。
 */
import { useEffect, useState, useCallback } from "react";
import BrandMark from "@/components/BrandMark";
import { getCurrentWorkspace } from "@/lib/api";
import { getReadySplashForDisplay } from "@/lib/splashCache";
import { isNativePlatform } from "@/hooks/useCapacitor";

export type AppSplashGateProps = {
  /** true 时表示应用数据就绪 */
  ready: boolean;
  minMs?: number;
  onHidden?: () => void;
};

export default function AppSplashGate({ ready, minMs = 600, onHidden }: AppSplashGateProps) {
  const native = isNativePlatform();
  const [customUrl, setCustomUrl] = useState<string | null | undefined>(
    () => (native ? undefined : null),
  );
  const [durationMs, setDurationMs] = useState(5000);
  const [visible, setVisible] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const [countdown, setCountdown] = useState(5);

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
          const sec = readySplash.displayDurationSec || 5;
          setDurationMs(sec * 1000);
          setCountdown(sec);
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

  const handleDismiss = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => onHidden?.(), 320);
  }, [onHidden]);

  useEffect(() => {
    if (!native) return;
    if (customUrl === undefined) return;

    if (customUrl) {
      const targetDuration = durationMs;
      const interval = window.setInterval(() => {
        const elapsed = Date.now() - mountedAt;
        const leftSec = Math.max(0, Math.ceil((targetDuration - elapsed) / 1000));
        setCountdown(leftSec);
      }, 200);

      const t = window.setTimeout(() => {
        if (ready) {
          handleDismiss();
        }
      }, targetDuration);

      return () => {
        clearInterval(interval);
        clearTimeout(t);
      };
    } else {
      if (!ready) return;
      const elapsed = Date.now() - mountedAt;
      const wait = Math.max(0, minMs - elapsed);
      const t = window.setTimeout(() => {
        handleDismiss();
      }, wait);
      return () => clearTimeout(t);
    }
  }, [native, ready, customUrl, mountedAt, minMs, handleDismiss, durationMs]);

  useEffect(() => {
    if (!native) return;
    if (customUrl && ready && Date.now() - mountedAt >= durationMs) {
      handleDismiss();
    }
  }, [native, ready, customUrl, mountedAt, handleDismiss, durationMs]);

  // 桌面 Web / Electron：不展示自定义闪屏门
  if (!native) return null;
  if (!visible && ready) return null;

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-center transition-opacity duration-300 ${
        ready && !visible ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ backgroundColor: "#F5F3EE" }}
      aria-hidden
    >
      {customUrl && visible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          // 必须落在状态栏下方。闪屏很早渲染，--safe-area-top / data-native 可能尚未就绪，
          // 因此用 max(CSS 变量, env, 32px) 兜底，再 +8px 与时间/电量拉开间距。
          className="fixed z-[310] right-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-zinc-200/85 text-zinc-700 border border-zinc-300/70 text-xs font-semibold backdrop-blur-md shadow-sm active:scale-95 transition-all cursor-pointer select-none"
          style={{
            top: "calc(max(var(--safe-area-top, 0px), env(safe-area-inset-top, 0px), 32px) + 8px)",
          }}
          aria-label="跳过闪屏"
        >
          <span>跳过</span>
          <span className="text-zinc-500 font-mono">({countdown}s)</span>
        </button>
      )}

      {customUrl ? (
        <img
          src={customUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center gap-4 px-6">
          <BrandMark size={96} />
          <div className="text-2xl font-bold tracking-tight text-stone-800">蜉蝣</div>
          <div className="text-sm text-stone-500">家庭知识与协作</div>
        </div>
      )}
    </div>
  );
}
