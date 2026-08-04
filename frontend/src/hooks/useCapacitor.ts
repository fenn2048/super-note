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
 * 判断 App 当前是否为深色模式（多源，避免 next-themes 未 hydration 时 class 未就绪）。
 * 优先级：html class → localStorage 偏好 → 系统 prefers-color-scheme
 */
export function isAppDarkMode(): boolean {
  if (typeof document === "undefined") return false;
  const root = document.documentElement;
  if (root.classList.contains("dark")) return true;
  if (root.classList.contains("light")) return false;
  try {
    const stored = localStorage.getItem("super-note-theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    // "system" 或未设置：跟系统
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** 读 CSS 主题色；失败时回退到 index.css 默认纸感/墨底 */
function readThemeSurfaceColors(isDark: boolean): { bg: string; elevated: string } {
  try {
    const cs = getComputedStyle(document.documentElement);
    const bg = (cs.getPropertyValue("--color-bg") || "").trim();
    const elevated =
      (cs.getPropertyValue("--color-elevated-solid") || "").trim() ||
      (cs.getPropertyValue("--color-elevated") || "").trim();
    // color-mix / rgba 无法直接喂给 Android Color.parseColor，只接受 #hex
    const hex = (v: string, fallback: string) =>
      /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v) ? v : fallback;
    return {
      bg: hex(bg, isDark ? "#16131c" : "#f3efe6"),
      elevated: hex(elevated, isDark ? "#252033" : "#fffaf2"),
    };
  } catch {
    return {
      bg: isDark ? "#16131c" : "#f3efe6",
      elevated: isDark ? "#252033" : "#fffaf2",
    };
  }
}

/** 同步 Android 导航栏/状态栏实体色（MainActivity.AndroidSystemBarsBridge） */
function applyAndroidSystemBarsColors(statusHex: string, navHex: string, lightIconsBg: boolean) {
  try {
    const bridge = (window as unknown as {
      AndroidSystemBarsBridge?: {
        setColors: (s: string, n: string, light: boolean) => void;
      };
    }).AndroidSystemBarsBridge;
    bridge?.setColors?.(statusHex, navHex, lightIconsBg);
  } catch {
    /* bridge 尚未注入时忽略 */
  }
}

type AndroidSystemBarsBridge = {
  setColors?: (s: string, n: string, light: boolean) => void;
  setLight?: (light: boolean) => void;
  /** 视频全屏：隐藏状态栏 + 导航栏 */
  setImmersive?: (immersive: boolean) => void;
};

function getAndroidSystemBarsBridge(): AndroidSystemBarsBridge | undefined {
  try {
    return (window as unknown as { AndroidSystemBarsBridge?: AndroidSystemBarsBridge })
      .AndroidSystemBarsBridge;
  } catch {
    return undefined;
  }
}

/**
 * Android 视频全屏沉浸态：隐藏系统状态栏与导航栏。
 * - 优先原生 WindowInsetsController（targetSdk 35 可靠）
 * - 并调用 Capacitor StatusBar.hide/show 双保险
 * 退出全屏时务必 setNativeImmersive(false) 恢复。
 */
export function setNativeImmersive(immersive: boolean) {
  if (!isNativePlatform()) return;
  try {
    if (immersive) {
      document.documentElement.setAttribute("data-video-immersive", "true");
    } else {
      document.documentElement.removeAttribute("data-video-immersive");
    }
  } catch {
    /* ignore */
  }

  const bridge = getAndroidSystemBarsBridge();
  try {
    bridge?.setImmersive?.(immersive);
  } catch {
    /* ignore */
  }

  if (immersive) {
    StatusBar.hide().catch(() => {});
  } else {
    StatusBar.show().catch(() => {});
    // 恢复主题色系统栏（hide 之后颜色/图标可能被系统重置）
    window.setTimeout(() => {
      if (!document.documentElement.hasAttribute("data-video-immersive")) {
        syncStatusBarToAppTheme();
      }
    }, 80);
  }
}

/**
 * 同步原生状态栏图标/背景色。
 * - isDarkSurface=true（深色背景）→ 白色时间/信号/电量（Style.Dark）
 * - isDarkSurface=false（浅色背景）→ 黑色时间/信号/电量（Style.Light）
 * 阅读器等全屏场景可临时覆盖；离开时用 syncStatusBarToAppTheme 恢复。
 *
 * 浅色务必用纸感米色（#f3efe6），不要 #ffffff——Honor 等机会在顶部留一条刺眼白带。
 */
export function applyNativeStatusBar(opts: {
  isDarkSurface: boolean;
  backgroundColor?: string;
  navigationColor?: string;
}) {
  if (!isNativePlatform()) return;
  const { isDarkSurface } = opts;
  const surfaces = readThemeSurfaceColors(isDarkSurface);
  const bg = opts.backgroundColor || surfaces.bg;
  const nav = opts.navigationColor || surfaces.elevated;
  // Style.Dark = 浅色内容（白字）；Style.Light = 深色内容（黑字）
  const style = isDarkSurface ? Style.Dark : Style.Light;
  const apply = () => {
    StatusBar.setStyle({ style }).catch(() => {});
    StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
    // lightIconsBg=true → 浅色底 + 深色图标
    applyAndroidSystemBarsColors(bg, nav, !isDarkSurface);
  };
  apply();
  // Android 偶发首帧被系统/其它 effect 覆盖，短延迟再刷一次
  window.setTimeout(apply, 50);
  window.setTimeout(apply, 200);
}

/** 按当前 App 明暗主题恢复状态栏（与 useStatusBarSync 一致） */
export function syncStatusBarToAppTheme() {
  if (typeof document === "undefined") return;
  const isDark = isAppDarkMode();
  const surfaces = readThemeSurfaceColors(isDark);
  applyNativeStatusBar({
    isDarkSurface: isDark,
    backgroundColor: surfaces.bg,
    navigationColor: surfaces.elevated,
  });
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

    // Android 15+ (targetSdk 35) 强制 Edge-to-Edge：setOverlaysWebView(false) 往往无效，
    // 且会与系统栏颜色/安全区打架。统一走 overlay:true，由 CSS --safe-area-* 避让。
    // MainActivity 还会通过 WindowInsets 注入更准的 --android-*-height。
    const ensureOverlay = () => {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    };
    ensureOverlay();
    const timer = setTimeout(ensureOverlay, 500);

    // 测量 env(safe-area-inset-*)；Honor/MagicOS 上常为 0，此时保留 CSS 硬兜底，
    // 等 MainActivity.injectSafeAreaCss 用真实 WindowInsets 覆盖。
    let applyStatusBarHeight: (() => void) | null = null;
    if (platform === "android") {
      const readEnvInset = (prop: string): number => {
        try {
          const probe = document.createElement("div");
          probe.style.cssText =
            `position:fixed;top:0;left:0;width:0;height:env(${prop},0px);visibility:hidden;pointer-events:none;`;
          document.body.appendChild(probe);
          const h = probe.getBoundingClientRect().height;
          document.body.removeChild(probe);
          return h;
        } catch {
          return 0;
        }
      };

      applyStatusBarHeight = () => {
        const topInset = readEnvInset("safe-area-inset-top");
        const bottomInset = readEnvInset("safe-area-inset-bottom");

        // 仅当 env 给出可信值时才写入；否则交给 CSS 兜底 / 原生 WindowInsets 注入
        if (topInset > 0) {
          document.documentElement.style.setProperty(
            "--android-status-bar-height",
            `${topInset}px`,
          );
        }
        if (bottomInset > 0) {
          document.documentElement.style.setProperty(
            "--android-nav-bar-height",
            `${bottomInset}px`,
          );
        } else if (!document.documentElement.style.getPropertyValue("--android-nav-bar-height")) {
          // 尚无原生注入时给手势条机型更稳妥的 32px（Magic7 底部指示条区域）
          document.documentElement.style.setProperty("--android-nav-bar-height", "32px");
        }
      };
      applyStatusBarHeight();
      window.visualViewport?.addEventListener("resize", applyStatusBarHeight);
      window.addEventListener("orientationchange", applyStatusBarHeight);
    }

    // 初始化时立即执行一次
    syncStatusBarToAppTheme();

    // 监听 <html> 的 class 变化（next-themes 通过修改 class 切换主题）
    // 阅读器 / 视频全屏沉浸态期间跳过，避免刷系统栏把 hide 顶掉
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          const root = document.documentElement;
          if (
            root.hasAttribute("data-reader-status-bar") ||
            root.hasAttribute("data-video-immersive")
          ) {
            return;
          }
          syncStatusBarToAppTheme();
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
 * 关键：防「双计」（工具栏/弹窗与键盘之间空出一整段键盘高度）
 *   1) layout 已被系统压矮（adjustResize / 部分 OEM）：fixed bottom:0 已在键盘上 → 写 0
 *   2) Chromium 把 fixed 自动推到 visualViewport 底：探针抬起 → 写 0
 *   3) adjustNothing + vv 缩：用 vvInset
 *   4) adjustNothing + vv 不缩：用 Capacitor plugin 高度
 *
 * 绝不要在未检测双计时无条件用 pluginHeight —— 会把 UI 再抬高一整段键盘高度。
 */
