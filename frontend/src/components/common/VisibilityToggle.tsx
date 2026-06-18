import { cn } from "@/lib/utils";

interface VisibilityToggleProps {
  value: "PRIVATE" | "WORKSPACE";
  onChange: (v: "PRIVATE" | "WORKSPACE") => void;
  disabled?: boolean;
  size?: "sm" | "md";
}

export default function VisibilityToggle({ value, onChange, disabled, size = "sm" }: VisibilityToggleProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-app-hover/50 p-0.5">
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 rounded-md text-xs font-medium transition-colors",
          size === "sm" ? "px-2 py-1" : "px-3 py-1.5",
          value === "PRIVATE"
            ? "bg-app-active text-tx-primary shadow-sm"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("PRIVATE")}
      >
        🔒 {size === "sm" ? "" : "仅自己可见"}
      </button>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          "flex items-center gap-1 rounded-md text-xs font-medium transition-colors",
          size === "sm" ? "px-2 py-1" : "px-3 py-1.5",
          value === "WORKSPACE"
            ? "bg-app-active text-tx-primary shadow-sm"
            : "text-tx-tertiary hover:text-tx-secondary"
        )}
        onClick={() => onChange("WORKSPACE")}
      >
        🌐 {size === "sm" ? "" : "所有人可见"}
      </button>
      {disabled && <span className="text-[10px] text-tx-tertiary px-1">仅创建者可改</span>}
    </div>
  );
}
