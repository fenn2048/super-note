import React, { useState, useMemo } from "react";
import { ProjectStage, ProjectTask } from "@/types";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProjectCalendarProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
  showProjectFilter?: boolean;
}

export default function ProjectCalendar({ stages, onTaskClick, showProjectFilter }: ProjectCalendarProps) {
  const { t } = useTranslation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");

  // Extract all tasks
  const tasks = stages.reduce<ProjectTask[]>((acc, stage) => {
    return [...acc, ...(stage.tasks || [])];
  }, []);

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
      if (selectedProjectId !== "all" && task.projectId !== selectedProjectId) {
        return false;
      }
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

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20">
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
              className="sleek-select h-8 px-2 text-xs text-tx-secondary rounded-lg border border-app-border bg-app-sidebar focus:outline-none focus:ring-1 focus:ring-accent-primary max-w-[150px] truncate"
            >
              <option value="all">{t("projects.allProjects") || "全部项目"}</option>
              {uniqueProjects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          )}
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
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0 divide-x divide-y divide-app-border border-b border-app-border">
        {calendarCells.map((cell, idx) => {
          const dayTasks = getTasksForDate(cell.date);
          const isToday = cell.date.toDateString() === new Date().toDateString();

          return (
            <div
              key={idx}
              className={`min-h-0 flex flex-col p-1.5 space-y-1 transition-colors ${
                cell.isCurrentMonth ? "bg-app-bg" : "bg-app-sidebar/45 opacity-55"
              }`}
            >
              <div className="flex justify-between items-center text-xs shrink-0">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full font-bold ${
                    isToday
                      ? "bg-accent-primary text-white"
                      : cell.isCurrentMonth
                      ? "text-tx-secondary"
                      : "text-tx-tertiary"
                  }`}
                >
                  {cell.date.getDate()}
                </span>
                {dayTasks.length > 0 && (
                  <span className="text-[10px] text-tx-tertiary font-mono">
                    {dayTasks.length} {t("projects.tasksCount") || "任务"}
                  </span>
                )}
              </div>

              {/* Tasks list for this day */}
              <div className="flex-1 overflow-y-auto space-y-1 max-h-[120px] scrollbar-none">
                {dayTasks.slice(0, 4).map((task) => (
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
                {dayTasks.length > 4 && (
                  <div className="text-[9px] text-tx-tertiary text-center font-medium">
                    +{dayTasks.length - 4} ...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
