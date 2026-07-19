/**
 * 栈页顶栏（Phase A）
 * ---------------------------------------------------------------------------
 * 用于资料库 / 设置子页等「沉浸可退」页面：
 *   - 移动端：右上 × 关闭（返回上一页）
 *   - 桌面：可选关闭或仅展示标题/Tabs
 * 与底栏根页区分：栈页不显示 MobileTabBar / FAB。
 */
import React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";

export interface StackChromeProps {
  /** 主内容：标题文字，或 Tabs 等自定义节点 */
  children?: React.ReactNode;
  /** 关闭回调（移动端 ×；桌面也可显示） */
  onClose?: () => void;
  /** 关闭按钮文案 */
  closeLabel?: string;
  /** 桌面也显示关闭钮 */
  showCloseOnDesktop?: boolean;
  /** 是否预留状态栏 safe-area（默认 true） */
  safeAreaTop?: boolean;
  className?: string;
  /** 右侧额外动作（在 × 左侧） */
  trailing?: React.ReactNode;
}

export default function StackChrome({
  children,
  onClose,
  closeLabel = "关闭",
  showCloseOnDesktop = false,
  safeAreaTop = true,
  className,
  trailing,
}: StackChromeProps) {
  const handleClose = () => {
    haptic.light();
    onClose?.();
  };

  return (
    <div
      className={cn(
        "shrink-0 border-b border-app-border bg-app-surface/80 backdrop-blur-sm px-2 md:px-4 pb-0",
        className,
      )}
      style={
        safeAreaTop
          ? { paddingTop: "calc(var(--safe-area-top, 0px) + 6px)" }
          : undefined
      }
    >
      <div className="flex items-center gap-0.5 md:gap-1 max-w-3xl min-h-[40px]">
        <div className="flex-1 min-w-0 flex items-center gap-0.5 md:gap-1">
          {children}
        </div>
        {trailing}
        {onClose && (
          <button
            type="button"
            onClick={handleClose}
            className={cn(
              "inline-flex items-center justify-center min-w-[36px] min-h-[36px] rounded-lg",
              "text-tx-tertiary hover:text-tx-primary hover:bg-app-hover active:bg-app-active shrink-0",
              !showCloseOnDesktop && "md:hidden",
            )}
            title={closeLabel}
            aria-label={closeLabel}
          >
            <X size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
