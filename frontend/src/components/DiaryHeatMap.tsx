import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

interface DailyDiaryStat {
  date: string; // YYYY-MM-DD
  count: number;
}

interface DiaryHeatMapProps {
  stats: DailyDiaryStat[];
  onDateSelect?: (date: string) => void;
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * DiaryHeatMap - 说说热力图（仿 Memos 风格）
 * 显示最近若干周的说发布统计，支持点击过滤。
 */
export default function DiaryHeatMap({ stats, onDateSelect }: DiaryHeatMapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ---- 构建日期网格（列=周，行=周日~周六，即 Sunday-start） ----
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = formatDate(today);

  // 最后一列以今天所在周的周六为结尾
  const dayOfWeek = today.getDay();
  const satOffset = dayOfWeek === 6 ? 0 : 6 - dayOfWeek;
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + satOffset);

  const TOTAL_WEEKS = 12;
  const gridStart = new Date(gridEnd);
  // 从周六往前推 (TOTAL_WEEKS * 7 - 1) 天，第一天必然是周日
  gridStart.setDate(gridStart.getDate() - (TOTAL_WEEKS * 7 - 1));

  // 按 列=周, 行=周几 填充
  const grid: (Date | null)[][] = [];
  const d = new Date(gridStart);
  for (let col = 0; col < TOTAL_WEEKS; col++) {
    const week: (Date | null)[] = [];
    for (let row = 0; row < 7; row++) {
      const cellDate = new Date(d);
      week.push(cellDate.getTime() <= today.getTime() ? cellDate : null);
      d.setDate(d.getDate() + 1);
    }
    grid.push(week);
  }

  // ---- 统计 map ----
  const statMap = new Map<string, number>();
  for (const s of stats) {
    statMap.set(s.date, s.count);
  }

  // ---- 绿色渐变色阶 ----
  const getColorClass = (count: number): string => {
    if (count === 0) return "bg-neutral-200/50 dark:bg-neutral-800/50 hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70";
    if (count === 1) return "bg-emerald-400/50 dark:bg-emerald-500/40";
    if (count === 2) return "bg-emerald-400/75 dark:bg-emerald-500/65";
    if (count === 3) return "bg-emerald-500 dark:bg-emerald-400";
    return "bg-emerald-600 dark:bg-emerald-300";
  };

  // ---- 统计 ----
  const totalCount = useMemo(() => {
    return stats.reduce((sum, s) => sum + s.count, 0);
  }, [stats]);

  // 计算第一次发布到现在的天数（如果没数据，默认 1 天）
  const daysCount = useMemo(() => {
    if (stats.length === 0) return 1;
    const dates = stats.map((s) => new Date(s.date).getTime());
    const minDate = Math.min(...dates);
    const diffMs = Date.now() - minDate;
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays);
  }, [stats]);

  return (
    <div className="flex flex-col gap-1.5 select-none relative">
      <div className="flex items-center gap-1.5">
        {/* 左侧：网格 */}
        <div className="flex-1 min-w-0">
          <div className="flex gap-0.5">
            {grid.map((week, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-0.5">
                {week.map((date, rowIdx) => {
                  if (!date) {
                    return <div key={rowIdx} className="w-[14px] h-[14px]" />;
                  }
                  const dateStr = formatDate(date);
                  const count = statMap.get(dateStr) || 0;
                  const isToday = dateStr === todayStr;
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={rowIdx}
                      type="button"
                      onClick={() => {
                        if (count > 0) {
                          setSelectedDate(dateStr);
                          onDateSelect?.(dateStr);
                        }
                      }}
                      onMouseEnter={() => count > 0 && setHoveredCell({ date: dateStr, count })}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={cn(
                        "w-[14px] h-[14px] rounded-[4px] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out duration-150 relative",
                        count === 0
                          ? "bg-neutral-100/40 dark:bg-neutral-900/40 border border-neutral-300 dark:border-neutral-700/70"
                          : cn(
                              "cursor-pointer hover:ring-1 hover:ring-tx-primary/30 [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 hover:shadow-sm",
                              getColorClass(count),
                              isToday && "ring-1.5 ring-neutral-900/60 dark:ring-neutral-200/60 shadow-sm",
                              isSelected && "ring-1.5 ring-tx-primary scale-125 shadow-md",
                            ),
                      )}
                      aria-label={`${dateStr}: ${count} 条`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：周几标签 */}
        <div className="flex flex-col gap-0.5 ml-1.5 select-none shrink-0">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={cn(
                "h-[14px] w-[20px] flex items-center text-[9px] font-medium leading-none shrink-0",
                (i === 0 || i === 2 || i === 4 || i === 6)
                  ? "text-tx-tertiary/60"
                  : "text-transparent",
              )}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* 底部：总数说明与 Tooltip 提示 */}
      <div className="flex items-center justify-between text-[10px] text-tx-tertiary/60 font-normal pl-0.5 mt-0.5 h-3">
        <span>
          {daysCount} 天内 {totalCount} 条说说
        </span>

        {hoveredCell && (
          <span className="text-[9px] text-tx-tertiary font-medium animate-in fade-in duration-100">
            {hoveredCell.date} · {hoveredCell.count} 条
          </span>
        )}
      </div>
    </div>
  );
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
