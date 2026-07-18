/**
 * 应用内启动门（P2-7）
 * - 有自定义闪屏：全屏显示用户图
 * - 否则：品牌默认 Logo + 蜉蝣
 * 在 auth/bootstrap 完成前覆盖主界面，避免原生 splash hide 后白屏。
 */
import { useEffect, useState } from "react";
import { getCustomSplashDataUrl } from "@/lib/splashStorage";
import BrandMark from "@/components/BrandMark";

export type AppSplashGateProps = {
  /** true 时开始淡出并卸载 */
  ready: boolean;
  minMs?: number;
  onHidden?: () => void;
};

export default function AppSplashGate({ ready, minMs = 600, onHidden }: AppSplashGateProps) {
  const [customUrl, setCustomUrl] = useState<string | null | undefined>(undefined);
  const [visible, setVisible] = useState(true);
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    getCustomSplashDataUrl()
      .then((u) => {
        if (!cancelled) setCustomUrl(u);
      })
      .catch(() => {
        if (!cancelled) setCustomUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || customUrl === undefined) return;
    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(0, minMs - elapsed);
    const t = window.setTimeout(() => {
      setVisible(false);
      window.setTimeout(() => onHidden?.(), 320);
    }, wait);
    return () => clearTimeout(t);
  }, [ready, customUrl, mountedAt, minMs, onHidden]);

  if (!visible && ready) return null;

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-center transition-opacity duration-300 ${
        ready && !visible ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
      style={{ backgroundColor: "#F5F3EE" }}
      aria-hidden
    >
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
