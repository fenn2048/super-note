/**
 * BottomSheet — iOS-style draggable sheet
 * ----------------------------------------------------------------------------
 * Fluid interaction (Apple WWDC → Web):
 *   1:1 drag · rubber-band past open edge · project + velocity handoff · interruptible spring
 *
 * Spec: DESIGN.md §13 · @/lib/motion
 *
 *   <BottomSheet open={open} onClose={close} title="标题">…</BottomSheet>
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
};

const DISMISS_FRACTION = 0.88;

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
}: BottomSheetProps) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const y = useMotionValue(0);
  const dragControls = useDragControls();
  const baseY = useRef(0);
  const snapIndex = useRef(initialSnap);
  const entered = useRef(false);

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

  useLayoutEffect(() => {
    if (!open) {
      entered.current = false;
      return;
    }
    const el = panelRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) setHeight(h);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, children, title]);

  // Enter animation once we know height
  useEffect(() => {
    if (!open || height <= 0) return;
    if (entered.current) return;
    entered.current = true;
    const snaps = resolveSnaps(height);
    const target = snaps[Math.min(initialSnap, snaps.length - 1)] ?? 0;
    if (reduce) {
      y.set(target);
      return;
    }
    y.set(height);
    const c = animate(y, target, springs.sheet);
    return () => c.stop();
  }, [open, height, initialSnap, reduce, resolveSnaps, y]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const dismiss = useCallback(
    (velocityY: number) => {
      const h = height || panelRef.current?.offsetHeight || window.innerHeight;
      if (reduce) {
        onClose();
        return;
      }
      const c = animate(y, h, springWithVelocity(springs.sheet, velocityY));
      c.then(() => onClose());
    },
    [height, onClose, reduce, y],
  );

  const onDragStart = useCallback(() => {
    baseY.current = y.get();
  }, [y]);

  const onDrag = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const h = height || panelRef.current?.offsetHeight || 1;
      const raw = baseY.current + info.offset.y;
      if (raw < 0) {
        y.set(rubberband(raw, h, 0.55));
      } else {
        y.set(Math.min(raw, h * 1.15));
      }
    },
    [height, y],
  );

  const onDragEnd = useCallback(
    (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      const h = height || panelRef.current?.offsetHeight || 1;
      const current = y.get();
      const velocityY = info.velocity.y;
      const projected = current + project(velocityY, 0.998);
      const snaps = resolveSnaps(h);
      const target = nearestSnap(projected, snaps);

      if (target >= h * DISMISS_FRACTION) {
        dismiss(velocityY);
        return;
      }

      const idx = snaps.findIndex((s) => Math.abs(s - target) < 1);
      if (idx >= 0) {
        snapIndex.current = idx;
        onSnapChange?.(idx);
      }
      animate(y, target, springWithVelocity(springs.momentum, velocityY));
    },
    [dismiss, height, onSnapChange, resolveSnaps, y],
  );

  if (typeof document === "undefined") return null;

  const label =
    ariaLabel || (typeof title === "string" ? title : "底部面板");

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 flex flex-col justify-end", zClassName)}>
          <motion.button
            type="button"
            aria-label="关闭"
            className={cn(
              "absolute inset-0 bg-black/45 backdrop-blur-[2px]",
              scrimClassName,
            )}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
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
              "relative w-full flex flex-col rounded-t-window",
              "border border-app-border border-b-0",
              "bg-app-card text-tx-primary shadow-xl",
              className,
            )}
            style={{
              maxHeight,
              y,
              paddingBottom:
                "max(0.5rem, var(--safe-area-bottom, env(safe-area-inset-bottom)))",
              willChange: "transform",
            }}
            initial={false}
            exit={
              reduce
                ? { opacity: 0 }
                : {
                    y: height || (typeof window !== "undefined" ? window.innerHeight : 800),
                    transition: springs.sheet,
                  }
            }
            drag={reduce ? false : "y"}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0}
            dragMomentum={false}
            onDragStart={onDragStart}
            onDrag={onDrag}
            onDragEnd={onDragEnd}
          >
            {/* Drag handle + header (starts drag) */}
            <div
              className="shrink-0 cursor-grab active:cursor-grabbing select-none"
              onPointerDown={(e) => {
                // Don't steal from interactive controls
                const t = e.target as HTMLElement;
                if (t.closest("button, a, input, textarea, select, [data-no-drag]")) return;
                dragControls.start(e);
              }}
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
                bodyClassName,
              )}
              data-swipe-blocker
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export default BottomSheet;
