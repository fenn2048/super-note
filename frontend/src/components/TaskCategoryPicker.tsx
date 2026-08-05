/**
 * 事务主分类选择（大类 → 小类）
 * 叶子项展示路径 + 说明小字；悬停/打开列表时气泡展示完整说明。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, getCurrentWorkspace } from "@/lib/api";
import type { TaskCategory } from "@/types";
import { cn } from "@/lib/utils";
import { Tags, Loader2, ChevronDown, Check } from "lucide-react";

interface TaskCategoryPickerProps {
  value: string | null | undefined;
  onChange: (categoryId: string | null) => void;
  className?: string;
  compact?: boolean;
}

type LeafOption = {
  id: string;
  label: string;
  code: string;
  description: string | null;
  color: string | null;
};

function flattenLeaves(tree: TaskCategory[], path: string[] = []): LeafOption[] {
  const out: LeafOption[] = [];
  for (const n of tree) {
    const p = [...path, n.name];
    if (n.children && n.children.length > 0) {
      out.push(...flattenLeaves(n.children, p));
    } else {
      out.push({
        id: n.id,
        label: p.join(" / "),
        code: n.code,
        description: n.description || null,
        color: n.color || null,
      });
    }
  }
  return out;
}

export default function TaskCategoryPicker({ value, onChange, className, compact }: TaskCategoryPickerProps) {
  const [tree, setTree] = useState<TaskCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 280 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getTaskCategories(getCurrentWorkspace());
      setTree(res.tree || []);
    } catch {
      setTree([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const leaves = useMemo(() => flattenLeaves(tree), [tree]);
  const selected = leaves.find((l) => l.id === value) || null;

  const applyPreset = async () => {
    setApplying(true);
    try {
      const r = await api.applyTaskCategoryPreset(getCurrentWorkspace());
      setTree(r.tree || []);
    } finally {
      setApplying(false);
    }
  };

  const updatePos = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 280);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    setPos({
      top: r.bottom + 4,
      left,
      width,
    });
  };

  useEffect(() => {
    if (!open) return;
    updatePos();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => updatePos();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  if (loading) {
    return (
      <div className={cn("flex items-center gap-1.5 text-xs text-tx-tertiary", className)}>
        <Loader2 size={12} className="animate-spin" />
        分类…
      </div>
    );
  }

  if (leaves.length === 0) {
    return (
      <button
        type="button"
        onClick={applyPreset}
        disabled={applying}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-semibold text-accent-primary hover:underline",
          className,
        )}
      >
        {applying ? <Loader2 size={12} className="animate-spin" /> : <Tags size={12} />}
        导入事务分类
      </button>
    );
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      onClick={() => {
        if (!open) updatePos();
        setOpen((v) => !v);
      }}
      className={cn(
        "flex items-center gap-1.5 min-w-0 w-full bg-app-sidebar border border-app-border/60 px-2.5 py-1.5 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors",
        compact && "py-1",
        open && "ring-1 ring-accent-primary/30 border-accent-primary/40",
      )}
      title={selected?.description || "事务分类（可选）"}
    >
      <Tags size={12} className="text-tx-tertiary shrink-0" />
      <span className="flex-1 min-w-0 text-left">
        <span className="block font-semibold truncate">
          {selected ? selected.label : "事务分类（可选）"}
        </span>
        {selected?.description && (
          <span className="block text-[10px] font-normal text-tx-tertiary truncate leading-tight mt-0.5">
            {selected.description}
          </span>
        )}
      </span>
      <ChevronDown size={12} className={cn("shrink-0 opacity-60 transition-transform", open && "rotate-180")} />
    </button>
  );

  const panel =
    open &&
    createPortal(
      <div
        ref={panelRef}
        className="fixed z-popover max-h-72 overflow-y-auto rounded-card border border-app-border bg-app-elevated shadow-xl py-1"
        style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 300) }}
        role="listbox"
      >
        <div className="px-3 py-1.5 border-b border-app-border/40 sticky top-0 bg-app-elevated">
          <p className="text-[10px] text-tx-tertiary">可选 · 用于复盘统计 · 灰色小字为说明</p>
        </div>
        <button
          type="button"
          role="option"
          className={cn(
            "w-full text-left px-3 py-2.5 text-xs hover:bg-app-hover transition-colors",
            !value && "bg-accent-primary/5",
          )}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <span className="font-medium text-tx-secondary">不选（完全可选）</span>
          <span className="block text-[10px] text-tx-tertiary mt-0.5">创建任务不受影响，复盘会归入「未归类」</span>
        </button>
        {leaves.map((l) => (
          <button
            key={l.id}
            type="button"
            role="option"
            aria-selected={value === l.id}
            title={l.description || l.label}
            className={cn(
              "w-full text-left px-3 py-2.5 hover:bg-app-hover transition-colors flex items-start gap-2 border-t border-app-border/20",
              value === l.id && "bg-accent-primary/8",
            )}
            onClick={() => {
              onChange(l.id);
              setOpen(false);
            }}
          >
            <span
              className="w-2 h-2 rounded-full mt-1 shrink-0"
              style={{ backgroundColor: l.color || "var(--color-accent-primary, #6366f1)" }}
            />
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-1">
                <span className="text-xs font-semibold text-tx-primary leading-snug">
                  {l.label}
                </span>
                {value === l.id && <Check size={12} className="text-accent-primary shrink-0" />}
              </span>
              {l.description ? (
                <span className="block text-[11px] text-tx-tertiary leading-snug mt-0.5">
                  {l.description}
                </span>
              ) : (
                <span className="block text-[10px] text-tx-quaternary font-mono mt-0.5">{l.code}</span>
              )}
            </span>
          </button>
        ))}
      </div>,
      document.body,
    );

  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      {trigger}
      {/* 始终可见的说明区：不依赖悬停 */}
      <p className="text-[10px] text-tx-tertiary leading-snug px-0.5 min-h-[1rem]">
        {selected?.description
          ? selected.description
          : open
            ? "可选；列表内灰色文字为每类说明"
            : "完全可选 · 选了更好做复盘，不选也能创建"}
      </p>
      {panel}
    </div>
  );
}
