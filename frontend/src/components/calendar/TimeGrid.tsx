import React, { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarTask } from "./types";
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_ROW_PX } from "./types";
import {
  extractTimeHm,
  minutesToHm,
  pad2,
  snapMinutes,
  toLocalYmd,
} from "./dateUtils";
import { layoutTimedEvents, splitTimedAndAllDay, tasksForDate } from "./taskUtils";
import { taskBlockVisual } from "./taskColors";
import { Lunar } from "lunar-javascript";

export interface TimeGridColumn {
  date: Date;
  label?: string;
}

/** 拖放到时间格时的落点（ymd + 可选时刻；全天行 dropHm 为空） */
export type DayDropPayload = {
  targetYmd: string;
  /** HH:mm；全天行 / 无时刻时为 undefined */
  dropHm?: string;
};

export type TaskTimeChangePayload = {
  task: CalendarTask;
  ymd: string;
  startHm: string;
  endHm: string;
};

interface TimeGridProps {
  columns: TimeGridColumn[];
  tasks: CalendarTask[];
  onTaskClick?: (task: CalendarTask) => void;
  onTaskContextMenu?: (e: React.MouseEvent, task: CalendarTask) => void;
  onEmptyClick?: (ymd: string, startHm: string, endHm: string) => void;
  onEmptyContextMenu?: (e: React.MouseEvent, ymd: string) => void;
  onDayDrop?: (e: React.DragEvent, payload: DayDropPayload) => void;
  onTaskDragStart?: (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => void;
  onTaskDragEnd?: () => void;
  /** 日/周视图：拖拽边缘调整起止时间 */
  onTaskTimeChange?: (payload: TaskTimeChangePayload) => void;
  draggingTaskId?: string | null;
  dragOverYmd?: string | null;
  onDayDragOver?: (e: React.DragEvent, ymd: string) => void;
  onDayDragLeave?: (e: React.DragEvent, ymd: string) => void;
  showColumnHeaders?: boolean;
}

const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
const SNAP_STEP = 15;
const MIN_DURATION = 15;

function clientYToSnappedMins(clientY: number, columnEl: HTMLElement): number {
  const rect = columnEl.getBoundingClientRect();
  const y = clientY - rect.top + columnEl.scrollTop;
  // column itself isn't scrolled; parent scroll moves the whole grid. clientY is viewport-relative,
  // getBoundingClientRect already accounts for scroll, so no extra scrollTop needed on column.
  const raw = (y / HOUR_ROW_PX) * 60 + GRID_START_HOUR * 60;
  return Math.max(0, Math.min(23 * 60 + 45, snapMinutes(raw, SNAP_STEP)));
}

export default function TimeGrid({
  columns,
  tasks,
  onTaskClick,
  onTaskContextMenu,
  onEmptyClick,
  onEmptyContextMenu,
  onDayDrop,
  onTaskDragStart,
  onTaskDragEnd,
  onTaskTimeChange,
  draggingTaskId,
  dragOverYmd,
  onDayDragOver,
  onDayDragLeave,
  showColumnHeaders = true,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalHeight = hours.length * HOUR_ROW_PX;
  const [dropPreview, setDropPreview] = useState<{ ymd: string; mins: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{
    taskId: string;
    startMin: number;
    endMin: number;
  } | null>(null);
  const resizingRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, 7 * HOUR_ROW_PX - 8);
    }
  }, [columns.map((c) => toLocalYmd(c.date)).join(",")]);

  const perColumn = useMemo(() => {
    return columns.map((col) => {
      const ymd = toLocalYmd(col.date);
      const dayTasks = tasksForDate(tasks, col.date);
      const { timed, allDay } = splitTimedAndAllDay(dayTasks);
      const layout = layoutTimedEvents(timed, ymd);
      return { col, ymd, allDay, layout };
    });
  }, [columns, tasks]);

  const handleTimedDragOver = useCallback(
    (e: React.DragEvent, ymd: string) => {
      onDayDragOver?.(e, ymd);
      if (!draggingTaskId) return;
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      const mins = clientYToSnappedMins(e.clientY, el);
      setDropPreview((prev) =>
        prev && prev.ymd === ymd && prev.mins === mins ? prev : { ymd, mins },
      );
    },
    [draggingTaskId, onDayDragOver],
  );

  const handleTimedDragLeave = useCallback(
    (e: React.DragEvent, ymd: string) => {
      onDayDragLeave?.(e, ymd);
      const related = e.relatedTarget as Node | null;
      if (related && (e.currentTarget as HTMLElement).contains(related)) return;
      setDropPreview((p) => (p?.ymd === ymd ? null : p));
    },
    [onDayDragLeave],
  );

  const handleTimedDrop = useCallback(
    (e: React.DragEvent, ymd: string) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      const mins = clientYToSnappedMins(e.clientY, el);
      setDropPreview(null);
      onDayDrop?.(e, { targetYmd: ymd, dropHm: minutesToHm(mins) });
    },
    [onDayDrop],
  );

  const handleAllDayDrop = useCallback(
    (e: React.DragEvent, ymd: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDropPreview(null);
      onDayDrop?.(e, { targetYmd: ymd });
    },
    [onDayDrop],
  );

  const beginResize = useCallback(
    (
      e: React.PointerEvent,
      task: CalendarTask,
      ymd: string,
      edge: "start" | "end",
      startMin: number,
      endMin: number,
      columnEl: HTMLElement | null,
    ) => {
      if (!onTaskTimeChange || !columnEl) return;
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;

      const pointerId = e.pointerId;
      (e.currentTarget as HTMLElement).setPointerCapture?.(pointerId);

      let curStart = startMin;
      let curEnd = endMin;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const mins = clientYToSnappedMins(ev.clientY, columnEl);
        if (edge === "start") {
          curStart = Math.min(mins, curEnd - MIN_DURATION);
          curStart = Math.max(0, curStart);
        } else {
          curEnd = Math.max(mins, curStart + MIN_DURATION);
          curEnd = Math.min(24 * 60, curEnd);
        }
        setResizePreview({ taskId: task.id, startMin: curStart, endMin: curEnd });
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        setResizePreview(null);
        resizingRef.current = false;
        const changed = curStart !== startMin || curEnd !== endMin;
        if (changed) {
          onTaskTimeChange({
            task,
            ymd,
            startHm: minutesToHm(curStart),
            endHm: minutesToHm(Math.min(curEnd, 23 * 60 + 59)),
          });
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [onTaskTimeChange],
  );

  return (
    <div className="flex flex-col flex-1 min-h-0 border-t border-app-border">
      {showColumnHeaders && (
        <div
          className="grid shrink-0 border-b border-app-border bg-app-sidebar/40"
          style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          <div className="border-r border-app-border" />
          {columns.map((col) => {
            const ymd = toLocalYmd(col.date);
            const isToday = ymd === toLocalYmd(new Date());
            const lunar = Lunar.fromDate(col.date);
            const lunarStr =
              lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese();
            const weekNames = ["日", "一", "二", "三", "四", "五", "六"];
            return (
              <div
                key={ymd}
                className={cn(
                  "px-1 py-1.5 text-center border-r border-app-border last:border-r-0 min-w-0",
                  isToday && "bg-accent-primary/10",
                )}
              >
                <div className="text-[10px] text-tx-tertiary font-semibold">
                  {weekNames[col.date.getDay()]} · {lunarStr}
                </div>
                <div
                  className={cn(
                    "text-sm font-bold tabular-nums",
                    isToday ? "text-accent-primary" : "text-tx-primary",
                  )}
                >
                  {col.date.getDate()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All-day row */}
      <div
        className="grid shrink-0 border-b border-app-border bg-app-sidebar/20 min-h-[36px]"
        style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        <div className="flex items-center justify-end pr-1.5 text-[10px] text-tx-tertiary font-semibold border-r border-app-border">
          全天
        </div>
        {perColumn.map(({ ymd, allDay }) => (
          <div
            key={ymd}
            className={cn(
              "border-r border-app-border last:border-r-0 px-0.5 py-0.5 space-y-0.5 min-w-0 overflow-hidden",
              dragOverYmd === ymd && "bg-accent-primary/10",
            )}
            onContextMenu={(e) => {
              e.preventDefault();
              onEmptyContextMenu?.(e, ymd);
            }}
            onDragOver={(e) => onDayDragOver?.(e, ymd)}
            onDragLeave={(e) => onDayDragLeave?.(e, ymd)}
            onDrop={(e) => handleAllDayDrop(e, ymd)}
          >
            {allDay.map((task) => {
              const visual = taskBlockVisual(task, { dense: true });
              return (
                <button
                  key={task.id}
                  type="button"
                  draggable
                  onDragStart={(e) => onTaskDragStart?.(e, task, ymd)}
                  onDragEnd={onTaskDragEnd}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTaskClick?.(task);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    onTaskContextMenu?.(e, task);
                  }}
                  style={visual.style}
                  className={cn(
                    "w-full text-left px-1.5 py-0.5 rounded text-[10px] font-semibold truncate border",
                    visual.className,
                    draggingTaskId === task.id && "opacity-40",
                  )}
                >
                  {task.title}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Timed scroll area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <div
          className="grid relative"
          style={{
            gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))`,
            height: totalHeight,
          }}
        >
          <div className="relative border-r border-app-border">
            {hours.map((h) => (
              <div
                key={h}
                className="absolute right-1.5 text-[10px] text-tx-tertiary font-mono tabular-nums -translate-y-1/2"
                style={{ top: (h - GRID_START_HOUR) * HOUR_ROW_PX }}
              >
                {pad2(h)}:00
              </div>
            ))}
          </div>

          {perColumn.map(({ ymd, layout }) => (
            <div
              key={ymd}
              data-cal-column={ymd}
              className={cn(
                "relative border-r border-app-border last:border-r-0",
                dragOverYmd === ymd && "bg-accent-primary/8",
              )}
              style={{ height: totalHeight }}
              onClick={(e) => {
                if (resizingRef.current) return;
                if ((e.target as HTMLElement).closest("[data-cal-event]")) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const y = e.clientY - rect.top;
                const mins = Math.floor((y / HOUR_ROW_PX) * 60) + GRID_START_HOUR * 60;
                const snapped = Math.floor(mins / 30) * 30;
                const clamped = Math.max(0, Math.min(23 * 60 + 30, snapped));
                const startH = Math.floor(clamped / 60);
                const startM = clamped % 60;
                const endTotal = clamped + 60;
                onEmptyClick?.(
                  ymd,
                  `${pad2(startH)}:${pad2(startM)}`,
                  `${pad2(Math.floor(endTotal / 60) % 24)}:${pad2(endTotal % 60)}`,
                );
              }}
              onContextMenu={(e) => {
                if ((e.target as HTMLElement).closest("[data-cal-event]")) return;
                e.preventDefault();
                onEmptyContextMenu?.(e, ymd);
              }}
              onDragOver={(e) => handleTimedDragOver(e, ymd)}
              onDragLeave={(e) => handleTimedDragLeave(e, ymd)}
              onDrop={(e) => handleTimedDrop(e, ymd)}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-app-border/50 pointer-events-none"
                  style={{ top: (h - GRID_START_HOUR) * HOUR_ROW_PX }}
                />
              ))}

              {/* Drop time guide */}
              {dropPreview?.ymd === ymd && (
                <div
                  className="absolute left-0 right-0 z-[2] pointer-events-none flex items-center"
                  style={{ top: ((dropPreview.mins - GRID_START_HOUR * 60) / 60) * HOUR_ROW_PX }}
                >
                  <div className="h-0.5 w-full bg-accent-primary shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
                  <span className="absolute left-1 -translate-y-1/2 text-[9px] font-mono font-bold text-accent-primary bg-app-elevated/95 px-1 rounded border border-accent-primary/30">
                    {minutesToHm(dropPreview.mins)}
                  </span>
                </div>
              )}

              {layout.map(({ task, col, colCount, startMin, endMin }) => {
                const preview =
                  resizePreview?.taskId === task.id ? resizePreview : null;
                const sMin = preview?.startMin ?? startMin;
                const eMin = preview?.endMin ?? endMin;
                const top = ((sMin - GRID_START_HOUR * 60) / 60) * HOUR_ROW_PX;
                const height = Math.max(22, ((eMin - sMin) / 60) * HOUR_ROW_PX - 2);
                const widthPct = 100 / colCount;
                const leftPct = col * widthPct;
                const startHm = minutesToHm(sMin);
                const endHm = minutesToHm(Math.min(eMin, 23 * 60 + 59));
                const visual = taskBlockVisual(task);
                return (
                  <div
                    key={task.id}
                    data-cal-event
                    draggable={!resizingRef.current}
                    onDragStart={(e) => {
                      if (resizingRef.current) {
                        e.preventDefault();
                        return;
                      }
                      e.stopPropagation();
                      onTaskDragStart?.(e, task, ymd);
                    }}
                    onDragEnd={() => {
                      setDropPreview(null);
                      onTaskDragEnd?.();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (resizingRef.current) return;
                      onTaskClick?.(task);
                    }}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      onTaskContextMenu?.(e, task);
                    }}
                    className={cn(
                      "absolute z-[1] rounded-md border px-1.5 py-0.5 overflow-hidden cursor-grab active:cursor-grabbing select-none group/event",
                      "transition-[opacity] duration-fast ease-out shadow-xs",
                      visual.className,
                      draggingTaskId === task.id && "opacity-40",
                      preview && "ring-2 ring-accent-primary/40 z-[3]",
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      ...visual.style,
                    }}
                    title={`${task.title}\n${startHm}–${endHm}\n拖动移动 · 边缘调整时长 · 右键设置时间`}
                  >
                    {/* Resize start (top) */}
                    {onTaskTimeChange && (
                      <div
                        role="separator"
                        aria-label="调整开始时间"
                        className="absolute inset-x-0 top-0 h-2 cursor-ns-resize z-[2] touch-none opacity-0 group-hover/event:opacity-100 hover:bg-black/10 dark:hover:bg-white/15"
                        onPointerDown={(e) => {
                          const colEl = (e.currentTarget as HTMLElement).closest(
                            "[data-cal-column]",
                          ) as HTMLElement | null;
                          beginResize(e, task, ymd, "start", sMin, eMin, colEl);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}

                    <div className="flex items-start gap-0.5 min-w-0 pointer-events-none pt-0.5">
                      {task.isCompleted === 1 && (
                        <CheckCircle2 size={10} className="shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold truncate leading-tight">{task.title}</div>
                        {height > 28 && (
                          <div className="text-[9px] opacity-80 font-mono truncate">
                            {startHm}–{endHm}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Resize end (bottom) */}
                    {onTaskTimeChange && (
                      <div
                        role="separator"
                        aria-label="调整截止时间"
                        className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize z-[2] touch-none opacity-0 group-hover/event:opacity-100 hover:bg-black/10 dark:hover:bg-white/15"
                        onPointerDown={(e) => {
                          const colEl = (e.currentTarget as HTMLElement).closest(
                            "[data-cal-column]",
                          ) as HTMLElement | null;
                          beginResize(e, task, ymd, "end", sMin, eMin, colEl);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
