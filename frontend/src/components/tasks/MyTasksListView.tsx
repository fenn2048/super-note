/**
 * 我的任务 · 列表流视图（今日关注 / 待办 / 已完成）
 * 「今天」已并入「今日关注」：有任务完整列表，无任务内嵌草稿输入。
 */
import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ProjectTask } from "@/types";
import { LIFE_COPY } from "@/lib/taskLifecycle";
import TaskListRow from "@/components/tasks/TaskListRow";

export type MyTasksCategorized = {
  focusToday: ProjectTask[];
  todo: ProjectTask[];
  completed: ProjectTask[];
  notStartedCount: number;
  inProgressCount: number;
};

export type ExpandedSections = {
  focusToday: boolean;
  todo: boolean;
  completed: boolean;
};

export type VisibleCounts = {
  focusToday: number;
  todo: number;
  completed: number;
};

export type MyTasksListViewProps = {
  categorized: MyTasksCategorized;
  expandedSections: ExpandedSections;
  onToggleSection: (key: keyof ExpandedSections) => void;
  visibleCounts: VisibleCounts;
  onLoadMore: (key: keyof VisibleCounts) => void;
  todayDrafts: string[];
  onTodayDraftChange: (index: number, value: string) => void;
  onSubmitTodayDraft: (index: number) => void;
  todayDraftBusy: boolean;
  showProjectName: boolean;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onDelete: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartTask: (task: ProjectTask) => void;
  onPauseTask: (task: ProjectTask) => void;
  /** 为 false 时隐藏待办 / 已完成（全局空列表仍展示今日关注草稿） */
  showSections?: boolean;
};

