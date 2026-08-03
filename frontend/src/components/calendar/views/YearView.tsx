import React, { useMemo } from "react";
import type { CalendarTask } from "../types";
import MiniMonth from "../MiniMonth";
import { ymdsWithTasks } from "../taskUtils";
import { Lunar } from "lunar-javascript";

interface YearViewProps {
  year: number;
  tasks: CalendarTask[];
  onDayClick: (date: Date) => void;
  onMonthClick: (year: number, month: number) => void;
}

export default function YearView({ year, tasks, onDayClick, onMonthClick }: YearViewProps) {
  const taskYmds = useMemo(() => ymdsWithTasks(tasks, year), [tasks, year]);
  const lunarHint = useMemo(() => {
    try {
      const d = new Date(year, 0, 1);
      const lunar = Lunar.fromDate(d);
      return `${lunar.getYearInGanZhi()}年 · 农历`;
    } catch {
      return "";
    }
  }, [year]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
      {lunarHint && (
        <div className="text-[11px] text-tx-tertiary font-semibold mb-3 px-1">{lunarHint}</div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
        {Array.from({ length: 12 }, (_, month) => (
          <MiniMonth
            key={month}
            year={year}
            month={month}
            taskYmds={taskYmds}
            onDayClick={onDayClick}
            onMonthTitleClick={onMonthClick}
          />
        ))}
      </div>
    </div>
  );
}
