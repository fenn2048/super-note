/**
 * 四象限选择：重要 × 紧急
 * compact = 迷你四宫格（quick-add）；默认完整 2×2 + 清除
 */
import React from "react";
import { cn } from "@/lib/utils";
import {
  QUADRANT_META,
  QUADRANT_ORDER,
  getQuadrant,
  quadrantToFlags,
  type QuadrantFlags,
  type QuadrantId,
} from "@/lib/taskQuadrant";

type Props = {
  isImportant?: unknown;
  isUrgent?: unknown;
  onChange: (flags: QuadrantFlags) => void;
  /** 迷你四宫格（快速创建） */
  compact?: boolean;
  className?: string;
  /** 是否显示「清除归类」 */
  allowClear?: boolean;
};

export default function QuadrantPicker({
  isImportant,
  isUrgent,
  onChange,
  compact = false,
  className,
  allowClear = true,
}: Props) {
  const current = getQuadrant(isImportant, isUrgent);

  const select = (q: QuadrantId | null) => {
    if (q === null) {
      onChange({ isImportant: null, isUrgent: null });
      return;
    }
    // 再次点击同一象限 → 清除
    if (current === q && allowClear) {
      onChange({ isImportant: null, isUrgent: null });
      return;
    }
    onChange(quadrantToFlags(q));
  };

  if (compact) {
    return (
      <div
        className={cn("inline-flex items-center gap-1 shrink-0", className)}
        role="group"
        aria-label="四象限"
      >
        {QUADRANT_ORDER.map((id) => {
          const m = QUADRANT_META[id];
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              title={`${m.shortLabel} · ${m.label}`}
              onClick={() => select(id)}
              className={cn(
                "px-2 py-1 rounded-lg border text-[10px] font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-press ease-out active:scale-[0.97] min-h-8",
                active ? m.cellActiveClass : cn("bg-app-sidebar/40", m.cellClass),
              )}
            >
              {m.shortLabel}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="grid grid-cols-2 gap-2">
        {QUADRANT_ORDER.map((id) => {
          const m = QUADRANT_META[id];
          const active = current === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              className={cn(
                "text-left rounded-xl border px-3 py-2.5 min-h-11 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-press ease-out active:scale-[0.98]",
                active ? m.cellActiveClass : cn("bg-app-sidebar/30", m.cellClass),
              )}
            >
              <span className="block text-xs font-bold leading-tight">{m.shortLabel}</span>
              <span className="block text-[10px] font-medium opacity-80 mt-0.5">{m.label}</span>
              <span className="block text-[10px] text-tx-tertiary mt-0.5 font-normal">{m.hint}</span>
            </button>
          );
        })}
      </div>
      {allowClear && current && (
        <button
          type="button"
          onClick={() => select(null)}
          className="text-[11px] text-tx-tertiary hover:text-tx-secondary transition-colors duration-press ease-out"
        >
          清除归类
        </button>
      )}
      <p className="text-[10px] text-tx-tertiary leading-snug">
        重要看价值，紧急看时间 · 可选，创建时可不选
      </p>
    </div>
  );
}

/** 列表用小徽章 */
export function QuadrantBadge({
  isImportant,
  isUrgent,
  className,
  onClick,
}: {
  isImportant?: unknown;
  isUrgent?: unknown;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const q = getQuadrant(isImportant, isUrgent);
  if (!q) {
    if (!onClick) return null;
    return (
      <button
        type="button"
        onClick={onClick}
        title="设置四象限"
        className={cn(
          "px-1.5 py-0.5 rounded-md border border-dashed border-app-border/60 text-[10px] font-medium text-tx-quaternary hover:text-tx-tertiary hover:border-app-border transition-colors duration-press ease-out",
          className,
        )}
      >
        归类
      </button>
    );
  }
  const m = QUADRANT_META[q];
  const Comp = onClick ? "button" : "span";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      title={`${m.shortLabel} · ${m.label}`}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-semibold shrink-0",
        m.badgeClass,
        onClick && "cursor-pointer active:scale-[0.97] transition-transform duration-press ease-out",
        className,
      )}
    >
      {m.shortLabel}
    </Comp>
  );
}