export default function MyTasksListView({
  categorized,
  expandedSections,
  onToggleSection,
  visibleCounts,
  onLoadMore,
  todayDrafts,
  onTodayDraftChange,
  onSubmitTodayDraft,
  todayDraftBusy,
  showProjectName,
  onToggleComplete,
  onDelete,
  onSelectProject,
  onStartTask,
  onPauseTask,
  showSections = true,
}: MyTasksListViewProps) {
  const { t } = useTranslation();
  const focusCount = categorized.focusToday.length;

  const rowProps = {
    onToggleComplete,
    onDelete,
    onSelectProject,
    onStartTask,
    onPauseTask,
    showProjectName,
  };

  return (
    <>
      {/* 今日关注：完整列表 + 空态草稿（已合并原「今天」主模块） */}
      <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
        <div
          onClick={() => onToggleSection("focusToday")}
          className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
        >
          <div className="flex items-center gap-2 min-w-0">
            {expandedSections.focusToday ? (
              <ChevronDown size={14} className="text-tx-tertiary shrink-0" />
            ) : (
              <ChevronRight size={14} className="text-tx-tertiary shrink-0" />
            )}
            <span className="text-[10px] md:text-xs font-bold text-red-500 uppercase tracking-wider">
              今日关注
            </span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 font-mono">
              {focusCount}
            </span>
            <span className="hidden sm:inline text-[10px] text-tx-quaternary font-normal normal-case truncate">
              逾期 · 今日截止 · 提醒已到
            </span>
          </div>
        </div>
        {expandedSections.focusToday && (
          <div className="animate-in fade-in duration-200">
            {focusCount === 0 ? (
              <div className="p-3.5 space-y-2">
                <p className="text-[11px] text-tx-tertiary leading-snug px-0.5">
                  还没有需要盯的事——写下今天最重要的几件
                </p>
                {todayDrafts.map((draft, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-app-border/50 bg-app-bg/60 px-2.5 py-1.5"
                  >
                    <span className="text-[11px] font-mono text-tx-quaternary w-4 shrink-0">
                      {i + 1}
                    </span>
                    <input
                      type="text"
                      value={draft}
                      onChange={(e) => onTodayDraftChange(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void onSubmitTodayDraft(i);
                        }
                      }}
                      placeholder={
                        i === 0
                          ? "今天最重要的一件事…"
                          : i === 1
                            ? "第二件（可选）"
                            : "第三件（可选）"
                      }
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none text-sm text-tx-primary placeholder:text-tx-quaternary h-9 no-focus-ring"
                      disabled={todayDraftBusy}
                    />
                    {draft.trim() && (
                      <button
                        type="button"
                        disabled={todayDraftBusy}
                        onClick={() => void onSubmitTodayDraft(i)}
                        className="text-[11px] font-semibold text-accent-primary px-2 py-1.5 min-h-9 shrink-0"
                      >
                        添加
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-tx-quaternary px-0.5">
                  回车即添加 · 默认今天截止 · 加入本列表
                </p>
              </div>
            ) : (
              <div className="divide-y divide-app-border/20">
                {categorized.focusToday.slice(0, visibleCounts.focusToday).map((task) => (
                  <TaskListRow key={task.id} task={task} {...rowProps} />
                ))}
                {focusCount > visibleCounts.focusToday && (
                  <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                    <button
                      type="button"
                      onClick={() => onLoadMore("focusToday")}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-transform duration-press ease-out"
                    >
                      <ChevronDown size={12} />
                      <span>加载更多 ({focusCount - visibleCounts.focusToday})</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {showSections && (
        <>
          {/* 待办 */}
          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
            <div
              onClick={() => onToggleSection("todo")}
              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
            >
              <div className="flex items-center gap-2">
                {expandedSections.todo ? (
                  <ChevronDown size={14} className="text-tx-tertiary" />
                ) : (
                  <ChevronRight size={14} className="text-tx-tertiary" />
                )}
                <span className="text-[10px] md:text-xs font-bold text-amber-500 uppercase tracking-wider">
                  待办
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                  {categorized.todo.length}
                </span>
                {(categorized.notStartedCount > 0 || categorized.inProgressCount > 0) && (
                  <span className="hidden sm:inline text-[10px] text-tx-quaternary font-normal normal-case">
                    {LIFE_COPY.notStarted} {categorized.notStartedCount}
                    {" · "}
                    {LIFE_COPY.inProgress} {categorized.inProgressCount}
                  </span>
                )}
              </div>
            </div>
            {expandedSections.todo && (
              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                {categorized.todo.length === 0 ? (
                  <div className="p-4 text-center text-xs text-tx-tertiary">没有其它待办</div>
                ) : (
                  <>
                    {categorized.todo.slice(0, visibleCounts.todo).map((task) => (
                      <TaskListRow key={task.id} task={task} {...rowProps} />
                    ))}
                    {categorized.todo.length > visibleCounts.todo && (
                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                        <button
                          type="button"
                          onClick={() => onLoadMore("todo")}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-transform duration-press ease-out"
                        >
                          <ChevronDown size={12} />
                          <span>加载更多 ({categorized.todo.length - visibleCounts.todo})</span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* 已完成 */}
          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
            <div
              onClick={() => onToggleSection("completed")}
              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
            >
              <div className="flex items-center gap-2">
                {expandedSections.completed ? (
                  <ChevronDown size={14} className="text-tx-tertiary" />
                ) : (
                  <ChevronRight size={14} className="text-tx-tertiary" />
                )}
                <span className="text-[10px] md:text-xs font-bold text-green-500 uppercase tracking-wider">
                  {t("projects.completedTasks") || "已完成"}
                </span>
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 font-mono">
                  {categorized.completed.length}
                </span>
              </div>
            </div>
            {expandedSections.completed && (
              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                {categorized.completed.length === 0 ? (
                  <div className="p-4 text-center text-xs text-tx-tertiary">
                    {t("projects.noCompletedTasks") || "没有已完成的任务"}
                  </div>
                ) : (
                  <>
                    {categorized.completed.slice(0, visibleCounts.completed).map((task) => (
                      <TaskListRow key={task.id} task={task} {...rowProps} />
                    ))}
                    {categorized.completed.length > visibleCounts.completed && (
                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                        <button
                          type="button"
                          onClick={() => onLoadMore("completed")}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-transform duration-press ease-out"
                        >
                          <ChevronDown size={12} />
                          <span>
                            加载更多 ({categorized.completed.length - visibleCounts.completed})
                          </span>
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
