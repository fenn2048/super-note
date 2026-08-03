import React, { useState, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";
import { rubberband } from "@/lib/motion";

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
  const crossedThreshold = useRef(false);
  const { t } = useTranslation();

  const THRESHOLD = 70; // 触发刷新的下拉距离
  /** 参考尺寸：用于 Apple-style rubberband 归一化 */
  const RUBBER_DIM = 280;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (refreshing) return;

    // 支持 radix scroll area 视口，以及标准 overflow-y-auto 容器，或者容器自身
    const scrollContainer =
      containerRef.current?.querySelector("[data-radix-scroll-area-viewport]") ||
      containerRef.current?.querySelector(".overflow-y-auto") ||
      containerRef.current;

    isAtTop.current = !scrollContainer || scrollContainer.scrollTop <= 0;
    crossedThreshold.current = false;
    if (isAtTop.current) {
      touchStartY.current = e.touches[0].clientY;
    }
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isAtTop.current || refreshing) return;
    const deltaY = e.touches[0].clientY - touchStartY.current;
    if (deltaY > 0) {
      // Apple rubber-band：越过阈值后阻力递增，非硬夹 / 线性系数
      const dampedDistance = rubberband(deltaY, RUBBER_DIM, 0.55);
      setPullDistance(dampedDistance);
      setPulling(true);

      if (dampedDistance >= THRESHOLD && !crossedThreshold.current) {
        crossedThreshold.current = true;
        haptic.light();
      } else if (dampedDistance < THRESHOLD) {
        crossedThreshold.current = false;
      }
    } else {
      setPulling(false);
      setPullDistance(0);
    }
  }, [refreshing]);

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
        className="absolute top-0 left-0 right-0 flex items-center justify-center z-10 pointer-events-none transition-opacity duration-micro ease-out"
        style={{
          height: `${Math.max(pullDistance, 0)}px`,
          opacity: pullDistance > 10 ? 1 : 0,
        }}
      >
        <div className="flex items-center gap-2 text-tx-tertiary">
          <RefreshCw
            size={16}
            className={cn(
              "transition-transform duration-press ease-out",
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

      {/* 内容区域：拖动中 1:1 无 transition；松手 ease-out 回落 */}
      <div
        className="flex-1 flex flex-col min-h-0"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : undefined,
          transition: pulling ? "none" : "transform 280ms var(--ease-out)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
