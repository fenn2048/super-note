/**
 * 我的任务 · 顶栏（移动 Chrome + 桌面 PageHeader / 视图切换）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { Filter, LayoutGrid, List as ListIcon, ListTodo, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import MobileChromeHeader, { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";

export type MyTasksViewMode = "flow" | "matrix";

export type MyTasksHeaderProps = {
  showMobileSearch: boolean;
  onShowMobileSearch: (v: boolean) => void;
  searchQuery: string;
  onSearchQuery: (q: string) => void;
  viewMode: MyTasksViewMode;
  onViewMode: (mode: MyTasksViewMode) => void;
  onOpenFilter: () => void;
  /** 筛选激活时显示圆点 */
  hasActiveFilters?: boolean;
};

export default function MyTasksHeader({
  showMobileSearch,
  onShowMobileSearch,
  searchQuery,
  onSearchQuery,
  viewMode,
  onViewMode,
  onOpenFilter,
  hasActiveFilters = false,
}: MyTasksHeaderProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="md:hidden shrink-0">
        {showMobileSearch ? (
          <MobileChromeHeader
            variant="bare"
            center={
              <div className="flex items-center gap-2 w-full">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
                  <Input
                    autoFocus
                    placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
                    className="pl-9 pr-8 w-full rounded-full bg-app-hover border-none h-8 text-xs"
                    value={searchQuery}
                    onChange={(e) => onSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => onSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-tx-tertiary"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onShowMobileSearch(false);
                    onSearchQuery("");
                  }}
                  className="text-xs font-medium text-accent-primary px-2 py-1 active:scale-95 shrink-0"
                >
                  取消
                </button>
              </div>
            }
          />
        ) : (
          <MobileChromeHeader
            variant="bare"
            title="任务"
            right={
              <div className="flex items-center gap-0.5">
                <MobileChromeIconButton title="筛选与视图" onClick={onOpenFilter}>
                  <Filter size={18} />
                </MobileChromeIconButton>
                <MobileChromeIconButton title="搜索" onClick={() => onShowMobileSearch(true)}>
                  <Search size={18} />
                </MobileChromeIconButton>
              </div>
            }
          />
        )}
      </div>

      <PageHeader
        mdOnly
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-card bg-accent-primary flex items-center justify-center">
              <ListTodo size={18} className="text-white" />
            </span>
            <span>
              <span className="block">{t("projects.myTasks") || "我的任务"}</span>
              <span className="block text-xs font-normal text-tx-tertiary mt-0.5">
                {t("projects.myTasksDesc") || "跨项目指派给我的任务"}
              </span>
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenFilter}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-9 rounded-button text-xs font-semibold border border-app-border/50 bg-app-hover text-tx-secondary hover:text-tx-primary transition-colors duration-press ease-out active:scale-[0.97]"
            >
              <Filter size={14} />
              筛选
              {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-accent-primary" />}
            </button>
            <div
              className="inline-flex items-center p-0.5 rounded-button bg-app-hover border border-app-border/50"
              role="group"
              aria-label="任务视图"
            >
              <button
                type="button"
                onClick={() => onViewMode("flow")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[calc(var(--radius-button)-2px)] text-xs font-semibold min-h-9 transition-[transform,background-color,color,box-shadow] duration-press ease-out active:scale-[0.97]",
                  viewMode === "flow"
                    ? "bg-app-elevated text-tx-primary shadow-xs"
                    : "text-tx-tertiary hover:text-tx-secondary",
                )}
              >
                <ListIcon size={14} />
                列表
              </button>
              <button
                type="button"
                onClick={() => onViewMode("matrix")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[calc(var(--radius-button)-2px)] text-xs font-semibold min-h-9 transition-[transform,background-color,color,box-shadow] duration-press ease-out active:scale-[0.97]",
                  viewMode === "matrix"
                    ? "bg-app-elevated text-tx-primary shadow-xs"
                    : "text-tx-tertiary hover:text-tx-secondary",
                )}
              >
                <LayoutGrid size={14} />
                矩阵整理
              </button>
            </div>
          </div>
        }
      />
    </>
  );
}
