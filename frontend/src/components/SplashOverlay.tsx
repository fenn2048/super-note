/**
 * 全屏闪屏层（冷启动门 / 设置预览共用）
 * ---------------------------------------------------------------------------
 * - 自定义图：全屏 cover + 右上角圆形半透明跳过（环形倒计时 + 纯数字）
 * - 无图：品牌默认短展示
 * - 收起时淡出；**出现必须立即不透明**，否则热恢复时 body 上 portal 的 UI
 *   （媒体库右上角车载/设置/加号等）会从闪屏「透」出来
 * - 默认 portal 到 document.body + z-system，盖过任意 createPortal 的 chrome
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BrandMark from "@/components/BrandMark";
import useReducedMotion from "@/hooks/useReducedMotion";

const FADE_MS = 320;
const SKIP_SIZE = 44;
const RING_STROKE = 2.5;
const RING_PAD = 2;
/** 与 --z-system 对齐，盖住 lightbox / toast / 媒体 titlebar portal */
const DEFAULT_SPLASH_Z = 1000;

export type SplashOverlayProps = {
  /** 自定义闪屏 data URL；null 表示品牌默认 */
  imageUrl: string | null;
  /** 自定义图展示秒数（1–30） */
  durationSec?: number;
  /** 品牌默认最短展示 ms */
  minMs?: number;
  /**
   * 应用数据是否就绪。冷启动门在 ready 后才允许自动收起；
   * 设置预览始终传 true。
   */
  ready?: boolean;
  /** 淡出并完全卸层后回调 */
  onHidden?: () => void;
  /** 覆盖 z-index（预览需盖住设置弹层） */
  zIndex?: number;
  /** 是否展示跳过按钮（无自定义图时默认 false） */
  showSkip?: boolean;
};

function clampDurationSec(sec: number | undefined): number {
  const n = Math.round(sec ?? 5);
  return Math.min(30, Math.max(1, Number.isFinite(n) ? n : 5));
}

/** 圆形跳过：半透明底 + 环形进度 + 纯数字 */
function CircularSkipButton({
  remainingSec,
  progress,
  onSkip,
}: {
  remainingSec: number;
  /** 0–1，1=满圈刚开始 */
  progress: number;
  onSkip: () => void;
}) {
  const size = SKIP_SIZE;
  const r = (size - RING_STROKE) / 2 - RING_PAD;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - Math.min(1, Math.max(0, progress)));

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSkip();
      }}
      className="fixed z-[1] flex items-center justify-center rounded-full active:scale-95 transition-transform cursor-pointer select-none"
      style={{
        top: "calc(max(var(--safe-area-top, 0px), env(safe-area-inset-top, 0px), 32px) + 8px)",
        right: "1rem",
        width: size,
        height: size,
      }}
      aria-label="跳过闪屏"
    >
      <span
        className="absolute inset-0 rounded-full bg-black/35 backdrop-blur-md shadow-sm"
        aria-hidden
      />
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={RING_STROKE}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.92)"
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span
        className="relative z-[1] text-white text-sm font-semibold tabular-nums leading-none"
        aria-live="polite"
      >
        {remainingSec}
      </span>
    </button>
  );
}

export default function SplashOverlay({
  imageUrl,
  durationSec = 5,
  minMs = 600,
  ready = true,
  onHidden,
  zIndex = DEFAULT_SPLASH_Z,
  showSkip,
}: SplashOverlayProps) {
  const reduceMotion = useReducedMotion();
  const fadeMs = reduceMotion ? 0 : FADE_MS;
  const totalMs = clampDurationSec(durationSec) * 1000;
  const hasCustom = !!imageUrl;
  const skipEnabled = showSkip ?? hasCustom;

  // 必须从 1 起：热恢复时若从 0 淡入，body 上 portal 的媒体库 chrome 会整段露出来
  const [opacity, setOpacity] = useState(1);
  const [remainingSec, setRemainingSec] = useState(() => clampDurationSec(durationSec));
  const [progress, setProgress] = useState(1);
  const [leaving, setLeaving] = useState(false);

  const mountedAtRef = useRef(Date.now());
  const dismissedRef = useRef(false);
  const onHiddenRef = useRef(onHidden);
  onHiddenRef.current = onHidden;
  const readyRef = useRef(ready);
  readyRef.current = ready;

  const finishHide = useCallback(() => {
    onHiddenRef.current?.();
  }, []);

  const handleDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    setLeaving(true);
    setOpacity(0);
    window.setTimeout(() => finishHide(), fadeMs);
  }, [fadeMs, finishHide]);

  // 倒计时 / 自动收起
  useEffect(() => {
    if (leaving) return;

    if (hasCustom) {
      const tick = () => {
        const elapsed = Date.now() - mountedAtRef.current;
        const left = Math.max(0, totalMs - elapsed);
        setRemainingSec(Math.max(0, Math.ceil(left / 1000)));
        setProgress(left / totalMs);
        if (left <= 0 && readyRef.current) {
          handleDismiss();
        }
      };
      tick();
      const interval = window.setInterval(tick, 50);
      return () => clearInterval(interval);
    }

    // 品牌默认：ready 后至少展示 minMs
    if (!ready) return;
    const elapsed = Date.now() - mountedAtRef.current;
    const wait = Math.max(0, minMs - elapsed);
    const t = window.setTimeout(() => handleDismiss(), wait);
    return () => clearTimeout(t);
  }, [hasCustom, totalMs, minMs, ready, leaving, handleDismiss]);

  // ready 变 true 且自定义图已超时：补一次 dismiss
  useEffect(() => {
    if (!hasCustom || leaving) return;
    if (ready && Date.now() - mountedAtRef.current >= totalMs) {
      handleDismiss();
    }
  }, [ready, hasCustom, totalMs, leaving, handleDismiss]);

  const layer = (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      data-splash-overlay
      style={{
        zIndex,
        backgroundColor: "#F5F3EE",
        opacity,
        transition: fadeMs > 0 ? `opacity ${fadeMs}ms ease-out` : undefined,
        pointerEvents: leaving ? "none" : "auto",
      }}
      aria-hidden
    >
      {skipEnabled && !leaving && (
        <CircularSkipButton
          remainingSec={remainingSec}
          progress={progress}
          onSkip={handleDismiss}
        />
      )}

      {hasCustom ? (
        <img
          src={imageUrl!}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          draggable={false}
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

  // portal 到 body：与媒体库 titlebar（createPortal → body）同一层比较 z-index，
  // 避免被 #root 内 transform/动画产生的层叠上下文压到下面。
  if (typeof document === "undefined") return layer;
  return createPortal(layer, document.body);
}
