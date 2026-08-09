/**
 * 我的任务列表行 · 三态：未开始 / 进行中 / 已完成
 */
import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Circle,
  MoreHorizontal,
  Pause,
  Play,
  Trash2,
} from "lucide-react";
import { format, isPast, isToday, isTomorrow, isThisWeek, parse, parseISO } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import type { ProjectTask } from "@/types";
import { cn } from "@/lib/utils";
import { BottomSheet } from "@/components/common/BottomSheet";
import { QuadrantBadge } from "@/components/QuadrantPicker";
import {
  LIFE_COPY,
  getTaskLifeState,
  isTaskNotStarted,
  isTaskPaused,
  isTaskInProgressActive,
} from "@/lib/taskLifecycle";

type Token =
  | { kind: "text"; value: string }
  | { kind: "image"; alt: string; url: string }
  | { kind: "link"; text: string; url: string };

const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)/g;

function parseTaskTitle(title: string): Token[] {
  if (!title) return [];
  const out: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(title)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: title.slice(lastIndex, m.index) });
    }
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push({ kind: "image", alt: m[1], url: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ kind: "link", text: m[3], url: m[4] });
    } else if (m[5]) {
      out.push({ kind: "link", text: hostnameOf(m[5]), url: m[5] });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < title.length) {
    out.push({ kind: "text", value: title.slice(lastIndex) });
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.length > 24 ? url.slice(0, 24) + "…" : url;
  }
}

