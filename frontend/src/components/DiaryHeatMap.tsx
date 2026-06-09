import { useState } from "react";
import { cn } from "@/lib/utils";

interface DailyDiaryStat {
  date: string; // YYYY-MM-DD
  count: number;
}

interface DiaryHeatMapProps {
  stats: DailyDiaryStat[];
  onDateSelect?: (date: string) => void;
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * DiaryHeatMap - 说说热力图（仿 GitHub contribution graph）
 * 显示最近若干周的说发布统计，支持点击跳转到对应日期。
 */
export default function DiaryHeatMap({ stats, onDateSelect }: DiaryHeatMapProps) {
  const [hoveredCell, setHoveredCell] = useState<{ date: string; count: number } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ---- 构建日期网格（行=周一~周日，列=周） ----
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayStr = formatDate(today);

  // 以今天所在周的周日为网格最后一列
  const dayOfWeek = today.getDay();
  const sundayOffset = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + sundayOffset);

  const TOTAL_WEEKS = 12;
  const gridStart = new Date(gridEnd);
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

  // ---- 颜色等级（更温润的渐变色阶） ----
  const getColorClass = (count: number): string => {
    if (count === 0) return "bg-app-hover/30";
    if (count === 1) return "bg-emerald-200 dark:bg-emerald-800";
    if (count === 2) return "bg-emerald-300 dark:bg-emerald-700";
    if (count === 3) return "bg-emerald-400 dark:bg-emerald-600";
    return "bg-emerald-500 dark:bg-emerald-500";
  };

  // ---- 统计 ----
  const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
  const activeDays = stats.filter((s) => s.count > 0).length;

  return (
    <div className="flex flex-col gap-2.5 select-none">
      {/* 标题行：说说动态 + 总数 */}
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] font-semibold text-tx-secondary uppercase tracking-wide">
          说说动态
        </span>
        <span className="text-[10px] text-tx-tertiary tabular-nums">
          {totalCount} 条 · {activeDays} 天
        </span>
      </div>

      {/* 热力图主体 */}
      <div className="flex gap-0.5">
        {/* 左侧：周几标签 */}
        <div className="flex flex-col gap-0.5 mr-0.5">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={label}
              className={cn(
                "w-[18px] h-[14px] flex items-center justify-center text-[9px]",
                i % 2 === 0 ? "text-tx-tertiary/60" : "text-transparent",
              )}
            >
              {i % 2 === 0 ? label : ""}
            </div>
          ))}
        </div>

        {/* 右侧：网格 */}
        <div className="flex-1 min-w-0">
          {/* 格子 */}
          <div className="flex gap-0.5">
            {grid.map((week, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-0.5">
                {week.map((date, rowIdx) => {
                  if (!date) {
                    return <div key={rowIdx} className="w-[14px] h-[14px] rounded-[2px]" />;
                  }
                  const dateStr = formatDate(date);
                  const count = statMap.get(dateStr) || 0;
                  const isToday = dateStr === todayStr;
                  const isSelected = selectedDate === dateStr;

                  return (
                    <button
                      key={rowIdx}
                      onClick={() => {
                        if (count > 0) {
                          setSelectedDate(dateStr);
                          onDateSelect?.(dateStr);
                        }
                      }}
                      onMouseEnter={() => count > 0 && setHoveredCell({ date: dateStr, count })}
                      onMouseLeave={() => setHoveredCell(null)}
                      className={cn(
                        "w-[14px] h-[14px] rounded-[2px] transition-all duration-150",
                        count === 0
                          ? "bg-app-hover/20 border border-app-border/20 hover:border-app-border/40"
                          : cn(
                              "cursor-pointer hover:ring-1 hover:ring-tx-primary/30 hover:scale-125 hover:shadow-sm",
                              getColorClass(count),
                              isToday && "ring-1 ring-tx-primary/50 shadow-sm",
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
      </div>

      {/* 底部：颜色图例 + tooltip */}
      <div className="flex items-center justify-between px-1 pt-1 border-t border-app-border/30">
        {/* 图例 */}
        <div className="flex items-center gap-0.5">
          <span className="text-[8px] text-tx-tertiary/50 mr-0.5">少</span>
          <div className="w-3 h-3 rounded-[2px] bg-app-hover/20 border border-app-border/20" />
          <div className="w-3 h-3 rounded-[2px] bg-emerald-200 dark:bg-emerald-800" />
          <div className="w-3 h-3 rounded-[2px] bg-emerald-300 dark:bg-emerald-700" />
          <div className="w-3 h-3 rounded-[2px] bg-emerald-400 dark:bg-emerald-600" />
          <div className="w-3 h-3 rounded-[2px] bg-emerald-500 dark:bg-emerald-500" />
          <span className="text-[8px] text-tx-tertiary/50 ml-0.5">多</span>
        </div>

        {/* hover 提示 */}
        {hoveredCell && (
          <span className="text-[9px] text-tx-tertiary tabular-nums">
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
