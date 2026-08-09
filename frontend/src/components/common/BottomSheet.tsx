/**
 * BottomSheet — iOS-style draggable sheet
 * ----------------------------------------------------------------------------
 * Fluid interaction (Apple WWDC → Web):
 *   1:1 drag · rubber-band past open edge · project + velocity handoff · interruptible spring
 *
 * Spec: DESIGN.md §13 · @/lib/motion
 *
 * 全屏播放器 dismiss 防抖（Android 录屏复现）：
 * 1) 松手后不得再被 dragConstraints / spring velocity 弹回
 * 2) 手势已滑出后 exit 禁止再播一遍 y→height
 * 3) dismiss 用 tween 单向滑出，不用带 velocity 的 spring（易过冲回弹 1～2 下）
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  useMotionValue,
  animate,
  type PanInfo,
} from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  nearestSnap,
  project,
  rubberband,
  springs,
  springWithVelocity,
} from "@/lib/motion";
import useReducedMotion from "@/hooks/useReducedMotion";

export type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  headerRight?: React.ReactNode;
  hideHandle?: boolean;
  hideClose?: boolean;
  /**
   * Snap points as fractions of sheet height (0 = open, 1 = fully dismissed).
   * Default `[0, 1]`. Mid-height example: `[0, 0.45, 1]`.
   */
  snapPoints?: number[];
  initialSnap?: number;
  maxHeight?: string;
  className?: string;
  bodyClassName?: string;
  scrimClassName?: string;
  zClassName?: string;
  onSnapChange?: (index: number) => void;
  "aria-label"?: string;
  /**
   * 允许从内容区下拉关闭（跳过 button/input 等）。
   * 全屏播放器等需要「任意位置下拉收起」时开启。
   */
  dragFromContent?: boolean;
  /**
   * 松手后判定关闭的位移比例（相对 sheet 高度）。
   * 默认 0.28；全屏播放器可用 0.18–0.25 更易滑关。
   */
  dismissFraction?: number;
  /** 向下 flick 速度超过此值（px/s）且已有一定位移则关闭。默认 850 */
  dismissVelocity?: number;
  /**
   * 全屏模式：贴满 fixed 容器（100% × 100%），无圆角底栏语义。
   * 解决 Android 上 100dvh 与 visualViewport 不一致导致「重开不满屏」。
   */
  fullscreen?: boolean;
};

const DEFAULT_DISMISS_FRACTION = 0.28;
const DEFAULT_DISMISS_VELOCITY = 850;

function viewportHeight(): number {
  if (typeof window === "undefined") return 800;
  // 优先 visualViewport（键盘/浏览器 chrome 更准）；过小则回退 innerHeight
  const vv = window.visualViewport?.height;
  const ih = window.innerHeight || 800;
  if (vv != null && vv > 0) {
    // 偶发 vv 远小于可视区时回退（比例阈值）
    if (vv < ih * 0.55) return Math.round(ih);
    return Math.round(vv);
  }
  return Math.round(ih);
}

/** 下滑关闭：时长随剩余距离与速度略变，但绝不回弹 */
function dismissDuration(remainingPx: number, velocityY: number): number {
  const v = Math.max(0, velocityY);
  // 快速 flick → 更短；慢拖 → 稍长但仍 ≤ 0.32s
  const byVelocity = v > 1200 ? 0.18 : v > 600 ? 0.24 : 0.3;
  const byDistance = Math.min(0.32, Math.max(0.16, remainingPx / 2400));
  return Math.min(byVelocity, byDistance + 0.08);
}

