/**
 * PR3: 移动端编辑器左缘右滑 → 返回笔记列表（跟手 + 阈值提交 / 回弹）
 *
 * 与侧栏边缘开抽屉互斥：本 hook 仅在编辑器可交互时生效；侧栏开抽屉应在
 * mobileView==="editor" 时禁用（见 App.tsx useSwipeGesture）。
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { haptic } from "@/hooks/useCapacitor";

const EDGE_PX = 28;
const COMMIT_RATIO = 0.28; // 屏宽 28% 或至少 72px
const COMMIT_MIN_PX = 72;
const MAX_Y_RATIO = 0.65;

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 767px)").matches;
}

function isSwipeBlocked(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return target.closest("[data-swipe-blocker]") !== null;
}

export function useEditorSwipeBack(options: {
  /** 是否启用（通常始终 true；父层 pointer-events 会挡住列表态） */
  enabled?: boolean;
  onBack: () => void;
}) {
  const { enabled = true, onBack } = options;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const [offsetX, setOffsetX] = useState(0);
  const [dragging, setDragging] = useState(false);

  const tracking = useRef(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"undecided" | "h" | "v">("undecided");
  const currentX = useRef(0);

  const reset = useCallback(() => {
    tracking.current = false;
    axis.current = "undecided";
    currentX.current = 0;
    setOffsetX(0);
    setDragging(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      reset();
      return;
    }

    const onStart = (e: TouchEvent) => {
      if (!isMobileViewport()) return;
      if (isSwipeBlocked(e.target)) {
        tracking.current = false;
        return;
      }
      const t = e.touches[0];
      if (t.clientX > EDGE_PX) {
        tracking.current = false;
        return;
      }
      tracking.current = true;
      axis.current = "undecided";
      startX.current = t.clientX;
      startY.current = t.clientY;
      currentX.current = 0;
      setDragging(true);
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking.current) return;
      const t = e.touches[0];
      const dx = t.clientX - startX.current;
      const dy = t.clientY - startY.current;

      if (axis.current === "undecided") {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis.current =
          Math.abs(dy) > Math.abs(dx) * MAX_Y_RATIO ? "v" : "h";
        if (axis.current === "v") {
          tracking.current = false;
          setDragging(false);
          setOffsetX(0);
          return;
        }
      }

      if (axis.current !== "h") return;

      // 只允许向右滑（返回）
      const next = Math.max(0, dx);
      currentX.current = next;
      setOffsetX(next);
      // 跟手时阻止纵向滚动
      if (next > 8 && e.cancelable) {
        e.preventDefault();
      }
    };

    const onEnd = () => {
      if (!tracking.current || axis.current !== "h") {
        reset();
        return;
      }
      const w = window.innerWidth || 375;
      const threshold = Math.max(COMMIT_MIN_PX, w * COMMIT_RATIO);
      const dx = currentX.current;

      if (dx >= threshold) {
        haptic.light();
        tracking.current = false;
        axis.current = "undecided";
        currentX.current = 0;
        setDragging(false);
        // 轻微跟手到底再切列表，观感更顺
        setOffsetX(Math.min(w, dx + 24));
        window.setTimeout(() => {
          onBackRef.current();
          setOffsetX(0);
        }, 120);
      } else {
        // 回弹
        setDragging(false);
        setOffsetX(0);
        tracking.current = false;
        axis.current = "undecided";
        currentX.current = 0;
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, reset]);

  return {
    offsetX,
    dragging,
    /** 绑到编辑器根节点 style */
    style: {
      transform: offsetX > 0 ? `translate3d(${offsetX}px, 0, 0)` : undefined,
      transition: dragging
        ? "none"
        : "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
      willChange: dragging || offsetX > 0 ? "transform" : undefined,
    } as CSSProperties,
    /** 跟手时左侧露出的列表遮罩提示（可选） */
    progress: typeof window !== "undefined" && window.innerWidth
      ? Math.min(1, offsetX / (window.innerWidth * COMMIT_RATIO || COMMIT_MIN_PX))
      : 0,
  };
}
