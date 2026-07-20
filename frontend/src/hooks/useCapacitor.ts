import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Keyboard } from "@capacitor/keyboard";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Task } from "@/types";

/** 判断是否运行在原生平台（Android / iOS） */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

// ---------------------------------------------------------------------------
// 模块加载时立刻把 `data-native` 标记写到 <html>，让 CSS 里 html[data-native="..."]
// 的安全区兜底（见 index.css）从 **首次渲染** 起就生效。如果等到 useStatusBarSync
// 的 useEffect 才设置，登录页 / SplashGate 等先渲染的组件会拿不到 --safe-area-top
// 的兜底值，导致顶栏贴住状态栏。
// ---------------------------------------------------------------------------
if (typeof document !== "undefined") {
  try {
    const platform = Capacitor.getPlatform(); // "android" | "ios" | "web"
    if (platform === "android" || platform === "ios") {
      document.documentElement.setAttribute("data-native", platform);
    }
  } catch {
    /* 非浏览器环境忽略 */
  }
}

/**
 * P0 / PR2 / Phase D: Android 返回键 + Predictive Back + Web Escape
 *
 * 优先走 useMobileBackStack 注册的层；无层可关时：原生双击退出。
 * Manifest 已开 enableOnBackInvokedCallback，与系统预测性返回动画对齐。
 * 层 dismiss 时派发 super:back-layer-dismissed，便于做过渡。
 */
export function useMobileBackButton(options?: {
  /** 再按退出时的提示文案；传 null 则只震动不 toast */
  exitHint?: string | null;
}) {
  const lastBackPress = useRef(0);
  const exitHint = options?.exitHint === undefined ? "再按一次退出应用" : options.exitHint;

  useEffect(() => {
    let cancelled = false;

    const handleBack = async (canGoBack?: boolean) => {
      const { tryDismissTopBackLayer, getBackLayerIds } = await import(
        "@/hooks/useMobileBackStack"
      );
      const hadLayers = getBackLayerIds().length > 0;
      if (tryDismissTopBackLayer()) {
        try {
          window.dispatchEvent(
            new CustomEvent("super:back-layer-dismissed", {
              detail: { remaining: getBackLayerIds().length },
            }),
          );
        } catch {
          /* ignore */
        }
        return;
      }

      // 无业务层时：若 WebView 历史可回退且非 SPA 根，交给 history（兼容部分外链页）
      if (canGoBack && window.history.length > 1) {
        const path = window.location.pathname + window.location.hash;
        if (path !== "/" && path !== "/#" && path !== "/#/" && !path.endsWith("#/")) {
          window.history.back();
          return;
        }
      }

      if (!isNativePlatform()) return;

      const now = Date.now();
      if (now - lastBackPress.current < 2000) {
        CapApp.exitApp();
        return;
      }
      lastBackPress.current = now;
      haptic.warning();
      if (exitHint) {
        try {
          const { toast } = await import("@/lib/toast");
          toast.info(exitHint);
        } catch {
          /* toast 不可用时忽略 */
        }
      }
      // 避免 unused
      void hadLayers;
    };

    const cleanups: Array<() => void> = [];

    if (isNativePlatform()) {
      const handlerPromise = CapApp.addListener(
        "backButton",
        (ev: { canGoBack?: boolean }) => {
          if (!cancelled) void handleBack(ev?.canGoBack);
        },
      );
      cleanups.push(() => {
        handlerPromise.then((h) => h.remove());
      });
    }

    // Web / 桌面调试：Escape 只关层，不退出
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      void import("@/hooks/useMobileBackStack").then(({ tryDismissTopBackLayer }) => {
        if (tryDismissTopBackLayer()) {
          e.preventDefault();
        }
      });
    };
    window.addEventListener("keydown", onKey);
    cleanups.push(() => window.removeEventListener("keydown", onKey));

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [exitHint]);
}

/**
 * @deprecated 使用 useMobileBackButton + useRegisterBackLayer
 * 保留薄包装，避免外部旧调用直接炸；内部忽略参数，依赖全局栈。
 */
export function useBackButton(_opts?: {
  mobileView?: "list" | "editor";
  mobileSidebarOpen?: boolean;
  onBackToList?: () => void;
  onCloseSidebar?: () => void;
}) {
  useMobileBackButton();
}

/**
 * P1: Splash Screen 控制
 * 在应用完成初始化渲染后手动隐藏启动屏
 */
export function hideSplashScreen() {
  if (!isNativePlatform()) return;
  SplashScreen.hide({ fadeOutDuration: 300 });
}

