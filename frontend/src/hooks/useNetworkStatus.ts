/**
 * useNetworkStatus — 网络在线/离线状态探测
 * =========================================================================
 *   1) navigator.onLine + online/offline
 *   2) 定期探活后端（GET health，平滑超时）
 *   3) 全局 API 调通自动即时恢复在线状态（无需等待探活周期）
 *   4) Capacitor 回前台时立即探活（Android 后台切网常见）
 *   5) online 恢复时 flush offlineQueue
 *   6) 连续失败阈值 + 近期成功宽限，避免本地 dev 单次探活抖动误报离线
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { App as CapApp } from "@capacitor/app";
import { getProbeHealthUrl } from "@/lib/api";
import { flushQueue, getQueueLength, subscribe } from "@/lib/offlineQueue";
import { offlineQueueFetch } from "@/lib/offlineQueueFetch";
import { isNativePlatform } from "@/hooks/useCapacitor";

import { logger } from "@/lib/logger";

const PROBE_INTERVAL = 30_000;
const PROBE_TIMEOUT_MS = 6_000;
/** 连续探活失败达到此次数才标离线（设备 offline 事件仍立即离线） */
const FAIL_THRESHOLD = 2;
/** 近期 API 成功宽限：此窗口内的单次探活失败不直接离线 */
const ALIVE_GRACE_MS = 20_000;

const aliveListeners = new Set<() => void>();
/** 模块级：任意 API 成功时间，供探活宽限判断 */
let lastAliveAt = 0;

/** 当任何常规 API 调通成功时调用，立刻反向恢复在线状态 */
export function notifyNetworkAlive() {
  lastAliveAt = Date.now();
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
  const consecutiveFailuresRef = useRef(0);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  const probe = useCallback(async (): Promise<boolean> => {
    // 设备层已断网时不必打后端
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return false;
    }
    const url = getProbeHealthUrl();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res.ok || res.status === 404 || res.status === 405;
    } catch (err) {
      logger.warn("network", "health probe failed", {
        url,
        err: err instanceof Error ? err.message : String(err),
      });
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
      consecutiveFailuresRef.current = 0;
      lastAliveAt = Date.now();
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

  /**
   * 探活失败时的离线判定（带阈值与宽限）。
   * forceImmediate：浏览器 offline 事件 / navigator 已断 → 立即离线。
   */
  const markProbeFailure = useCallback(
    (opts?: { forceImmediate?: boolean; reason?: string }) => {
      if (opts?.forceImmediate) {
        consecutiveFailuresRef.current = FAIL_THRESHOLD;
        setIsOnline(false);
        return;
      }

      consecutiveFailuresRef.current += 1;
      const fails = consecutiveFailuresRef.current;
      const withinGrace = lastAliveAt > 0 && Date.now() - lastAliveAt < ALIVE_GRACE_MS;

      // 近期 API 仍通：忽略单次探活抖动，但累计失败
      if (withinGrace && fails < FAIL_THRESHOLD + 1) {
        logger.warn("network", "probe miss within alive grace, stay online", {
          fails,
          reason: opts?.reason,
        });
        return;
      }

      if (fails < FAIL_THRESHOLD) {
        logger.warn("network", "probe miss, waiting for consecutive failures", {
          fails,
          threshold: FAIL_THRESHOLD,
          reason: opts?.reason,
        });
        return;
      }

      if (isOnlineRef.current) {
        logger.warn("network", "marking offline after consecutive probe failures", {
          fails,
          reason: opts?.reason,
        });
      }
      setIsOnline(false);
    },
    [],
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
      if (alive) markOnline(true);
      else markProbeFailure({ reason: "browser-online-but-health-failed" });
    };

    const handleOffline = () => {
      markProbeFailure({ forceImmediate: true, reason: "browser-offline-event" });
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const runProbe = async (reason: string) => {
      const alive = await probe();
      if (alive) markOnline(true);
      else markProbeFailure({ reason });
    };

    const interval = setInterval(() => {
      void runProbe("interval");
    }, PROBE_INTERVAL);

    // 首探：失败时不立即离线（等阈值），避免后端冷启动闪一下
    void runProbe("initial");

    // 原生：从后台回前台立刻探活（比等 30s 更及时）
    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      const p = CapApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;
        void runProbe("app-foreground");
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
  }, [probe, markOnline, markProbeFailure]);

  useEffect(() => {
    const unsub = subscribe((count: number) => setPendingCount(count));
    return unsub;
  }, []);

  return { isOnline, wasOffline, pendingCount, flush: doFlush };
}
