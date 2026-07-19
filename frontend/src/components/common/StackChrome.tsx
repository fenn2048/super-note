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
        "shrink-0 border-b border-app-border bg-app-surface/90 backdrop-blur-md px-3 md:px-4",
        className,
      )}
      style={
        safeAreaTop
          ? { paddingTop: "calc(var(--safe-area-top, 0px) + 8px)" }
          : undefined
      }
    >
      <div className="flex items-center gap-2 max-w-4xl min-h-[48px] pb-2">
        <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-hide">
          {children}
        </div>
        {trailing}
        {onClose && (
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
      </div>
    </div>
  );
}
