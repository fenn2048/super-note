import React, { useMemo } from "react";
import { ProjectStage, ProjectTask } from "@/types";
import { useTranslation } from "react-i18next";
import { Calendar, CheckCircle2, Clock } from "lucide-react";

interface ProjectGanttProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
}

export default function ProjectGantt({ stages, onTaskClick }: ProjectGanttProps) {
  const { t } = useTranslation();

  // Extract all tasks
  const tasks = useMemo(() => {
    return stages.reduce<ProjectTask[]>((acc, stage) => {
      return [...acc, ...(stage.tasks || [])];
    }, []);
  }, [stages]);

  // Determine Gantt range: min start date to max end date
  const ganttRange = useMemo(() => {
    const today = new Date();
    let minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5);
    let maxDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 25);

    const taskDates = tasks
      .map((t) => ({
        start: t.startDate ? new Date(t.startDate) : null,
        end: t.endDate ? new Date(t.endDate) : null,
      }))
      .filter((d) => d.start || d.end);

    if (taskDates.length > 0) {
      const absoluteMin = new Date(
        Math.min(
          ...taskDates.map((d) => (d.start || d.end)!.getTime())
        )
      );
      const absoluteMax = new Date(
        Math.max(
          ...taskDates.map((d) => (d.end || d.start)!.getTime())
        )
      );

      // Pad a few days before and after
      absoluteMin.setDate(absoluteMin.getDate() - 3);
      absoluteMax.setDate(absoluteMax.getDate() + 7);

      minDate = absoluteMin;
      maxDate = absoluteMax;
    }

    // Generate list of days
    const days: Date[] = [];
    const current = new Date(minDate);
    while (current <= maxDate) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    return { minDate, maxDate, days };
  }, [tasks]);

  const formatDateLabel = (date: Date) => {
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  };

  const getDayName = (date: Date) => {
    const days = ["日", "一", "二", "三", "四", "五", "六"];
    return days[date.getDay()];
  };

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20">
      {/* Header */}
      <div className="flex items-center gap-2 p-4 border-b border-app-border shrink-0 bg-app-sidebar">
        <Calendar size={18} className="text-accent-primary" />
        <h2 className="text-base font-bold text-tx-primary">
          {t("projects.gantt") || "甘特图"}
        </h2>
        <span className="text-xs text-tx-tertiary font-medium">
          ({t("projects.readOnlyTimeline") || "时间线视图"})
        </span>
      </div>

      {/* Gantt Container */}
      <div className="flex-1 overflow-auto flex flex-col min-w-0">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary">
            <Calendar size={48} className="stroke-1 mb-2 opacity-50" />
            <p className="text-sm font-semibold">{t("projects.noTasksToDisplay") || "当前项目没有任务"}</p>
            <p className="text-xs max-w-xs">{t("projects.noTasksDesc") || "请在看板或列表中添加并设置任务开始和结束日期"}</p>
          </div>
        ) : (
          <div className="inline-block min-w-full align-middle">
            {/* Grid Header Dates */}
            <div className="flex border-b border-app-border bg-app-sidebar sticky top-0 z-10 shrink-0 text-xs font-semibold select-none text-tx-tertiary">
              {/* Task name column spacer */}
              <div className="w-64 border-r border-app-border shrink-0 p-3 flex items-center bg-app-sidebar">
                {t("projects.taskName") || "任务名称"}
              </div>
              {/* Timeline Header Days */}
              <div className="flex flex-1">
                {ganttRange.days.map((day, idx) => {
                  const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                  const isToday = day.toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={idx}
                      className={`w-12 border-r border-app-border shrink-0 text-center py-2 flex flex-col items-center justify-center ${
                        isToday
                          ? "bg-accent-primary/10 text-accent-primary"
                          : isWeekend
                          ? "bg-app-hover/30"
                          : ""
                      }`}
                    >
                      <span className="text-[10px] scale-90">{formatDateLabel(day)}</span>
                      <span className={`text-[11px] font-bold ${isToday ? "text-accent-primary" : "text-tx-secondary"}`}>
                        {getDayName(day)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Rows */}
            <div className="divide-y divide-app-border bg-app-bg text-sm">
              {tasks.map((task) => {
                const hasTimeline = task.startDate || task.endDate;
                let barStyle: React.CSSProperties = { display: "none" };

                if (hasTimeline) {
                  const tStart = task.startDate ? new Date(task.startDate) : ganttRange.minDate;
                  const tEnd = task.endDate ? new Date(task.endDate) : tStart;

                  // Normalize to gantt boundaries
                  const startPos = Math.max(0, Math.floor((tStart.getTime() - ganttRange.minDate.getTime()) / (24 * 3600 * 1000)));
                  const duration = Math.max(1, Math.ceil((tEnd.getTime() - tStart.getTime()) / (24 * 3600 * 1000)) + 1);

                  barStyle = {
                    left: `${startPos * 3}rem`, // 3rem is w-12 (48px)
                    width: `${duration * 3}rem`,
                  };
                }

                return (
                  <div key={task.id} className="flex hover:bg-app-hover/20 transition-colors">
                    {/* Task Title Cell */}
                    <div
                      className="w-64 border-r border-app-border shrink-0 px-3 py-2.5 flex items-center gap-2 font-medium cursor-pointer truncate text-tx-secondary hover:text-tx-primary"
                      onClick={() => onTaskClick?.(task)}
                    >
                      {task.isCompleted === 1 ? (
                        <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                      ) : (
                        <Clock size={14} className="text-tx-tertiary shrink-0" />
                      )}
                      <span className={`truncate text-xs ${task.isCompleted === 1 ? "line-through opacity-60" : ""}`}>
                        {task.title}
                      </span>
                    </div>

                    {/* Timeline Day Slots with Overlay Bar */}
                    <div className="flex flex-1 relative min-h-[40px] items-center">
                      {/* Day Grid Lines */}
                      <div className="absolute inset-0 flex pointer-events-none">
                        {ganttRange.days.map((day, idx) => {
                          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                          return (
                            <div
                              key={idx}
                              className={`w-12 border-r border-app-border/40 shrink-0 h-full ${
                                isWeekend ? "bg-app-hover/10" : ""
                              }`}
                            />
                          );
                        })}
                      </div>

                      {/* Actual Task Schedule Bar */}
                      {hasTimeline ? (
                        <div
                          style={barStyle}
                          className={`absolute h-7 rounded-lg flex items-center justify-between px-2.5 text-[10px] font-bold shadow-sm transition-all border select-none cursor-pointer truncate ${
                            task.isCompleted === 1
                              ? "bg-green-500/10 border-green-500/20 text-green-600 line-through"
                              : "bg-accent-primary/10 border-accent-primary/20 text-accent-primary hover:bg-accent-primary/25"
                          }`}
                          onClick={() => onTaskClick?.(task)}
                          title={`${task.title} (${task.startDate ? task.startDate.split("T")[0] : ""} ~ ${task.endDate ? task.endDate.split("T")[0] : ""})`}
                        >
                          <span className="truncate">{task.title}</span>
                        </div>
                      ) : (
                        <div className="px-4 py-1 text-[10px] text-tx-tertiary italic">
                          {t("projects.noTimeline") || "未设定时间段"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
