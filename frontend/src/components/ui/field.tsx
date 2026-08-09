/**
 * 表单字段：标签 + 控件，触控高度 ≥ 44px
 */
import React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hint?: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-tx-secondary">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-tx-tertiary leading-relaxed">{hint}</span> : null}
    </label>
  );
}

/** 健康/记账表单统一输入（min-h-11 触控） */
export const fieldControlClass =
  "min-h-11 w-full rounded-button border border-app-border bg-app-surface px-3 py-2 text-sm text-tx-primary " +
  "placeholder:text-tx-quaternary " +
  "transition-[border-color,box-shadow,background-color] duration-fast ease-out " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary/30 focus-visible:border-accent-primary/50 " +
  "disabled:opacity-50";

export function FieldInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      className={cn("min-h-11 h-11 bg-app-surface shadow-none", className)}
      {...props}
    />
  );
}

export function FieldTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn("min-h-[72px] bg-app-surface shadow-none text-sm", className)}
      {...props}
    />
  );
}

export function FieldSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldControlClass, className)} {...props}>
      {children}
    </select>
  );
}
