/**
 * 我的任务 · 桌面右侧筛选栏（搜索 / 角色 / 标签）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import type { Tag } from "@/types";
import { cn, getTagColor } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type MyTasksRoleFilter = "favorites" | "assigned" | "created" | "participating";

export type MyTasksSidebarProps = {
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  searchMode: "AND" | "OR";
  onSearchMode: (mode: "AND" | "OR") => void;
  roleFilter: MyTasksRoleFilter;
  onRoleFilter: (role: MyTasksRoleFilter) => void;
  selectedTagId: string | null;
  onSelectedTagId: (id: string | null) => void;
  tags: Tag[];
};

const ROLE_OPTIONS: { id: MyTasksRoleFilter; label: string; dot: string }[] = [
  { id: "favorites", label: "⭐️ 我收藏的", dot: "bg-amber-500" },
  { id: "assigned", label: "👤 我负责的", dot: "bg-blue-500" },
  { id: "created", label: "➕ 我创建的", dot: "bg-emerald-500" },
  { id: "participating", label: "👥 我参与的", dot: "bg-indigo-500" },
];

export default function MyTasksSidebar({
  searchQuery,
  onSearchQuery,
  searchMode,
  onSearchMode,
  roleFilter,
  onRoleFilter,
  selectedTagId,
  onSelectedTagId,
  tags,
}: MyTasksSidebarProps) {
  const { t } = useTranslation();

  return (
    <div className="hidden md:flex w-[260px] min-w-[260px] shrink-0 flex-col bg-app-surface border-l border-app-border/50 overflow-y-auto px-5 py-4 gap-5 animate-in fade-in duration-200 diary-project-sidebar">
      <div className="space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
          <Input
            placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
            className="pl-8 h-8 text-xs bg-app-bg border-app-border no-focus-ring"
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-secondary"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {searchQuery.trim() !== "" && (
          <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-app-hover/50 border border-app-border/40 animate-in slide-in-from-top-2 duration-200">
            <div className="flex items-center justify-between text-[10px] text-tx-tertiary select-none font-medium">
              <span>过滤条件</span>
              <button
                type="button"
                onClick={() => onSearchMode(searchMode === "AND" ? "OR" : "AND")}
                className="px-1.5 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary font-semibold hover:bg-accent-primary/20 active:scale-95 transition-transform duration-press ease-out cursor-pointer"
              >
                {searchMode === "AND" ? "并且 (AND)" : "或者 (OR)"}
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {searchQuery
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((term, index, arr) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-app-surface border border-app-border/50 text-tx-secondary text-[10px] font-medium animate-in zoom-in-95 duration-100"
                  >
                    <span className="truncate max-w-[120px]">{term}</span>
                    <button
                      type="button"
                      onClick={() => {
                        onSearchQuery(arr.filter((_, i) => i !== index).join(" "));
                      }}
                      className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                      title="清除"
                    >
                      <X size={8} />
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-tx-primary px-1">
          分类与标签
        </div>
        <div className="space-y-1">
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onRoleFilter(opt.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                roleFilter === opt.id
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:bg-app-hover",
              )}
            >
              <span className={cn("w-2 h-2 rounded-full shrink-0", opt.dot)} />
              <span>{opt.label}</span>
            </button>
          ))}

          {tags.length > 0 && <div className="h-px bg-app-border/40 my-2" />}

          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => onSelectedTagId(selectedTagId === tag.id ? null : tag.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                selectedTagId === tag.id
                  ? "bg-accent-primary/10 text-accent-primary font-medium"
                  : "text-tx-secondary hover:bg-app-hover",
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: getTagColor(tag) }}
              />
              <span className="truncate">{tag.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
