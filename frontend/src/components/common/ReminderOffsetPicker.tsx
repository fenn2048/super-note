import React from "react";
import { cn } from "@/lib/utils";

interface ReminderOffsetPickerProps {
  value: number;
  unit: 'minute' | 'hour' | 'day' | 'month' | 'year';
  onChangeValue: (val: number) => void;
  onChangeUnit: (unit: 'minute' | 'hour' | 'day' | 'month' | 'year') => void;
  disabled?: boolean;
}

export default function ReminderOffsetPicker({
  value,
  unit,
  onChangeValue,
  onChangeUnit,
  disabled = false,
}: ReminderOffsetPickerProps) {
  const units = [
    { value: 'minute', label: '分钟' },
    { value: 'hour', label: '小时' },
    { value: 'day', label: '天' },
    { value: 'month', label: '月' },
    { value: 'year', label: '年' },
  ];

  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-50 pointer-events-none")}>
      <span className="text-xs text-tx-secondary shrink-0">提前</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          onChangeValue(isNaN(val) ? 0 : val);
        }}
        disabled={disabled}
        className="w-16 h-8 px-2 text-center text-xs rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:border-accent-primary"
      />
      <select
        value={unit}
        onChange={(e) => onChangeUnit(e.target.value as any)}
        disabled={disabled}
        className="sleek-select h-8 px-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-secondary focus:outline-none focus:border-accent-primary cursor-pointer"
      >
        {units.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
    </div>
  );
}