/**
 * P2: 状态栏与主题同步
 * 监听 HTML class 变化，自动切换状态栏样式
 * 确保状态栏不覆盖 WebView 内容
 */
export function useStatusBarSync() {
  useEffect(() => {
    if (!isNativePlatform()) return;

    // 标注当前原生平台：CSS 里根据 html[data-native="android"] 切换 --safe-area-top
    // 策略（详见 index.css），避免 Android overlay:false 下 env() 恒为 0 的坑
    const platform = Capacitor.getPlatform(); // "android" | "ios" | "web"
    document.documentElement.setAttribute("data-native", platform);

    // 确保状态栏不覆盖 WebView 内容（状态栏占据独立空间，不盖住返回按钮）
    // 延迟执行确保原生层已就绪
    const ensureNoOverlay = () => {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    };
    ensureNoOverlay();
    // 延迟再执行一次，防止初始化时序问题
    const timer = setTimeout(ensureNoOverlay, 500);

    // Android overlay:false 下 env(safe-area-inset-top) 永远是 0；
    // 但 Android 15+ (targetSdk>=35) 强制 Edge-to-Edge，setOverlaysWebView(false)
    // 在新系统上事实上不再生效——状态栏会持续 overlay 在 WebView 上。无论哪种
    // 情况，顶部都需要避让一段距离。
    //
    // 测量策略（按可信度从高到低尝试）：
    //   1) env(safe-area-inset-top)：浏览器规范的安全区，Capacitor 6+ Android 14+
    //      Edge-to-Edge 下能正确返回真实状态栏（含刘海避让）。最可信，优先使用。
    //   2) 兜底常量 28px：覆盖普通屏真实状态栏（Android 24dp ≈ 24-30px CSS）。
    //      故意不再用 `screen.height - visualViewport.height` 做差值估算——
    //      该差值在 Edge-to-Edge 下混合了状态栏 + 系统导航条 + 输入法等多种
    //      占用，硬分给顶部会导致顶部留白远大于真实状态栏（实测 70~80px），
    //      视觉上极不雅观。刘海屏由 (1) env() 提供真值即可，无需"猜"。
    //   - 只在 Android 上注入，iOS 走 env()
    let applyStatusBarHeight: (() => void) | null = null;
    if (platform === "android") {
      applyStatusBarHeight = () => {
        // 1) 先尝试读 env(safe-area-inset-top) —— 临时塞进一个隐藏元素再 getComputedStyle
        let topInset = 0;
        try {
          const probe = document.createElement("div");
          probe.style.cssText =
            "position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none;";
          document.body.appendChild(probe);
          const rect = probe.getBoundingClientRect();
          topInset = rect.height;
          document.body.removeChild(probe);
        } catch {
          /* ignore */
        }

        // 2) 兜底：env() 失效时使用 28px 常量。不再做差值估算，避免误差。
        //    刘海/挖孔屏 env() 通常正常返回 36-50px+，由 (1) 自动覆盖。
        const finalTop = topInset > 0 ? topInset : 28;

        document.documentElement.style.setProperty(
          "--android-status-bar-height",
          `${finalTop}px`,
        );
        // Android 15+ Edge-to-Edge 下底部导航/手势栏也是 overlay。
        // 兜底 24px（手势条 16dp + 少量呼吸），与 CSS 兜底保持一致。
        document.documentElement.style.setProperty(
          "--android-nav-bar-height",
          `24px`,
        );
      };
      applyStatusBarHeight();
      // 旋转屏或 splitscreen 变化后重新测量
      window.visualViewport?.addEventListener("resize", applyStatusBarHeight);
      window.addEventListener("orientationchange", applyStatusBarHeight);
    }

    const updateStatusBar = () => {
      const isDark = document.documentElement.classList.contains("dark");
      StatusBar.setStyle({
        style: isDark ? Style.Dark : Style.Light,
      }).catch(() => {});
      StatusBar.setBackgroundColor({
        color: isDark ? "#0d1117" : "#ffffff",
      }).catch(() => {});
    };

    // 初始化时立即执行一次
    updateStatusBar();

    // 监听 <html> 的 class 变化（next-themes 通过修改 class 切换主题）
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          updateStatusBar();
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => {
      clearTimeout(timer);
      observer.disconnect();
      if (applyStatusBarHeight) {
        window.visualViewport?.removeEventListener("resize", applyStatusBarHeight);
        window.removeEventListener("orientationchange", applyStatusBarHeight);
      }
    };
  }, []);
}

