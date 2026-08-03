import React, { useMemo, useRef, useEffect } from "react";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarTask } from "./types";
import { GRID_END_HOUR, GRID_START_HOUR, HOUR_ROW_PX } from "./types";
import { extractTimeHm, pad2, toLocalYmd } from "./dateUtils";
import { layoutTimedEvents, splitTimedAndAllDay, tasksForDate } from "./taskUtils";
import { taskBlockVisual } from "./taskColors";
import { Lunar } from "lunar-javascript";

export interface TimeGridColumn {
  date: Date;
  label?: string;
}

interface TimeGridProps {
  columns: TimeGridColumn[];
  tasks: CalendarTask[];
  onTaskClick?: (task: CalendarTask) => void;
  onTaskContextMenu?: (e: React.MouseEvent, task: CalendarTask) => void;
  onEmptyClick?: (ymd: string, startHm: string, endHm: string) => void;
  onEmptyContextMenu?: (e: React.MouseEvent, ymd: string) => void;
  onDayDrop?: (e: React.DragEvent, targetYmd: string) => void;
  onTaskDragStart?: (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => void;
  onTaskDragEnd?: () => void;
  draggingTaskId?: string | null;
  dragOverYmd?: string | null;
  onDayDragOver?: (e: React.DragEvent, ymd: string) => void;
  onDayDragLeave?: (e: React.DragEvent, ymd: string) => void;
  showColumnHeaders?: boolean;
}

const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);

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
  draggingTaskId,
  dragOverYmd,
  onDayDragOver,
  onDayDragLeave,
  showColumnHeaders = true,
}: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const totalHeight = hours.length * HOUR_ROW_PX;

  useEffect(() => {
    // Scroll to ~7:00 on mount
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

  return (
    <div className="flex flex-col flex-1 min-h-0 border-t border-app-border">
      {/* Column headers */}
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
            onDrop={(e) => onDayDrop?.(e, ymd)}
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
          {/* Hour labels */}
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

          {/* Day columns */}
          {perColumn.map(({ ymd, layout }) => (
            <div
              key={ymd}
              className={cn(
                "relative border-r border-app-border last:border-r-0",
                dragOverYmd === ymd && "bg-accent-primary/8",
              )}
              style={{ height: totalHeight }}
              onClick={(e) => {
                // Only create when clicking empty background
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
              onDragOver={(e) => onDayDragOver?.(e, ymd)}
              onDragLeave={(e) => onDayDragLeave?.(e, ymd)}
              onDrop={(e) => onDayDrop?.(e, ymd)}
            >
              {/* Hour lines */}
              {hours.map((h) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 border-t border-app-border/50 pointer-events-none"
                  style={{ top: (h - GRID_START_HOUR) * HOUR_ROW_PX }}
                />
              ))}

              {/* Events */}
              {layout.map(({ task, col, colCount, startMin, endMin }) => {
                const top = ((startMin - GRID_START_HOUR * 60) / 60) * HOUR_ROW_PX;
                const height = Math.max(22, ((endMin - startMin) / 60) * HOUR_ROW_PX - 2);
                const widthPct = 100 / colCount;
                const leftPct = col * widthPct;
                const startHm = extractTimeHm(task.startDate) || extractTimeHm(task.endDate) || "";
                const endHm = extractTimeHm(task.endDate) || extractTimeHm(task.startDate) || "";
                const visual = taskBlockVisual(task);
                return (
                  <div
                    key={task.id}
                    data-cal-event
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      onTaskDragStart?.(e, task, ymd);
                    }}
                    onDragEnd={onTaskDragEnd}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTaskClick?.(task);
                    }}
                    onContextMenu={(e) => {
                      e.stopPropagation();
                      onTaskContextMenu?.(e, task);
                    }}
                    className={cn(
                      "absolute z-[1] rounded-md border px-1.5 py-0.5 overflow-hidden cursor-grab active:cursor-grabbing select-none",
                      "transition-[opacity] duration-fast ease-out shadow-xs",
                      visual.className,
                      draggingTaskId === task.id && "opacity-40",
                    )}
                    style={{
                      top,
                      height,
                      left: `calc(${leftPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      ...visual.style,
                    }}
                    title={task.title}
                  >
                    <div className="flex items-start gap-0.5 min-w-0">
                      {task.isCompleted === 1 && (
                        <CheckCircle2 size={10} className="shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold truncate leading-tight">{task.title}</div>
                        {height > 28 && (startHm || endHm) && (
                          <div className="text-[9px] opacity-80 font-mono truncate">
                            {startHm}
                            {endHm ? `–${endHm}` : ""}
                          </div>
                        )}
                      </div>
                    </div>
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
