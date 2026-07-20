import { cn } from "@/lib/utils";

interface VisibilityToggleProps {
  value: "PRIVATE" | "WORKSPACE";
  onChange: (v: "PRIVATE" | "WORKSPACE") => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

const LABELS = {
  PRIVATE: "私有",
  WORKSPACE: "所有人可见",
} as const;

const SHORT_LABELS = {
  PRIVATE: "私有",
  WORKSPACE: "公开",
} as const;

export default function VisibilityToggle({ value, onChange, disabled, size = "sm" }: VisibilityToggleProps) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-app-hover/50 p-0.5">
      <button
        type="button"
        disabled={disabled}
        title={LABELS.PRIVATE}
        aria-label={LABELS.PRIVATE}
        className={cn(
          "flex items-center gap-1 rounded-md text-xs font-medium transition-colors",
          size === "sm" ? "px-1.5 py-1" : "px-3 py-1.5",
          value === "PRIVATE"
            ? "bg-app-active text-tx-primary shadow-sm"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("PRIVATE")}
      >
        🔒
        <span className={cn(size === "sm" && "hidden md:inline")}>
          {size === "sm" ? SHORT_LABELS.PRIVATE : LABELS.PRIVATE}
        </span>
      </button>
      <button
        type="button"
        disabled={disabled}
        title={LABELS.WORKSPACE}
        aria-label={LABELS.WORKSPACE}
        className={cn(
          "flex items-center gap-1 rounded-md text-xs font-medium transition-colors",
          size === "sm" ? "px-1.5 py-1" : "px-3 py-1.5",
          value === "WORKSPACE"
            ? "bg-app-active text-tx-primary shadow-sm"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("WORKSPACE")}
      >
        🌐
        <span className={cn(size === "sm" && "hidden md:inline")}>
          {size === "sm" ? SHORT_LABELS.WORKSPACE : LABELS.WORKSPACE}
        </span>
      </button>
      {disabled && <span className="text-[10px] text-tx-tertiary px-1 whitespace-nowrap">锁定</span>}
    </div>
  );
}