export function BottomSheet({
  open,
  onClose,
  children,
  title,
  headerRight,
  hideHandle = false,
  hideClose = false,
  snapPoints = [0, 1],
  initialSnap = 0,
  maxHeight = "min(92dvh, 100%)",
  className,
  bodyClassName,
  scrimClassName,
  zClassName = "z-modal",
  onSnapChange,
  "aria-label": ariaLabel,
  dragFromContent = false,
  dismissFraction = DEFAULT_DISMISS_FRACTION,
  dismissVelocity = DEFAULT_DISMISS_VELOCITY,
  fullscreen = false,
}: BottomSheetProps) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  /** 触发 re-render 以关掉 drag，避免与 dismiss 动画抢 y */
  const [isClosing, setIsClosing] = useState(false);
  const y = useMotionValue(0);
  const dragControls = useDragControls();
  const baseY = useRef(0);
  const snapIndex = useRef(initialSnap);
  const entered = useRef(false);
  /** 手势/程序已把 sheet 推到屏外；exit 不再从打开位重播 y */
  const dismissedOffscreen = useRef(false);
  const closingRef = useRef(false);
  const dismissAnimRef = useRef<{ stop: () => void } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resolveSnaps = useCallback(
    (h: number) => {
      const raw = (snapPoints.length >= 2 ? snapPoints : [0, 1]).map((f) =>
        Math.max(0, Math.min(1, f)) * Math.max(h, 1),
      );
      if (!raw.some((v) => Math.abs(v - h) < 1)) raw.push(h);
      return [...new Set(raw.map((v) => Math.round(v)))].sort((a, b) => a - b);
    },
    [snapPoints],
  );

  const measureHeight = useCallback(() => {
    if (closingRef.current) return;
    if (fullscreen) {
      const h = viewportHeight();
      if (h <= 0) return;
      // 避免 visualViewport 轻微抖动反复 setState → 打断入场动画
      setHeight((prev) => (Math.abs(prev - h) < 12 ? prev : h));
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    if (h > 0) setHeight((prev) => (Math.abs(prev - h) < 4 ? prev : h));
  }, [fullscreen]);

  useLayoutEffect(() => {
    if (!open) {
      entered.current = false;
      // 关闭后清高度，避免下次以陈旧 height 入场（二次打开高度不一致）
      setHeight(0);
      // 不在这里清 closing / dismissed — 留给 onExitComplete，避免 exit 误判
      return;
    }
    closingRef.current = false;
    dismissedOffscreen.current = false;
    setIsClosing(false);
    // 打开瞬间先给一个可用高度，减少 height=0 空窗
    if (fullscreen) {
      const h = viewportHeight();
      if (h > 0) setHeight(h);
    }
    measureHeight();
    const el = panelRef.current;
    const ro =
      !fullscreen && el && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => measureHeight())
        : null;
    if (el) ro?.observe(el);

    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const onVv = () => measureHeight();
    vv?.addEventListener("resize", onVv);
    window.addEventListener("resize", onVv);

    return () => {
      ro?.disconnect();
      vv?.removeEventListener("resize", onVv);
      window.removeEventListener("resize", onVv);
    };
  }, [open, children, title, fullscreen, measureHeight]);

  // Enter animation once we know height
  // 关键：height 二次变化会 stop 动画，且 entered 后不补 y→0 → 卡在半屏
  useEffect(() => {
    if (!open || height <= 0 || closingRef.current) return;

    const snaps = resolveSnaps(height);
    const target = snaps[Math.min(initialSnap, snaps.length - 1)] ?? 0;

    if (entered.current) {
      // 已入场：高度微调时必须回到打开位，禁止卡在中途
      const cur = y.get();
      if (Math.abs(cur - target) < 2) {
        y.set(target);
        return;
      }
      if (reduce) {
        y.set(target);
        return;
      }
      const c = animate(y, target, springs.sheet);
      return () => {
        c.stop();
        // 清理时若仍打开，强制钉在打开位（防半屏残留）
        if (!closingRef.current) y.set(target);
      };
    }

    entered.current = true;
    dismissedOffscreen.current = false;
    if (reduce) {
      y.set(target);
      return;
    }
    // 从屏外滑入
    y.set(height);
    const c = animate(y, target, springs.sheet);
    return () => {
      c.stop();
      if (!closingRef.current) y.set(target);
    };
  }, [open, height, initialSnap, reduce, resolveSnaps, y]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const dismiss = useCallback(
    (velocityY: number) => {
      if (closingRef.current) return;
      closingRef.current = true;
      // 尽早标记：后续 re-render 的 exit 走「已离屏」分支，不再二次 y 动画
      dismissedOffscreen.current = true;
      setIsClosing(true);

      // 停掉可能在跑的 snap 弹簧，避免与 dismiss 抢 y
      try {
        dismissAnimRef.current?.stop();
      } catch {
        /* ignore */
      }

      const h = Math.max(
        height || 0,
        panelRef.current?.offsetHeight || 0,
        viewportHeight(),
      );
      const target = h + 24; // 略超一截，确保完全出屏
      const current = y.get();

      if (reduce) {
        y.set(target);
        onCloseRef.current();
        return;
      }

      // 已几乎出屏：直接关，不再播动画（避免弹一下）
      if (current >= h * 0.92) {
        y.set(target);
        onCloseRef.current();
        return;
      }

      const remaining = Math.max(0, target - current);
      const duration = dismissDuration(remaining, velocityY);

      // 单向 tween，不用 spring+velocity（Android 上易过冲回弹 1～2 下）
      const c = animate(y, target, {
        type: "tween",
        ease: [0.32, 0.72, 0, 1], // easings.drawer
        duration,
      });
      dismissAnimRef.current = c;
      c.then(() => {
        y.set(target);
        onCloseRef.current();
      });
    },
    [height, reduce, y],
  );

  const onDragStart = useCallback(() => {
    if (closingRef.current) return;
    try {
      dismissAnimRef.current?.stop();
    } catch {
      /* ignore */
    }
    baseY.current = y.get();
  }, [y]);

  const onDrag = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (closingRef.current) return;
      const h = height || panelRef.current?.offsetHeight || viewportHeight() || 1;
      const raw = baseY.current + info.offset.y;
      if (raw < 0) {
        y.set(rubberband(raw, h, 0.55));
      } else {
        // 允许拖过底边，但别无界延伸
        y.set(Math.min(raw, h * 1.2));
      }
    },
    [height, y],
  );

  const onDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (closingRef.current) return;
      const h = height || panelRef.current?.offsetHeight || viewportHeight() || 1;
      const current = y.get();
      const velocityY = info.velocity.y;
      const frac = Math.min(0.95, Math.max(0.12, dismissFraction));
      const flickClose =
        velocityY > dismissVelocity && current > Math.min(48, h * 0.06);
      const projected = current + project(velocityY, 0.998);
      const snaps = resolveSnaps(h);
      const target = nearestSnap(projected, snaps);

      if (flickClose || target >= h * frac || current >= h * frac) {
        // 立刻进入 dismiss：不再走 momentum snap（否则先弹回再下滑 = 顿两下）
        dismiss(velocityY);
        return;
      }

      const idx = snaps.findIndex((s) => Math.abs(s - target) < 1);
      if (idx >= 0) {
        snapIndex.current = idx;
        onSnapChange?.(idx);
      }
      const c = animate(y, target, springWithVelocity(springs.momentum, velocityY));
      dismissAnimRef.current = c;
    },
    [dismiss, dismissFraction, dismissVelocity, height, onSnapChange, resolveSnaps, y],
  );

  const tryStartDrag = useCallback(
    (e: React.PointerEvent) => {
      if (reduce || closingRef.current || isClosing) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, a, input, textarea, select, label, [data-no-drag], [data-no-sheet-drag]")) {
        return;
      }
      const scrollEl = t.closest("[data-sheet-scroll]") as HTMLElement | null;
      if (scrollEl && scrollEl.scrollTop > 1) return;
      dragControls.start(e);
    },
    [dragControls, reduce, isClosing],
  );

  if (typeof document === "undefined") return null;

  const label =
    ariaLabel || (typeof title === "string" ? title : "底部面板");

  const dragBottom = Math.max(height || viewportHeight(), 1);
  const dragEnabled = !reduce && !isClosing && !closingRef.current;

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        dismissedOffscreen.current = false;
        closingRef.current = false;
        setIsClosing(false);
        y.set(0);
        dismissAnimRef.current = null;
      }}
    >
      {open && (
        <motion.div
          key="bottom-sheet-root"
          className={cn(
            "fixed inset-0",
            // 全屏：不依赖 flex 拉伸；半屏：底对齐
            fullscreen ? "" : "flex flex-col justify-end",
            zClassName,
          )}
          style={
            fullscreen
              ? {
                  // 与 visualViewport 对齐，避免 Android 100dvh 不满屏
                  top: 0,
                  left: 0,
                  right: 0,
                  width: "100%",
                  height: height > 0 ? height : "100%",
                  maxHeight: height > 0 ? height : "100%",
                }
              : undefined
          }
          // 根节点只做 opacity exit；y 由 panel 的 motion value 负责，避免双重 y
          initial={false}
          exit={{
            opacity: 0,
            transition: reduce
              ? { duration: 0 }
              : dismissedOffscreen.current
                ? { duration: 0.12, ease: [0.23, 1, 0.32, 1] as const }
                : { duration: 0.15 },
          }}
        >
          <motion.button
            type="button"
            aria-label="关闭"
            className={cn(
              "absolute inset-0 bg-black/45 backdrop-blur-[2px]",
              scrimClassName,
            )}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: isClosing ? 0 : 1 }}
            transition={reduce ? { duration: 0 } : { duration: 0.2 }}
            onClick={() => dismiss(0)}
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : label}
            className={cn(
              "relative w-full flex flex-col",
              fullscreen
                ? "absolute inset-0 h-full max-h-full rounded-none border-0"
                : "rounded-t-window border border-app-border border-b-0",
              "bg-app-card text-tx-primary shadow-xl",
              className,
            )}
            style={{
              ...(fullscreen
                ? {
                    // 显式像素高，避免 % / flex 链在 portal 里塌缩
                    height: height > 0 ? height : "100%",
                    maxHeight: height > 0 ? height : "100%",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    paddingBottom: 0,
                  }
                : {
                    maxHeight,
                    paddingBottom:
                      "max(0.5rem, var(--safe-area-bottom, env(safe-area-inset-bottom)))",
                  }),
              y,
              willChange: "transform",
              boxSizing: "border-box",
            }}
            initial={false}
            // panel 的 y 已由 dismiss tween 推到屏外 → exit 不再动 y（保持当前 transform）
            exit={{ opacity: 1, transition: { duration: 0 } }}
            drag={dragEnabled ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={dragEnabled ? { top: 0, bottom: dragBottom } : undefined}
            dragElastic={0}
            dragMomentum={false}
            dragSnapToOrigin={false}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          >
            <div
              className="shrink-0 cursor-grab active:cursor-grabbing select-none"
              onPointerDown={tryStartDrag}
              style={{ touchAction: "none" }}
            >
              {!hideHandle && (
                <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
                  <div className="w-10 h-1 rounded-full bg-tx-quaternary/50" />
                </div>
              )}
              {(title || !hideClose || headerRight) && (
                <div className="flex items-center gap-2 px-3 sm:px-4 pb-2 min-h-[48px]">
                  <div
                    id={titleId}
                    className="flex-1 min-w-0 text-[15px] font-semibold truncate text-tx-primary"
                  >
                    {title}
                  </div>
                  {headerRight}
                  {!hideClose && (
                    <button
                      type="button"
                      data-no-drag
                      onClick={() => dismiss(0)}
                      className="p-2 min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-button text-tx-tertiary hover:bg-app-hover hover:text-tx-primary transition-colors duration-press ease-out active:scale-[0.97]"
                      aria-label="关闭"
                    >
                      <X size={18} />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div
              className={cn(
                "flex-1 min-h-0 overflow-y-auto overscroll-contain",
                fullscreen && "overflow-hidden",
                bodyClassName,
              )}
              data-swipe-blocker
              data-sheet-scroll
              onPointerDown={dragFromContent ? tryStartDrag : undefined}
              style={dragFromContent ? { touchAction: "none" } : undefined}
            >
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default BottomSheet;
