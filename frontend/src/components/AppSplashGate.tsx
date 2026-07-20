/**
 * 应用内启动门（P2-7 / P2-7b）
 * 优先级：本机自定义图 → 站点级 site_splash_url → 品牌默认 Logo
 */
import { useEffect, useState, useCallback } from "react";
import { getCustomSplashDataUrl } from "@/lib/splashStorage";
import BrandMark from "@/components/BrandMark";
import { api } from "@/lib/api";

export type AppSplashGateProps = {
  /** true 时表示应用数据就绪 */
  ready: boolean;
  minMs?: number;
  onHidden?: () => void;
};

export default function AppSplashGate({ ready, minMs = 600, onHidden }: AppSplashGateProps) {
  const [customUrl, setCustomUrl] = useState<string | null | undefined>(undefined);
  const [visible, setVisible] = useState(true);
  const [mountedAt] = useState(() => Date.now());
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const local = await getCustomSplashDataUrl();
        if (cancelled) return;
        if (local) {
          setCustomUrl(local);
          return;
        }
        // 站点级默认闪屏（多设备一致）
        try {
          const site = await api.getSiteSettings();
          const siteUrl = (site.site_splash_url || "").trim();
          if (!cancelled) setCustomUrl(siteUrl || null);
        } catch {
          if (!cancelled) setCustomUrl(null);
        }
      } catch {
        if (!cancelled) setCustomUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setVisible(false);
    window.setTimeout(() => onHidden?.(), 320);
  }, [onHidden]);

  useEffect(() => {
    if (customUrl === undefined) return;

    if (customUrl) {
      // 有自定义闪屏图：展示 5 秒，并实时更新倒计时
      const targetDuration = 5000;
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
      // 无自定义图：常规淡出
      if (!ready) return;
      const elapsed = Date.now() - mountedAt;
      const wait = Math.max(0, minMs - elapsed);
      const t = window.setTimeout(() => {
        handleDismiss();
      }, wait);
      return () => clearTimeout(t);
    }
  }, [ready, customUrl, mountedAt, minMs, handleDismiss]);

  // 当 app 数据就绪且 5s 倒计时结束时自动关闭
  useEffect(() => {
    if (customUrl && ready && Date.now() - mountedAt >= 5000) {
      handleDismiss();
    }
  }, [ready, customUrl, mountedAt, handleDismiss]);

  if (!visible && ready) return null;

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-center transition-opacity duration-300 ${
        ready && !visible ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ backgroundColor: "#F5F3EE" }}
      aria-hidden
    >
      {/* 跳过按钮：仅在有自定义图片时显示 */}
      {customUrl && visible && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDismiss();
          }}
          className="fixed z-[310] top-[max(12px,env(safe-area-inset-top))] right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/55 text-white/90 border border-white/20 text-xs font-semibold backdrop-blur-md shadow-md active:scale-95 transition-all cursor-pointer select-none"
          aria-label="跳过闪屏"
        >
          <span>跳过</span>
          <span className="opacity-75 font-mono">({countdown}s)</span>
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
