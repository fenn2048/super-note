/**
 * 全站反馈态（Phase D）
 * ---------------------------------------------------------------------------
 * EmptyState / LoadingBlock / ErrorBanner — 统一空、载、错视觉，避免各中心各写一套。
 */
import React from "react";
import { Loader2, AlertCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Motion } from "@/components/common/Motion";
import { springs, variants } from "@/lib/motion";

// ── Loading ──────────────────────────────────────────────────────────────

export function LoadingBlock({
  label = "加载中…",
  className,
  size = "md",
}: {
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const icon = size === "sm" ? 18 : 24;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2.5 py-12 px-4 text-tx-tertiary",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2
        size={icon}
        className="animate-spin text-accent-primary"
        aria-hidden
      />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

// ── Empty ────────────────────────────────────────────────────────────────

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Motion.div
      className={cn(
        "flex flex-col items-center justify-center py-14 px-6 text-center",
        className,
      )}
      role="status"
      variants={variants.listStagger}
      initial="initial"
      animate="animate"
    >
      {Icon && (
        <Motion.div
          variants={variants.listItemIn}
          transition={springs.snappy}
          className="w-14 h-14 rounded-2xl bg-accent-primary/10 border border-accent-primary/15 flex items-center justify-center mb-4"
          aria-hidden
        >
          <Icon size={28} className="text-accent-primary/75" />
        </Motion.div>
      )}
      <Motion.p
        variants={variants.listItemIn}
        transition={springs.snappy}
        className="text-sm font-semibold text-tx-primary mb-1"
      >
        {title}
      </Motion.p>
      {description && (
        <Motion.p
          variants={variants.listItemIn}
          transition={springs.snappy}
          className="text-xs text-tx-tertiary max-w-[260px] leading-relaxed mb-1"
        >
          {description}
        </Motion.p>
      )}
      {action && (
        <Motion.div variants={variants.listItemIn} transition={springs.snappy} className="mt-4">
          {action}
        </Motion.div>
      )}
    </Motion.div>
  );
}

// ── Error ────────────────────────────────────────────────────────────────

export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 px-3.5 py-3 rounded-xl",
        "bg-accent-danger/10 border border-accent-danger/20 text-sm",
        className,
      )}
      role="alert"
    >
      <AlertCircle
        size={16}
        className="text-accent-danger shrink-0 mt-0.5"
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <p className="text-tx-primary text-sm leading-snug">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-xs font-semibold text-accent-primary hover:underline min-h-[32px]"
          >
            重试
          </button>
        )}
      </div>
    </div>
  );
}

/** 主 CTA 按钮样式（空态用） */
export function EmptyActionButton({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 h-11 px-5 rounded-xl",
        "bg-accent-primary text-white text-sm font-semibold shadow-sm",
        "active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-accent-primary/40 focus-visible:ring-offset-2",
        "focus-visible:ring-offset-app-bg disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}
