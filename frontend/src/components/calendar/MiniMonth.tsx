import React, { useMemo } from "react";
import { Lunar, HolidayUtil } from "lunar-javascript";
import { cn } from "@/lib/utils";
import { buildMonthCells, toLocalYmd } from "./dateUtils";

interface MiniMonthProps {
  year: number;
  month: number; // 0-11
  taskYmds?: Set<string>;
  selectedYmd?: string | null;
  onDayClick?: (date: Date) => void;
  onMonthTitleClick?: (year: number, month: number) => void;
  compact?: boolean;
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export default function MiniMonth({
  year,
  month,
  taskYmds,
  selectedYmd,
  onDayClick,
  onMonthTitleClick,
  compact = true,
}: MiniMonthProps) {
  const cells = useMemo(() => buildMonthCells(year, month), [year, month]);
  const todayYmd = toLocalYmd(new Date());

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => onMonthTitleClick?.(year, month)}
        className={cn(
          "w-full text-left font-bold text-accent-primary mb-1",
          compact ? "text-xs px-0.5" : "text-sm",
          onMonthTitleClick && "hover:underline cursor-pointer",
        )}
      >
        {month + 1}月
      </button>
      <div className="grid grid-cols-7 text-center mb-0.5">
        {WEEK.map((w, i) => (
          <div
            key={w}
            className={cn(
              "text-[9px] font-semibold text-tx-tertiary py-0.5",
              (i === 0 || i === 6) && "text-accent-danger/70",
            )}
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 text-center">
        {cells.map((cell, idx) => {
          const ymd = toLocalYmd(cell.date);
          const isToday = ymd === todayYmd;
          const isSelected = selectedYmd === ymd;
          const hasTask = taskYmds?.has(ymd);
          let isHoliday = false;
          try {
            const h = HolidayUtil.getHoliday(
              cell.date.getFullYear(),
              cell.date.getMonth() + 1,
              cell.date.getDate(),
            );
            isHoliday = !!h && !h.isWork();
          } catch {
            /* ignore */
          }
          if (!isHoliday && cell.isCurrentMonth) {
            try {
              const lunar = Lunar.fromDate(cell.date);
              isHoliday = lunar.getFestivals().length > 0;
            } catch {
              /* ignore */
            }
          }

          return (
            <button
              key={idx}
              type="button"
              disabled={!onDayClick}
              onClick={() => onDayClick?.(cell.date)}
              className={cn(
                "relative aspect-square flex flex-col items-center justify-center text-[10px] tabular-nums rounded-full mx-auto",
                compact ? "w-6 h-6 max-w-full" : "w-7 h-7",
                !cell.isCurrentMonth && "text-tx-tertiary/40",
                cell.isCurrentMonth && "text-tx-secondary",
                isHoliday && cell.isCurrentMonth && "underline decoration-accent-danger/70 underline-offset-2",
                isToday && "bg-accent-danger text-white font-bold",
                isSelected && !isToday && "ring-1 ring-accent-primary text-accent-primary font-bold",
                onDayClick && cell.isCurrentMonth && "hover:bg-app-hover cursor-pointer",
              )}
            >
              {cell.date.getDate()}
              {hasTask && !isToday && (
                <span className="absolute bottom-0.5 w-0.5 h-0.5 rounded-full bg-accent-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
