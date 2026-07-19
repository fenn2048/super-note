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

/** 主 FAB 按钮（移动端），单击打开 CreateMenu */
export function CreateFabButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-14 h-14 rounded-full bg-accent-primary text-white shadow-lg shadow-accent-primary/30 flex items-center justify-center active:scale-95 transition-transform",
        className,
      )}
      aria-label="快速创建"
    >
      <Plus size={28} aria-hidden />
    </button>
  );
}
