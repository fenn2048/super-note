/**
 * 桌面/通用页头（与 MobileChromeHeader 互补）
 * Page Contract：一级中心页顶栏优先用本组件或 MobileChromeHeader。
 *
 * 约定：
 *   - 移动端用 MobileChromeHeader（含 safe-area）
 *   - 桌面端用 PageHeader（可加 className="hidden md:flex"）
 *   - 需要双端同一套时：两处各渲染一份，或 PageHeader 加 `mdOnly`
 */
import React from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 左侧（如返回按钮） */
  leading?: React.ReactNode;
  /** 右侧操作 */
  actions?: React.ReactNode;
  /** 完全自定义中间区（覆盖 title/subtitle） */
  center?: React.ReactNode;
  className?: string;
  /** 无底边 */
  borderless?: boolean;
  /** sticky 吸顶 */
  sticky?: boolean;
  /** 仅桌面显示（默认 false = 始终显示，由调用方控制 md:hidden） */
  mdOnly?: boolean;
  /** 紧凑高度 */
  dense?: boolean;
}

export default function PageHeader({
  title,
  subtitle,
  leading,
  actions,
  center,
  className,
  borderless = false,
  sticky = false,
  mdOnly = false,
  dense = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "items-center gap-3 px-4 md:px-6 shrink-0 select-none",
        dense ? "py-2 min-h-[44px]" : "py-3 min-h-[52px]",
        "bg-app-bg/95 backdrop-blur-sm",
        !borderless && "border-b border-app-border",
        sticky && "sticky top-0 z-sticky",
        mdOnly ? "hidden md:flex" : "flex",
        className,
      )}
    >
      {leading && <div className="shrink-0 flex items-center">{leading}</div>}
      <div className="min-w-0 flex-1">
        {center ? (
          center
        ) : (
          <>
            <div className="text-[15px] md:text-base font-semibold text-tx-primary truncate">
              {title}
            </div>
            {subtitle && (
              <div className="text-xs text-tx-tertiary truncate mt-0.5">{subtitle}</div>
            )}
          </>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
      )}
    </header>
  );
}
