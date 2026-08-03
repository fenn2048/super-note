import React from "react";
import { CheckCircle2, Circle, Star } from "lucide-react";
import { Lunar, Solar, HolidayUtil } from "lunar-javascript";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { CalendarTask } from "../types";
import { buildMonthCells, toLocalYmd } from "../dateUtils";
import { tasksForDate } from "../taskUtils";
import { taskBlockVisual } from "../taskColors";

interface MonthViewProps {
  anchorDate: Date;
  selectedDate: Date;
  tasks: CalendarTask[];
  weekDayLabels: string[];
  isMobile: boolean;
  clipboardTitle?: string | null;
  draggingTaskId: string | null;
  dragOverYmd: string | null;
  movingTaskId: string | null;
  suppressDayClickRef: React.MutableRefObject<boolean>;
  onSelectDate: (d: Date) => void;
  onOpenCreate: (d: Date) => void;
  onTaskClick?: (task: CalendarTask) => void;
  onTaskContextMenu: (e: React.MouseEvent, task: CalendarTask) => void;
  onDayContextMenu: (e: React.MouseEvent, date: Date) => void;
  onTaskDragStart: (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => void;
  onTaskDragEnd: () => void;
  onDayDragOver: (e: React.DragEvent, ymd: string) => void;
  onDayDragLeave: (e: React.DragEvent, ymd: string) => void;
  onDayDrop: (e: React.DragEvent, targetYmd: string) => void;
  onPaste?: (ymd: string) => void;
  onDrillDay?: (d: Date) => void;
}

export default function MonthView({
  anchorDate,
  selectedDate,
  tasks,
  weekDayLabels,
  isMobile,
  clipboardTitle,
  draggingTaskId,
  dragOverYmd,
  movingTaskId,
  suppressDayClickRef,
  onSelectDate,
  onOpenCreate,
  onTaskClick,
  onTaskContextMenu,
  onDayContextMenu,
  onTaskDragStart,
  onTaskDragEnd,
  onDayDragOver,
  onDayDragLeave,
  onDayDrop,
  onPaste,
  onDrillDay,
}: MonthViewProps) {
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  const calendarCells = buildMonthCells(year, month);

  return (
    <>
      <div className="grid grid-cols-7 border-b border-app-border bg-app-sidebar shrink-0 text-center py-2 text-xs font-semibold text-tx-tertiary">
        {weekDayLabels.map((day, idx) => (
          <div key={idx} className={idx === 0 || idx === 6 ? "text-accent-danger/75" : ""}>
            {day}
          </div>
        ))}
      </div>

      <div
        className={cn(
          "grid grid-cols-7 grid-rows-6 divide-x divide-y divide-app-border border-b border-app-border shrink-0",
          isMobile ? "h-64" : "flex-1 min-h-0",
        )}
      >
        {calendarCells.map((cell, idx) => {
          const dayTasks = tasksForDate(tasks, cell.date);
          const isToday = cell.date.toDateString() === new Date().toDateString();
          const lunar = Lunar.fromDate(cell.date);
          const lunarDateStr =
            lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese();
          const isFirstDayOfMonth = cell.date.getDate() === 1;
          const solarDateStr = isFirstDayOfMonth
            ? `${cell.date.getMonth() + 1}月1日`
            : `${cell.date.getDate()}日`;

          const labels: { text: string; isHoliday: boolean; isWork?: boolean }[] = [];
          const h = HolidayUtil.getHoliday(
            cell.date.getFullYear(),
            cell.date.getMonth() + 1,
            cell.date.getDate(),
          );
          let holidayName = "";
          if (h) {
            holidayName = h.getName();
            labels.push({
              text: `${holidayName} (${h.isWork() ? "班" : "休"})`,
              isHoliday: true,
              isWork: h.isWork(),
            });
          }
          const jieQi = lunar.getJieQi();
          if (jieQi) labels.push({ text: jieQi, isHoliday: false });
          const solar = Solar.fromDate(cell.date);
          solar.getFestivals().forEach((f: string) => {
            if (!holidayName || (!holidayName.includes(f) && !f.includes(holidayName))) {
              labels.push({ text: f, isHoliday: false });
            }
          });
          lunar.getFestivals().forEach((f: string) => {
            if (!holidayName || (!holidayName.includes(f) && !f.includes(holidayName))) {
              labels.push({ text: f, isHoliday: false });
            }
          });

          const cellYmd = toLocalYmd(cell.date);
          const isDropTarget = dragOverYmd === cellYmd && !!draggingTaskId;

          return (
            <div
              key={idx}
              onClick={() => {
                if (suppressDayClickRef.current) return;
                if (isMobile) {
                  onSelectDate(cell.date);
                  return;
                }
                onOpenCreate(cell.date);
              }}
              onDoubleClick={() => onDrillDay?.(cell.date)}
              onContextMenu={(e) => onDayContextMenu(e, cell.date)}
              onDragOver={(e) => onDayDragOver(e, cellYmd)}
              onDragLeave={(e) => onDayDragLeave(e, cellYmd)}
              onDrop={(e) => void onDayDrop(e, cellYmd)}
              className={cn(
                "min-h-0 flex flex-col p-1.5 space-y-1 transition-colors cursor-pointer",
                cell.isCurrentMonth ? "bg-app-bg" : "bg-app-sidebar/45 opacity-55",
                isMobile &&
                  cell.date.toDateString() === selectedDate.toDateString() &&
                  "bg-accent-primary/10 border-accent-primary/40 border-2",
                !isMobile &&
                  "[@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover/40",
                isDropTarget && "bg-accent-primary/15 ring-2 ring-inset ring-accent-primary/50",
              )}
              title={isMobile ? undefined : "点击新建 · 拖拽任务 · 双击进入日视图"}
            >
              <div className="flex justify-between items-center text-xs shrink-0 select-none">
                <span className="text-tx-tertiary text-[9px] font-medium truncate max-w-[50%]">
                  {lunarDateStr}
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold flex items-center gap-0.5 shrink-0",
                    cell.isCurrentMonth ? "text-tx-secondary" : "text-tx-tertiary",
                  )}
                >
                  {isToday ? (
                    <>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent-danger text-white text-[10px] font-bold shrink-0">
                        {cell.date.getDate()}
                      </span>
                      <span>日</span>
                    </>
                  ) : (
                    solarDateStr
                  )}
                </span>
              </div>

              {labels.length > 0 && !isMobile && (
                <div className="flex flex-col gap-0.5 shrink-0">
                  {labels.map((lbl, lIdx) => (
                    <div
                      key={lIdx}
                      className={cn(
                        "w-full px-1 py-0.5 rounded text-[9px] leading-none font-semibold flex items-center gap-0.5 border border-transparent truncate shrink-0",
                        lbl.isHoliday
                          ? lbl.isWork
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-500/20"
                            : "bg-accent-primary/10 text-accent-primary border-accent-primary/15"
                          : "bg-accent-primary/10 text-accent-primary",
                      )}
                      title={lbl.text}
                    >
                      {!lbl.isHoliday && (
                        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-accent-primary text-white shrink-0 scale-90">
                          <Star size={7} className="fill-current text-white" />
                        </span>
                      )}
                      <span className="truncate">{lbl.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {!isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-1 max-h-[100px] scrollbar-none">
                  {dayTasks.slice(0, 3).map((task) => {
                    const isDragging = draggingTaskId === task.id;
                    const isMoving = movingTaskId === task.id;
                    const visual = taskBlockVisual(task, { dense: true });
                    return (
                      <div
                        key={task.id}
                        draggable={!isMoving}
                        onDragStart={(e) => onTaskDragStart(e, task, cellYmd)}
                        onDragEnd={onTaskDragEnd}
                        style={visual.style}
                        className={cn(
                          "group/cal-task relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border truncate font-medium cursor-grab active:cursor-grabbing select-none",
                          "transition-[opacity] duration-fast ease-out",
                          visual.className,
                          isDragging && "opacity-40",
                          isMoving && "opacity-60 pointer-events-none",
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressDayClickRef.current || isDragging) return;
                          onTaskClick?.(task);
                        }}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          onTaskContextMenu(e, task);
                        }}
                        title={`${task.title}（拖到其他日期可移动 · 右键更多）`}
                      >
                        {task.isCompleted === 1 ? (
                          <CheckCircle2 size={10} className="shrink-0 opacity-80" />
                        ) : (
                          <Circle size={10} className="shrink-0 opacity-80" />
                        )}
                        <span className="truncate">{task.title}</span>
                      </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[9px] text-tx-tertiary text-center font-medium">
                      +{dayTasks.length - 3} ...
                    </div>
                  )}
                </div>
              ) : (
                dayTasks.length > 0 && (
                  <div className="flex justify-center items-center mt-1 select-none pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {isMobile && (
        <div className="flex-1 flex flex-col min-h-0 bg-app-bg border-t border-app-border/40 select-text overflow-hidden">
          <div className="px-4 py-2.5 bg-app-sidebar/20 border-b border-app-border/30 flex items-center justify-between shrink-0 gap-2">
            <span className="text-[11px] font-bold text-tx-secondary min-w-0 truncate">
              {format(selectedDate, "yyyy年MM月dd日")} (
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][selectedDate.getDay()]}) 的任务
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-mono">
                {tasksForDate(tasks, selectedDate).length}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[11px] px-2 gap-1"
                onClick={() => onOpenCreate(selectedDate)}
              >
                <Plus size={12} />
                新建
              </Button>
              {clipboardTitle && onPaste && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[11px] px-2"
                  onClick={() => onPaste(toLocalYmd(selectedDate))}
                >
                  粘贴
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-app-border/10 p-2">
            {tasksForDate(tasks, selectedDate).map((task) => (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                onContextMenu={(e) => onTaskContextMenu(e, task)}
                className="flex items-center justify-between p-3 active:bg-app-hover/10 rounded-xl cursor-pointer min-h-11"
              >
                <span
                  className={cn(
                    "text-xs font-semibold truncate text-tx-secondary",
                    task.isCompleted === 1 && "line-through opacity-50",
                  )}
                >
                  {task.title}
                </span>
                <span className="text-[10px] text-tx-tertiary shrink-0">
                  {(task as CalendarTask).projectName || "个人TODO"}
                </span>
              </div>
            ))}
            {tasksForDate(tasks, selectedDate).length === 0 && (
              <div className="text-center py-8 text-xs text-tx-tertiary select-none">
                这一天没有安排任何任务
                <button
                  type="button"
                  className="block mx-auto mt-3 text-accent-primary font-semibold"
                  onClick={() => onOpenCreate(selectedDate)}
                >
                  点击创建
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
