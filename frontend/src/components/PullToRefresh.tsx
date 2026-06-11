import React, { useState, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";

export interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  children: React.ReactNode;
  className?: string;
}

export function PullToRefresh({
  onRefresh,
  children,
  className,
}: PullToRefreshProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pulling, setPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const touchStartY = useRef(0);
  const isAtTop = useRef(false);
  const { t } = useTranslation();

  const THRESHOLD = 70; // 触发刷新的下拉距离
  const MAX_PULL = 120; // 最大下拉距离

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;
    
    // 支持 radix scroll area 视口，以及标准 overflow-y-auto 容器，或者容器自身
    const scrollContainer = 
      containerRef.current?.querySelector("[data-radix-scroll-area-viewport]") || 
      containerRef.current?.querySelector(".overflow-y-auto") || 
      containerRef.current;

    isAtTop.current = !scrollContainer || scrollContainer.scrollTop <= 0;
    if (isAtTop.current) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isAtTop.current || refreshing) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY > 0) {
      // 应用阻尼效果：越往下拉越难拉
      const dampedDistance = Math.min(MAX_PULL, deltaY * 0.45);
      setPullDistance(dampedDistance);
      setPulling(true);

      // 达到阈值时触发触觉反馈
      if (dampedDistance >= THRESHOLD && pullDistance < THRESHOLD) {
        haptic.light();
      }
    } else {
      setPulling(false);
      setPullDistance(0);
    }
  }, [refreshing, pullDistance]);

  const handleTouchEnd = useCallback(async () => {
    if (!pulling) return;

    if (pullDistance >= THRESHOLD) {
      setRefreshing(true);
      setPullDistance(THRESHOLD * 0.6); // 刷新时保持一定偏移显示 loading
      haptic.medium();
      try {
        await onRefresh();
        haptic.success();
      } catch {
        haptic.error();
      }
      setRefreshing(false);
    }

    setPulling(false);
    setPullDistance(0);
  }, [pulling, pullDistance, onRefresh]);

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={cn("relative flex-1 flex flex-col overflow-hidden", className)}
    >
      {/* 下拉刷新指示器 */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-center z-10 pointer-events-none transition-opacity"
        style={{
          height: `${Math.max(pullDistance, 0)}px`,
          opacity: pullDistance > 10 ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2 text-tx-tertiary">
          <RefreshCw
            size={16}
            className={cn(
              "transition-transform",
              refreshing && "animate-spin",
              pullDistance >= THRESHOLD && !refreshing && "text-accent-primary"
            )}
            style={{
              transform: refreshing
                ? undefined
                : `rotate(${Math.min(pullDistance / THRESHOLD, 1) * 360}deg)`,
            }}
          />
          <span className="text-xs">
            {refreshing
              ? t("noteList.refreshing")
              : pullDistance >= THRESHOLD
              ? t("noteList.releaseToRefresh")
              : t("noteList.pullToRefresh")}
          </span>
        </div>
      </div>

      {/* 内容区域 */}
      <div
        className="flex-1 flex flex-col min-h-0 transition-transform"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pulling ? "none" : "transform 0.3s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