export function useKeyboardLayout() {
  useEffect(() => {
    if (!isNativePlatform()) return;

    let pluginHeight = 0;
    let keyboardOpen = false;
    let lastWritten = -1;
    /** 键盘收起时的 layout 高度，用于判断系统是否在弹键盘时压矮了 WebView */
    let layoutHeightWhenClosed = window.innerHeight || 0;
    /**
     * 本轮键盘会话的 inset 策略：
     * - "pending"：尚未稳定，允许探测
     * - "zero"：系统/引擎已处理，固定写 0（防 300→0→300 抖动）
     * - "manual"：需要我们叠 --keyboard-height
     * 同一次键盘弹起期间不在 zero/manual 之间来回跳。
     */
    let sessionMode: "pending" | "zero" | "manual" = "pending";
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let showRaf1 = 0;
    let showRaf2 = 0;

    // ── 探针：实测 fixed bottom:0 是否已被引擎推到可视区底部 ──
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;bottom:0;left:-9999px;width:1px;height:1px;" +
      "pointer-events:none;z-index:-99999;opacity:0;";
    document.body.appendChild(probe);

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

    /**
     * fixed bottom:0 是否已在「当前 layout 视口」底部之上。
     * true → 浏览器已处理，--keyboard-height 必须为 0，否则双计。
     */
    const isFixedAutoRepositioned = (): boolean => {
      try {
        const vh = window.innerHeight || 0;
        if (vh <= 0) return false;
        const probeBottom = probe.getBoundingClientRect().bottom;
        // 探针底边距 layout 底 > 50px → 已被抬到 visualViewport 底
        return vh - probeBottom > 50;
      } catch {
        return false;
      }
    };

    /** layout 视口是否已相对键盘关闭时明显变矮（系统 adjustResize 等） */
    const isLayoutShrunkByKeyboard = (): boolean => {
      const vh = window.innerHeight || 0;
      if (vh <= 0 || layoutHeightWhenClosed <= 0) return false;
      return layoutHeightWhenClosed - vh >= 80;
    };

    const softCap = (h: number): number => {
      const vh = window.innerHeight || 0;
      if (vh <= 0) return Math.max(0, h);
      let out = Math.max(0, Math.round(h));
      if (out > 0 && out < 80) out = 0;
      // 键盘一般不超过屏高 55%；过高多半是双计或异常上报
      const maxH = Math.floor(vh * 0.55);
      if (out > maxH) out = maxH;
      return out;
    };

    /**
     * 计算 fixed / sheet 应使用的 bottom inset（写入 --keyboard-height）。
     */
    const resolveInset = (): number => {
      const vvInset = readVvInset();

      if (!keyboardOpen) {
        // plugin 未报开，但 vv 已明显缩 → 仍视为键盘打开
        if (vvInset < 80) return 0;
        keyboardOpen = true;
      }

      // 已锁定 zero：本会话不再叠高度（避免弹窗 bottom 来回跳）
      if (sessionMode === "zero") {
        return 0;
      }

      // ① layout 已被系统压矮 / ② 引擎自动抬 fixed
      if (isLayoutShrunkByKeyboard() || isFixedAutoRepositioned()) {
        sessionMode = "zero";
        return 0;
      }

      // 已锁定 manual：优先用当前测量，不切回 zero（除非上面条件）
      if (sessionMode === "manual") {
        if (vvInset >= 80) return softCap(vvInset);
        if (pluginHeight > 0) return softCap(pluginHeight);
        return lastWritten > 0 ? lastWritten : 0;
      }

      // pending：择优
      if (vvInset >= 80) {
        sessionMode = "manual";
        return softCap(vvInset);
      }
      if (pluginHeight > 0) {
        sessionMode = "manual";
        return softCap(pluginHeight);
      }

      return 0;
    };

    const writeInset = (force = false) => {
      const next = resolveInset();
      // 非 force 时：忽略小幅抖动（≤8px），减少 sheet 闪烁
      if (!force && Math.abs(next - lastWritten) <= 8) return;
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

    const resetWindowScroll = () => {
      if (window.scrollY > 0) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleSettleWrite = () => {
      // 等几何稳定后再写一次；合并 willShow/didShow 的多次回调
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        settleTimer = null;
        resetWindowScroll();
        writeInset(true);
      }, 48);
    };

    const onPluginShow = (height: number) => {
      // 在 layout 可能被压矮之前尽量锁一次关闭态高度（若已缩则保持旧基线）
      if (!keyboardOpen && !isLayoutShrunkByKeyboard()) {
        layoutHeightWhenClosed = window.innerHeight || layoutHeightWhenClosed;
      }
      const wasOpen = keyboardOpen;
      keyboardOpen = true;
      pluginHeight = Math.max(0, Math.round(height || 0));
      // 新一轮键盘会话才重置策略
      if (!wasOpen) {
        sessionMode = "pending";
      }
      resetWindowScroll();
      // 双 rAF + 短延时：等 vv / 探针稳定，避免 0↔plugin 来回写
      if (showRaf1) cancelAnimationFrame(showRaf1);
      if (showRaf2) cancelAnimationFrame(showRaf2);
      showRaf1 = requestAnimationFrame(() => {
        showRaf2 = requestAnimationFrame(() => {
          resetWindowScroll();
          writeInset(true);
          scheduleSettleWrite();
        });
      });
    };

    const onPluginHide = () => {
      keyboardOpen = false;
      pluginHeight = 0;
      sessionMode = "pending";
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      if (showRaf1) cancelAnimationFrame(showRaf1);
      if (showRaf2) cancelAnimationFrame(showRaf2);
      showRaf1 = 0;
      showRaf2 = 0;
      resetWindowScroll();
      lastWritten = -1;
      writeInset(true);
      // 收起后再采基线（等 layout 恢复）
      requestAnimationFrame(() => {
        layoutHeightWhenClosed = window.innerHeight || layoutHeightWhenClosed;
      });
    };

    // visualViewport：键盘期间持续校正（部分 OEM 只缩 vv 不缩 layout）
    const onVvChange = () => {
      if (!keyboardOpen) {
        const inset = readVvInset();
        if (inset >= 80) {
          keyboardOpen = true;
          sessionMode = "pending";
        } else {
          // 键盘关闭时同步基线
          if (!isLayoutShrunkByKeyboard()) {
            layoutHeightWhenClosed = window.innerHeight || layoutHeightWhenClosed;
          }
          return;
        }
      }
      resetWindowScroll();
      // 会话已锁定时避免每帧重写；pending 时轻量校正
      writeInset(false);
    };

    const vv = window.visualViewport;
    vv?.addEventListener("resize", onVvChange);
    vv?.addEventListener("scroll", onVvChange);
    window.addEventListener("scroll", resetWindowScroll);

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
      window.removeEventListener("scroll", resetWindowScroll);
      if (settleTimer) clearTimeout(settleTimer);
      if (showRaf1) cancelAnimationFrame(showRaf1);
      if (showRaf2) cancelAnimationFrame(showRaf2);
      willShowHandler.then((h) => h.remove());
      didShowHandler.then((h) => h.remove());
      willHideHandler.then((h) => h.remove());
      didHideHandler.then((h) => h.remove());
      probe.remove();
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

/** 提前量提醒 id（历史兼容：仅 task.id） */
function taskAdvanceNotifId(taskId: string): number {
  return hashStringToInt(taskId);
}
/** 截止日当天提醒 id */
function taskDueNotifId(taskId: string): number {
  return hashStringToInt(`${taskId}#due`);
}

/**
 * Parse remindAt / dueDate into a local Date for AlarmManager scheduling.
 * Supports: YYYY-MM-DD, YYYY-MM-DD HH:mm, ISO T/Z.
 * Date-only defaults to 09:00 local (same as historical behavior).
 */
export function parseRemindAtToLocalDate(remindAt: string): Date | null {
  if (!remindAt || typeof remindAt !== "string") return null;
  const s = remindAt.trim();
  if (!s) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    return new Date(y, m - 1, d, 9, 0, 0, 0);
  }

  // Local wall clock without timezone suffix
  const localDt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (localDt && !s.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(
      Number(localDt[1]),
      Number(localDt[2]) - 1,
      Number(localDt[3]),
      Number(localDt[4]),
      Number(localDt[5]),
      localDt[6] ? Number(localDt[6]) : 0,
      0,
    );
  }

  // ISO with Z / offset, or other Date-parseable forms
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** 兼容 Task / ProjectTask 字段 */
export type TaskLikeForReminder = {
  id: string;
  title: string;
  isCompleted?: number | boolean;
  remindAt?: string | null;
  dueDate?: string | null;
  endDate?: string | null;
};

function taskDueField(task: TaskLikeForReminder): string | null {
  return task.endDate || task.dueDate || null;
}

function sameMinute(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / 60_000) === Math.floor(b.getTime() / 60_000);
}

/**
 * 双提醒计划：
 * 1) 提前量：remindAt（若设置）
 * 2) 截止日：endDate/dueDate 当天（date-only 默认 09:00；与提前量同一分钟则去重只留一条）
 */
export function buildTaskReminderSlots(task: TaskLikeForReminder): Array<{
  kind: "advance" | "due";
  at: Date;
  title: string;
  body: string;
  id: number;
}> {
  const slots: Array<{
    kind: "advance" | "due";
    at: Date;
    title: string;
    body: string;
    id: number;
  }> = [];
  if (task.isCompleted) return slots;

  let advanceAt: Date | null = null;
  if (task.remindAt) {
    advanceAt = parseRemindAtToLocalDate(task.remindAt);
    if (advanceAt && !isNaN(advanceAt.getTime()) && advanceAt.getTime() > Date.now()) {
      slots.push({
        kind: "advance",
        at: advanceAt,
        title: "任务提醒",
        body: task.title,
        id: taskAdvanceNotifId(task.id),
      });
    }
  }

  const dueStr = taskDueField(task);
  if (dueStr) {
    const dueAt = parseRemindAtToLocalDate(dueStr);
    if (dueAt && !isNaN(dueAt.getTime()) && dueAt.getTime() > Date.now()) {
      // 与提前量同一分钟则不再重复调度截止提醒
      if (!advanceAt || !sameMinute(advanceAt, dueAt)) {
        slots.push({
          kind: "due",
          at: dueAt,
          title: "截止提醒",
          body: `【今天截止】${task.title}`,
          id: taskDueNotifId(task.id),
        });
      }
    }
  }

  return slots;
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

export async function syncTaskNotification(task: Task | TaskLikeForReminder) {
  if (!isNativePlatform()) return;
  try {
    const advanceId = taskAdvanceNotifId(task.id);
    const dueId = taskDueNotifId(task.id);
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: advanceId }, { id: dueId }],
      });
    } catch {}

    if (task.isCompleted) return;

    const slots = buildTaskReminderSlots(task as TaskLikeForReminder);
    if (slots.length === 0) return;

    const granted = await checkAndRequestPermissions();
    if (!granted) return;

    await LocalNotifications.schedule({
      notifications: slots.map((s) => ({
        title: s.title,
        body: s.body,
        id: s.id,
        channelId: NOTIF_CHANNEL_TASKS,
        schedule: { at: s.at, allowWhileIdle: true },
        extra: { taskId: task.id, kind: s.kind },
      })),
    });
  } catch (err) {
    console.error("syncTaskNotification failed:", err);
  }
}