export function TitleView({ title, isCompleted }: { title: string; isCompleted: boolean }) {
  const tokens = parseTaskTitle(title);
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return <>{tokens[0].value}</>;
  }
  return (
    <span className="inline">
      {tokens.map((tok, i) => {
        if (tok.kind === "text") {
          return <React.Fragment key={i}>{tok.value}</React.Fragment>;
        }
        if (tok.kind === "image") {
          return (
            <img
              key={i}
              src={tok.url}
              alt={tok.alt}
              className="inline-block align-middle w-7 h-7 mx-0.5 rounded object-cover border border-app-border bg-app-elevated"
              loading="lazy"
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        const display = hostnameOf(tok.url);
        return (
          <a
            key={i}
            href={tok.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded-md text-xs bg-app-hover/60 text-accent-primary hover:bg-app-active hover:underline max-w-[120px] md:max-w-[160px] truncate ${isCompleted ? "opacity-70" : ""}`}
          >
            <span className="truncate">{display}</span>
          </a>
        );
      })}
    </span>
  );
}

export function toLocalDate(dateStr: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return parse(dateStr, "yyyy-MM-dd", new Date());
  }
  return parseISO(dateStr);
}

export function DateBadge({ dateStr }: { dateStr: string | null }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;
  if (!dateStr) return null;
  const date = toLocalDate(dateStr);

  if (isPast(date) && !isToday(date)) {
    return (
      <span
        className="flex items-center text-red-500 shrink-0"
        title={(t("tasks.overdue") || "逾期") + " " + format(date, "MM/dd")}
      >
        <AlertCircle size={14} strokeWidth={2.5} />
      </span>
    );
  }

  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return null;
  }

  let className = "text-tx-tertiary";
  let text = format(date, "MM/dd", { locale: dateLocale });
  if (isToday(date)) {
    className = "text-green-500";
    text = t("tasks.today") || "今天";
  } else if (isTomorrow(date)) {
    className = "text-accent-primary";
    text = t("tasks.tomorrow") || "明天";
  } else if (isThisWeek(date, { weekStartsOn: 1 })) {
    text = format(date, "EEEE", { locale: dateLocale });
  }

  return (
    <span className={`flex items-center gap-1 text-[10px] md:text-xs whitespace-nowrap ${className}`}>
      <Calendar size={12} />
      {text}
    </span>
  );
}

export type TaskListRowProps = {
  task: ProjectTask;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onDelete: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartTask?: (task: ProjectTask) => void;
  onPauseTask?: (task: ProjectTask) => void;
  showProjectName?: boolean;
};

export default function TaskListRow({
  task,
  onToggleComplete,
  onDelete,
  onStartTask,
  onPauseTask,
  showProjectName = true,
}: TaskListRowProps) {
  const [showActionSheet, setShowActionSheet] = useState(false);
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const life = getTaskLifeState(task);
  const notStarted = isTaskNotStarted(task);
  const paused = isTaskPaused(task);
  const activeProgress = isTaskInProgressActive(task);

  const clearLongPress = () => {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
    touchStart.current = null;
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) return;
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null;
      setShowActionSheet(true);
    }, 480);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current || !touchTimer.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    // 滑动超过约 10px 取消长按（区分滚动）
    if (dx * dx + dy * dy > 100) clearLongPress();
  };

  const handleTouchEnd = () => {
    clearLongPress();
  };

  return (
    <>
      <div
        onClick={() => {
          window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchCancel={handleTouchEnd}
        className="group flex items-center justify-between min-h-12 p-3 px-3.5 pr-1.5 md:pr-3.5 hover:bg-app-hover/20 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out gap-1.5 md:gap-4 cursor-pointer select-none"
      >
        <div className="flex items-center gap-1.5 md:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete(task.id, task.isCompleted);
            }}
            className="inline-flex items-center justify-center min-w-11 min-h-11 -ml-1 text-tx-tertiary hover:text-accent-primary transition-colors focus:outline-none shrink-0 active:scale-[0.96]"
            title={life === "completed" ? LIFE_COPY.reopen : LIFE_COPY.complete}
            aria-label={life === "completed" ? LIFE_COPY.reopen : LIFE_COPY.complete}
          >
            {life === "completed" ? (
              <CheckCircle2 size={18} className="text-green-500" />
            ) : (
              <Circle size={18} className="hover:text-green-500" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "font-semibold text-tx-secondary text-[13px] md:text-sm flex items-center gap-1.5 min-w-0",
                life === "completed" && "line-through opacity-50 text-tx-tertiary",
              )}
            >
              <span className="truncate min-w-0">
                <TitleView title={task.title} isCompleted={life === "completed"} />
              </span>
              {notStarted && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/10 text-sky-500 border border-sky-500/25">
                  {LIFE_COPY.notStarted}
                </span>
              )}
              {paused && (
                <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-app-hover text-tx-tertiary border border-app-border/50">
                  {LIFE_COPY.paused}
                </span>
              )}
              {Number(task.isBackfilled) === 1 && (
                <span
                  className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/12 text-amber-600 dark:text-amber-400 border border-amber-500/25"
                  title="事后补录"
                >
                  补录
                </span>
              )}
            </div>
            {showProjectName && (
              <div className="flex items-center gap-2 text-[10px] text-tx-tertiary font-bold mt-0.5">
                <span>所在项目: {(task as { projectName?: string }).projectName || "个人TODO"}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {notStarted && onStartTask && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartTask(task);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                title={LIFE_COPY.start}
              >
                <Play size={11} fill="currentColor" />
              </button>
            )}
            {paused && onStartTask && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartTask(task);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                title={LIFE_COPY.resume}
              >
                <Play size={11} fill="currentColor" />
              </button>
            )}
            {activeProgress && (
              <div className="flex items-center gap-1 shrink-0">
                {onPauseTask && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPauseTask(task);
                    }}
                    className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                    title={LIFE_COPY.pause}
                  >
                    <Pause size={11} fill="currentColor" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleComplete(task.id, task.isCompleted);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                  title={LIFE_COPY.complete}
                >
                  <Check size={11} />
                </button>
              </div>
            )}
            {/* 未开始也可直接完成（不必先点开始） */}
            {notStarted && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleComplete(task.id, task.isCompleted);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                title={LIFE_COPY.complete}
              >
                <Check size={11} />
              </button>
            )}
          </div>

          <QuadrantBadge isImportant={task.isImportant} isUrgent={task.isUrgent} />
          {task.endDate && <DateBadge dateStr={task.endDate} />}

          {task.assigneeId && (task.assigneeDisplayName || task.assigneeName) ? (
            task.assigneeAvatarUrl ? (
              <img
                src={task.assigneeAvatarUrl}
                alt={task.assigneeDisplayName || task.assigneeName || "assignee"}
                className="w-6 h-6 rounded-full object-cover border border-app-border shrink-0"
                title={task.assigneeDisplayName || task.assigneeName}
              />
            ) : (
              <div
                className="w-6 h-6 rounded-full bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-[10px] font-bold text-accent-primary shrink-0 font-mono"
                title={task.assigneeDisplayName || task.assigneeName}
              >
                {(task.assigneeDisplayName || task.assigneeName || "").slice(0, 1).toUpperCase()}
              </div>
            )
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(task.id);
            }}
            className="hidden md:block opacity-0 group-hover:opacity-100 p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-accent-danger transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
          >
            <Trash2 size={14} />
          </button>

          {/* 移动端可发现入口（与长按同一操作表） */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowActionSheet(true);
            }}
            className="md:hidden inline-flex items-center justify-center min-w-11 min-h-11 shrink-0 text-tx-tertiary hover:text-tx-secondary active:scale-[0.96] transition-transform duration-press ease-out"
            aria-label="任务操作"
            title="更多操作"
          >
            <MoreHorizontal size={18} />
          </button>
        </div>
      </div>

      <div className="md:hidden" onClick={(e) => e.stopPropagation()}>
        <BottomSheet
          open={showActionSheet}
          onClose={() => setShowActionSheet(false)}
          title={task.title}
          maxHeight="min(70dvh, 100%)"
          zClassName="z-[101]"
        >
          <div className="px-4 pb-2 space-y-2">
            {(notStarted || paused) && onStartTask && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowActionSheet(false);
                  onStartTask(task);
                }}
                className="w-full py-4 bg-app-elevated rounded-xl font-bold text-accent-primary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform min-h-[44px]"
              >
                <Play size={18} />
                {paused ? LIFE_COPY.resume : LIFE_COPY.start}
              </button>
            )}
            {activeProgress && onPauseTask && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowActionSheet(false);
                  onPauseTask(task);
                }}
                className="w-full py-4 bg-app-elevated rounded-xl font-bold text-amber-500 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform min-h-[44px]"
              >
                <Pause size={18} />
                {LIFE_COPY.pause}
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowActionSheet(false);
                onToggleComplete(task.id, task.isCompleted);
              }}
              className="w-full py-4 bg-app-elevated rounded-xl font-bold text-green-500 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform min-h-[44px]"
            >
              <CheckCircle2 size={18} />
              {life === "completed" ? LIFE_COPY.reopen : LIFE_COPY.complete}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowActionSheet(false);
                onDelete(task.id);
              }}
              className="w-full py-4 bg-app-elevated rounded-xl font-bold text-accent-danger flex items-center justify-center gap-2 active:scale-[0.98] transition-transform min-h-[44px]"
            >
              <Trash2 size={18} />
              删除任务
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowActionSheet(false);
              }}
              className="w-full py-4 bg-app-hover rounded-xl font-bold text-tx-tertiary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mt-2 min-h-[44px]"
            >
              取消
            </button>
          </div>
        </BottomSheet>
      </div>
    </>
  );
}
