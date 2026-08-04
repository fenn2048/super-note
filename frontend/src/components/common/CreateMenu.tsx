/**
 * 全局创建菜单（P2-6）
 * 固定：笔记 | 说说 | 任务 | 拍照（可选）
 * 按模块包隐藏未授权入口
 */
import React, { useEffect, useMemo } from "react";
import { BookOpen, NotebookPen, ListTodo, Camera, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { useModalFocusTrap } from "@/hooks/useModalFocusTrap";
import {
  filterCreateMenuItems,
  type CreateMenuAction,
} from "@/lib/createMenuItems";
import { getModulePack } from "@/lib/modulePack";
import { springs } from "@/lib/motion";

export type { CreateMenuAction };

export interface CreateMenuProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: CreateMenuAction) => void;
  /** 桌面浮层定位；移动端可忽略 */
  className?: string;
  showCamera?: boolean;
}

const ICONS: Record<CreateMenuAction, React.ReactNode> = {
  note: <BookOpen size={16} aria-hidden />,
  diary: <NotebookPen size={16} aria-hidden />,
  task: <ListTodo size={16} aria-hidden />,
  camera: <Camera size={16} aria-hidden />,
};

const TONES: Record<CreateMenuAction, string> = {
  note: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  diary: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  task: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  camera: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
};

export default function CreateMenu({
  open,
  onClose,
  onAction,
  className,
  showCamera = true,
}: CreateMenuProps) {
  const [packTick, setPackTick] = React.useState(0);
  useEffect(() => {
    const onPack = () => setPackTick((n) => n + 1);
    window.addEventListener("super:module-pack-changed", onPack);
    return () => window.removeEventListener("super:module-pack-changed", onPack);
  }, []);

  const items = useMemo(() => {
    void packTick;
    return filterCreateMenuItems({
      showCamera,
      pack: getModulePack(),
    });
  }, [showCamera, packTick]);

  const trapRef = useModalFocusTrap(open, onClose);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={trapRef as React.RefObject<HTMLDivElement>}
            role="menu"
            aria-label="快速创建"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 8 }}
            className={cn(
              "z-50 w-56 rounded-2xl border border-app-border bg-app-elevated shadow-xl p-2",
              // 默认 fixed（移动 FAB）；桌面 Rail 传入 absolute 锚在按钮旁
              className?.includes("absolute") ? "absolute" : "fixed",
              className,
            )}
          >
            <div className="flex items-center justify-between px-2 py-1.5 mb-1">
              <span className="text-xs font-semibold text-tx-tertiary">快速创建</span>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-tx-tertiary hover:bg-app-hover"
                aria-label="关闭创建菜单"
              >
                <X size={14} aria-hidden />
              </button>
            </div>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                onClick={() => {
                  onAction(item.key);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-tx-primary hover:bg-app-hover transition-colors"
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    TONES[item.key],
                  )}
                >
                  {ICONS[item.key]}
                </span>
                {item.label}
              </button>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * 全局创建 FAB
 * - 移动：默认 56px
 * - 桌面：更大圆形 + hover 果冻弹跳（jelly）
 */
