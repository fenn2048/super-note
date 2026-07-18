/**
 * 全局创建菜单（P2-6）
 * 固定：笔记 | 说说 | 任务 | 拍照（可选）
 */
import React, { useEffect, useRef } from "react";
import { BookOpen, NotebookPen, ListTodo, Camera, Plus, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

export type CreateMenuAction = "note" | "diary" | "task" | "camera";

export interface CreateMenuProps {
  open: boolean;
  onClose: () => void;
  onAction: (action: CreateMenuAction) => void;
  /** 桌面浮层定位；移动端可忽略 */
  className?: string;
  showCamera?: boolean;
}

const ITEMS: Array<{
  key: CreateMenuAction;
  label: string;
  icon: React.ReactNode;
  tone: string;
}> = [
  {
    key: "note",
    label: "新建笔记",
    icon: <BookOpen size={16} />,
    tone: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  },
  {
    key: "diary",
    label: "写说说",
    icon: <NotebookPen size={16} />,
    tone: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  },
  {
    key: "task",
    label: "新建任务",
    icon: <ListTodo size={16} />,
    tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  },
  {
    key: "camera",
    label: "拍照",
    icon: <Camera size={16} />,
    tone: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  },
];

export default function CreateMenu({
  open,
  onClose,
  onAction,
  className,
  showCamera = true,
}: CreateMenuProps) {
  const items = showCamera ? ITEMS : ITEMS.filter((i) => i.key !== "camera");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
          />
          <motion.div
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
              >
                <X size={14} />
              </button>
            </div>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  onAction(item.key);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-tx-primary hover:bg-app-hover transition-colors"
              >
                <span
                  className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                    item.tone,
                  )}
                >
                  {item.icon}
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
      <Plus size={28} />
    </button>
  );
}
