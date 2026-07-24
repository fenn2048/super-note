/**
 * 可搜索账户选择器（导入 / 记一笔共用）
 * - 按类型分组 + 关键词过滤
 * - 支持叶子中文名与完整路径匹配
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { FinanceAccount } from "@/types";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  ASSETS: "资产",
  LIABILITIES: "负债",
  INCOME: "收入",
  EXPENSES: "支出",
  EQUITY: "权益",
};

function shortName(name: string) {
  const parts = name.split(":");
  return parts[parts.length - 1] || name;
}

function groupKey(name: string, type: string) {
  const parts = name.split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return type;
}

export default function AccountPicker({
  accounts,
  value,
  onChange,
  placeholder = "选择账户",
  allowEmpty = true,
  emptyLabel = "不指定",
  className,
  disabled,
}: {
  accounts: FinanceAccount[];
  value: string;
  onChange: (accountId: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => accounts.find((a) => a.id === value) || null,
    [accounts, value],
  );

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const list = !kw
      ? accounts
      : accounts.filter((a) => {
          const n = a.name.toLowerCase();
          const s = shortName(a.name).toLowerCase();
          return n.includes(kw) || s.includes(kw) || (a.type || "").toLowerCase().includes(kw);
        });
    return list;
  }, [accounts, q]);

  const groups = useMemo(() => {
    const map = new Map<string, FinanceAccount[]>();
    for (const a of filtered) {
      const g = `${TYPE_LABEL[a.type] || a.type} · ${groupKey(a.name, a.type)}`;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(a);
    }
    return [...map.entries()];
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-1 px-2 py-1.5 rounded-lg border border-app-border bg-app-bg text-left text-sm",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className={cn("flex-1 min-w-0 truncate", !selected && "text-tx-tertiary")}>
          {selected ? shortName(selected.name) : placeholder}
        </span>
        {value && allowEmpty && (
          <span
            role="button"
            tabIndex={-1}
            className="p-0.5 text-tx-tertiary hover:text-tx-primary shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
          >
            <X size={12} />
          </span>
        )}
        <ChevronDown size={14} className="text-tx-tertiary shrink-0" />
      </button>
      {selected && (
        <p className="text-[10px] text-tx-tertiary truncate mt-0.5 px-0.5" title={selected.name}>
          {selected.name}
        </p>
      )}

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-app-border bg-app-card shadow-xl max-h-72 flex flex-col min-w-[220px]">
          <div className="p-2 border-b border-app-border flex items-center gap-1.5">
            <Search size={14} className="text-tx-tertiary shrink-0" />
            <input
              ref={inputRef}
              className="flex-1 bg-transparent text-sm outline-none"
              placeholder="搜索账户名…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {allowEmpty && (
              <button
                type="button"
                className={cn(
                  "w-full text-left px-3 py-1.5 text-sm hover:bg-app-hover",
                  !value && "text-emerald-600",
                )}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {emptyLabel}
              </button>
            )}
            {groups.length === 0 && (
              <p className="px-3 py-4 text-xs text-tx-tertiary text-center">无匹配账户</p>
            )}
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="px-3 py-1 text-[10px] font-medium text-tx-tertiary sticky top-0 bg-app-card">
                  {g}
                </div>
                {list.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm hover:bg-app-hover",
                      a.id === value && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                    )}
                    onClick={() => {
                      onChange(a.id);
                      setOpen(false);
                    }}
                    title={a.name}
                  >
                    <div className="truncate font-medium">{shortName(a.name)}</div>
                    <div className="truncate text-[10px] text-tx-tertiary">{a.name}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
