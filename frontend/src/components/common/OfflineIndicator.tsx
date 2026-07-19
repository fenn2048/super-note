/**
 * OfflineIndicator — 离线 / 待同步指示
 * Phase D：原生/移动端增加顶栏横条（安全区下），避免只在右下角小 pill 被遮挡。
 */

import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { WifiOff, CloudUpload, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { isNativePlatform } from "@/hooks/useCapacitor";

export default function OfflineIndicator() {
  const { isOnline, wasOffline, pendingCount, flush } = useNetworkStatus();

  if (isOnline && pendingCount === 0 && !wasOffline) return null;

  const showTopBar = !isOnline || wasOffline;

  return (
    <>
      {/* 顶栏：离线 / 刚恢复（移动 + 原生更醒目） */}
      {showTopBar && (
        <div
          className={cn(
            "fixed left-0 right-0 z-[9998] flex justify-center pointer-events-none",
            "md:top-3",
          )}
          style={{
            top: "var(--safe-area-top, 0px)",
            paddingTop: isNativePlatform() ? "4px" : undefined,
          }}
          role="status"
          aria-live="polite"
        >
          <div
            className={cn(
              "pointer-events-auto mx-3 mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs shadow-lg",
              !isOnline
                ? "bg-amber-600 text-white"
                : "bg-emerald-600/95 text-white",
            )}
          >
            {!isOnline ? (
              <>
                <WifiOff className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>网络不可用 · 已进入离线模式</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span>已恢复连接</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* 右下：待同步 + 桌面端补充离线 pill */}
      <div
        className={cn(
          "fixed z-[9999] flex flex-col items-end gap-2 pointer-events-none",
          "right-4 bottom-4",
          // 移动底栏避让
          "max-md:bottom-[calc(var(--mobile-tab-h,0px)+var(--safe-area-bottom,0px)+1rem)]",
        )}
      >
        {!isOnline && (
          <div className="pointer-events-auto md:flex hidden items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/90 text-white text-xs shadow-lg">
            <WifiOff className="w-3.5 h-3.5" aria-hidden />
            <span>离线模式</span>
          </div>
        )}

        {pendingCount > 0 && (
          <button
            type="button"
            onClick={() => {
              if (isOnline) flush();
            }}
            disabled={!isOnline}
            className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-500/90 hover:bg-blue-600/90 disabled:opacity-60 text-white text-xs shadow-lg transition-colors cursor-pointer disabled:cursor-default min-h-[40px]"
            title={isOnline ? "点击立即同步" : "等待网络恢复后自动同步"}
          >
            <CloudUpload className="w-3.5 h-3.5" aria-hidden />
            <span>待同步 {pendingCount} 条</span>
          </button>
        )}
      </div>
    </>
  );
}
