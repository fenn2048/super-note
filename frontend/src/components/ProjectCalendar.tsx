import React, { useState, useMemo } from "react";
import { ProjectStage, ProjectTask } from "@/types";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckCircle2, Circle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Lunar, Solar, HolidayUtil } from "lunar-javascript";
import { cn } from "@/lib/utils";
import { format } from "date-fns";


interface ProjectCalendarProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
  showProjectFilter?: boolean;
}

export default function ProjectCalendar({ stages, onTaskClick, showProjectFilter }: ProjectCalendarProps) {
  const { t } = useTranslation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Extract all tasks with stageName decoration
  const tasks = useMemo(() => {
    return stages.reduce<any[]>((acc, stage) => {
      const stageTasks = (stage.tasks || []).map(task => ({
        ...task,
        stageName: (task as any).stageName || stage.name
      }));
      return [...acc, ...stageTasks];
    }, []);
  }, [stages]);

  const uniqueProjects = useMemo(() => {
    const projMap = new Map<string, string>();
    tasks.forEach((task) => {
      if (task.projectId && !projMap.has(task.projectId)) {
        projMap.set(task.projectId, (task as any).projectName || task.projectId);
      }
    });
    return Array.from(projMap.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Helper: Get days in month
  const getDaysInMonth = (y: number, m: number) => {
    return new Date(y, m + 1, 0).getDate();
  };

  // Helper: Get first day of month (0 = Sunday, 1 = Monday, etc.)
  const getFirstDayOfMonth = (y: number, m: number) => {
    return new Date(y, m, 1).getDay();
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  // Pad previous month days
  const prevMonthDays = getDaysInMonth(year, month - 1);
  const calendarCells: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    calendarCells.push({
      date: new Date(year, month - 1, prevMonthDays - i),
      isCurrentMonth: false,
    });
  }

  // Current month days
  for (let i = 1; i <= daysInMonth; i++) {
    calendarCells.push({
      date: new Date(year, month, i),
      isCurrentMonth: true,
    });
  }

  // Pad next month days to make complete weeks (multiples of 7)
  const remaining = 42 - calendarCells.length; // 6 rows of 7 days
  for (let i = 1; i <= remaining; i++) {
    calendarCells.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false,
    });
  }

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const today = () => {
    setCurrentDate(new Date());
  };

  // Check if a date falls within task's timeline
  const getTasksForDate = (date: Date) => {
    const dStr = date.toISOString().split("T")[0];
    return tasks.filter((task) => {
      // 1. Project Filter
      if (selectedProjectId !== "all" && task.projectId !== selectedProjectId) {
        return false;
      }

      // 2. Status Filter
      if (selectedStatus !== "all") {
        const isCompleted = task.isCompleted === 1 || (task as any).stageName === "已完成";
        const isPaused = task.status === "paused";
        const isNotStarted = task.isCompleted !== 1 && !isPaused && ((task as any).stageName === "待启动" || (task as any).stageName === "待规划");
        const isInProgress = task.isCompleted !== 1 && !isPaused && !isNotStarted;

        if (selectedStatus === "pending" && !isNotStarted) return false;
        if (selectedStatus === "in_progress" && !isInProgress) return false;
        if (selectedStatus === "paused" && !isPaused) return false;
        if (selectedStatus === "completed" && !isCompleted) return false;
      }

      // 3. Date range match
      if (!task.startDate && !task.endDate) return false;
      const start = task.startDate ? task.startDate.split("T")[0] : dStr;
      const end = task.endDate ? task.endDate.split("T")[0] : dStr;
      return dStr >= start && dStr <= end;
    });
  };

  const weekDays = [
    t("calendar.sunday") || "日",
    t("calendar.monday") || "一",
    t("calendar.tuesday") || "二",
    t("calendar.wednesday") || "三",
    t("calendar.thursday") || "四",
    t("calendar.friday") || "五",
    t("calendar.saturday") || "六",
  ];

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 select-none">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b border-app-border shrink-0">
        <div className="flex items-center gap-2">
          <CalendarIcon size={18} className="text-accent-primary" />
          <h2 className="text-base font-bold text-tx-primary">
            {year}年 {month + 1}月
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          {showProjectFilter && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="sleek-select h-8 px-2 text-xs text-tx-secondary rounded-lg border border-app-border bg-app-sidebar focus:outline-none focus:ring-1 focus:ring-accent-primary max-w-[120px] md:max-w-[150px] truncate"
            >
              <option value="all">{t("projects.allProjects") || "全部项目"}</option>
              {uniqueProjects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="sleek-select h-8 px-2 text-xs text-tx-secondary rounded-lg border border-app-border bg-app-sidebar focus:outline-none focus:ring-1 focus:ring-accent-primary min-w-[85px] max-w-[120px] truncate"
          >
            <option value="all">{t("calendar.allStatus") || "所有状态"}</option>
            <option value="pending">{t("calendar.statusPending") || "待启动"}</option>
            <option value="in_progress">{t("calendar.statusInProgress") || "进行中"}</option>
            <option value="paused">{t("calendar.statusPaused") || "已暂停"}</option>
            <option value="completed">{t("calendar.statusCompleted") || "已完成"}</option>
          </select>

          <Button variant="outline" size="sm" onClick={today} className="text-xs">
            {t("calendar.today") || "今天"}
          </Button>
          <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Week Header */}
      <div className="grid grid-cols-7 border-b border-app-border bg-app-sidebar shrink-0 text-center py-2 text-xs font-semibold text-tx-tertiary">
        {weekDays.map((day, idx) => (
          <div key={idx} className={idx === 0 || idx === 6 ? "text-accent-danger/75" : ""}>
            {day}
          </div>
        ))}
      </div>

      {/* Grid Days */}
      <div className={cn("grid grid-cols-7 grid-rows-6 divide-x divide-y divide-app-border border-b border-app-border shrink-0", isMobile ? "h-64" : "flex-1 min-h-0")}>
        {calendarCells.map((cell, idx) => {
          const dayTasks = getTasksForDate(cell.date);
          const isToday = cell.date.toDateString() === new Date().toDateString();

          // Lunar calculations
          const lunar = Lunar.fromDate(cell.date);
          const lunarDateStr = lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese();

          const isFirstDayOfMonth = cell.date.getDate() === 1;
          const solarDateStr = isFirstDayOfMonth ? `${cell.date.getMonth() + 1}月1日` : `${cell.date.getDate()}日`;

          // Holidays, Solar Terms and Festivals
          const labels: { text: string; isHoliday: boolean; isWork?: boolean }[] = [];
          const h = HolidayUtil.getHoliday(cell.date.getFullYear(), cell.date.getMonth() + 1, cell.date.getDate());
          let holidayName = "";
          if (h) {
            holidayName = h.getName();
            labels.push({
              text: `${holidayName} (${h.isWork() ? '班' : '休'})`,
              isHoliday: true,
              isWork: h.isWork()
            });
          }

          const jieQi = lunar.getJieQi();
          if (jieQi) {
            labels.push({ text: jieQi, isHoliday: false });
          }

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

          return (
            <div
              key={idx}
              onClick={() => {
                if (isMobile) {
                  setSelectedDate(cell.date);
                }
              }}
              className={cn(
                "min-h-0 flex flex-col p-1.5 space-y-1 transition-colors cursor-pointer",
                cell.isCurrentMonth ? "bg-app-bg" : "bg-app-sidebar/45 opacity-55",
                isMobile && cell.date.toDateString() === selectedDate.toDateString() && "bg-accent-primary/10 border-accent-primary/40 border-2"
              )}
            >
              {/* Header: Lunar Date on Left, Solar Date on Right */}
              <div className="flex justify-between items-center text-xs shrink-0 select-none">
                <span className="text-tx-tertiary text-[9px] font-medium truncate max-w-[50%]">
                  {lunarDateStr}
                </span>
                <span className={cn("text-xs font-semibold flex items-center gap-0.5 shrink-0", cell.isCurrentMonth ? "text-tx-secondary" : "text-tx-tertiary")}>
                  {isToday ? (
                    <>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#ff4d4f] text-white text-[10px] font-bold shrink-0">
                        {cell.date.getDate()}
                      </span>
                      <span>日</span>
                    </>
                  ) : (
                    solarDateStr
                  )}
                </span>
              </div>

              {/* Holidays, Solar Terms and Festivals list */}
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
                            : "bg-[#e6f4ff] text-[#1677ff] border border-[#d9d9d9]/10"
                          : "bg-[#e6f4ff] text-[#1677ff]"
                      )}
                      title={lbl.text}
                    >
                      {!lbl.isHoliday && (
                        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-[#1677ff] text-white shrink-0 scale-90">
                          <Star size={7} className="fill-current text-white" />
                        </span>
                      )}
                      <span className="truncate">{lbl.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tasks list for this day */}
              {!isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-1 max-h-[100px] scrollbar-none">
                  {dayTasks.slice(0, 3).map((task) => (
                    <div
                      key={task.id}
                      className={`group/cal-task relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] cursor-pointer border transition-colors truncate font-medium ${
                        task.isCompleted === 1
                          ? "bg-green-500/10 border-green-500/20 text-green-600 line-through decoration-green-600/50"
                          : "bg-accent-primary/10 border-accent-primary/20 text-accent-primary hover:bg-accent-primary/20"
                      }`}
                      onClick={() => onTaskClick?.(task)}
                      title={task.title}
                    >
                      {task.isCompleted === 1 ? (
                        <CheckCircle2 size={10} className="shrink-0 text-green-500" />
                      ) : (
                        <Circle size={10} className="shrink-0 text-accent-primary" />
                      )}
                      <span className="truncate">{task.title}</span>
                    </div>
                  ))}
                  {dayTasks.length > 3 && (
                    <div className="text-[9px] text-tx-tertiary text-center font-medium">
                      +{dayTasks.length - 3} ...
                    </div>
                  )}
                </div>
              ) : (
                /* Compact dot indicators on Mobile */
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

      {/* Mobile Task List for Selected Date */}
      {isMobile && (
        <div className="flex-1 flex flex-col min-h-0 bg-app-bg border-t border-app-border/40 select-text overflow-hidden">
          <div className="px-4 py-2.5 bg-app-sidebar/20 border-b border-app-border/30 flex items-center justify-between shrink-0">
            <span className="text-[11px] font-bold text-tx-secondary">
              {format(selectedDate, "yyyy年MM月dd日")} ({
                ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][selectedDate.getDay()]
              }) 的任务
            </span>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-mono">
              {getTasksForDate(selectedDate).length}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-app-border/10 p-2">
            {getTasksForDate(selectedDate).map((task) => (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                className="flex items-center justify-between p-3 active:bg-app-hover/10 rounded-xl cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={cn(
                    "text-xs font-semibold truncate text-tx-secondary",
                    task.isCompleted === 1 && "line-through opacity-50"
                  )}>
                    {task.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-tx-tertiary shrink-0">
                  <span>{(task as any).projectName || "个人TODO"}</span>
                </div>
              </div>
            ))}
            {getTasksForDate(selectedDate).length === 0 && (
              <div className="text-center py-8 text-xs text-tx-tertiary select-none">
                这一天没有安排任何任务
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