export function CreateFabButton({
  onClick,
  className,
  size = "md",
  jelly = false,
  open = false,
  onPointerDown,
  style,
  dragging = false,
}: {
  onClick: () => void;
  className?: string;
  /** md=56px（移动），lg=72px（桌面常驻大圆） */
  size?: "md" | "lg";
  /** 桌面 hover 果冻弹性 */
  jelly?: boolean;
  /** 菜单打开时旋转为 × 感（可选） */
  open?: boolean;
  onPointerDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  style?: React.CSSProperties;
  /** 拖拽中禁用 hover/tap 缩放，避免跟手位移打架 */
  dragging?: boolean;
}) {
  const dim = size === "lg" ? "w-[4.5rem] h-[4.5rem]" : "w-14 h-14";
  const icon = size === "lg" ? 34 : 28;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      aria-label="快速创建"
      aria-expanded={open}
      title="快速创建 (Alt+C) · 长按拖动"
      aria-keyshortcuts="Alt+C"
      className={cn(
        dim,
        "rounded-full flex items-center justify-center touch-none select-none",
        "btn-primary-glow text-white shadow-fab",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg",
        dragging && "cursor-grabbing",
        className,
      )}
      // 果冻：低阻尼弹簧 + 轻 squash/stretch，hover 时 Q 弹回弹
      whileHover={
        dragging
          ? undefined
          : jelly
            ? {
                scale: 1.16,
                transition: springs.momentum,
              }
            : { scale: 1.05 }
      }
      whileTap={
        dragging
          ? undefined
          : jelly
            ? {
                scale: 0.88,
                transition: springs.snappy,
              }
            : { scale: 0.9 }
      }
      // 静止时也带一点弹簧回正，离开 hover 更有果冻感
      transition={
        jelly
          ? springs.momentum
          : springs.snappy
      }
      style={{
        willChange: jelly || dragging ? "transform" : undefined,
        transformOrigin: "center",
        touchAction: "none",
        ...style,
      }}
    >
      <motion.span
        animate={{ rotate: open ? 45 : 0 }}
        transition={springs.snappy}
        className="flex items-center justify-center pointer-events-none"
      >
        <Plus size={icon} strokeWidth={2.5} aria-hidden />
      </motion.span>
    </motion.button>
  );
}

/* -------------------------------------------------------------------------- */
/* 可拖拽 FAB 锚点：自由移动 + localStorage 记忆位置                            */
/* -------------------------------------------------------------------------- */

const FAB_DRAG_THRESHOLD = 8; // px：超过才算拖，否则当点击
const FAB_EDGE_PAD = 12;

type FabPos = { left: number; top: number };

