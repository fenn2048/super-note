/**
 * 栈页顶栏（Phase A）
 * ---------------------------------------------------------------------------
 * 用于资料库 / 设置子页等「沉浸可退」页面。
 * 移动端默认：左返回箭头 + 中间标题区 + 右侧操作（可选）。
 * 与底栏根页区分：栈页不显示 MobileTabBar / FAB。
 */
import React from "react";
import { ChevronLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";

export interface StackChromeProps {
  /** 主内容：标题文字，或 Tabs 等自定义节点（居中/左侧内容区） */
  children?: React.ReactNode;
  /** 返回/关闭回调 */
  onClose?: () => void;
  /** 返回按钮文案（aria） */
  closeLabel?: string;
  /**
   * 移动端主操作样式：
   *   - "back"：左向箭头（默认，符合「我的」子页规范）
   *   - "close"：右上 ×（旧行为，可选）
   */
  leadingAction?: "back" | "close";
  /** 桌面也显示关闭/返回钮 */
  showCloseOnDesktop?: boolean;
  /** 是否预留状态栏 safe-area（默认 true） */
  safeAreaTop?: boolean;
  className?: string;
  /** 右侧额外动作（在 × 左侧；back 模式下整块在右侧） */
  trailing?: React.ReactNode;
  /** 中间标题（字符串时居中显示；与 children 二选一优先 title） */
  title?: string;
}

export default function StackChrome({
  children,
  onClose,
  closeLabel = "返回",
  leadingAction = "back",
  showCloseOnDesktop = false,
  safeAreaTop = true,
  className,
  trailing,
  title,
}: StackChromeProps) {
  const handleClose = () => {
    haptic.light();
    onClose?.();
  };

  const backBtnClass = cn(
    "inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl shrink-0",
    "text-accent-primary hover:bg-app-hover active:bg-app-active",
    !showCloseOnDesktop && leadingAction === "close" && "md:hidden",
  );

  return (
    <div
      className={cn(
        "shrink-0 border-b border-app-border bg-app-surface/90 backdrop-blur-md px-2 md:px-4",
        className,
      )}
      style={
        safeAreaTop
          ? { paddingTop: "calc(var(--safe-area-top, 0px) + 8px)" }
          : undefined
      }
    >
      <div className="flex items-center gap-1 max-w-4xl min-h-[48px] pb-2 relative">
        {/* 左侧：返回箭头（默认） */}
        {onClose && leadingAction === "back" && (
          <button
            type="button"
            onClick={handleClose}
            className={cn(backBtnClass, "md:inline-flex")}
            title={closeLabel}
            aria-label={closeLabel}
          >
            <ChevronLeft size={24} />
          </button>
        )}

        {/* 中间：标题或自定义 children */}
        <div
          className={cn(
            "flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-hide",
            title && "justify-center absolute left-12 right-12 md:static md:justify-start",
          )}
        >
          {title ? (
            <h1 className="text-[15px] font-bold text-tx-primary truncate text-center md:text-left">
              {title}
            </h1>
          ) : (
            children
          )}
        </div>

        {/* 无 title 时 children 已在中间；桌面 Tabs 仍可走 children */}
        {title && children && (
          <div className="hidden md:flex flex-1 min-w-0 items-center gap-1 overflow-x-auto scrollbar-hide">
            {children}
          </div>
        )}

        {/* 右侧操作 */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {trailing}
          {onClose && leadingAction === "close" && (
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                "inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl",
                "text-tx-tertiary hover:text-tx-primary hover:bg-app-hover active:bg-app-active shrink-0",
                "border border-app-border/60 bg-app-elevated/80",
                !showCloseOnDesktop && "md:hidden",
              )}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <X size={18} />
            </button>
          )}
          {/* back 模式下右侧占位，保证标题视觉居中 */}
          {onClose && leadingAction === "back" && !trailing && (
            <div className="w-10 h-10 shrink-0 md:hidden" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}