/**
 * P5: 键盘弹出布局适配
 * ------------------------------------------------------------------
 * 不动 body/html 尺寸，只写 CSS 变量 `--keyboard-height`，由 sheet / 工具栏
 * 通过 `bottom: var(--keyboard-height)` 贴键盘顶。
 *
 * 关键：防「双计」
 *   - 若 WebView 实际走了 resize（visualViewport 已缩小），fixed bottom:0
 *     本身已在键盘上方 → 必须写 0，再叠加 plugin 高度会把 UI 顶飞。
 *   - 若真正 adjustNothing 叠层（vv 不缩），才用 Capacitor plugin 高度。
 *
 * 优先序：visualViewport inset →（仅 vv≈0 时）plugin 高度 → 软上限。
 */
export function useKeyboardLayout() {
  useEffect(() => {
    if (!isNativePlatform()) return;

    let pluginHeight = 0;
    let keyboardOpen = false;
    let lastWritten = -1;

    const readVvInset = (): number => {
      try {
        const vv = window.visualViewport;
        if (!vv) return 0;
        const vh = window.innerHeight || 0;
        if (vh <= 0) return 0;
        return Math.max(0, Math.round(vh - vv.height - (vv.offsetTop || 0)));
      } catch {
        return 0;
      }
    };

    const softCap = (h: number): number => {
      const vh = window.innerHeight || 0;
      if (vh <= 0) return Math.max(0, h);
      const maxH = Math.floor(vh * 0.45);
      const typicalH = Math.floor(vh * 0.38);
      let out = Math.max(0, Math.round(h));
      if (out > 0 && out < 80) out = 0;
      if (out > maxH) out = typicalH;
      return out;
    };

    /**
     * 计算 fixed 元素应使用的 bottom inset：
     *
     *   vvInset = innerHeight - vv.offsetTop - vv.height
     *
     * 三种机型：
     *   1) adjustResize（layout 已缩）：vv 几乎铺满 layout → vvInset≈0 → bottom:0 ✓
     *   2) adjustNothing + vv 仍缩：vvInset≈真实键盘高 → 用 vvInset ✓
     *   3) adjustNothing + vv 不缩：vvInset≈0 → 用 plugin 高度 ✓
     *
     * 绝不要「vvInset>0 就写 0」——那会在 (2) 把工具栏压到键盘下面。
     */
    const resolveInset = (): number => {
      const vvInset = readVvInset();
      if (!keyboardOpen && vvInset < 80) return 0;

      // visualViewport 给出的 inset 最贴近「layout 底到可视区底」
      if (vvInset >= 80) {
        return softCap(vvInset);
      }

      // vv 无感知：退回 Capacitor 原生高度
      if (pluginHeight > 0) {
        return softCap(pluginHeight);
      }

      return 0;
    };

    const writeInset = (force = false) => {
      const next = resolveInset();
      if (!force && next === lastWritten) return;
      lastWritten = next;
      document.documentElement.style.setProperty("--keyboard-height", `${next}px`);
      document.documentElement.style.setProperty(
        "--keyboard-height-raw",
        `${Math.max(0, Math.round(pluginHeight))}px`,
      );
      if (keyboardOpen) {
        document.documentElement.setAttribute("data-keyboard", "open");
      } else {
        document.documentElement.removeAttribute("data-keyboard");
      }
    };

    const onPluginShow = (height: number) => {
      keyboardOpen = true;
      pluginHeight = Math.max(0, Math.round(height || 0));
      writeInset(true);
      requestAnimationFrame(() => {
        const activeEl = document.activeElement;
        if (activeEl && "scrollIntoView" in activeEl) {
          (activeEl as HTMLElement).scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        }
      });
    };

    const onPluginHide = () => {
      keyboardOpen = false;
      pluginHeight = 0;
      writeInset(true);
    };

    // visualViewport：键盘期间持续校正（部分 OEM 只缩 vv 不缩 layout）
    const onVvChange = () => {
      const inset = readVvInset();
      if (inset >= 80) keyboardOpen = true;
      else if (!keyboardOpen) return;
      writeInset();
    };

    const vv = window.visualViewport;
    vv?.addEventListener("resize", onVvChange);
    vv?.addEventListener("scroll", onVvChange);

    const willShowHandler = Keyboard.addListener("keyboardWillShow", (info) => {
      onPluginShow(info.keyboardHeight);
    });
    const didShowHandler = Keyboard.addListener("keyboardDidShow", (info) => {
      onPluginShow(info.keyboardHeight);
    });
    const willHideHandler = Keyboard.addListener("keyboardWillHide", () => {
      onPluginHide();
    });
    const didHideHandler = Keyboard.addListener("keyboardDidHide", () => {
      onPluginHide();
    });

    return () => {
      vv?.removeEventListener("resize", onVvChange);
      vv?.removeEventListener("scroll", onVvChange);
      willShowHandler.then((h) => h.remove());
      didShowHandler.then((h) => h.remove());
      willHideHandler.then((h) => h.remove());
      didHideHandler.then((h) => h.remove());
      document.documentElement.style.setProperty("--keyboard-height", "0px");
      document.documentElement.style.setProperty("--keyboard-height-raw", "0px");
      document.documentElement.removeAttribute("data-keyboard");
    };
  }, []);
}

