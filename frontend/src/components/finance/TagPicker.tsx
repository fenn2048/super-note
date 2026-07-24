/**
 * 交易标签选择器（对齐 beancount-web Select mode=tags）
 * - 预设标签 chips 一键添加
 * - 已用标签建议
 * - 支持输入新标签
 */
import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export default function TagPicker({
  value,
  onChange,
  suggestions = [],
  presets = [],
  placeholder = "输入标签后回车，或点选预设",
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  presets?: string[];
  placeholder?: string;
  className?: string;
}) {
  const [input, setInput] = useState("");
  const selected = value || [];

  const available = useMemo(() => {
    const set = new Set(selected);
    const list: string[] = [];
    for (const t of [...suggestions, ...presets]) {
      if (t && !set.has(t) && !list.includes(t)) list.push(t);
    }
    return list.slice(0, 24);
  }, [suggestions, presets, selected]);

  const add = (raw: string) => {
    const t = raw.trim().replace(/^#/, "");
    if (!t) return;
    if (selected.includes(t)) {
      setInput("");
      return;
    }
    onChange([...selected, t]);
    setInput("");
  };

  const remove = (t: string) => onChange(selected.filter((x) => x !== t));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap gap-1.5 min-h-[32px] px-2 py-1.5 rounded-lg border border-app-border bg-app-bg">
        {selected.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-0.5 pl-2 pr-1 py-0.5 rounded-full text-xs bg-accent-primary/15 text-accent-primary"
          >
            #{t}
            <button
              type="button"
              className="p-0.5 rounded-full hover:bg-accent-primary/20"
              onClick={() => remove(t)}
              aria-label={`移除 ${t}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          className="flex-1 min-w-[100px] bg-transparent text-sm outline-none py-0.5"
          value={input}
          placeholder={selected.length ? "" : placeholder}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && selected.length) {
              remove(selected[selected.length - 1]);
            }
          }}
          onBlur={() => {
            if (input.trim()) add(input);
          }}
        />
      </div>
      {available.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {available.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="px-2 py-0.5 rounded-full text-[11px] border border-app-border text-tx-tertiary hover:border-accent-primary/50 hover:text-accent-primary"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
