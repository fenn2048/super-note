/**
 * 我的任务 · 统一筛选 / 视图 Sheet
 * 角色 · 项目 · 象限 · 列表/矩阵
 */
import React from "react";
import { Check, LayoutGrid, List as ListIcon } from "lucide-react";
import type { Project } from "@/types";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/common/BottomSheet";
import type { QuadrantFilter } from "@/lib/taskQuadrant";
import type { MyTasksRoleFilter } from "@/components/tasks/MyTasksSidebar";

type ViewMode = "flow" | "matrix";

type Props = {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  projectFilter: string;
  onProjectFilter: (id: string) => void;
  quadrantFilter: QuadrantFilter;
  onQuadrantFilter: (f: QuadrantFilter) => void;
  viewMode: ViewMode;
  onViewMode: (m: ViewMode) => void;
  /** 矩阵模式下隐藏象限 chip 段（分格即筛选） */
  showQuadrantFilters?: boolean;
  /** 角色筛选（移动端补齐桌面侧栏能力） */
  roleFilter?: MyTasksRoleFilter;
  onRoleFilter?: (role: MyTasksRoleFilter) => void;
};

const QUADRANT_OPTS: { id: QuadrantFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "q1", label: "马上做" },
  { id: "q2", label: "计划做" },
  { id: "q3", label: "能转就转" },
  { id: "q4", label: "少做" },
  { id: "uncategorized", label: "象限未归" },
];

const ROLE_OPTS: { id: MyTasksRoleFilter; label: string; dot: string }[] = [
  { id: "assigned", label: "我负责的", dot: "bg-blue-500" },
  { id: "created", label: "我创建的", dot: "bg-emerald-500" },
  { id: "participating", label: "我参与的", dot: "bg-indigo-500" },
  { id: "favorites", label: "我收藏的", dot: "bg-amber-500" },
];

export default function MyTasksFilterSheet({
  open,
  onClose,
  projects,
  projectFilter,
  onProjectFilter,
  quadrantFilter,
  onQuadrantFilter,
  viewMode,
  onViewMode,
  showQuadrantFilters = true,
  roleFilter,
  onRoleFilter,
}: Props) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="筛选与视图"
      maxHeight="min(78dvh, 100%)"
      zClassName="z-modal"
    >
      <div className="px-4 pb-6 space-y-5">
        {/* 视图 */}
        <section className="space-y-2">
          <h4 className="text-[11px] font-bold text-tx-tertiary uppercase tracking-wider">
            视图
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                onViewMode("flow");
              }}
              className={cn(
                "flex items-center justify-center gap-2 py-3 min-h-12 rounded-xl border text-xs font-semibold transition-[transform,background-color,color,border-color] duration-press ease-out active:scale-[0.98]",
                viewMode === "flow"
                  ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30"
                  : "bg-app-elevated text-tx-secondary border-app-border/50",
              )}
            >
              <ListIcon size={16} />
              列表
            </button>
            <button
              type="button"
              onClick={() => {
                onViewMode("matrix");
              }}
              className={cn(
                "flex items-center justify-center gap-2 py-3 min-h-12 rounded-xl border text-xs font-semibold transition-[transform,background-color,color,border-color] duration-press ease-out active:scale-[0.98]",
                viewMode === "matrix"
                  ? "bg-accent-primary/10 text-accent-primary border-accent-primary/30"
                  : "bg-app-elevated text-tx-secondary border-app-border/50",
              )}
            >
              <LayoutGrid size={16} />
              矩阵整理
            </button>
          </div>
        </section>

        {/* 角色（移动端对齐桌面侧栏） */}
        {roleFilter != null && onRoleFilter && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold text-tx-tertiary uppercase tracking-wider">
              范围
            </h4>
            <div className="space-y-1.5">
              {ROLE_OPTS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onRoleFilter(opt.id);
                  }}
                  className={cn(
                    "w-full py-3.5 px-4 rounded-xl font-bold flex items-center gap-2.5 active:scale-[0.98] transition-transform text-xs min-h-[44px]",
                    roleFilter === opt.id
                      ? "bg-accent-primary/10 text-accent-primary"
                      : "bg-app-elevated text-tx-secondary",
                  )}
                >
                  <span className={cn("w-2 h-2 rounded-full shrink-0", opt.dot)} />
                  <span className="flex-1 text-left">{opt.label}</span>
                  {roleFilter === opt.id && <Check size={14} />}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 象限（仅列表） */}
        {showQuadrantFilters && viewMode === "flow" && (
          <section className="space-y-2">
            <h4 className="text-[11px] font-bold text-tx-tertiary uppercase tracking-wider">
              四象限筛选
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {QUADRANT_OPTS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    onQuadrantFilter(opt.id);
                  }}
                  className={cn(
                    "px-3 py-2 min-h-11 rounded-lg text-[11px] font-semibold border transition-[transform,background-color,color,border-color] duration-press ease-out active:scale-[0.97]",
                    quadrantFilter === opt.id
                      ? "bg-accent-primary/12 text-accent-primary border-accent-primary/30"
                      : "bg-app-elevated text-tx-tertiary border-app-border/40",
                  )}
                  aria-pressed={quadrantFilter === opt.id}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* 项目 */}
        <section className="space-y-2">
          <h4 className="text-[11px] font-bold text-tx-tertiary uppercase tracking-wider">
            项目
          </h4>
          <div className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                onProjectFilter("all");
                onClose();
              }}
              className={cn(
                "w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-between active:scale-[0.98] transition-transform text-xs min-h-[44px]",
                projectFilter === "all"
                  ? "bg-accent-primary/10 text-accent-primary"
                  : "bg-app-elevated text-tx-secondary",
              )}
            >
              <span>全部项目</span>
              {projectFilter === "all" && <Check size={14} />}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onProjectFilter(p.id);
                  onClose();
                }}
                className={cn(
                  "w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-between active:scale-[0.98] transition-transform text-xs min-h-[44px]",
                  projectFilter === p.id
                    ? "bg-accent-primary/10 text-accent-primary"
                    : "bg-app-elevated text-tx-secondary",
                )}
              >
                <span className="truncate">{p.name}</span>
                {projectFilter === p.id && <Check size={14} />}
              </button>
            ))}
          </div>
        </section>
      </div>
    </BottomSheet>
  );
}