/**
 * P7: 触觉反馈工具函数
 * 在关键交互时提供震动反馈，提升操作手感
 */
export const haptic = {
  /** 轻触反馈 - 用于普通点击操作（切换收藏、置顶等） */
  light: () => {
    if (!isNativePlatform()) return;
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  },

  /** 中等反馈 - 用于重要操作（删除、移动笔记等） */
  medium: () => {
    if (!isNativePlatform()) return;
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  },

  /** 重度反馈 - 用于危险操作确认（永久删除等） */
  heavy: () => {
    if (!isNativePlatform()) return;
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  },

  /** 成功通知 - 用于操作成功（保存完成、同步成功等） */
  success: () => {
    if (!isNativePlatform()) return;
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  },

  /** 警告通知 - 用于提醒操作（双击返回退出提示等） */
  warning: () => {
    if (!isNativePlatform()) return;
    Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
  },

  /** 错误通知 - 用于操作失败（保存失败、网络错误等） */
  error: () => {
    if (!isNativePlatform()) return;
    Haptics.notification({ type: NotificationType.Error }).catch(() => {});
  },

  /** 选择反馈 - 用于列表项选中、切换开关等 */
  selection: () => {
    if (!isNativePlatform()) return;
    Haptics.selectionStart().catch(() => {});
    Haptics.selectionEnd().catch(() => {});
  },
};

// ─── 通知渠道（与原生 NotificationChannels.java 对齐） ─────────────

/** 任务截止提醒 */
export const NOTIF_CHANNEL_TASKS = "fuyou_tasks";
/** 协作消息 / 提及 */
export const NOTIF_CHANNEL_MESSAGES = "fuyou_messages";
/** 后台同步（FGS 常驻） */
export const NOTIF_CHANNEL_SYNC = "fuyou_sync";

let channelsReady: Promise<void> | null = null;

/** 确保 Android 通知渠道存在（幂等） */
export async function ensureNotificationChannels(): Promise<void> {
  if (!isNativePlatform()) return;
  if (channelsReady) return channelsReady;
  channelsReady = (async () => {
    try {
      // 原生侧也建一遍（含删除旧渠道）
      try {
        const { registerPlugin } = await import("@capacitor/core");
        const AppPermissions = registerPlugin<{
          ensureNotificationChannels: () => Promise<{ ok: boolean }>;
        }>("AppPermissions");
        await AppPermissions.ensureNotificationChannels();
      } catch {
        /* web or missing plugin */
      }

      const defs: Array<{
        id: string;
        name: string;
        description: string;
        importance: number;
        visibility?: number;
      }> = [
        {
          id: NOTIF_CHANNEL_TASKS,
          name: "任务提醒",
          description: "任务截止与提醒时间到点通知",
          importance: 5,
        },
        {
          id: NOTIF_CHANNEL_MESSAGES,
          name: "消息与提及",
          description: "家庭协作消息、@提及等",
          importance: 5,
        },
        {
          id: NOTIF_CHANNEL_SYNC,
          name: "后台同步",
          description: "后台消息轮询与同步状态",
          importance: 2,
        },
      ];
      for (const ch of defs) {
        try {
          await LocalNotifications.createChannel({
            id: ch.id,
            name: ch.name,
            description: ch.description,
            importance: ch.importance as any,
            visibility: 1,
          });
        } catch {
          /* channel may already exist */
        }
      }
    } catch (e) {
      console.warn("[notifications] ensure channels failed", e);
    }
  })();
  return channelsReady;
}

// ─── 待办事项本地通知调度 ──────────────────────────────────────────

function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

async function checkAndRequestPermissions() {
  await ensureNotificationChannels();
  const status = await LocalNotifications.checkPermissions();
  if (status.display === "granted") return true;
  if (status.display === "prompt" || status.display === "prompt-with-rationale") {
    const requestStatus = await LocalNotifications.requestPermissions();
    return requestStatus.display === "granted";
  }
  return false;
}

