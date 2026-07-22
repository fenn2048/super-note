/**
 * useNetworkStatus — 网络在线/离线状态探测
 * =========================================================================
 *   1) navigator.onLine + online/offline
 *   2) 定期探活后端（GET /api/health，平滑 6s 超时）
 *   3) 全局 API 调通自动即时恢复在线状态（无需等待 30s 探活）
 *   4) Capacitor 回前台时立即探活（Android 后台切网常见）
 *   5) online 恢复时 flush offlineQueue
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { getBaseUrl } from "@/lib/api";
import { flushQueue, getQueueLength, subscribe } from "@/lib/offlineQueue";
import { offlineQueueFetch } from "@/lib/offlineQueueFetch";
import { isNativePlatform } from "@/hooks/useCapacitor";

import { logger } from "@/lib/logger";

const PROBE_INTERVAL = 30_000;

const aliveListeners = new Set<() => void>();

/** 当任何常规 API 调通成功时调用，立刻反向恢复在线状态 */
export function notifyNetworkAlive() {
  aliveListeners.forEach((fn) => fn());
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [wasOffline, setWasOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => getQueueLength());
  const flushingRef = useRef(false);
  const wasOfflineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const probe = useCallback(async (): Promise<boolean> => {
    // 设备层已断网时不必打后端
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return false;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(`${getBaseUrl()}/health`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok || res.status === 404 || res.status === 405;
    } catch {
      return false;
    }
  }, []);

  const doFlush = useCallback(async () => {
    if (flushingRef.current) return;
    if (getQueueLength() === 0) return;
    flushingRef.current = true;
    try {
      await flushQueue(offlineQueueFetch);
    } finally {
      flushingRef.current = false;
      setPendingCount(getQueueLength());
    }
  }, []);

  const markOnline = useCallback(
    (alive: boolean) => {
      if (!alive) {
        setIsOnline(false);
        return;
      }
      setIsOnline((prev) => {
        if (!prev) {
          setWasOffline(true);
          if (wasOfflineTimer.current) clearTimeout(wasOfflineTimer.current);
          wasOfflineTimer.current = setTimeout(() => setWasOffline(false), 5000);
        }
        return true;
      });
      if (getQueueLength() > 0) void doFlush();
    },
    [doFlush],
  );

  useEffect(() => {
    const handleAliveSignal = () => {
      markOnline(true);
    };
    aliveListeners.add(handleAliveSignal);
    return () => {
      aliveListeners.delete(handleAliveSignal);
    };
  }, [markOnline]);

  useEffect(() => {
    const handleOnline = async () => {
      const alive = await probe();
      markOnline(alive);
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(async () => {
      const alive = await probe();
      if (alive) markOnline(true);
      else setIsOnline(false);
    }, PROBE_INTERVAL);

    void probe().then((alive) => {
      if (alive) markOnline(true);
      else setIsOnline(false);
    });

    // 原生：从后台回前台立刻探活（比等 30s 更及时）
    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      const p = CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        void probe().then((alive) => {
          if (alive) markOnline(true);
          else setIsOnline(false);
        });
      });
      removeApp = () => {
        void p.then((h) => h.remove());
      };
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
      if (wasOfflineTimer.current) clearTimeout(wasOfflineTimer.current);
      removeApp?.();
    };
  }, [probe, markOnline]);

  useEffect(() => {
    const unsub = subscribe((count: number) => setPendingCount(count));
    return unsub;
  }, []);

  return { isOnline, wasOffline, pendingCount, flush: doFlush };
}
