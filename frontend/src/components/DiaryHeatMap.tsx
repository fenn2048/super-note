import React, { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface DailyDiaryStat {
  date: string; // YYYY-MM-DD
  count: number;
}

interface DiaryHeatMapProps {
  stats: DailyDiaryStat[];
  onDateSelect?: (date: string) => void;
}

const DAILY_MS = 24 * 60 * 60 * 1000;

/**
 * DiaryHeatMap - 日记统计热力图（参考 memos 的 UsageHeatMap）
 * 显示最近 10 周的日记发布统计
 */
export default function DiaryHeatMap({ stats, onDateSelect }: DiaryHeatMapProps) {
  const [currentStat, setCurrentStat] = useState<DailyDiaryStat | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 生成最近 10 周的日期网格
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayTime = today.getTime();
  
  // 周一为第一天（中文习惯）
  const dayOfWeek = today.getDay();
  const dayOffset = (dayOfWeek === 0 ? 6 : dayOfWeek - 1); // 0=Monday, 6=Sunday
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - dayOffset);

  // 生成 10 周 (70 天)
  const days: Date[] = [];
  for (let i = 0; i < 70; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  // 构建统计 map
  const statMap = new Map<string, number>();
  for (const s of stats) {
    statMap.set(s.date, s.count);
  }

  const getColorLevel = (count: number): string => {
    if (count === 0) return "";
    if (count <= 1) return "bg-accent-primary/30";
    if (count <= 2) return "bg-accent-primary/50";
    if (count <= 4) return "bg-accent-primary/70";
    return "bg-accent-primary";
  };

  const formatDate = (date: Date): string => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const handleItemClick = useCallback((date: Date) => {
    const dateStr = formatDate(date);
    const count = statMap.get(dateStr) || 0;
    if (count > 0) {
      setCurrentStat({ date: dateStr, count });
      onDateSelect?.(dateStr);
    }
  }, [statMap, onDateSelect]);

  // 数据统计
  const totalCount = stats.reduce((sum, s) => sum + s.count, 0);
  const activeDays = stats.filter(s => s.count > 0).length;

  // 日期提示 Tooltip
  const handleMouseEnter = useCallback((e: React.MouseEvent, date: Date) => {
    const dateStr = formatDate(date);
    const count = statMap.get(dateStr) || 0;
    if (count === 0) return;

    const target = e.target as HTMLElement;
    const bounds = target.getBoundingClientRect();
    const tooltip = document.createElement("div");
    tooltip.className = "diary-heatmap-tooltip";
    tooltip.textContent = `${dateStr}: ${count} 条说说`;
    tooltip.style.position = "fixed";
    tooltip.style.left = `${bounds.left + bounds.width / 2}px`;
    tooltip.style.top = `${bounds.top - 8}px`;
    tooltip.style.transform = "translateX(-50%) translateY(-100%)";
    tooltip.style.fontSize = "12px";
    tooltip.style.padding = "6px 10px";
    tooltip.style.backgroundColor = "var(--app-elevated, #1f2937)";
    tooltip.style.color = "var(--tx-primary, #fff)";
    tooltip.style.borderRadius = "8px";
    tooltip.style.whiteSpace = "nowrap";
    tooltip.style.zIndex = "1000";
    tooltip.style.pointerEvents = "none";
    tooltip.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.25)";
    tooltip.style.fontWeight = "500";
    document.body.appendChild(tooltip);
  }, [statMap]);

  const handleMouseLeave = useCallback(() => {
    const tooltips = document.querySelectorAll(".diary-heatmap-tooltip");
    tooltips.forEach(t => t.remove());
  }, []);

  // 按周分组
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {/* 热力图标题 */}
      <div className="text-xs font-semibold text-tx-secondary px-1 mb-1">
        说说动态
      </div>

      {/* 热力图网格 */}
      <div className="flex flex-col gap-1.5">
        {/* 周几标签 */}
        <div className="flex items-center gap-1 px-1">
          <div className="w-7 h-6" /> {/* 与第一列对齐 */}
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
            <div key={day} className="w-6 h-6 flex items-center justify-center text-[10px] text-tx-tertiary font-medium">
              {day}
            </div>
          ))}
        </div>

        {/* 热力图 */}
        <div className="flex flex-col gap-1">
          {weeks.map((week, weekIdx) => (
            <div key={weekIdx} className="flex items-center gap-1">
              {/* 周号 */}
              <div className="w-7 text-[9px] text-tx-tertiary text-center font-medium opacity-60">
                W{weekIdx + 1}
              </div>
              {/* 7 天方格 */}
              {week.map((date, dayIdx) => {
                if (!date) {
                  return (
                    <div key={dayIdx} className="w-6 h-6 rounded-sm" />
                  );
                }
                const dateStr = formatDate(date);
                const count = statMap.get(dateStr) || 0;
                const isToday = dateStr === formatDate(today);
                const isSelected = currentStat?.date === dateStr;

                return (
                  <button
                    key={dayIdx}
                    onClick={() => handleItemClick(date)}
                    onMouseEnter={(e) => handleMouseEnter(e, date)}
                    onMouseLeave={handleMouseLeave}
                    title={`${dateStr}: ${count} 条说说`}
                    className={cn(
                      "w-6 h-6 rounded-sm transition-all duration-200",
                      count === 0
                        ? "bg-app-hover/30 border border-app-border/30 hover:border-app-border/60"
                        : cn(
                            "border border-app-border/50 cursor-pointer hover:scale-110 hover:shadow-md",
                            getColorLevel(count),
                            isSelected && "ring-2 ring-accent-primary scale-110 shadow-lg",
                            isToday && "ring-2 ring-accent-primary/60 shadow-sm"
                          )
                    )}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 统计信息 */}
      <div className="flex items-center justify-between text-xs text-tx-secondary px-1 mt-2 pt-2 border-t border-app-border/40">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-tx-primary">{totalCount}</span>
          <span>条说说</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-tx-primary">{activeDays}</span>
          <span>天活跃</span>
        </div>
      </div>

      {/* 颜色图例 */}
      <div className="flex items-center justify-between text-[10px] text-tx-tertiary px-1">
        <span>少</span>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-sm bg-app-hover/30 border border-app-border/30" />
          <div className="w-4 h-4 rounded-sm bg-accent-primary/30" />
          <div className="w-4 h-4 rounded-sm bg-accent-primary/50" />
          <div className="w-4 h-4 rounded-sm bg-accent-primary/70" />
          <div className="w-4 h-4 rounded-sm bg-accent-primary" />
        </div>
        <span>多</span>
      </div>
    </div>
  );
}