function readFabPos(key: string): FabPos | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FabPos>;
    if (
      typeof parsed.left === "number" &&
      typeof parsed.top === "number" &&
      Number.isFinite(parsed.left) &&
      Number.isFinite(parsed.top)
    ) {
      return { left: parsed.left, top: parsed.top };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeFabPos(key: string, pos: FabPos) {
  try {
    localStorage.setItem(key, JSON.stringify(pos));
  } catch {
    /* ignore */
  }
}

function clampFabPos(
  left: number,
  top: number,
  size: number,
  viewportW: number,
  viewportH: number,
): FabPos {
  const maxL = Math.max(FAB_EDGE_PAD, viewportW - size - FAB_EDGE_PAD);
  const maxT = Math.max(FAB_EDGE_PAD, viewportH - size - FAB_EDGE_PAD);
  return {
    left: Math.min(maxL, Math.max(FAB_EDGE_PAD, left)),
    top: Math.min(maxT, Math.max(FAB_EDGE_PAD, top)),
  };
}

function defaultFabPos(size: number, variant: "mobile" | "desktop"): FabPos {
  if (typeof window === "undefined") {
    return { left: 0, top: 0 };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rightPad = 16;
  // 移动：默认贴 Tab 栏上方（与 --mobile-fab-bottom 近似）；桌面 bottom-6
  let bottomPad = 24;
  if (variant === "mobile") {
    const css = getComputedStyle(document.documentElement)
      .getPropertyValue("--mobile-fab-bottom")
      .trim();
    const parsed = css ? Number.parseFloat(css) : NaN;
    bottomPad = Number.isFinite(parsed) ? parsed : 88;
  }
  return clampFabPos(
    vw - size - rightPad,
    vh - size - bottomPad,
    size,
    vw,
    vh,
  );
}

export type DraggableFabAnchorProps = {
  /** localStorage 键，移动/桌面分开记 */
  storageKey: string;
  /** 按钮边长 px */
  sizePx: number;
  variant: "mobile" | "desktop";
  /** 滚动隐栏时隐藏视觉（移动） */
  visuallyHidden?: boolean;
  className?: string;
  children: (api: {
    pos: FabPos;
    dragging: boolean;
    onFabPointerDown: (e: React.PointerEvent) => void;
    /** 未发生拖动时调用；已拖动则 no-op（吞掉松手 click） */
    onFabClick: () => void;
  }) => React.ReactNode;
  /** 点击 FAB（未拖动时） */
  onClick: () => void;
};

/**
 * 可拖拽 FAB 外壳。
 * - 1:1 跟手；越界时 clamp 回安全区
 * - 位移 &lt; 阈值视为点击
 * - 位置写入 localStorage，刷新后保留
 */
export function DraggableFabAnchor({
  storageKey,
  sizePx,
  variant,
  visuallyHidden = false,
  className,
  children,
  onClick,
}: DraggableFabAnchorProps) {
  const [pos, setPos] = React.useState<FabPos>(() => {
    if (typeof window === "undefined") return { left: 0, top: 0 };
    const saved = readFabPos(storageKey);
    return saved
      ? clampFabPos(saved.left, saved.top, sizePx, window.innerWidth, window.innerHeight)
      : defaultFabPos(sizePx, variant);
  });
  const [dragging, setDragging] = React.useState(false);
  const dragRef = React.useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);
  // 拖过之后吞掉紧随的 click，避免松手误开菜单
  const suppressClickRef = React.useRef(false);
  const posRef = React.useRef(pos);
  posRef.current = pos;

  // 窗口变化时把 FAB 夹回视口
  React.useEffect(() => {
    const onResize = () => {
      setPos((p) =>
        clampFabPos(p.left, p.top, sizePx, window.innerWidth, window.innerHeight),
      );
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [sizePx]);

  // 首次挂载：若无记忆位置，用默认角；有记忆则已 clamp
  React.useEffect(() => {
    const saved = readFabPos(storageKey);
    if (!saved) {
      setPos(defaultFabPos(sizePx, variant));
    }
  }, [storageKey, sizePx, variant]);

  const onFabPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      // 不 preventDefault 整按钮，否则部分浏览器点不了；
      // touch-action:none 已挡住滚动
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture?.(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: posRef.current.left,
        originTop: posRef.current.top,
        moved: false,
      };
      suppressClickRef.current = false;

      const onMove = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== ev.pointerId) return;
        const dx = ev.clientX - d.startX;
        const dy = ev.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) >= FAB_DRAG_THRESHOLD) {
          d.moved = true;
          setDragging(true);
        }
        if (!d.moved) return;
        ev.preventDefault();
        setPos(
          clampFabPos(
            d.originLeft + dx,
            d.originTop + dy,
            sizePx,
            window.innerWidth,
            window.innerHeight,
          ),
        );
      };

      const onUp = (ev: PointerEvent) => {
        const d = dragRef.current;
        if (!d || d.pointerId !== ev.pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        try {
          el.releasePointerCapture?.(ev.pointerId);
        } catch {
          /* ignore */
        }
        if (d.moved) {
          suppressClickRef.current = true;
          const next = clampFabPos(
            posRef.current.left,
            posRef.current.top,
            sizePx,
            window.innerWidth,
            window.innerHeight,
          );
          setPos(next);
          writeFabPos(storageKey, next);
        }
        dragRef.current = null;
        setDragging(false);
      };

      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [sizePx, storageKey],
  );

  const onFabClick = React.useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick();
  }, [onClick]);

  return (
    <div
      className={cn(
        "fixed z-rail-fab flex flex-col items-end gap-3",
        "transition-[opacity,transform] duration-panel ease-out",
        visuallyHidden
          ? "opacity-0 translate-y-4 pointer-events-none"
          : "opacity-100 translate-y-0 pointer-events-auto",
        dragging && "z-[80]",
        className,
      )}
      style={{
        left: pos.left,
        top: pos.top,
        // 菜单在按钮上方展开，锚点以按钮左上角为准；菜单 absolute bottom-full
        width: sizePx,
      }}
    >
      {children({
        pos,
        dragging,
        onFabPointerDown,
        onFabClick,
      })}
    </div>
  );
}
