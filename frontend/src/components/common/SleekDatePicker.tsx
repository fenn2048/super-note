import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
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
import { zhCN, enUS } from "date-fns/locale";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface SleekDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  align?: "left" | "right";
  variant?: "default" | "mobile-form";
}

export default function SleekDatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  className,
  align = "left",
  variant = "default"
}: SleekDatePickerProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language.startsWith("zh") ? zhCN : enUS;
  const headerFormat = i18n.language.startsWith("zh") ? "yyyy年 M月" : "MMMM yyyy";

  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; showAbove: boolean } | null>(null);

  // Parse current value string into Date object, default to today if empty/invalid
  const selectedDate = value ? parse(value, "yyyy-MM-dd", new Date()) : null;

  // Format label to show to user
  const getDisplayLabel = () => {
    if (!selectedDate) return placeholder;
    if (isToday(selectedDate)) return t("calendar.today");
    if (isTomorrow(selectedDate)) return t("calendar.tomorrow", { defaultValue: "明天" });
    
    // Check if past (overdue)
    if (isPast(selectedDate)) {
      return `${t("calendar.overdue", { defaultValue: "逾期" })} ${format(selectedDate, "MM/dd")}`;
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

  const updateCoords = () => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const calendarWidth = 256;
    const calendarHeight = popoverRef.current ? popoverRef.current.offsetHeight : 310;
    
    const spaceBelow = window.innerHeight - rect.bottom;
    const showAbove = spaceBelow < calendarHeight && rect.top > calendarHeight;
    
    let top = rect.bottom + 6;
    if (showAbove) {
      top = rect.top - calendarHeight - 6;
    }
    
    let left = align === "right" ? rect.right - calendarWidth : rect.left;
    if (left + calendarWidth > window.innerWidth) {
      left = window.innerWidth - calendarWidth - 8;
    }
    if (left < 8) {
      left = 8;
    }
    
    setCoords({
      top,
      left,
      showAbove
    });
  };

  // Click outside listener to close calendar
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const clickedTrigger = containerRef.current && containerRef.current.contains(target);
      const clickedPopover = popoverRef.current && popoverRef.current.contains(target);
      if (!clickedTrigger && !clickedPopover) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    updateCoords();
    
    const timeoutId = setTimeout(updateCoords, 0);
    const handleScrollOrResize = () => {
      updateCoords();
    };
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize, true);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize, true);
    };
  }, [isOpen, align]);

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

  const weekDays = [
    t("calendar.monday", { defaultValue: "一" }),
    t("calendar.tuesday", { defaultValue: "二" }),
    t("calendar.wednesday", { defaultValue: "三" }),
    t("calendar.thursday", { defaultValue: "四" }),
    t("calendar.friday", { defaultValue: "五" }),
    t("calendar.saturday", { defaultValue: "六" }),
    t("calendar.sunday", { defaultValue: "日" })
  ];

  return (
    <div ref={containerRef} className={cn("relative select-none", variant === "mobile-form" ? "block w-full" : "inline-block", className)}>
      {/* Trigger Button */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          variant === "mobile-form"
            ? "flex items-center gap-2 px-3 py-2.5 rounded-xl border border-app-border bg-app-surface text-xs cursor-pointer transition-all hover:bg-app-hover/80 hover:border-app-border/80 w-full min-w-0"
            : "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-app-border bg-app-sidebar/80 text-xs cursor-pointer transition-all hover:bg-app-hover/80 hover:border-app-border/80 min-w-[90px]",
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
            title={t("calendar.clearDate", { defaultValue: "清除日期" })}
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Calendar Dropdown Popover */}
      {isOpen && coords && createPortal(
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            pointerEvents: "auto",
          }}
          className="bg-app-elevated border border-app-border rounded-xl shadow-2xl z-[9999] p-3 w-64"
        >
          {/* Calendar Header */}
          <div className="flex items-center justify-between mb-3 px-1">
            <button
              onClick={prevMonth}
              type="button"
              className="p-1 hover:bg-app-hover rounded-lg text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-bold text-tx-primary">
              {format(currentMonth, headerFormat, { locale: currentLocale })}
            </span>
            <button
              onClick={nextMonth}
              type="button"
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
              {t("calendar.today")}
            </button>
            {selectedDate && (
              <button
                onClick={handleClear}
                type="button"
                className="text-[10px] font-semibold text-tx-tertiary hover:text-accent-danger transition-all"
              >
                {t("calendar.clear", { defaultValue: "清除" })}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
