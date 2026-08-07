/**
 * 健康模块视觉 token（语义色，避免 emerald/sky 字面量）
 */
import { cn } from "@/lib/utils";

/** 处方 → 药箱预填（sessionStorage） */
export const HEALTH_MED_PREFILL_KEY = "super:health-med-prefill";

export function medicineSystemBadgeClass(sys?: string | null) {
  switch (sys) {
    case "tcm":
      return "bg-accent-primary/12 text-accent-primary";
    case "western":
      return "bg-accent-primary/10 text-tx-secondary ring-1 ring-accent-primary/20";
    case "integrated":
      return "bg-app-elevated text-tx-primary ring-1 ring-app-border";
    default:
      return "bg-app-elevated text-tx-tertiary";
  }
}

export function recordStatusBadgeClass(status?: string | null) {
  switch (status) {
    case "ongoing":
      return "bg-accent-warning/15 text-accent-warning";
    case "recovered":
      return "bg-accent-primary/12 text-accent-primary";
    case "chronic":
      return "bg-app-elevated text-tx-secondary ring-1 ring-app-border";
    default:
      return "bg-app-elevated text-tx-tertiary";
  }
}

export function expiryBadgeClass(kind: "ok" | "soon" | "expired" | "none") {
  if (kind === "expired") return "bg-accent-danger/15 text-accent-danger";
  if (kind === "soon") return "bg-accent-warning/15 text-accent-warning";
  return "text-tx-tertiary";
}

export function expiryCardBorderClass(kind: "ok" | "soon" | "expired" | "none") {
  if (kind === "expired") return "border-accent-danger/40";
  if (kind === "soon") return "border-accent-warning/40";
  return "border-app-border";
}

export function segmentBtnClass(active: boolean) {
  return cn(
    "min-h-11 px-3 rounded-button text-xs font-medium",
    "transition-[background-color,color,box-shadow,transform] duration-fast ease-out",
    "active:scale-[0.97]",
    active
      ? "bg-accent-primary text-white shadow-accent"
      : "bg-app-surface border border-app-border text-tx-secondary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
  );
}
