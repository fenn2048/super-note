/**
 * 通用居中弹窗（从 WorkspaceSwitcher 抽出，避免 MembersPanel 循环依赖）
 * Motion: DESIGN.md §11–12 / springs.modal + fadeScaleIn
 */
import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

export function AppModal({
  title,
  children,
  onClose,
  widthClass = "max-w-md",
  heightClass,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  widthClass?: string;
  /**
   * 可选高度约束。如 "h-[80vh]" / "max-h-[80vh]"。
   * 设置后 body 区域 flex-1 + min-h-0 内部滚动。
   */
  heightClass?: string;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/45 backdrop-blur-[1px] p-4"
      onClick={onClose}
      role="presentation"
    >
      <Motion.div
        variants={variants.fadeScaleIn}
        initial="initial"
        animate="animate"
        exit="exit"
        transition={springs.modal}
        className={cn(
          // 使用 app-card 实体底 + app token，避免半透明 / 循环依赖导致「空白弹窗」
          "bg-app-card text-tx-primary border border-app-border rounded-window shadow-xl w-full flex flex-col overflow-hidden",
          widthClass,
          heightClass,
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={title}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0 bg-app-card">
          <h3 className="font-semibold text-tx-primary truncate pr-2">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg min-h-[44px] min-w-[44px] inline-flex items-center justify-center transition-colors duration-press ease-out hover:bg-app-hover text-tx-secondary shrink-0 active:scale-[0.97]"
            aria-label={t("common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 flex-1 min-h-0 overflow-auto text-tx-primary bg-app-card">{children}</div>
      </Motion.div>
    </div>,
    document.body,
  );
}

/** @deprecated 使用 AppModal；保留别名兼容旧 import */
export const Modal = AppModal;