export async function syncAllTaskNotifications(tasks: Array<Task | TaskLikeForReminder>) {
  if (!isNativePlatform()) return;
  try {
    const granted = await checkAndRequestPermissions();
    if (!granted) return;

    const pending = await LocalNotifications.getPending();
    const pendingIds = new Set(pending.notifications.map((n) => n.id));

    const notificationsToSchedule: any[] = [];
    const idsToKeep = new Set<number>();

    for (const task of tasks) {
      const advanceId = taskAdvanceNotifId(task.id);
      const dueId = taskDueNotifId(task.id);

      if (task.isCompleted) {
        for (const id of [advanceId, dueId]) {
          if (pendingIds.has(id)) {
            await LocalNotifications.cancel({ notifications: [{ id }] });
          }
        }
        continue;
      }

      const slots = buildTaskReminderSlots(task as TaskLikeForReminder);
      if (slots.length === 0) {
        for (const id of [advanceId, dueId]) {
          if (pendingIds.has(id)) {
            await LocalNotifications.cancel({ notifications: [{ id }] });
          }
        }
        continue;
      }

      for (const s of slots) {
        idsToKeep.add(s.id);
        notificationsToSchedule.push({
          title: s.title,
          body: s.body,
          id: s.id,
          channelId: NOTIF_CHANNEL_TASKS,
          schedule: { at: s.at, allowWhileIdle: true },
          extra: { taskId: task.id, kind: s.kind },
        });
      }
      // cancel orphan of the pair not in slots
      for (const id of [advanceId, dueId]) {
        if (!idsToKeep.has(id) && pendingIds.has(id)) {
          await LocalNotifications.cancel({ notifications: [{ id }] });
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

export type NotificationDiagnostics = {
  isNative: boolean;
  displayPermission: string;
  exactAlarm: string | null;
  pendingCount: number;
  pendingPreview: Array<{ id: number; title?: string; body?: string; at?: string }>;
  dualReminderNote: string;
};

/** 设置页「通知诊断」数据 */
export async function getNotificationDiagnostics(): Promise<NotificationDiagnostics> {
  const base: NotificationDiagnostics = {
    isNative: isNativePlatform(),
    displayPermission: "n/a",
    exactAlarm: null,
    pendingCount: 0,
    pendingPreview: [],
    dualReminderNote: "每个有截止日的任务会调度：提前量提醒 + 截止日当天提醒（同一时刻去重）",
  };
  if (!isNativePlatform()) return base;

  try {
    await ensureNotificationChannels();
    const perm = await LocalNotifications.checkPermissions();
    base.displayPermission = perm.display || "unknown";
  } catch {
    base.displayPermission = "error";
  }

  try {
    const exact = await LocalNotifications.checkExactNotificationSetting();
    base.exactAlarm = exact.exact_alarm || "unknown";
  } catch {
    base.exactAlarm = "unsupported";
  }

  try {
    const pending = await LocalNotifications.getPending();
    base.pendingCount = pending.notifications?.length || 0;
    base.pendingPreview = (pending.notifications || []).slice(0, 8).map((n: any) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      at: n.schedule?.at
        ? new Date(n.schedule.at).toLocaleString()
        : undefined,
    }));
  } catch {
    base.pendingCount = -1;
  }

  return base;
}

export async function requestNotificationPermission(): Promise<string> {
  if (!isNativePlatform()) return "n/a";
  await ensureNotificationChannels();
  const status = await LocalNotifications.requestPermissions();
  return status.display || "unknown";
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await LocalNotifications.changeExactNotificationSetting();
  } catch (e) {
    console.warn("[notifications] changeExactNotificationSetting failed", e);
    throw e;
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
