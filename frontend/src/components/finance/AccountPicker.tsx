/**
 * 可搜索账户选择器（导入 / 记一笔共用）
 * - 按类型分组 + 关键词过滤
 * - variant=dropdown（默认）| sheet（portal 底部抽屉，触控友好）
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { FinanceAccount } from "@/types";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/common/BottomSheet";

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
  variant = "dropdown",
  sheetTitle,
}: {
  accounts: FinanceAccount[];
  value: string;
  onChange: (accountId: string) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
  disabled?: boolean;
  /** dropdown = absolute panel; sheet = portal bottom sheet */
  variant?: "dropdown" | "sheet";
  sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSheet = variant === "sheet";

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
    if (!open || isSheet) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, isSheet]);

  useEffect(() => {
    if (open) {
      setQ("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isSheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isSheet]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const listBody = (
    <>
      <div className="p-2 border-b border-app-border flex items-center gap-1.5 shrink-0">
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
      <div className="overflow-y-auto flex-1 py-1 min-h-0">
        {allowEmpty && (
          <button
            type="button"
            className={cn(
              "w-full text-left px-3 text-sm hover:bg-app-hover",
              isSheet ? "py-3 min-h-[44px]" : "py-1.5",
              !value && "text-accent-primary",
            )}
            onClick={() => pick("")}
          >
            {emptyLabel}
          </button>
        )}
        {groups.length === 0 && (
          <p className="px-3 py-4 text-xs text-tx-tertiary text-center">无匹配账户</p>
        )}
        {groups.map(([g, list]) => (
          <div key={g}>
            <div className="px-3 py-1 text-[10px] font-medium text-tx-tertiary sticky top-0 bg-app-elevated">
              {g}
            </div>
            {list.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn(
                  "w-full text-left px-3 text-sm hover:bg-app-hover",
                  isSheet ? "py-3 min-h-[44px]" : "py-1.5",
                  a.id === value && "bg-accent-primary/10 text-accent-primary",
                )}
                onClick={() => pick(a.id)}
                title={a.name}
              >
                <div className="truncate font-medium">{shortName(a.name)}</div>
                <div className="truncate text-[10px] text-tx-tertiary">{a.name}</div>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );

  const sheet = isSheet ? (
    <BottomSheet
      open={open}
      onClose={() => setOpen(false)}
      title={sheetTitle || placeholder}
      maxHeight="min(70dvh, 100%)"
      zClassName="z-modal"
      bodyClassName="flex flex-col min-h-0"
    >
      {listBody}
    </BottomSheet>
  ) : null;

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full flex items-center gap-1 px-2 rounded-lg border border-app-border bg-app-bg text-left text-sm",
          isSheet ? "py-2.5 min-h-[44px]" : "py-1.5",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <span className={cn("flex-1 min-w-0 truncate", !selected && "text-tx-tertiary")}>
          {selected ? shortName(selected.name) : placeholder}
        </span>
        {value && allowEmpty && !disabled && (
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

      {open && !isSheet && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-app-border shadow-xl max-h-72 flex flex-col min-w-[220px] text-tx-primary"
          style={{ backgroundColor: "var(--color-elevated-solid, var(--color-elevated))" }}
        >
          {listBody}
        </div>
      )}
      {sheet}
    </div>
  );
}