export async function syncTaskNotification(task: Task) {
  if (!isNativePlatform()) return;
  try {
    const notificationId = hashStringToInt(task.id);
    try {
      await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
    } catch {}

    if (task.isCompleted || !task.remindAt) {
      return;
    }

    const hasTime = task.remindAt.includes(" ");
    const datePart = hasTime ? task.remindAt.split(" ")[0] : task.remindAt;
    const timePart = hasTime ? task.remindAt.split(" ")[1] : "09:00";
    const [year, month, day] = datePart.split("-").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    const scheduleDate = new Date(year, month - 1, day, hour, minute, 0);

    if (scheduleDate.getTime() > Date.now()) {
      const granted = await checkAndRequestPermissions();
      if (!granted) return;

      await LocalNotifications.schedule({
        notifications: [
          {
            title: "任务提醒",
            body: task.title,
            id: notificationId,
            channelId: NOTIF_CHANNEL_TASKS,
            schedule: { at: scheduleDate },
            extra: { taskId: task.id },
          },
        ],
      });
    }
  } catch (err) {
    console.error("syncTaskNotification failed:", err);
  }
}

export async function syncAllTaskNotifications(tasks: Task[]) {
  if (!isNativePlatform()) return;
  try {
    const granted = await checkAndRequestPermissions();
    if (!granted) return;

    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set(pending.notifications.map((n) => n.id));

    const notificationsToSchedule: any[] = [];
    const idsToKeep = new Set<number>();

    for (const task of tasks) {
      const notificationId = hashStringToInt(task.id);

      if (task.isCompleted || !task.remindAt) {
        if (pendingIds.has(notificationId)) {
          await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
        }
        continue;
      }

      const hasTime = task.remindAt.includes(" ");
      const datePart = hasTime ? task.remindAt.split(" ")[0] : task.remindAt;
      const timePart = hasTime ? task.remindAt.split(" ")[1] : "09:00";
      const [year, month, day] = datePart.split("-").map(Number);
      const [hour, minute] = timePart.split(":").map(Number);
      const scheduleDate = new Date(year, month - 1, day, hour, minute, 0);

      if (scheduleDate.getTime() > Date.now()) {
        idsToKeep.add(notificationId);
        notificationsToSchedule.push({
          title: "任务提醒",
          body: task.title,
          id: notificationId,
          channelId: NOTIF_CHANNEL_TASKS,
          schedule: { at: scheduleDate },
          extra: { taskId: task.id },
        });
      } else {
        if (pendingIds.has(notificationId)) {
          await LocalNotifications.cancel({ notifications: [{ id: notificationId }] });
        }
      }
    }

    for (const p of pending.notifications) {
      if (!idsToKeep.has(p.id)) {
        await LocalNotifications.cancel({ notifications: [{ id: p.id }] });
      }
    }

    if (notificationsToSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: notificationsToSchedule });
    }
  } catch (err) {
    console.error("syncAllTaskNotifications failed:", err);
  }
}

// ─── 实时消息本地通知触发 ──────────────────────────────────────────
export async function showLocalNotification(title: string, body: string, extra: any) {
  if (!isNativePlatform()) return;
  try {
    const granted = await checkAndRequestPermissions();
    if (!granted) return;

    const notificationId = Math.floor(Math.random() * 1000000) + 1;

    await LocalNotifications.schedule({
      notifications: [
        {
          title,
          body,
          id: notificationId,
          channelId: NOTIF_CHANNEL_MESSAGES,
          extra,
        },
      ],
    });
  } catch (err) {
    console.error("showLocalNotification failed:", err);
  }
}

// 注册通知点击跳转事件
if (typeof window !== "undefined" && isNativePlatform()) {
  try {
    LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const extra = action.notification.extra;
      if (extra) {
        if (extra.sourceType && extra.sourceId) {
          sessionStorage.setItem("super:pending-navigate", JSON.stringify({
            sourceType: extra.sourceType,
            sourceId: extra.sourceId
          }));
          window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
        } else if (extra.taskId) {
          sessionStorage.setItem("super:pending-navigate", JSON.stringify({
            sourceType: "task",
            sourceId: extra.taskId
          }));
          window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
        }
      } else {
        window.dispatchEvent(new CustomEvent("super:navigate-to-tasks"));
      }
    });
  } catch (err) {
    console.error("Failed to register localNotificationActionPerformed listener:", err);
  }
}
