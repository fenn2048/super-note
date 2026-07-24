/**
 * 移动端统一顶栏（PR1）
 *
 * 变体：
 *   - root：左汉堡（开抽屉）+ 标题 + 右侧动作
 *   - stack：左返回/关闭 + 标题 + 右侧动作
 *   - bare：无左侧按钮，仅标题 + 右侧（特殊全屏页）
 *
 * 所有 md:hidden 主流程顶栏应优先用本组件，避免汉堡/返回/safe-area 各写一套。
 */
import React from "react";
import { ChevronLeft, Menu, X } from "lucide-react";
import { useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";

export type MobileChromeVariant = "root" | "stack" | "bare";

export interface MobileChromeHeaderProps {
  /** 主标题；也可传 ReactNode（如带 icon 的标题） */
  title?: React.ReactNode;
  /** 副标题（可选，显示在标题下方） */
  subtitle?: React.ReactNode;
  variant?: MobileChromeVariant;
  /**
   * stack 变体左侧按钮：
   *   - "back"：ChevronLeft（默认）
   *   - "close"：X
   */
  stackAction?: "back" | "close";
  /** stack/bare 时左侧/返回回调；root 默认开侧栏，也可覆盖 */
  onLeadingClick?: () => void;
  /** 右侧动作区 */
  right?: React.ReactNode;
  /** 中间区域完全自定义时使用（覆盖 title/subtitle） */
  center?: React.ReactNode;
  /**
   * 滚动隐栏：false 时用高度折叠动画藏起
   * （由 super:scroll-hide-bars 等驱动）
   */
  visible?: boolean;
  /** 额外 class（挂在 header 上） */
  className?: string;
  /** 无底边框 */
  borderless?: boolean;
  /** leading 按钮 aria/title */
  leadingLabel?: string;
}

const btnClass =
  "inline-flex items-center justify-center min-w-[44px] min-h-[44px] -ml-1.5 rounded-button text-tx-secondary hover:bg-app-hover active:bg-app-active transition-colors shrink-0";

export default function MobileChromeHeader({
  title,
  subtitle,
  variant = "root",
  stackAction = "back",
  onLeadingClick,
  right,
  center,
  visible = true,
  className,
  borderless = false,
  leadingLabel,
}: MobileChromeHeaderProps) {
  const actions = useAppActions();

  const handleLeading = () => {
    haptic.light();
    if (onLeadingClick) {
      onLeadingClick();
      return;
    }
    if (variant === "root") {
      actions.setMobileSidebar(true);
    }
  };

  const leadingIcon =
    variant === "root" ? (
      <Menu size={22} />
    ) : stackAction === "close" ? (
      <X size={20} />
    ) : (
      <ChevronLeft size={24} />
    );

  const defaultLeadingLabel =
    variant === "root"
      ? "打开菜单"
      : stackAction === "close"
        ? "关闭"
        : "返回";

  return (
    <header
      data-mobile-chrome-header
      className={cn(
        "md:hidden shrink-0 select-none z-40",
        "flex items-center gap-1 px-3 sm:px-4",
        "bg-app-elevated/70 backdrop-blur-md",
        !borderless && "border-b border-app-border/60",
        "transition-all duration-300 ease-soft overflow-hidden",
        visible
          ? "min-h-[52px] opacity-100 py-1.5"
          : "h-0 min-h-0 max-h-0 opacity-0 py-0 pointer-events-none border-0",
        className
      )}
      style={{ paddingTop: visible ? "calc(var(--safe-area-top) + 4px)" : 0 }}
    >
      {variant !== "bare" && (
        <button
          type="button"
          onClick={handleLeading}
          className={cn(
            btnClass,
            variant === "stack" && stackAction === "back" && "text-accent-primary"
          )}
          title={leadingLabel || defaultLeadingLabel}
          aria-label={leadingLabel || defaultLeadingLabel}
        >
          {leadingIcon}
        </button>
      )}

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        {center ? (
          center
        ) : (
          <>
            {title != null &&
              (typeof title === "string" || typeof title === "number" ? (
                <h1 className="text-[15px] font-bold text-tx-primary tracking-tight truncate leading-tight">
                  {title}
                </h1>
              ) : (
                <div className="min-w-0 truncate">{title}</div>
              ))}
            {subtitle != null && (
              <div className="text-[11px] text-tx-tertiary truncate leading-snug mt-0.5">
                {subtitle}
              </div>
            )}
          </>
        )}
      </div>

      {right != null && (
        <div className="flex items-center gap-0.5 shrink-0 min-h-[44px]">{right}</div>
      )}
    </header>
  );
}

/** 顶栏右侧统一图标按钮样式（约 40–44px 触控） */
export const MobileChromeIconButton = React.forwardRef<
  HTMLButtonElement,
  {
    onClick?: () => void;
    title?: string;
    children: React.ReactNode;
    active?: boolean;
    className?: string;
  }
>(function MobileChromeIconButton(
  { onClick, title, children, active = false, className },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-button transition-colors relative",
        active
          ? "text-accent-primary bg-accent-primary/10"
          : "text-tx-tertiary hover:bg-app-hover hover:text-tx-secondary",
        className
      )}
    >
      {children}
    </button>
  );
});
