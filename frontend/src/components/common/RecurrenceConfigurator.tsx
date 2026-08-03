import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export interface RecurrenceRule {
  type: "weekly" | "interval" | "weekday" | "custom_weekdays" | "monthly" | "annually";
  value?: number; // for interval
  day?: number; // for weekly (0=Sun, 1=Mon, ..., 6=Sat) or monthly/annually (1-31)
  days?: number[]; // for custom_weekdays
  month?: number; // for annually (1-12)
}

interface RecurrenceConfiguratorProps {
  isRecurring: boolean;
  onChangeRecurring: (val: boolean) => void;
  rule: RecurrenceRule;
  onChangeRule: (rule: RecurrenceRule) => void;
  compact?: boolean;
}

const WEEKDAYS = [
  { label: "一", value: 1 },
  { label: "二", value: 2 },
  { label: "三", value: 3 },
  { label: "四", value: 4 },
  { label: "五", value: 5 },
  { label: "六", value: 6 },
  { label: "日", value: 0 },
];

export default function RecurrenceConfigurator({
  isRecurring,
  onChangeRecurring,
  rule,
  onChangeRule,
  compact = false,
}: RecurrenceConfiguratorProps) {
  const { t } = useTranslation();

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const type = e.target.value as RecurrenceRule["type"];
    const defaultRule: RecurrenceRule = { type };

    if (type === "interval") {
      defaultRule.value = 1;
    } else if (type === "weekly") {
      defaultRule.day = 1; // Monday default
    } else if (type === "custom_weekdays") {
      defaultRule.days = [1]; // Monday default
    } else if (type === "monthly") {
      defaultRule.day = 1; // 1st of month default
    } else if (type === "annually") {
      defaultRule.month = 1; // January default
      defaultRule.day = 1; // 1st day default
    }

    onChangeRule(defaultRule);
  };

  const handleWeeklyDayChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChangeRule({
      ...rule,
      day: parseInt(e.target.value, 10),
    });
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    onChangeRule({
      ...rule,
      value: isNaN(val) || val < 1 ? 1 : val,
    });
  };

  const handleMonthlyDayChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChangeRule({
      ...rule,
      day: parseInt(e.target.value, 10),
    });
  };

  const handleAnnuallyMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChangeRule({
      ...rule,
      month: parseInt(e.target.value, 10),
    });
  };

  const handleAnnuallyDayChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChangeRule({
      ...rule,
      day: parseInt(e.target.value, 10),
    });
  };

  const toggleCustomDay = (day: number) => {
    const currentDays = rule.days || [];
    let nextDays: number[];
    if (currentDays.includes(day)) {
      nextDays = currentDays.filter((d) => d !== day);
    } else {
      nextDays = [...currentDays, day].sort((a, b) => a - b);
    }
    // Don't allow empty days array
    if (nextDays.length === 0) {
      nextDays = [day];
    }
    onChangeRule({
      ...rule,
      days: nextDays,
    });
  };

  return (
    <div className={cn("space-y-2", compact ? "text-xs" : "text-sm")}>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 cursor-pointer font-medium text-tx-secondary select-none">
          <input
            type="checkbox"
            checked={isRecurring}
            onChange={(e) => onChangeRecurring(e.target.checked)}
            className="w-4 h-4 rounded border-app-border bg-app-bg text-accent-primary focus:ring-accent-primary cursor-pointer accent-accent-primary"
          />
          <span>周期任务</span>
        </label>
      </div>

      {isRecurring && (
        <div
          className={cn(
            "p-3 rounded-xl border border-app-border/60 bg-app-sidebar/20 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200",
            compact ? "flex flex-wrap items-center gap-3 space-y-0 py-2" : ""
          )}
        >
          {/* Cycle Type */}
          <div className={cn("flex items-center gap-2", compact ? "shrink-0" : "")}>
            <span className="text-tx-tertiary font-medium">类型:</span>
            <select
              value={rule.type}
              onChange={handleTypeChange}
              className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer min-w-[110px]"
            >
              <option value="weekday">每个工作日</option>
              <option value="weekly">每周固定一天</option>
              <option value="custom_weekdays">自定义周天</option>
              <option value="monthly">每个月固定一天</option>
              <option value="annually">每一年固定一天</option>
              <option value="interval">每隔几天</option>
            </select>
          </div>

          {/* Conditional Options */}
          {rule.type === "weekly" && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <span className="text-tx-tertiary font-medium">周几:</span>
              <select
                value={rule.day ?? 1}
                onChange={handleWeeklyDayChange}
                className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer min-w-[90px]"
              >
                <option value={1}>周一</option>
                <option value={2}>周二</option>
                <option value={3}>周三</option>
                <option value={4}>周四</option>
                <option value={5}>周五</option>
                <option value={6}>周六</option>
                <option value={0}>周日</option>
              </select>
            </div>
          )}

          {rule.type === "interval" && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <span className="text-tx-tertiary font-medium">间隔:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={rule.value ?? 1}
                  onChange={handleIntervalChange}
                  className="w-16 h-8 px-2 text-center text-xs rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:border-accent-primary"
                />
                <span className="text-tx-secondary text-xs">天</span>
              </div>
            </div>
          )}

          {rule.type === "monthly" && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <span className="text-tx-tertiary font-medium">几号:</span>
              <select
                value={rule.day ?? 1}
                onChange={handleMonthlyDayChange}
                className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer min-w-[75px]"
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}号
                  </option>
                ))}
              </select>
            </div>
          )}

          {rule.type === "annually" && (
            <div className="flex items-center gap-2 animate-in fade-in duration-150">
              <span className="text-tx-tertiary font-medium">月/日:</span>
              <div className="flex items-center gap-1">
                <select
                  value={rule.month ?? 1}
                  onChange={handleAnnuallyMonthChange}
                  className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer min-w-[70px]"
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {m}月
                    </option>
                  ))}
                </select>
                <select
                  value={rule.day ?? 1}
                  onChange={handleAnnuallyDayChange}
                  className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer min-w-[70px]"
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}号
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {rule.type === "custom_weekdays" && (
            <div className={cn("flex items-center gap-2 animate-in fade-in duration-150", compact ? "w-full mt-1.5 pt-1.5 border-t border-app-border/30" : "")}>
              <span className="text-tx-tertiary font-medium shrink-0">选择:</span>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((day) => {
                  const active = (rule.days || []).includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleCustomDay(day.value)}
                      className={cn(
                        "w-6 h-6 rounded-md text-[10px] font-bold border transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out flex items-center justify-center",
                        active
                          ? "bg-accent-primary border-transparent text-white shadow-sm shadow-accent-primary/20"
                          : "bg-app-bg border-app-border text-tx-tertiary hover:text-tx-primary hover:border-app-border-hover"
                      )}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
