import React, { useState, useRef, useEffect } from "react";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  startOfWeek,
  endOfWeek,
  isSameMonth,
  isSameDay,
  parse,
  isToday,
  isPast,
  isTomorrow
} from "date-fns";
import { zhCN } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SleekDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
}

export default function SleekDatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  className,
  align = "left"
}: SleekDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  // Parse current value string into Date object, default to today if empty/invalid
  const selectedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : null;

  // Format label to show to user
  const getDisplayLabel = () => {
    if (!selectedDate) return placeholder;
    if (isToday(selectedDate)) return "今天";
    if (isTomorrow(selectedDate)) return "明天";
    
    // Check if past (overdue)
    if (isPast(selectedDate)) {
      return `逾期 ${format(selectedDate, "MM/dd")}`;
    }
    
    return format(selectedDate, "yyyy-MM-dd");
  };

  const getLabelClass = () => {
    if (!selectedDate) return "text-tx-tertiary";
    if (isToday(selectedDate)) return "text-green-500 font-semibold";
    if (isTomorrow(selectedDate)) return "text-accent-primary font-semibold";
    if (isPast(selectedDate)) return "text-red-500 font-semibold";
    return "text-tx-secondary font-medium";
  };

  // Click outside listener to close calendar
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Adjust month viewing when opening calendar
  useEffect(() => {
    if (isOpen && selectedDate) {
      setCurrentMonth(selectedDate);
    }
  }, [isOpen]);

  // Month navigation
  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(subMonths(currentMonth, 1));
  };
  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  // Clear date value
  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
    setIsOpen(false);
  };

  // Date cell click
  const handleDateClick = (day: Date) => {
    onChange(format(day, "yyyy-MM-dd"));
    setIsOpen(false);
  };

  // Generate calendar days grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 1 }); // Week starts on Monday
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });

  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const weekDays = ["一", "二", "三", "四", "五", "六", "日"];

  return (
    <div ref={containerRef} className={cn("relative inline-block select-none", className)}>
      {/* Trigger Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-app-border bg-app-sidebar/80 text-xs cursor-pointer transition-all hover:bg-app-hover/80 hover:border-app-border/80 min-w-[90px]",
          isOpen && "border-accent-primary ring-1 ring-accent-primary/20"
        )}
      >
        <CalendarIcon size={12} className="text-tx-tertiary shrink-0" />
        <span className={cn("truncate flex-1", getDisplayLabel() === placeholder ? "text-tx-tertiary" : getLabelClass())}>
          {getDisplayLabel()}
        </span>
        {selectedDate && (
          <button
            onClick={handleClear}
            className="p-0.5 rounded-full hover:bg-app-active text-tx-tertiary hover:text-tx-primary shrink-0 ml-0.5"
            title="清除日期"
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Calendar Dropdown Popover */}
      {isOpen && (
        <div
          className={cn(
            "absolute mt-1.5 bg-app-elevated border border-app-border rounded-xl shadow-2xl z-[100] p-3 w-64 animate-in fade-in slide-in-from-top-1 duration-150",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <button
              onClick={prevMonth}
              className="p-1 hover:bg-app-hover rounded-lg text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-bold text-tx-primary">
              {format(currentMonth, "yyyy年 M月", { locale: zhCN })}
            </span>
            <button
              onClick={nextMonth}
              className="p-1 hover:bg-app-hover rounded-lg text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Weekday labels */}
          <div className="grid grid-cols-7 gap-0.5 mb-1 text-center">
            {weekDays.map((d, i) => (
              <span key={i} className="text-[10px] font-bold text-tx-tertiary">
                {d}
              </span>
            ))}
          </div>

          {/* Days Grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((day, idx) => {
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
              const isDayToday = isToday(day);

              return (
                <button
                  key={idx}
                  onClick={() => handleDateClick(day)}
                  type="button"
                  className={cn(
                    "h-7 w-7 rounded-lg text-[11px] flex items-center justify-center transition-all focus:outline-none",
                    !isCurrentMonth ? "text-tx-tertiary/30" : "text-tx-secondary",
                    isCurrentMonth && "hover:bg-app-hover hover:text-tx-primary",
                    isDayToday && !isSelected && "border border-accent-primary/40 text-accent-primary font-semibold",
                    isSelected && "bg-accent-primary text-white font-bold shadow-sm"
                  )}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>

          {/* Footer controls */}
          <div className="flex items-center justify-between border-t border-app-border/40 mt-3 pt-2 px-0.5">
            <button
              onClick={() => handleDateClick(new Date())}
              type="button"
              className="text-[10px] font-semibold text-accent-primary hover:underline transition-all"
            >
              今天
            </button>
            {selectedDate && (
              <button
                onClick={handleClear}
                type="button"
                className="text-[10px] font-semibold text-tx-tertiary hover:text-accent-danger transition-all"
              >
                清除
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
