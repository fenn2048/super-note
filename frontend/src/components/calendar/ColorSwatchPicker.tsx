import React from "react";
import { cn } from "@/lib/utils";
import { TASK_COLOR_MAP } from "@/components/ProjectKanban";
import { CAL_COLOR_KEYS, DEFAULT_CAL_COLOR } from "./taskColors";

interface ColorSwatchPickerProps {
  value: string;
  onChange: (colorKey: string) => void;
  /** Optional: allow clearing color */
  allowNone?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export default function ColorSwatchPicker({
  value,
  onChange,
  allowNone = false,
  size = "md",
  className,
}: ColorSwatchPickerProps) {
  const dim = size === "sm" ? "w-5 h-5" : "w-6 h-6";

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {allowNone && (
        <button
          type="button"
          onClick={() => onChange("")}
          className={cn(
            dim,
            "rounded-full border border-app-border bg-app-bg flex items-center justify-center",
            "transition-[transform,box-shadow] duration-fast ease-out",
            !value && "ring-2 ring-accent-primary ring-offset-1 ring-offset-app-elevated",
            "[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110",
          )}
          title="默认"
          aria-label="默认颜色"
        >
          <span className="w-2 h-px bg-tx-tertiary rotate-45" />
        </button>
      )}
      {CAL_COLOR_KEYS.map((key) => {
        const info = TASK_COLOR_MAP[key];
        const selected = value === key || (!value && key === DEFAULT_CAL_COLOR && !allowNone);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              dim,
              "rounded-full border border-transparent shrink-0",
              "transition-[transform,box-shadow] duration-fast ease-out",
              selected && "ring-2 ring-accent-primary ring-offset-1 ring-offset-app-elevated",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110",
            )}
            style={{ backgroundColor: info.font }}
            title={key}
            aria-label={`颜色 ${key}`}
          />
        );
      })}
    </div>
  );
}
