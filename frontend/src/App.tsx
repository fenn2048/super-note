import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Home, NotebookPen, BookOpen, ListTodo, MoreHorizontal, Plus, Briefcase, Camera, Bell, CheckCheck, Film, User as UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/Sidebar";
import NavRail from "@/components/NavRail";
import { useRailMode } from "@/hooks/useRailMode";
import NoteList from "@/components/NoteList";
import Dashboard from "@/components/Dashboard";
import type { TabId } from "@/components/SettingsModal";

// 延时加载的重型组件
const DiaryCenter = React.lazy(() => import("@/components/DiaryCenter"));
const MentionList = React.lazy(() => import("@/components/MentionList"));
const SharedNoteView = React.lazy(() => import("@/components/SharedNoteView"));
const LoginPage = React.lazy(() => import("@/components/LoginPage"));
const QuickLoginGate = React.lazy(() => import("@/components/QuickLoginGate"));
const AppLockOverlay = React.lazy(() => import("@/components/AppLockOverlay"));
const QuickLoginEnrollDialog = React.lazy(() => import("@/components/QuickLoginEnrollDialog"));
const WhatsNewModal = React.lazy(() => import("@/components/WhatsNewModal"));
const SettingsModal = React.lazy(() => import("@/components/SettingsModal"));
const BrowserScreensaver = React.lazy(() => import("@/components/BrowserScreensaver"));
const MobileMorePage = React.lazy(() => import("@/components/MobileMorePage"));
const DiaryComposeModal = React.lazy(() => import("@/components/DiaryComposeModal"));
const EditorPane = React.lazy(() => import("@/components/EditorPane"));
const MindMapCenter = React.lazy(() => import("@/components/MindMapEditor"));
const AIChatPanel = React.lazy(() => import("@/components/AIChatPanel"));
const ProjectCenter = React.lazy(() => import("@/components/ProjectCenter"));
const LibraryCenter = React.lazy(() => import("@/components/LibraryCenter"));
const FinanceCenter = React.lazy(() => import("@/components/finance/FinanceCenter"));
import MobileCameraModal from "@/components/MobileCameraModal";
import GlobalMusicPlayer from "@/components/media/GlobalMusicPlayer";
import MobileTaskCreateModal from "@/components/MobileTaskCreateModal";
import FirstRunWizard from "@/components/FirstRunWizard";
import { AppProvider, useApp, useAppActions, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH } from "@/store/AppContext";
import { ThemeProvider } from "@/components/ThemeProvider";
import { SiteSettingsProvider, useSiteSettings } from "@/hooks/useSiteSettings";
import { UserPreferencesProvider, useUserPreferences } from "@/hooks/useUserPreferences";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider, prompt as appPrompt } from "@/components/ui/confirm";
import { toast } from "@/lib/toast";
import Toaster from "@/components/Toaster";
import { User, ViewMode } from "@/types";
import { api, getServerUrl, clearServerUrl, broadcastLogout, getCurrentWorkspace, setCurrentWorkspace } from "@/lib/api";
import {
  getAuthCacheScope,
  saveCachedAuthUser,
  loadCachedAuthUser,
} from "@/lib/authVerify";
import { bootstrap as syncBootstrap, teardown as syncTeardown } from "@/lib/syncEngine";
import { useMobileBackButton, hideSplashScreen, useStatusBarSync, useKeyboardLayout, isNativePlatform, showLocalNotification, haptic, ensureNotificationChannels } from "@/hooks/useCapacitor";
import { useShareReceive } from "@/hooks/useShareReceive";
import { useShellLayout } from "@/hooks/useShellLayout";
import { stashSharePayload, subscribeShareReceive } from "@/lib/shareReceive";
import { useRegisterBackLayer } from "@/hooks/useMobileBackStack";
import { useEditorSwipeBack } from "@/hooks/useEditorSwipeBack";
import { useDesktopMenuBridge } from "@/hooks/useDesktopMenuBridge";
import { useKeyboardVisible } from "@/hooks/useKeyboardVisible";
import { resetScrollHideBars } from "@/hooks/useScrollHideBars";
import CommandPalette from "@/components/common/CommandPalette";
import OfflineIndicator from "@/components/common/OfflineIndicator";
import UpdateNotifier from "@/components/common/UpdateNotifier";
import MobileChromeHeader, { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import { realtime } from "@/lib/realtime";
import {
  openTasksEntry,
  openPlansEntry,
  setLibraryTab,
  getMobileTabModules,
  shouldShowMobileTabBar,
  shouldShowMobileFAB,
  syncMobileShellCssVars,
} from "@/lib/navigation.config";
import AppSplashGate from "@/components/AppSplashGate";
import CreateMenu, { CreateFabButton } from "@/components/common/CreateMenu";
import { syncWorkspaceSplash } from "@/lib/splashSync";

import { App as CapApp } from "@capacitor/app";

/** 遗留 viewMode=tasks → 项目「我的任务」（任务模型方案 A） */
function TasksToProjectsRedirect() {
  const actions = useAppActions();
  useEffect(() => {
    openTasksEntry();
    actions.setViewMode("projects");
  }, [actions]);
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-accent-primary" />
    </div>
  );
}

/** 遗留 viewMode=plans → 项目壳内「我的计划」 */
function PlansToProjectsRedirect() {
  const actions = useAppActions();
  useEffect(() => {
    openPlansEntry();
    actions.setViewMode("projects");
  }, [actions]);
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-accent-primary" />
    </div>
  );
}

/** 遗留 files/books/media → library + tab */
function LegacyLibraryRedirect({ tab }: { tab: "files" | "books" | "media" }) {
  const actions = useAppActions();
  useEffect(() => {
    setLibraryTab(tab);
    actions.setViewMode("library");
  }, [actions, tab]);
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-accent-primary" />
    </div>
  );
}

function isVerifyNetworkFailure(err: any): boolean {
  return err?.networkLike === true
    || err?.name === "AbortError"
    || err instanceof TypeError;
}

function isNativeClientRuntime(): boolean {
  return !!(window as any).superDesktop?.isDesktop
    || !!(window as any).Capacitor?.isNativePlatform?.()
    || (!!(window as any).Capacitor?.platform && (window as any).Capacitor.platform !== "web");
}

async function fetchWebUiEnabled(): Promise<boolean> {
  try {
    const baseUrl = getServerUrl() ? `${getServerUrl()}/api` : "/api";
    const res = await fetch(`${baseUrl}/settings`, { cache: "no-store" });
    if (!res.ok) return true;
    const data = await res.json().catch(() => ({}));
    return data?.web_ui_enabled !== "false";
  } catch {
    // 网络/后端异常时不做前端自锁，避免误伤本地开发和临时故障恢复。
    return true;
  }
}

function WebUiDisabledPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-6 text-center text-zinc-600">
      <main className="max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-zinc-900 mb-3">网页端已被管理员关闭</h1>
        <p className="text-sm leading-7">
          当前服务器仅提供 API 服务。请使用 蜉蝣 桌面客户端连接该服务器。
        </p>
      </main>
    </div>
  );
}

function SidebarResizeHandle() {
  const { state } = useApp();
  const actions = useAppActions();
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = state.sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = startWidth.current + (ev.clientX - startX.current);
      actions.setSidebarWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [state.sidebarWidth, actions]);

  if (state.sidebarCollapsed) return null;

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={() => actions.setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
      className="hidden md:flex w-1 cursor-col-resize items-center justify-center hover:bg-accent-primary/30 active:bg-accent-primary/50 transition-colors shrink-0 group"
      title="拖拽调整侧边栏宽度 / 双击恢复默认"
    >
      <div className="w-[2px] h-8 rounded-full bg-transparent group-hover:bg-accent-primary/60 transition-colors" />
    </div>
  );
}


/**
 * P3: 侧边栏边缘滑动手势 Hook
 * 从屏幕左侧 30px 区域右滑打开侧边栏，侧边栏打开时左滑关闭
 *
 * 重要：本 hook 在 document 上挂全局 touchstart/touchend，触发的是 setMobileSidebar(false)。
 * 在移动端，用户从 Sidebar 进入 SettingsModal 时，Sidebar 仍处于 open 状态（关闭设置后
 * 还要回到 Sidebar），mobileSidebarOpen 为 true。此时只要 touchend 的 deltaX 超过阈值
 * 就会左滑关闭 Sidebar——而 SettingsModal 通过 createPortal 渲染到 body，但**生命周期
 * 仍挂在 Sidebar 子树**：Sidebar 卸载 = SettingsModal 卸载 = 设置弹窗"莫名消失"。
 *
 * 实测表现：用户在 SettingsModal 里"长按 / 滚动 / 横向触摸"时，touch 起止位移就足够触发
 * 该判定，弹窗瞬间被卸掉，看起来像"动一下就关"。React 合成事件的 stopPropagation
 * 拦不住 document 原生监听，必须在监听内部主动跳过。
 *
 * 修复：在 touchstart 时，沿事件 target 向上查找是否处于带 `[data-swipe-blocker]` 的子树。
 * 是则置 isSwiping=false，本次手势整段不参与 sidebar 开关判定。任何想屏蔽 sidebar 全局
 * 滑动手势的浮层（设置弹窗、未来的对话框等）只需在自身根节点加上这个 data 属性即可，
 * 不需要改 hook 也不需要污染全局 store。
 */
function useSwipeGesture({
  onSwipeRight,
  onSwipeLeft,
  mobileSidebarOpen,
  /** PR3：编辑器打开时禁用「左缘开抽屉」，交给编辑器右滑返回 */
  disableOpen = false,
}: {
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
  mobileSidebarOpen: boolean;
  disableOpen?: boolean;
}) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);

  useEffect(() => {
    // 仅在小屏幕（移动端）上启用手势
    const EDGE_THRESHOLD = 30; // 边缘检测区域宽度
    const SWIPE_MIN_DISTANCE = 60; // 最小滑动距离
    const SWIPE_MAX_Y_RATIO = 0.6; // y 偏移不超过 x 偏移的 60%

    // 触摸起点是否落在"屏蔽该手势"的浮层内。
    // 用 closest 走 DOM 树而非比较具体节点，能兼容 portal 渲染的浮层（document.body 直挂）。
    const isInsideSwipeBlocker = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return target.closest("[data-swipe-blocker]") !== null;
    };

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartX.current = touch.clientX;
      touchStartY.current = touch.clientY;
      // 起点在屏蔽层内：本次手势全程禁用，避免误关 Sidebar 顺带卸掉浮层。
      if (isInsideSwipeBlocker(e.target)) {
        isSwiping.current = false;
        return;
      }
      // 编辑器态不跟踪「开抽屉」（关闭抽屉仍允许）
      if (disableOpen && !mobileSidebarOpen) {
        isSwiping.current = false;
        return;
      }
      // 仅在左边缘区域或侧边栏已打开时激活
      isSwiping.current = touch.clientX <= EDGE_THRESHOLD || mobileSidebarOpen;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!isSwiping.current) return;
      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX.current;
      const deltaY = Math.abs(touch.clientY - touchStartY.current);

      // 确保是水平滑动而非垂直滑动
      if (deltaY > Math.abs(deltaX) * SWIPE_MAX_Y_RATIO) return;

      if (
        deltaX > SWIPE_MIN_DISTANCE &&
        touchStartX.current <= EDGE_THRESHOLD &&
        !mobileSidebarOpen &&
        !disableOpen
      ) {
        onSwipeRight();
      } else if (deltaX < -SWIPE_MIN_DISTANCE && mobileSidebarOpen) {
        onSwipeLeft();
      }

      isSwiping.current = false;
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [mobileSidebarOpen, onSwipeRight, onSwipeLeft, disableOpen]);
}

function AppLayout() {
  const { state } = useApp();
  const actions = useAppActions();
  const { t, i18n } = useTranslation();

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<TabId>("appearance");
  const [barsVisible, setBarsVisible] = useState(true);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [showDiaryComposer, setShowDiaryComposer] = useState(false);
  const [composerInitialImages, setComposerInitialImages] = useState<{ id: string; url: string }[]>([]);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [showTaskComposer, setShowTaskComposer] = useState(false);

  useEffect(() => {
    const show = () => setBarsVisible(true);
    const hide = () => setBarsVisible(false);
    window.addEventListener("super:scroll-show-bars", show);
    window.addEventListener("super:scroll-hide-bars", hide);
    return () => {
      window.removeEventListener("super:scroll-show-bars", show);
      window.removeEventListener("super:scroll-hide-bars", hide);
    };
  }, []);

  useEffect(() => {
    // 切页时强制显示底栏，并同步 hook 内部状态（避免无法再 hide）
    setBarsVisible(true);
    resetScrollHideBars();
  }, [state.viewMode, state.mobileView, showSettings]);



  // 健康休息提醒（定时屏保）
  const { prefs: userPrefs } = useUserPreferences();
  const [startupApplied, setStartupApplied] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderTrigger, setReminderTrigger] = useState(0);
  // Initialize from URL eagerly (before effects run) to prevent the hash-sync
  // effect from overwriting a full book URL (e.g. #/books/<64-char-hash>) with
  // just "#/books" when the page is reloaded while reading a book.
  const [activeBookHash, setActiveBookHash] = useState<string | null>(() => {
    const h = window.location.hash;
    if (h.startsWith("#/books/")) {
      const hash = h.replace("#/books/", "");
      return hash || null;
    }
    return null;
  });

  const viewModeRef = useRef(state.viewMode);
  useEffect(() => {
    viewModeRef.current = state.viewMode;
  }, [state.viewMode]);

  // Sync hash changes -> App State
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      const notesViewModes = ["all", "notebook", "favorites", "search", "tag", "trash"];
      if (hash.startsWith("#/books/")) {
        const bookHash = hash.replace("#/books/", "");
        if (bookHash) {
          actions.setViewMode("books");
          setActiveBookHash(bookHash);
        }
      } else if (hash === "#/books") {
        actions.setViewMode("books");
        setActiveBookHash(null);
      } else if (hash === "#/diary") {
        actions.setViewMode("diary");
      } else if (hash === "#/notes") {
        if (!notesViewModes.includes(viewModeRef.current)) {
          actions.setViewMode("all");
        }
      } else if (hash === "#/tasks") {
        openTasksEntry();
        actions.setViewMode("projects");
      } else if (hash === "#/files") {
        setLibraryTab("files");
        actions.setViewMode("library");
      } else if (hash === "#/media" || hash.startsWith("#/media/")) {
        setLibraryTab("media");
        actions.setViewMode("library");
      } else if (hash === "#/library") {
        actions.setViewMode("library");
      } else if (hash === "#/projects") {
        actions.setViewMode("projects");
      } else if (hash === "#/plans") {
        openPlansEntry();
        actions.setViewMode("projects");
      } else if (hash === "#/mindmaps") {
        actions.setViewMode("mindmaps");
      } else if (hash === "#/home" || hash === "#/") {
        actions.setViewMode("home");
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [actions]);

  // Sync App State -> URL Hash
  useEffect(() => {
    if (state.viewMode === "books" || state.viewMode === "library") {
      // books 深链 / library 由 LibraryCenter 内部处理阅读器；hash 统一 #/library
      const target = state.viewMode === "library" ? "#/library" : "#/books";
      if (
        window.location.hash !== target &&
        !window.location.hash.startsWith("#/books/") &&
        !(state.viewMode === "library" && window.location.hash.startsWith("#/media/items/"))
      ) {
        window.location.hash = target;
      }
    } else {
      const notesViewModes = ["all", "notebook", "favorites", "search", "tag", "trash"];
      const targetHash = notesViewModes.includes(state.viewMode) ? "#/notes" : `#/${state.viewMode}`;
      
      if (state.viewMode === "media" && window.location.hash.startsWith("#/media")) {
        // Let MediaCenter manage its own sub-routes
      } else if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    }
  }, [state.viewMode, activeBookHash]);

  useEffect(() => {
    // P2-5：健康提醒默认关闭，需用户在设置中显式开启
    if (!userPrefs.healthReminderEnabled) return;
    if (showReminder) return;
    const intervalMs = Math.max(1, userPrefs.reminderInterval) * 60 * 1000;
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("super:save-all"));
      setShowReminder(true);
    }, intervalMs);
    return () => clearTimeout(timer);
  }, [userPrefs.healthReminderEnabled, userPrefs.reminderInterval, showReminder, reminderTrigger]);

  // P2-1：启动默认页（深链 hash 优先；仅首次进入主界面应用一次）
  useEffect(() => {
    if (startupApplied) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    if (hash && hash !== "#" && hash !== "#/" && hash !== "#/home" && hash !== "#/notes") {
      setStartupApplied(true);
      return;
    }
    const landing = userPrefs.startupLanding || "last";
    if (landing === "last") {
      setStartupApplied(true);
      return;
    }
    if (landing === "home") {
      actions.setViewMode("home");
    } else if (landing === "notes") {
      actions.setViewMode("all");
      actions.setSelectedNotebook(null);
    } else if (landing === "tasks") {
      openTasksEntry();
      actions.setViewMode("projects");
    }
    setStartupApplied(true);
  }, [startupApplied, userPrefs.startupLanding, actions]);


  // Listen to custom open-book event → 资料库书库 Tab（阅读器由 LibraryCenter 承接）
  useEffect(() => {
    const onOpenBook = (e: Event) => {
      const customEvent = e as CustomEvent<{ bookHash: string }>;
      const hash = customEvent.detail?.bookHash;
      if (hash) {
        try {
          sessionStorage.setItem("super-open-book-hash", hash);
        } catch { /* ignore */ }
        setLibraryTab("books");
        actions.setViewMode("library");
        setActiveBookHash(hash);
      }
    };
    window.addEventListener("super:open-book", onOpenBook);
    return () => {
      window.removeEventListener("super:open-book", onOpenBook);
    };
  }, [actions]);

  // Listen to custom close-book event
  useEffect(() => {
    const onCloseBook = () => {
      setActiveBookHash(null);
    };
    window.addEventListener("super:close-book", onCloseBook);
    return () => {
      window.removeEventListener("super:close-book", onCloseBook);
    };
  }, []);

  // Confirm browser reload in reader mode
  useEffect(() => {
    if (!activeBookHash) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "是否要继续刷新？您的阅读进度和设置已自动保存。";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeBookHash]);

  // Global click interceptor for book:// and book-note:// links
  useEffect(() => {
    const handleGlobalClick = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const a = target.closest("a");
      if (!a) return;
      const href = a.getAttribute("href");
      if (!href) return;

      if (href.startsWith("book://")) {
        e.preventDefault();
        const bookHash = href.replace("book://", "");
        window.dispatchEvent(new CustomEvent("super:open-book", { detail: { bookHash } }));
      } else if (href.startsWith("book-note://")) {
        e.preventDefault();
        const noteId = href.replace("book-note://", "");
        try {
          const { bookHash } = await api.books.getNoteInfo(noteId);
          window.dispatchEvent(new CustomEvent("super:open-book", { detail: { bookHash } }));
        } catch (err) {
          console.warn("无法解析读书笔记关联的书籍:", err);
        }
      }
    };
    document.addEventListener("click", handleGlobalClick);
    return () => {
      document.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  // Listen to custom open-settings event
  useEffect(() => {
    const onOpenSettings = (e: Event) => {
      const customEvent = e as CustomEvent<{ tab?: TabId }>;
      const tab = customEvent.detail?.tab || "appearance";
      setSettingsTab(tab);
      setShowSettings(true);
    };
    window.addEventListener("super:open-settings", onOpenSettings);
    return () => {
      window.removeEventListener("super:open-settings", onOpenSettings);
    };
  }, []);
  // v16 P3 后续：Rail 视觉模式三档（icon / label / hidden）。
  // 约束：主侧栏折叠时强制显示 Rail（即便偏好是 hidden），
  // 否则用户会陷入"既无 Rail 又无主侧栏"的死局，找不到任何导航入口。
  const [railMode] = useRailMode();
  const railVisible = railMode !== "hidden" || state.sidebarCollapsed;
  const isMindMapView = false;
  const isAIChatView = state.viewMode === "ai-chat";
  const isHomeView = state.viewMode === "home";
  const isDiaryView = state.viewMode === "diary";
  const isProjectsView = state.viewMode === "projects";
  const isPlansView = state.viewMode === "plans";
  const isTasksView = state.viewMode === "tasks";
  const isNotesView = ["all", "notebook", "favorites", "search", "tag", "trash"].includes(state.viewMode);
  const isFilesView = state.viewMode === "files";
  const isMentionsView = state.viewMode === "mentions";
  const isBooksView = state.viewMode === "books";
  const isMediaView = state.viewMode === "media";
  const isLibraryView = state.viewMode === "library";
  const isFinanceView = state.viewMode === "finance";

  /**
   * Cmd-K 全局搜索面板开关
   * ----------------------------------------------------------------
   * 三种来源：
   *   1) 组件内部 Cmd-K 键盘事件自己派发 "super:open-command-palette"；
   *   2) macOS 原生菜单 "搜索笔记…" / Dock 右键 → useDesktopMenuBridge.onOpenSearch；
   *   3) 未来若需要业务代码编程式打开，同样 dispatch 上述事件即可。
   * 统一从外部事件驱动 setOpen(true)，组件只负责展示 + Esc 关闭。
   */
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setCommandPaletteOpen(true);
    window.addEventListener("super:open-command-palette", onOpen);
    return () => window.removeEventListener("super:open-command-palette", onOpen);
  }, []);

  // 离线队列入队事件 → 把 syncStatus 切到 "queued"（让 UI 展示"已暂存"而非"已同步"）
  useEffect(() => {
    const onQueued = () => {
      actions.setSyncStatus("queued");
    };
    window.addEventListener("super:offline-queued", onQueued);
    return () => window.removeEventListener("super:offline-queued", onQueued);
  }, [actions]);

  // 获取待办任务提醒统计与消息未读数（红点）
  useEffect(() => {
    let timer: any = null;
    const fetchStats = async () => {
      try {
        const stats = await api.getTaskStats();
        actions.setReminderActiveCount(stats.activeReminders || 0);
        // 初始与周期性刷新消息未读数
        actions.refreshMentionCount();
      } catch (err) {
        console.error("Fetch task stats for reminder badge failed:", err);
      }
    };

    fetchStats();

    // 周期性拉取（60s）
    timer = setInterval(fetchStats, 60000);

    const onStatsChanged = () => {
      fetchStats();
    };

    window.addEventListener("super:task-stats-changed", onStatsChanged);
    window.addEventListener("super:workspace-changed", onStatsChanged);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("super:task-stats-changed", onStatsChanged);
      window.removeEventListener("super:workspace-changed", onStatsChanged);
    };
  }, [actions]);

  // 监听 WebSocket 的实时通知，收到后立即刷新或更新未读数红点，并在原生平台展示本地通知
  useEffect(() => {
    const offNotification = realtime.on("notification:received", (msg: any) => {
      if (msg && typeof msg.unreadCount === "number") {
        actions.setUnreadMentionCount(msg.unreadCount);
      }
      if (msg && msg.notification && isNativePlatform()) {
        const notif = msg.notification;
        const isZh = i18n.language?.startsWith("zh");
        let title = isZh ? "新消息" : "New Message";
        let body = notif.sourceTitle || (isZh ? "你收到了一条新消息" : "You received a new message");
        const actor = notif.actorName || (isZh ? "某人" : "Someone");
        const targetTitle = notif.sourceTitle || "";

        switch (notif.type) {
          case "mention":
            title = isZh ? "有人提到你" : "Mentioned You";
            body = isZh
              ? `${actor} 在「${targetTitle || "内容"}」中提到了你`
              : `${actor} mentioned you in "${targetTitle || "content"}"`;
            break;
          case "task_completed":
            title = isZh ? "任务完成" : "Task Completed";
            body = isZh
              ? `${actor} 完成了任务: ${targetTitle}`
              : `${actor} completed task: ${targetTitle}`;
            break;
          case "diary_posted":
            title = isZh ? "新说说" : "New Diary Entry";
            body = isZh
              ? `${actor} 发表了说说: ${targetTitle}`
              : `${actor} posted a new diary entry: ${targetTitle}`;
            break;
          case "note_updated":
            title = isZh ? "笔记更新" : "Note Updated";
            body = isZh
              ? `${actor} 更新了笔记: ${targetTitle}`
              : `${actor} updated note: ${targetTitle}`;
            break;
        }

        showLocalNotification(title, body, {
          sourceType: notif.sourceType,
          sourceId: notif.sourceId,
        });
      }
    });
    return () => {
      offNotification();
    };
  }, [actions, i18n.language]);

  // 当未读消息变化时，动态更新移动端应用图标的角标(Badge)
  useEffect(() => {
    if (isNativePlatform()) {
      const updateBadge = async () => {
        try {
          const { Badge } = await import("@capawesome/capacitor-badge");
          const perm = await Badge.checkPermissions();
          if (perm.display !== "granted") {
            await Badge.requestPermissions();
          }
          await Badge.set({ count: state.unreadMentionCount });
        } catch (err) {
          console.error("Failed to update app icon badge:", err);
        }
      };
      updateBadge();
    }
  }, [state.unreadMentionCount]);

  // 监听移动端生命周期状态变化，返回前台时立即同步最新消息与重连 WebSocket
  useEffect(() => {
    if (!isNativePlatform()) return;
    
    let active = true;
    const handler = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive && active) {
        actions.refreshMentionCount();
        realtime.connect();
        api.getTaskStats().then((stats) => {
          actions.setReminderActiveCount(stats.activeReminders || 0);
        }).catch(console.error);
        // 热启动：拉最新闪屏元数据并缓存（不弹闪屏门）
        void syncWorkspaceSplash(undefined, { force: true });
      }
    });

    return () => {
      active = false;
      handler.then((h) => h.remove());
    };
  }, [actions]);

  // 登录后 / 工作区切换：同步闪屏缓存（供下次冷启动展示）
  useEffect(() => {
    if (!isNativePlatform()) return;
    void syncWorkspaceSplash(undefined, { force: true });
    const onWs = () => {
      void syncWorkspaceSplash(undefined, { force: true });
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, []);

  // 监听通知点击/仪表盘点击的快捷跳转事件
  useEffect(() => {
    const handleNavigateTrigger = async () => {
      const pendingRaw = sessionStorage.getItem("super:pending-navigate");
      if (!pendingRaw) return;
      try {
        const pending = JSON.parse(pendingRaw);
        if (!pending.sourceType || !pending.sourceId) return;

        const { sourceType, sourceId } = pending;
        if (sourceType === "note") {
          actions.setViewMode("all");
          actions.setNoteLoading(true);
          actions.setMobileView("editor");
          try {
            const note = await api.getNote(sourceId);
            if (note) {
              actions.setActiveNote(note);
            }
          } catch (err) {
            console.error("Failed to load navigated note:", err);
            const { toast } = await import("@/lib/toast");
            toast.error("加载笔记失败");
          } finally {
            actions.setNoteLoading(false);
          }
          sessionStorage.removeItem("super:pending-navigate");
        } else if (sourceType === "diary") {
          actions.setViewMode("diary");
          actions.setMobileView("list");
        } else if (sourceType === "task") {
          actions.setViewMode("tasks");
          actions.setMobileView("list");
        }
      } catch (e) {
        console.error("Failed to parse pending navigate:", e);
      }
    };

    window.addEventListener("super:navigate-to-item-trigger", handleNavigateTrigger);

    // 延迟少许检查挂起的导航，等待组件及状态初始化完成
    const timer = setTimeout(handleNavigateTrigger, 200);

    return () => {
      window.removeEventListener("super:navigate-to-item-trigger", handleNavigateTrigger);
      clearTimeout(timer);
    };
  }, [actions]);

  // 监听旧待办快捷跳转事件
  useEffect(() => {
    const onNavigateToTasks = () => {
      actions.setViewMode("tasks");
      actions.setMobileView("list");
    };
    window.addEventListener("super:navigate-to-tasks", onNavigateToTasks);
    return () => window.removeEventListener("super:navigate-to-tasks", onNavigateToTasks);
  }, [actions]);


  // ── PR2: 移动端返回栈（priority 高者先关）──
  // 全屏屏保 / 设置 / 命令面板 / 撰写类 modal / 侧栏 / 编辑器 / 书籍 / 项目详情 / 更多子页
  useRegisterBackLayer(
    "reminder-screensaver",
    showReminder,
    () => {
      setShowReminder(false);
      setReminderTrigger((prev) => prev + 1);
    },
    1000
  );
  useRegisterBackLayer(
    "settings",
    showSettings,
    () => setShowSettings(false),
    900
  );
  useRegisterBackLayer(
    "command-palette",
    commandPaletteOpen,
    () => setCommandPaletteOpen(false),
    880
  );
  useRegisterBackLayer(
    "camera-modal",
    showCameraModal,
    () => setShowCameraModal(false),
    820
  );
  useRegisterBackLayer(
    "diary-composer",
    showDiaryComposer,
    () => {
      setShowDiaryComposer(false);
      setComposerInitialImages([]);
    },
    810
  );
  useRegisterBackLayer(
    "task-composer",
    showTaskComposer,
    () => setShowTaskComposer(false),
    800
  );
  useRegisterBackLayer(
    "mobile-sidebar",
    state.mobileSidebarOpen,
    () => actions.setMobileSidebar(false),
    600
  );
  // 笔记编辑器：笔记相关视图 + editor 态
  useRegisterBackLayer(
    "note-editor",
    isNotesView && state.mobileView === "editor",
    () => actions.setMobileView("list"),
    500
  );
  useRegisterBackLayer(
    "book-reader",
    (state.viewMode === "books" || state.viewMode === "library") && !!activeBookHash,
    () => {
      console.log("[BookReader Back Debug - App]", { viewMode: state.viewMode, activeBookHash });
      setLibraryTab("books");
      setActiveBookHash(null);
      window.dispatchEvent(new CustomEvent("super:close-book"));
    },
    400
  );

  // 从「更多」进入的子页 → 回更多
  // （项目详情层在 projectFilter 声明后单独注册）
  const moreStackModes = new Set([
    "files",
    "ai-chat",
    "favorites",
    "trash",
    "mentions",
    "tasks",
  ]);
  useRegisterBackLayer(
    "more-stack",
    moreStackModes.has(state.viewMode),
    () => {
      actions.setViewMode("more");
      actions.setMobileView("list");
    },
    200
  );

  // Android 返回键 / Escape 入口
  useMobileBackButton();

  // Phase D：分屏/矮屏/大字体壳层标记
  useShellLayout();

  // Android 系统分享入站（已登录：落库为笔记并跳转）
  useShareReceive({
    authenticated: true,
    onNoteCreated: (noteId) => {
      actions.refreshNotebooks();
      actions.refreshNotes();
      sessionStorage.setItem(
        "super:pending-navigate",
        JSON.stringify({ sourceType: "note", sourceId: noteId }),
      );
      window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
    },
  });

  // P2: 状态栏与主题同步
  useStatusBarSync();

  // Android 通知渠道（任务 / 消息 / 同步）
  useEffect(() => {
    if (!isNativePlatform()) return;
    void ensureNotificationChannels();
  }, []);

  // 标签页/Electron 窗口标题同步：
  //   关闭"标题跟随笔记标题"开关 → 沿用 useSiteSettings 设置的站点名（默认行为）；
  //   开启时 → 标题改为 "笔记标题 - 站点名"，没选中笔记则回退站点名。
  // 之所以放在 AppLayout 而不是 useSiteSettings：noteTitleAsAppTitle 依赖
  // AppContext.activeNote，而 AppContext 是在 AuthGate → AppProvider 之后才挂的，
  // useSiteSettings 是分享页/登录页等更外层场景也会用到的更基础 Provider。
  const { siteConfig } = useSiteSettings();
  useEffect(() => {
    const baseTitle = siteConfig.title || "蜉蝣";
    if (userPrefs.noteTitleAsAppTitle) {
      const noteTitle = (state.activeNote?.title || "").trim();
      document.title = noteTitle ? `${noteTitle} - ${baseTitle}` : baseTitle;
    } else {
      document.title = baseTitle;
    }
  }, [siteConfig.title, userPrefs.noteTitleAsAppTitle, state.activeNote?.id, state.activeNote?.title]);


  // P5: 键盘弹出布局适配
  useKeyboardLayout();

  // P3: 侧边栏边缘滑动手势
  const handleSwipeOpen = useCallback(() => {
    actions.setMobileSidebar(true);
  }, [actions]);
  const handleSwipeClose = useCallback(() => {
    actions.setMobileSidebar(false);
  }, [actions]);

  // 笔记编辑器打开时禁用左缘开抽屉，避免与 PR3 右滑返回抢手势
  const editorSwipeOpen =
    isNotesView && state.mobileView === "editor" && !state.mobileSidebarOpen;

  useSwipeGesture({
    onSwipeRight: handleSwipeOpen,
    onSwipeLeft: handleSwipeClose,
    mobileSidebarOpen: state.mobileSidebarOpen,
    disableOpen: editorSwipeOpen,
  });

  const editorSwipeBack = useEditorSwipeBack({
    enabled: editorSwipeOpen && !showSettings && !showDiaryComposer && !showCameraModal && !showTaskComposer,
    onBack: () => actions.setMobileView("list"),
  });

  const handleCreateNotebook = useCallback(async () => {
    const name = await appPrompt({
      title: t("common.newNotebook") || "新建笔记本",
      placeholder: t("sidebar.notebookName") || "笔记本名称",
      confirmText: t("common.confirm") || "确认",
      cancelText: t("common.cancel") || "取消",
    });
    if (!name || !name.trim()) return;
    try {
      const nb = await api.createNotebook({ name: name.trim(), icon: "📒" });
      actions.setNotebooks([...state.notebooks, nb]);
      toast.success(t("common.createSuccess") || "创建成功");
    } catch (err: any) {
      toast.error(err?.message || "创建笔记本失败");
    }
  }, [state.notebooks, actions, t]);

  const handleCreateProject = useCallback(async () => {
    actions.setViewMode("projects");
    sessionStorage.setItem("super-pending-create-project", "1");
    window.dispatchEvent(new CustomEvent("super:create-project-trigger"));
  }, [actions]);

  // Alt+N 全局快捷键 / 桌面端菜单"新建笔记"共用同一入口
  const quickCreateNote = useCallback(async () => {
    const { toast } = await import("@/lib/toast");
    // 无笔记本时给出提示
    if (state.notebooks.length === 0) {
      toast.warning(t('common.needNotebookFirst'));
      return;
    }
    // 优先使用当前选中的笔记本，否则取第一个笔记本
    const notebookId = state.selectedNotebookId || state.notebooks[0]?.id;
    if (!notebookId) {
      toast.warning(t('common.needNotebookFirst'));
      return;
    }
    try {
      const { api } = await import("@/lib/api");
      const note = await api.createNote({ notebookId, title: t('common.untitledNote') });
      actions.setActiveNote(note);
      actions.setSelectedNotebook(notebookId);
      actions.setViewMode("notebook");
      actions.setMobileView("editor");
      actions.refreshNotebooks();
    } catch (err: any) {
      console.error("Quick create note failed:", err);
      toast.error(err?.message || t('noteList.createFailed'));
    }
  }, [state.selectedNotebookId, state.notebooks, actions, t]);

  // 全局创建快捷键（桌面为主；不与 Ctrl/Cmd 组合，避免抢浏览器默认）
  //   Alt+C  打开/关闭快速创建菜单
  //   Alt+N  新建笔记
  //   Alt+S  新建说说（不用 Alt+D，Chrome 会抢地址栏）
  //   Alt+T  新建任务
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const key = e.key.toLowerCase();
      if (key === "c") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("super:toggle-create-menu"));
        return;
      }
      if (key === "n") {
        e.preventDefault();
        void quickCreateNote();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("super:quick-new-diary"));
        return;
      }
      if (key === "t") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("super:quick-new-task"));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quickCreateNote]);

  // 监听全局新建命令（通过 Cmd+K 弹窗派发）
  useEffect(() => {
    const onQuickNewNote = () => {
      void quickCreateNote();
    };
    const onQuickNewDiary = () => {
      setComposerInitialImages([]);
      setShowDiaryComposer(true);
    };
    const onQuickNewTask = () => {
      setShowTaskComposer(true);
    };

    window.addEventListener("super:quick-new-note", onQuickNewNote);
    window.addEventListener("super:quick-new-diary", onQuickNewDiary);
    window.addEventListener("super:quick-new-task", onQuickNewTask);

    return () => {
      window.removeEventListener("super:quick-new-note", onQuickNewNote);
      window.removeEventListener("super:quick-new-diary", onQuickNewDiary);
      window.removeEventListener("super:quick-new-task", onQuickNewTask);
    };
  }, [quickCreateNote]);

  // ── 工作区切换：清空笔记会话态，按需回到笔记列表 ───────────────────
  //
  // WorkspaceSwitcher 切换后会广播 "super:workspace-changed"。之前只有 Sidebar /
  // FileManager / DiaryCenter / MindMap 自己监听并各自重拉，但
  // App 顶层并没有清理"正在编辑的笔记 + 笔记列表 + 选择/筛选状态"——于是会
  // 出现两类问题：
  //   1) 切到 A 空间后，右侧仍显示着 B 空间的 activeNote，且该笔记被 B 空间
  //      的权限/归属保护，任何保存操作都可能落到错误的上下文里；
  //   2) 上一次选中的 notebookId / tagId 仍在 state 中，下一次"快速新建"会
  //      把新笔记塞到不属于当前空间的笔记本里（后端已拒，但 UX 很糟）。
  //
  // 切换工作区是一次强隔离事件：清理笔记选择/筛选并 refresh。
  // 仅当当前已在笔记相关 view 时才强制回到「所有笔记」列表空态；
  // 在首页 / 说说 / 项目等页面切换工作区应留在原地，只刷新数据。
  useEffect(() => {
    const notesViewModes = ["all", "notebook", "favorites", "search", "tag", "trash"];
    const onWorkspaceChanged = () => {
      actions.setActiveNote(null);
      actions.setNotes([]);
      actions.setSelectedNotebook(null);
      actions.setSelectedTag(null);
      actions.setSearchQuery("");
      if (notesViewModes.includes(viewModeRef.current)) {
        actions.setViewMode("all");
        actions.setMobileView("list");
      }
      actions.refreshNotes();
      actions.refreshNotebooks();
    };
    window.addEventListener("super:workspace-changed", onWorkspaceChanged);
    return () => window.removeEventListener("super:workspace-changed", onWorkspaceChanged);
  }, [actions]);

  // 微信公众号文章保存自动导入与跳转
  useEffect(() => {
    let active = true;
    const handlePendingImport = async () => {
      const url = sessionStorage.getItem("super:pending-import-url");
      if (!url) return;

      // 马上清除，避免重复触发
      sessionStorage.removeItem("super:pending-import-url");

      const { toast } = await import("@/lib/toast");
      const loadingToastId = toast.info("正在抓取并保存文章到剪藏笔记...", 0);

      try {
        const { api } = await import("@/lib/api");
        const result = await api.urlImport(url);

        if (!active) return;

        toast.dismiss(loadingToastId);
        toast.success("已成功保存至「剪藏笔记」");

        // 刷新列表和笔记本
        actions.refreshNotebooks();
        actions.refreshNotes();

        // 自动进入该笔记页面进行查看
        setTimeout(() => {
          if (!active) return;
          sessionStorage.setItem("super:pending-navigate", JSON.stringify({
            sourceType: "note",
            sourceId: result.noteId
          }));
          window.dispatchEvent(new CustomEvent("super:navigate-to-item-trigger"));
        }, 500);
      } catch (err: any) {
        if (!active) return;
        toast.dismiss(loadingToastId);
        toast.error(`保存失败：${err?.message || err}`);
      }
    };

    // 1) 挂载时立即尝试处理一次（针对从非活跃状态启动的情况）
    // 延迟 800ms 等主界面和同步初始化完毕，防止列表还未加载导致导航失败
    const timer = setTimeout(handlePendingImport, 800);

    // 2) 监听后续新接收到的链接事件（针对应用在后台运行，用户再次点击分享的情况）
    window.addEventListener("super:pending-import-url-trigger", handlePendingImport);

    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener("super:pending-import-url-trigger", handlePendingImport);
    };
  }, [actions]);

  // Electron 桌面端：菜单 / 托盘动作 IPC 桥
  useDesktopMenuBridge({
    onNewNote: () => void quickCreateNote(),
    onToggleSidebar: () => actions.toggleSidebar(),
    /**
     * 原生"搜索"菜单 / Dock Quick Action → 打开 Cmd-K 命令面板。
     * 相比过去聚焦 Sidebar 搜索框的方案，命令面板是"即用即走"语义，
     * 不污染当前 viewMode，也与 Cmd-K 键盘入口完全统一。
     */
    onOpenSearch: () => setCommandPaletteOpen(true),
  });

  const [projectFilter, setProjectFilter] = useState<{ type: string; projectId?: string }>(() => {
    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      return val ? JSON.parse(val) : { type: "my-tasks" };
    } catch {
      return { type: "my-tasks" };
    }
  });

  useEffect(() => {
    const handleFilterChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setProjectFilter(customEvent.detail);
      }
    };
    window.addEventListener("super:project-filter-changed", handleFilterChange);
    return () => {
      window.removeEventListener("super:project-filter-changed", handleFilterChange);
    };
  }, []);

  const isProjectDetailOpen = isProjectsView && projectFilter?.type === "detail";

  // 项目详情返回层（依赖 projectFilter，须在其后注册）
  useRegisterBackLayer(
    "project-detail",
    isProjectDetailOpen,
    () => {
      const filter = { type: "my-tasks" };
      try {
        sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
      } catch { /* ignore */ }
      setProjectFilter(filter);
      window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
    },
    350
  );

  // 移动壳层：规则集中在 navigation.config（Phase A）
  const { visible: keyboardVisible } = useKeyboardVisible();
  const shellCtx = {
    viewMode: state.viewMode,
    mobileView: state.mobileView,
    isProjectDetailOpen,
    barsVisible,
    keyboardVisible,
  };
  const showMobileTabBar = shouldShowMobileTabBar(shellCtx);
  // FAB 结构是否存在：与滚动隐栏解耦，避免 unmount/mount 闪烁
  const showMobileFAB = shouldShowMobileFAB(shellCtx) && !keyboardVisible;
  // 滚动隐栏只控制视觉 visible，不卸载
  const barsVisuallyVisible = barsVisible && !keyboardVisible;

  // 底栏 CSS 避让：根页有底栏结构且底栏当前「可见」时才占用高度。
  // 向下滚动隐栏后 --mobile-tab-h→0，说说/任务列表可铺满原 Tab 区域；
  // 与 scroll-hide 冷却配合，避免 padding 与滚动方向互抢导致闪烁。
  useEffect(() => {
    syncMobileShellCssVars({
      tabBarVisible: showMobileTabBar && barsVisuallyVisible,
    });
    return () => {
      syncMobileShellCssVars({ tabBarVisible: true });
    };
  }, [showMobileTabBar, barsVisuallyVisible]);

  // 工作区检测：新用户若无工作区则显示引导页
  const [hasFamilySpace, setHasFamilySpace] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getWorkspaces().then(list => {
      if (cancelled) return;
      const has = list.length > 0;
      setHasFamilySpace(has);
      if (!has) {
        localStorage.removeItem("super-current-workspace");
        return;
      }
      // 有工作区但未选中 / 选中 id 已失效 → 自动选第一个（首次登录、登出后重登）
      const current = getCurrentWorkspace();
      const valid = current && list.some((w) => w.id === current);
      if (!valid) {
        setCurrentWorkspace(list[0].id);
        window.dispatchEvent(
          new CustomEvent("super:workspace-changed", {
            detail: { workspaceId: list[0].id },
          }),
        );
      }
    }).catch(() => {
      if (cancelled) return;
      setHasFamilySpace(true);
    });
    return () => { cancelled = true; };
  }, []);

  // 工作区检测门控
  if (hasFamilySpace === false) {
    return <FirstRunWizard onComplete={() => setHasFamilySpace(true)} />;
  }
  if (hasFamilySpace === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app-bg">
        <Loader2 size={32} className="animate-spin text-tx-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-screen bg-app-bg overflow-hidden transition-colors duration-200">
      {/* ===== 移动端：抽屉式侧边栏（无 NavRail）=====
          模块切换只走底部 Tab +「更多」；抽屉专注工作区 / 搜索 / 笔记本 / 标签，
          避免 Rail 与 Tab 双重导航抢宽度。关闭 / 设置 / 登出在 Sidebar mobile 自管。 */}
      <AnimatePresence>
        {state.mobileSidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => actions.setMobileSidebar(false)}
              className="fixed inset-0 z-40 bg-zinc-900/60 backdrop-blur-sm md:hidden"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}
              className="fixed inset-y-0 left-0 z-50 w-[86%] max-w-[340px] md:hidden shadow-2xl flex bg-app-sidebar"
              style={{ paddingBottom: "var(--safe-area-bottom)" }}
            >
              <Sidebar variant="mobile" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ===== 桌面端：永久 Rail + 可折叠主侧栏 + 拖拽条 =====
          v16 P3：左侧 Rail 永久可见（含模块切换 + 设置/登出 + 折叠按钮）；
          主侧栏（笔记本 + 标签）由 sidebarCollapsed 控制显隐——折叠时主侧栏整块消失，
          但 Rail 仍在，模块切换永远 1 次点击可达。
          v16 P3 后续：Rail 三档模式（icon=48px 纯图标 / label=64px 图标+文字 / hidden=完全隐藏）；
          hidden 模式下若主侧栏也折叠，强制保留 Rail（避免完全无侧栏入口）。 */}
      {railVisible && <NavRail />}
      {!state.sidebarCollapsed && (isNotesView || isProjectsView || isPlansView) && (
        <div
          className="hidden md:flex shrink-0"
          style={{ width: `${state.sidebarWidth}px` }}
        >
          <Sidebar variant="desktop" />
        </div>
      )}
      {(isNotesView || isProjectsView || isPlansView) && <SidebarResizeHandle />}

      {/* ===== 主内容区 =====
          桌面：为全局音乐贴底栏留出高度（--global-music-bar-height，不盖 NavRail） */}
      <div className={cn(
        "flex-1 flex flex-col min-w-0 relative overflow-hidden transition-[padding] duration-300",
        showMobileTabBar ? "mobile-content-pad md:pb-[var(--global-music-bar-height,0px)]" : "pb-0 md:pb-[var(--global-music-bar-height,0px)]"
      )}>
        <AnimatePresence mode="wait">
          <motion.div
            key={state.viewMode}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden"
          >
            {isMindMapView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <MobileTopBar />
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <MindMapCenter />
                </Suspense>
              </div>
            ) : isAIChatView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <AIChatPanel
                    onClose={() => {
                      actions.setViewMode("more");
                      actions.setMobileView("list");
                    }}
                    onNavigateToNote={async (noteId) => {
                      try {
                        const { api } = await import("@/lib/api");
                        const note = await api.getNote(noteId);
                        if (note) {
                          actions.setActiveNote(note);
                          actions.setViewMode("all");
                          actions.setMobileView("editor");
                        }
                      } catch (err) {
                        console.error("Navigate to note failed:", err);
                      }
                    }}
                  />
                </Suspense>
              </div>
            ) : isDiaryView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <MobileTopBar />
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <DiaryCenter />
                </Suspense>
              </div>
            ) : isProjectsView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <MobileTopBar />
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <ProjectCenter />
                </Suspense>
              </div>
            ) : isPlansView ? (
              <PlansToProjectsRedirect />
            ) : isTasksView ? (
              <TasksToProjectsRedirect />
            ) : isLibraryView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <LibraryCenter />
                </Suspense>
              </div>
            ) : isFinanceView ? (
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {/* 记账列表顶栏由 FinanceCenter 自管（返回/居中标题/+），不再叠 MobileTopBar */}
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <FinanceCenter />
                </Suspense>
              </div>
            ) : isFilesView ? (
              <LegacyLibraryRedirect tab="files" />
            ) : isBooksView ? (
              <LegacyLibraryRedirect tab="books" />
            ) : isMediaView ? (
              <LegacyLibraryRedirect tab="media" />
            ) : state.viewMode === "more" ? (
              <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                <MobileMorePage />
              </Suspense>
            ) : isHomeView ? (
              <Dashboard />
            ) : isMentionsView ? (
              <div className="flex-1 flex flex-col">
                <MobileTopBar />
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                  <MentionList />
                </Suspense>
              </div>
            ) : (
              <div className="flex-1 flex relative overflow-hidden">
                {/* 笔记列表
                    PR3：编辑器态仍渲染在下层（右滑时可露出），但 inert 禁止误点 */}
                {isNotesView && (
                  <div
                    className={cn(
                      "shrink-0 border-r border-app-border bg-app-bg w-full md:w-[var(--note-list-width)]",
                      "md:relative md:translate-x-0 md:opacity-100 md:pointer-events-auto",
                      state.mobileView === "list"
                        ? "relative translate-x-0 z-10"
                        : "absolute inset-y-0 left-0 z-0 pointer-events-none"
                    )}
                    style={{
                      "--note-list-width": `${state.noteListWidth}px`,
                    } as React.CSSProperties}
                    {...(state.mobileView === "editor"
                      ? ({ inert: "" } as React.HTMLAttributes<HTMLDivElement>)
                      : {})}
                    aria-hidden={state.mobileView === "editor"}
                  >
                    <NoteList />
                  </div>
                )}

                {/* 编辑器 — 移动端全屏；左缘右滑跟手返回列表 */}
                <div
                  className={cn(
                    "flex flex-col min-w-0 bg-app-bg",
                    "md:static md:z-auto md:flex-1 md:translate-x-0 md:pointer-events-auto",
                    "absolute inset-0 z-20",
                    // 移动端进出场（无跟手 offset 时）
                    state.mobileView === "editor"
                      ? "pointer-events-auto max-md:translate-x-0"
                      : "pointer-events-none max-md:translate-x-full",
                    !editorSwipeBack.dragging && "max-md:transition-transform max-md:duration-300 max-md:ease-out"
                  )}
                  style={
                    state.mobileView === "editor" && editorSwipeBack.offsetX > 0
                      ? {
                          transform: `translate3d(${editorSwipeBack.offsetX}px, 0, 0)`,
                          transition: editorSwipeBack.dragging
                            ? "none"
                            : "transform 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
                          boxShadow: " -12px 0 32px rgba(28, 25, 23, 0.14)",
                        }
                      : undefined
                  }
                >
                  {editorSwipeBack.offsetX > 6 && state.mobileView === "editor" && (
                    <div
                      className="absolute inset-y-0 left-0 w-0.5 bg-accent-primary/50 md:hidden z-30 pointer-events-none"
                      style={{ opacity: Math.min(1, editorSwipeBack.offsetX / 64) }}
                      aria-hidden
                    />
                  )}
                  <Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent-primary" /></div>}>
                    <EditorPane />
                  </Suspense>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <GlobalMusicPlayer />
      </div>

      {showMobileTabBar && <MobileTabBar visible={barsVisuallyVisible} />}

      {/* FAB：始终挂载（根页），用 opacity/transform 隐栏，避免 AnimatePresence 闪烁 */}
      {showMobileFAB && (
        <>
          <div
            className={cn(
              "mobile-fab-anchor fixed right-4 z-40 md:hidden transition-all duration-300 ease-soft",
              barsVisuallyVisible
                ? "opacity-100 translate-y-0 pointer-events-auto"
                : "opacity-0 translate-y-4 pointer-events-none",
            )}
          >
            <CreateFabButton onClick={() => setCreateMenuOpen(true)} />
          </div>
          <CreateMenu
            open={createMenuOpen && barsVisuallyVisible}
            onClose={() => setCreateMenuOpen(false)}
            className="right-4 bottom-[calc(5.5rem+var(--safe-area-bottom))] md:hidden"
            showCamera={isNativePlatform()}
            onAction={(action) => {
              if (action === "note") void quickCreateNote();
              else if (action === "diary") {
                setComposerInitialImages([]);
                setShowDiaryComposer(true);
              } else if (action === "task") {
                setShowTaskComposer(true);
              } else if (action === "camera") {
                setShowCameraModal(true);
              }
            }}
          />
        </>
      )}

      <MobileCameraModal
        isOpen={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        onCapture={async (file) => {
          const toastId = toast.info("正在处理并上传照片...", 0);
          try {
            const res = await api.diaryImages.upload(file);
            setComposerInitialImages([{ id: res.id, url: api.diaryImages.urlFor(res.id) }]);
            setShowDiaryComposer(true);
            toast.dismiss(toastId);
            toast.success("照片已添加至说说");
          } catch (err: any) {
            toast.dismiss(toastId);
            toast.error(err?.message || "照片上传失败");
          }
        }}
      />

      <MobileTaskCreateModal
        isOpen={showTaskComposer}
        onClose={() => setShowTaskComposer(false)}
      />

      <Suspense fallback={null}>
        <AnimatePresence>
          {showDiaryComposer && (
            <DiaryComposeModal
              isOpen={showDiaryComposer}
              initialImages={composerInitialImages}
              onClose={() => {
                setShowDiaryComposer(false);
                setComposerInitialImages([]);
              }}
              onPost={() => {
                window.dispatchEvent(new CustomEvent("super:workspace-changed"));
                actions.setViewMode("diary");
              }}
            />
          )}
        </AnimatePresence>
      </Suspense>

      {/* 全局命令面板（Cmd-K / 菜单搜索 / Dock 搜索统一入口） */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* 离线状态 + 待同步指示器 */}
      <OfflineIndicator />

      {/* 服务端版本升级提示（前端 bundle 与服务端不一致时） */}
      <UpdateNotifier />

      {/* 全局设置弹窗 */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {showSettings && (
            <SettingsModal
              defaultTab={settingsTab}
              onClose={() => setShowSettings(false)}
            />
          )}
        </AnimatePresence>
      </Suspense>

      {/* 健康休息屏保 */}
      <Suspense fallback={null}>
        <AnimatePresence>
          {showReminder && (
            <BrowserScreensaver
              isOpen={showReminder}
              onClose={() => {
                setShowReminder(false);
                setReminderTrigger((prev) => prev + 1);
              }}
            />
          )}
        </AnimatePresence>
      </Suspense>
    </div>
  );
}

function MobileTopBar() {
  const { state } = useApp();
  const actions = useAppActions();
  const { siteConfig } = useSiteSettings();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(true);

  const getTitle = () => {
    switch (state.viewMode) {
      case "all":
      case "notebook":
      case "tag":
        return t("sidebar.allNotes") || "全部笔记";
      case "favorites":
        return "我的收藏";
      case "tasks":
        return t("projects.myTasks") || "我的待办";
      case "trash":
        return "回收站";
      case "files":
        return t("sidebar.fileManager") || "文件管理";
      case "mentions":
        return "消息盒子";
      default:
        return siteConfig.title || "蜉蝣";
    }
  };

  useEffect(() => {
    const show = () => setVisible(true);
    const hide = () => setVisible(false);
    window.addEventListener("super:scroll-show-bars", show);
    window.addEventListener("super:scroll-hide-bars", hide);
    return () => {
      window.removeEventListener("super:scroll-show-bars", show);
      window.removeEventListener("super:scroll-hide-bars", hide);
    };
  }, []);

  if (state.viewMode === "projects" || state.viewMode === "diary") {
    return null;
  }

  const closeToMore = () => {
    actions.setViewMode("more");
    actions.setMobileView("list");
  };

  if (state.viewMode === "files") {
    return (
      <MobileChromeHeader
        variant="stack"
        stackAction="back"
        title={getTitle()}
        onLeadingClick={closeToMore}
        visible={visible}
      />
    );
  }

  if (state.viewMode === "mentions") {
    return (
      <MobileChromeHeader
        variant="stack"
        stackAction="back"
        title={
          <span className="flex items-center gap-2 min-w-0">
            <Bell size={16} className="text-accent-primary shrink-0" />
            <span className="text-[15px] font-bold text-tx-primary truncate">消息盒子</span>
            {state.unreadMentionCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-danger text-white font-bold shrink-0">
                {state.unreadMentionCount}
              </span>
            )}
          </span>
        }
        onLeadingClick={closeToMore}
        visible={visible}
        right={
          state.unreadMentionCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("super:mark-all-mentions-read"));
              }}
              className="flex items-center gap-1 text-xs text-accent-primary hover:underline font-medium px-2 min-h-[40px]"
            >
              <CheckCheck size={14} />
              全部已读
            </button>
          ) : undefined
        }
      />
    );
  }

  // 「我的」子页：收藏 / 回收站 / AI 等统一左返回
  if (
    ["favorites", "trash", "ai-chat", "home"].includes(state.viewMode)
  ) {
    const titles: Record<string, string> = {
      favorites: "收藏",
      trash: "回收站",
      "ai-chat": "AI",
      home: "首页",
    };
    return (
      <MobileChromeHeader
        variant="stack"
        stackAction="back"
        title={titles[state.viewMode] || getTitle()}
        onLeadingClick={closeToMore}
        visible={visible}
      />
    );
  }

  return (
    <MobileChromeHeader
      variant="root"
      title={getTitle()}
      visible={visible}
    />
  );
}

function MobileTabBar({ visible }: { visible: boolean }) {
  const { state } = useApp();
  const actions = useAppActions();
  const { t } = useTranslation();
  const [features, setFeatures] = useState<import("@/types").WorkspaceFeatures | null>(null);
  const [packTick, setPackTick] = useState(0);

  useEffect(() => {
    const load = () => {
      const ws = getCurrentWorkspace();
      if (!ws || ws === "personal") {
        setFeatures(null);
        return;
      }
      api.getWorkspaceFeatures(ws).then(setFeatures).catch(() => setFeatures(null));
    };
    load();
    const onWs = () => load();
    const onPack = () => setPackTick((n) => n + 1);
    window.addEventListener("super:workspace-changed", onWs);
    window.addEventListener("super:workspace-features-changed", onWs);
    window.addEventListener("super:module-pack-changed", onPack);
    return () => {
      window.removeEventListener("super:workspace-changed", onWs);
      window.removeEventListener("super:workspace-features-changed", onWs);
      window.removeEventListener("super:module-pack-changed", onPack);
    };
  }, []);

  const handleTabClick = (mode: ViewMode, opts?: { openMyTasks?: boolean }) => {
    haptic.light();
    // 先写 filter 再切 viewMode，保证 ProjectCenter 挂载时能读到 my-tasks
    if (opts?.openMyTasks) {
      openTasksEntry();
    }
    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
    if (mode === "books" || mode === "library") {
      window.dispatchEvent(new CustomEvent("super:close-book"));
    }
    // 已在 projects 视图时 setViewMode 不会 remount，再补一次 filter 同步
    if (opts?.openMyTasks) {
      openTasksEntry();
    }
  };

  // 与 navigation.config + 模块包一致（P2 补完）
  const tabModules = useMemo(() => getMobileTabModules(features), [features, packTick]);

  const TAB_ICONS: Record<string, React.ReactNode> = {
    notes: <BookOpen size={20} />,
    tasks: <ListTodo size={20} />,
    diary: <NotebookPen size={20} />,
  };

  const tabs = [
    ...tabModules.map((m) => ({
      id: m.id,
      mode: m.mode,
      label: t(m.labelKey, { defaultValue: m.labelFallback }),
      icon: TAB_ICONS[m.id] || <BookOpen size={20} />,
      active:
        m.id === "notes"
          ? ["all", "notebook", "search", "tag", "favorites"].includes(state.viewMode)
          : m.id === "tasks"
            ? ["projects", "plans", "tasks"].includes(state.viewMode)
            : state.viewMode === m.mode,
      openMyTasks: m.action === "openMyTasks",
    })),
    {
      id: "more",
      mode: "more" as ViewMode,
      label: "我的",
      icon: <UserIcon size={20} />,
      active:
        state.viewMode === "more" ||
        ["media", "trash", "ai-chat", "mentions", "files", "books", "home", "library"].includes(state.viewMode),
      openMyTasks: false,
    },
  ];

  return (
    <div 
      className={cn(
        "mobile-tab-bar fixed bottom-0 left-0 right-0 z-35 md:hidden flex items-center justify-around transition-all duration-300 ease-soft",
        visible ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
      )}
      style={{
        // 底栏背景必须铺满手势条区域；内容区固定 64px，底部用 padding 消化 safe-area
        paddingBottom: "var(--safe-area-bottom)",
        minHeight: "calc(64px + var(--safe-area-bottom))",
        height: "calc(64px + var(--safe-area-bottom))",
        boxSizing: "border-box",
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => {
            handleTabClick(tab.mode, { openMyTasks: tab.openMyTasks });
          }}
          className={cn(
            // h-16 只约束图标+文字行，整体栏高由外层 minHeight 含 safe-area
            "flex flex-col items-center justify-center flex-1 h-16 max-h-16 relative transition-all duration-fast ease-soft active:scale-95",
            tab.active ? "text-accent-primary" : "text-tx-tertiary hover:text-tx-primary"
          )}
        >
          <div className={cn(
            "relative flex items-center justify-center w-11 h-7 rounded-full transition-all duration-fast ease-soft",
            tab.active && "bg-accent-primary/12"
          )}>
            {tab.icon}
            {tab.id === "more" && state.unreadMentionCount > 0 && (
              <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-red-500 border border-app-elevated shadow-sm" />
            )}
            {tab.id === "tasks" && state.reminderActiveCount > 0 && (
              <span className="absolute -top-1 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-accent-danger text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-sm">
                {state.reminderActiveCount}
              </span>
            )}
          </div>
          <span className={cn(
            "text-[10px] tracking-wide mt-0.5",
            tab.active ? "font-semibold" : "font-medium"
          )}>
            {tab.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * PR4 MobileFAB：主创建一等公民
 * - 单击：按当前模块新建（笔记 / 说说 / 待办）
 * - 长按 或 点「⋯」：展开次要入口（笔记/说说/待办/拍照）
 * - 不再塞笔记本/项目创建；不拖拽，避免误触
 */
function MobileFAB({
  viewMode,
  onNewNote,
  onNewDiary,
  onNewTask,
  onCameraClick,
}: {
  viewMode: ViewMode;
  onNewNote: () => void;
  onNewDiary: () => void;
  onNewTask: () => void;
  onCameraClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  const primary =
    viewMode === "diary"
      ? { run: onNewDiary, label: "写说说", icon: <NotebookPen size={26} /> }
      : viewMode === "projects"
        ? { run: onNewTask, label: "加待办", icon: <ListTodo size={26} /> }
        : { run: onNewNote, label: "新建笔记", icon: <Plus size={28} /> };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const secondary = [
    {
      key: "note",
      label: "新建笔记",
      icon: <BookOpen size={16} />,
      tone: "bg-amber-500/12 text-amber-500",
      run: onNewNote,
    },
    {
      key: "diary",
      label: "新建说说",
      icon: <NotebookPen size={16} />,
      tone: "bg-violet-500/12 text-violet-500",
      run: onNewDiary,
    },
    {
      key: "task",
      label: "新建待办",
      icon: <ListTodo size={16} />,
      tone: "bg-emerald-500/12 text-emerald-500",
      run: onNewTask,
    },
    {
      key: "camera",
      label: "拍照",
      icon: <Camera size={16} />,
      tone: "bg-sky-500/12 text-sky-500",
      run: onCameraClick,
    },
  ];

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 bg-black/15 backdrop-blur-[1px] md:hidden"
          />
        )}
      </AnimatePresence>

      <motion.div
        initial={{ opacity: 0, scale: 0.5, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.5, y: 20 }}
        transition={{ type: "spring", bounce: 0, duration: 0.3 }}
        className="mobile-fab-anchor fixed right-4 z-40 md:hidden flex flex-col items-end gap-2 select-none"
      >
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, scale: 0.88, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 10 }}
              className="flex flex-col gap-2 z-40 items-end mb-1"
            >
              {secondary.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    haptic.light();
                    setOpen(false);
                    item.run();
                  }}
                  className="flex items-center gap-2.5 pl-4 pr-2 py-2 rounded-full bg-app-elevated border border-app-border text-xs font-semibold text-tx-primary shadow-lg active:scale-95"
                >
                  <span>{item.label}</span>
                  <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", item.tone)}>
                    {item.icon}
                  </div>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-end gap-2">
          {/* 次要入口：展开菜单 */}
          <button
            type="button"
            title="更多创建"
            aria-label="更多创建"
            onClick={() => {
              haptic.light();
              setOpen((v) => !v);
            }}
            className="w-10 h-10 rounded-full bg-app-elevated border border-app-border shadow-md text-tx-secondary flex items-center justify-center active:scale-95"
          >
            <MoreHorizontal size={18} />
          </button>

          {/* 主按钮：单击主创建，长按展开菜单 */}
          <motion.button
            type="button"
            title={primary.label}
            aria-label={primary.label}
            onPointerDown={() => {
              longPressFired.current = false;
              clearLongPress();
              longPressTimer.current = setTimeout(() => {
                longPressFired.current = true;
                haptic.medium();
                setOpen(true);
              }, 420);
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onClick={() => {
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              if (open) {
                setOpen(false);
                return;
              }
              haptic.light();
              primary.run();
            }}
            whileTap={{ scale: 0.92 }}
            className="btn-primary-glow w-14 h-14 rounded-full flex items-center justify-center shadow-fab z-40"
          >
            <motion.div
              animate={{ rotate: open ? 45 : 0 }}
              transition={{ duration: 0.2 }}
            >
              {open ? <Plus size={28} /> : primary.icon}
            </motion.div>
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}

function AuthGate() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Phase 7: 快速登录（生物识别）网关 —— 在客户端模式下、isAuthenticated=false
  // 时优先尝试用 Keystore 中的 token + 指纹/人脸完成无密码登录。
  //   "pending"：刚确认未登录，正交给 QuickLoginGate 决定是否唤起
  //   "skipped" / null：QuickLoginGate 决定不展示（不支持 / 未启用 / 已尝试过）
  //                    或用户取消，UI 应渲染 LoginPage 让用户输密码
  const [quickLoginState, setQuickLoginState] = useState<"pending" | "skipped">("pending");
  /**
   * 热恢复锁屏：已登录态下回到前台时叠一层生物识别遮罩，
   * 不 setIsAuthenticated(false)，避免卸载 GlobalMusicPlayer 导致音频中断。
   */
  const [appLocked, setAppLocked] = useState(false);
  /** 应用内启动门：auth 判定完成即可 ready；淡出后再真正卸门 */
  const [splashDismissed, setSplashDismissed] = useState(false);
  const { t } = useTranslation();

  // Warm Resume Lock: Lock the app when returning from the background
  const authRef = useRef(isAuthenticated);
  useEffect(() => {
    authRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // 未登录时收到系统分享：暂存，登录后由 AppLayout useShareReceive 落库
  useEffect(() => {
    if (!isNativePlatform()) return;
    return subscribeShareReceive((payload) => {
      // true = 已登录，AppLayout 会处理；null = auth 判定中，只 stash 不 toast
      if (authRef.current === true) return;
      stashSharePayload(payload);
      if (authRef.current === false) {
        toast.info("已收到分享，登录后将自动保存为笔记");
      }
    });
  }, []);

  const lastBackgroundTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isNativePlatform()) return;

    let active = true;
    const handler = CapApp.addListener("appStateChange", ({ isActive }) => {
      if (!active) return;
      if (!isActive) {
        lastBackgroundTimeRef.current = Date.now();
      } else {
        if (lastBackgroundTimeRef.current) {
          const elapsed = Date.now() - lastBackgroundTimeRef.current;
          lastBackgroundTimeRef.current = null;
          // Only lock if backgrounded for more than 5 seconds
          if (elapsed > 5000) {
            const checkAndLock = async () => {
              try {
                const { isQuickLoginEnabled } = await import("@/lib/quickLogin");
                const enabled = await isQuickLoginEnabled();
                // 已登录 + 已启用快速登录 → 叠遮罩，不卸载主界面（音频继续播）
                if (enabled && authRef.current) {
                  setAppLocked(true);
                }
              } catch (err) {
                console.error("Failed to check quick login status on resume:", err);
              }
            };
            void checkAndLock();
          }
        }
      }
    });

    return () => {
      active = false;
      handler.then((h) => h.remove());
    };
  }, []);

  // P1: Splash Screen — 应用就绪后隐藏启动屏（必须在条件返回之前调用）
  useEffect(() => {
    if (isAuthenticated !== null) {
      hideSplashScreen();
    }
  }, [isAuthenticated]);

  // 判断是否为客户端模式（Electron / Android / 曾配置过服务器地址）
  //
  // Electron 打包后窗口加载的是 http://127.0.0.1:<port>/，protocol 是 "http:" 而非 "file:"，
  // 所以不能只靠 protocol 判断。preload 会注入 window.superDesktop.isDesktop=true，
  // 用它精确识别 Electron 桌面端 —— 同一个 Electron 窗口既能连"内置 backend"（localhost）
  // 也能连"远程服务器"（填 IP + 端口），登录页会展示服务器地址输入框。
  const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.()
    || !!(window as any).Capacitor?.platform && (window as any).Capacitor.platform !== "web";
  const isElectron = !!(window as any).superDesktop?.isDesktop;
  const isClientMode = window.location.protocol === "file:"
    || window.location.protocol === "capacitor:"
    || isCapacitor
    || isElectron
    || !!getServerUrl();

  const checkAuth = useCallback(() => {
    const token = localStorage.getItem("super-token");
    if (!token) {
      setIsAuthenticated(false);
      return;
    }

    const serverUrl = getServerUrl();
    const authScope = getAuthCacheScope(serverUrl);
    // 原生 APP（Capacitor）里没有 vite proxy，也没有同源后端 ——
    // 如果拿不到 serverUrl，直接回登录页让用户重新输，避免打到 "/api"
    // 后请求挂起导致白屏。
    const isCap = !!(window as any).Capacitor?.isNativePlatform?.();
    if (isCap && !serverUrl) {
      setIsAuthenticated(false);
      return;
    }
    const baseUrl = serverUrl ? `${serverUrl}/api` : "/api";

    // 8s 超时兜底：网络不通 / 服务器未启动时 fetch 会一直挂起，
    // 没有超时的话 UI 会永远停在 loading（splash 已被手动隐藏 → 白屏）。
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    fetch(`${baseUrl}/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.ok) return res.json();
        let body: any = {};
        try { body = await res.clone().json(); } catch { /* ignore */ }
        // 401 / 会话吊销类 403 才是真正的"登录态失效"，需要清 token。
        // 网络抖动、远端 5xx、超时不应把用户踢回登录页，否则云端离线缓存无法使用。
        const code = body?.code as string | undefined;
        const authInvalid =
          res.status === 401 ||
          code === "ACCOUNT_DISABLED" ||
          code === "TOKEN_REVOKED" ||
          code === "USER_NOT_FOUND" ||
          code === "TOKEN_INVALID" ||
          code === "SESSION_REVOKED" ||
          code === "UNAUTHENTICATED";
        if (authInvalid) {
          const err = new Error(body?.error || "Invalid token") as Error & { authInvalid?: boolean };
          err.authInvalid = true;
          throw err;
        }
        const err = new Error(body?.error || `Verify failed: ${res.status}`) as Error & { networkLike?: boolean; status?: number };
        err.status = res.status;
        err.networkLike = res.status >= 500 || res.status === 408 || res.status === 425 || res.status === 429;
        throw err;
      })
      .then((data) => {
        const verifiedUser = data.user as User;
        saveCachedAuthUser(authScope, token, verifiedUser);
        setUser(verifiedUser);
        setActiveToken(token);
        setIsAuthenticated(true);
        void import("@/lib/quickLogin")
          .then((m) => m.syncQuickLoginToken(token))
          .catch(() => {});
      })
      .catch((err) => {
        if ((err as any)?.authInvalid) {
          // 只有明确的鉴权失效才广播登出；网络/远端不可达不能清 token。
          broadcastLogout("verify_failed");
          setIsAuthenticated(false);
          return;
        }

        if (isVerifyNetworkFailure(err)) {
          const cachedUser = loadCachedAuthUser(authScope, token);
          if (cachedUser) {
            // 云端降级：保留 token + serverUrl，使用上次用户信息进入主界面。
            // 后续读请求会走 offlineRead，本地缓存可用；写请求失败会进 offlineQueue。
            setUser(cachedUser);
            setIsAuthenticated(true);
            try { window.dispatchEvent(new CustomEvent("super:cloud-degraded")); } catch { /* ignore */ }
            return;
          }
          // 无缓存时无法绑定 localStore 用户 id，只能展示登录页；但仍不清 token，
          // 网络恢复后刷新即可重新 verify 进入。
          setIsAuthenticated(false);
          return;
        }

        setIsAuthenticated(false);
      })
      .finally(() => clearTimeout(timer));
  }, []);

  useEffect(() => {
    // Phase A: Electron 桌面端零登录优先 —— 在任何"客户端模式 + 无 serverUrl 即回登录页"
    // 的判断之前先问主进程要本地账号 token。
    //   - 如果 localStorage 里已有 token（用户已显式登录过），优先尊重之，不覆盖；
    //   - 仅当未登录且 superDesktop.isDesktop+getLocalAuth 可用时才走零登录路径；
    //   - lite 模式（连远端）下主进程会返回 null，自动回落到原有登录流程；
    //   - 拿到 token 时同时把 window.location.origin（http://127.0.0.1:<port>）
    //     写入 super-server-url，让后续 API 调用照常走 ${serverUrl}/api，
    //     避免 verify / fetch 落空。
    //   - 整体放到最前面是因为：桌面端首启 localStorage 一片空白，
    //     原先 "isClientMode && !getServerUrl()" 会直接 return，零登录代码永远走不到。
    const desktopApi = (window as any).superDesktop;
    const existingToken = (() => {
      try { return localStorage.getItem("super-token"); } catch { return null; }
    })();
    // D-1：桌面端"切换到云端"开关。
    //   用户在 NavRail 点击云端入口后会写 super-prefer-cloud=1，
    //   此时强制跳过零登录，直接进登录页（让用户输入 fnos 服务器地址）。
    //   返回本地模式时 LoginPage 会清除该标记 + reload，零登录恢复。
    const preferCloud = (() => {
      try { return localStorage.getItem("super-prefer-cloud") === "1"; } catch { return false; }
    })();
    if (!existingToken && !preferCloud && desktopApi?.isDesktop && desktopApi?.getLocalAuth) {
      let cancelled = false;
      desktopApi.getLocalAuth().then((auth: { token: string; user: User } | null) => {
        if (cancelled) return;
        if (auth?.token) {
          try {
            localStorage.setItem("super-token", auth.token);
            // 桌面端首启把 origin 当作 serverUrl 落盘，让后续同源 API 调用顺利通过
            if (!getServerUrl() && window.location.origin.startsWith("http")) {
              localStorage.setItem("super-server-url", window.location.origin);
            }
          } catch { /* ignore */ }
          saveCachedAuthUser(getAuthCacheScope(getServerUrl()), auth.token, auth.user);
          setUser(auth.user);
          setIsAuthenticated(true);
          return;
        }
        // 主进程没给 token（lite 模式 / ensureLocalAccount 失败）→ 退回原有判定
        if (isClientMode && !getServerUrl()) {
          setIsAuthenticated(false);
        } else {
          checkAuth();
        }
      }).catch(() => {
        if (cancelled) return;
        if (isClientMode && !getServerUrl()) {
          setIsAuthenticated(false);
        } else {
          checkAuth();
        }
      });
      return () => { cancelled = true; };
    }

    // 非桌面端 / 已有 token：走原有逻辑
    // 客户端模式但没有服务器地址：直接显示登录页（含服务器输入框）
    if (isClientMode && !getServerUrl()) {
      setIsAuthenticated(false);
      return;
    }

    const checkStartupAuth = async () => {
      const isCap = isNativePlatform();
      if (isCap) {
        try {
          const { isQuickLoginEnabled } = await import("@/lib/quickLogin");
          const enabled = await isQuickLoginEnabled();
          if (enabled) {
            // 已启用指纹：走 QuickLoginGate（生物识别 → 恢复会话）。
            // 不在这里 checkAuth 自动进主界面，否则会绕过指纹门。
            // 同时把 quickLoginState 复位为 pending，避免上次「skipped」残留。
            setQuickLoginState("pending");
            setIsAuthenticated(false);
            return;
          }
        } catch (err) {
          console.error("Failed to check quick login status:", err);
        }
      }
      checkAuth();
    };

    checkStartupAuth();
  }, [checkAuth, isClientMode]);

  // L10: 多标签页登录态同步
  //
  //   同一浏览器里开了多个 tab 时，常见的诉求：
  //     1) A tab 退出登录 / 被踢下线 → B tab 要立刻跟着退出；
  //     2) A tab 登录成功（或换了账号） → B tab 应该重载进入对应账号；
  //     3) A tab 改了服务器地址 → B tab 的后续请求自然应该打到新服务器。
  //
  //   storage 事件只在"其他"tab 修改 localStorage 时触发（不会在自己这 tab 触发），
  //   所以 handler 里调 window.location.reload() 不会导致死循环。
  //   仅监听我们自己的 key：super-token / super-server-url / super-logout-broadcast。
  //
  //   另外单独用一个 "super-logout-broadcast" key 作为广播通道：
  //   当某 tab 主动登出时 setItem(..., Date.now()) 即可通知所有其他 tab。
  useEffect(() => {
    const onStorage = (ev: StorageEvent) => {
      if (!ev.key) return;
      if (ev.key === "super-token") {
        const oldHad = !!ev.oldValue;
        const nowHas = !!ev.newValue;
        if (oldHad && !nowHas) {
          // 其他 tab 登出了 → 把本 tab 也拉回登录页
          setIsAuthenticated(false);
          setUser(null);
        } else if (oldHad && nowHas && ev.oldValue !== ev.newValue) {
          // token 被替换（换账号 / factory-reset 下发新 token）→ 重新验证并重载应用
          window.location.reload();
        } else if (!oldHad && nowHas) {
          // 其他 tab 刚登录成功 → 本 tab 去走一遍 verify，无感进入已登录态
          checkAuth();
        }
      } else if (ev.key === "super-logout-broadcast") {
        // 其他 tab 主动登出 → 本 tab 也清本地 token 并回登录页
        try { localStorage.removeItem("super-token"); } catch {}
        setIsAuthenticated(false);
        setUser(null);
      } else if (ev.key === "super-server-url") {
        // 服务器地址改了，接下来的 API 调用需要刷新页面才能命中新 base URL
        // 只有已登录（或正在展示列表）才需要 reload，未登录状态本身就在输服务器地址那一步，不用动
        if (isAuthenticated) {
          window.location.reload();
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [checkAuth, isAuthenticated]);

  // Phase 7: 标记"本次登录是否刚通过密码完成"——
  //   只有密码登录的用户才会被引导启用快速登录；
  //   通过快速登录进来的用户已经启用过，不应再弹。
  const [justPasswordLogin, setJustPasswordLogin] = useState(false);
  /** 当前 token（用于引导对话框写入 secure storage） */
  const [activeToken, setActiveToken] = useState<string>("");

  // Synchronize credentials to Android native bridge for background notifications
  useEffect(() => {
    const cap = (window as any).Capacitor;
    if (cap && cap.getPlatform() === "android") {
      const bridge = (window as any).AndroidKeepAliveBridge;
      if (bridge && bridge.updateAuthInfo) {
        const serverUrl = getServerUrl();
        const token = activeToken || localStorage.getItem("super-token") || "";
        const userId = user?.id || "";
        try {
          bridge.updateAuthInfo(serverUrl, token, userId);
        } catch (e) {
          console.error("Failed to sync auth info to Android bridge:", e);
        }
      }
    }
  }, [user?.id, activeToken]);

  // Phase B: 用户登录态确立后启动同步引擎（绑定 IDB + 全量 pull）。
  // 任何登录入口（密码 / 快速登录 / 桌面零登录）最终都会落到 setUser，
  // 这里集中接管，避免每个入口都重复挂钩。失败不阻塞 UI。
  useEffect(() => {
    if (!user?.id) return;
    void syncBootstrap(user).catch((e) => {
      console.warn("[App] syncBootstrap failed:", e);
    });
  }, [user?.id]);

  // 「更新日志」首次升级自动弹窗。
  //   - 仅在已登录分支生效（enable=!!user），未登录态不打扰；
  //   - useWhatsNew 内部对比 localStorage.super-seen-version 与 __APP_VERSION__，
  //     不一致才返回 shouldShow=true，关闭后立即写回，下一次升级才再弹。
  const showWhatsNew = false;
  const markWhatsNewSeen = () => {};

  const handleDisconnect = () => {
    clearServerUrl();
    // L10: 断开服务器相当于登出 + 切换服务器，通知其他 tab
    broadcastLogout("disconnect_server");
    // Phase 7: 切换服务器时 token 已经无意义，把 secure storage 镜像也清掉，
    // 避免下次开 app 又用旧 token 自动登录（会落到 verify 失败再回退，但没必要走一遭）
    void import("@/lib/quickLogin").then((m) => m.disableQuickLogin()).catch(() => {});
    // Phase B: 解绑本地缓存当前用户；缓存数据保留以便下次重登秒开
    syncTeardown();
    setIsAuthenticated(false);
    setUser(null);
  };

  const handleLogin = (token: string, userData: User) => {
    saveCachedAuthUser(getAuthCacheScope(getServerUrl()), token, userData);
    try {
      localStorage.setItem("super-token", token);
    } catch {
      /* ignore */
    }
    setUser(userData);
    setActiveToken(token);
    setIsAuthenticated(true);
    // 指纹已开启时静默刷新 Keystore 镜像，避免过期后只能输密码
    void import("@/lib/quickLogin")
      .then((m) => m.syncQuickLoginToken(token))
      .catch(() => {});

    // 登录引导回跳：支持来自分享页（edit_auth 权限）的 `/login?redirect=/share/<token>`。
    //
    // 安全约束 —— 只允许相对路径回跳，绝不允许 http(s):// 或 // 开头：
    //   1. 防止开放重定向（open redirect）：恶意人造 `?redirect=https://attacker.example`
    //      把刚登录的用户带到钓鱼页；
    //   2. 防 protocol-relative URL（`//attacker.example`）和 `javascript:` 协议；
    //   3. 兼容 hash router 链路：相对 `/share/xxx` 直接 location.assign 即可命中
    //      App.tsx 顶部的 path 路由匹配（shareMatch）。
    //
    // 命中即跳；不命中保持原行为（停留在主界面）。
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("redirect");
      if (raw) {
        // 仅接受单斜杠 + 字母/数字/常见符号的相对路径
        if (/^\/[A-Za-z0-9_\-./?&=%#]*$/.test(raw) && !raw.startsWith("//")) {
          // 用 replace 而非 assign：登录页在历史栈中没意义，避免用户后退又回登录页
          window.location.replace(raw);
          return;
        }
      }
    } catch {
      // location 异常时静默：保持登录后的默认主界面渲染即可，不阻断登录流程
    }
  };

  /** 仅用于 LoginPage（密码登录路径），登录成功后下一帧弹引导对话框 */
  const handlePasswordLogin = (token: string, userData: User) => {
    setJustPasswordLogin(true);
    handleLogin(token, userData);
  };

  // 应用内闪屏门：仅原生 APP；Web / Electron 不挂载
  const splashGate =
    isNativePlatform() && !splashDismissed ? (
      <AppSplashGate
        ready={isAuthenticated !== null}
        onHidden={() => setSplashDismissed(true)}
      />
    ) : null;

  if (isAuthenticated === null) {
    return (
      <>
        {splashGate}
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('auth.verifying')}</p>
          </div>
        </div>
      </>
    );
  }

  // 未登录 → 一体化登录页
  if (!isAuthenticated) {
    // Phase 7: 先让 QuickLoginGate 看看是否能用生物识别一键登录
    //   - 不支持 / 未启用 / 用户取消：onSettled(false) 会把 quickLoginState
    //     置为 "skipped"，下面继续渲染 LoginPage
    //   - 成功：onSettled(true, payload) 直接走 handleLogin 进主界面
    if (isClientMode && quickLoginState === "pending") {
      // 原生 APP：等应用内闪屏淡出后再挂载 QuickLoginGate，
      // 避免系统指纹/人脸浮层盖在闪屏图上。
      const canStartQuickLogin = !isNativePlatform() || splashDismissed;
      const verifyingFallback = (
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('auth.verifying')}</p>
          </div>
        </div>
      );
      return (
        <>
          {splashGate}
          {canStartQuickLogin ? (
            <Suspense fallback={verifyingFallback}>
              <QuickLoginGate
                isClientMode={isClientMode}
                onSettled={(used, payload) => {
                  if (used && payload) {
                    handleLogin(payload.token, payload.user);
                  } else {
                    setQuickLoginState("skipped");
                  }
                }}
              />
            </Suspense>
          ) : (
            verifyingFallback
          )}
        </>
      );
    }

    return (
      <>
        {splashGate}
        <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-zinc-400 dark:text-zinc-500">{t('auth.verifying')}</p>
          </div>
        </div>
      }>
        <LoginPage
          onLogin={handlePasswordLogin}
          isClientMode={isClientMode}
          onDisconnect={isClientMode ? handleDisconnect : undefined}
        />
      </Suspense>
      </>
    );
  }

  // 已登录
  return (
    <>
      {splashGate}
      <AppProvider>
      <TooltipProvider>
        <AppLayout />
        <Suspense fallback={null}>
          {/* Phase 7: 客户端模式下，密码登录成功后引导启用快速登录。
              QuickLoginEnrollDialog 内部会判断"是否已问过 / 设备是否支持"，
              不需要展示时会立即调 onClose 自我隐身。 */}
          {justPasswordLogin && isClientMode && user && activeToken && (
            <QuickLoginEnrollDialog
              username={user.username}
              token={activeToken}
              onClose={() => setJustPasswordLogin(false)}
            />
          )}
          {/* 首次升级到新版本自动弹「更新日志」。
              useWhatsNew 决定是否该弹；onClose 调 markSeen 写回 localStorage，
              下一次升版前都不会再弹。 */}
          {showWhatsNew && (
            <WhatsNewModal
              open={showWhatsNew}
              onClose={markWhatsNewSeen}
              highlightVersion={__APP_VERSION__}
            />
          )}
          {/* 热恢复锁屏：叠在主界面上，不卸载播放器，音频可继续播 */}
          {appLocked && (
            <AppLockOverlay
              onUnlocked={() => setAppLocked(false)}
              onFallbackToPassword={() => {
                // 用户主动选「使用密码」：清本地会话进登录页，但保留 Keystore 指纹配置
                // （broadcastLogout verify 类不会清指纹；这里只清 LS token）
                setAppLocked(false);
                try {
                  localStorage.removeItem("super-token");
                } catch {
                  /* ignore */
                }
                // 允许登录页路径再走一次 QuickLoginGate（用户可改主意点指纹）
                setQuickLoginState("pending");
                setIsAuthenticated(false);
                setUser(null);
              }}
            />
          )}
        </Suspense>
      </TooltipProvider>
    </AppProvider>
    </>
  );
}

function App() {
  const [webUiAllowed, setWebUiAllowed] = useState<boolean | null>(() => isNativeClientRuntime() ? true : null);

  useEffect(() => {
    if (isNativePlatform()) {
      setWebUiAllowed(true);
      return;
    }
    let cancelled = false;
    fetchWebUiEnabled().then((enabled) => {
      if (!cancelled) setWebUiAllowed(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  // 监听原生 App 打开 URL 事件 (Capacitor)
  useEffect(() => {
    if (typeof window === "undefined" || !isNativePlatform()) return;

    let isAttached = true;
    const registerListener = async () => {
      try {
        const handler = await CapApp.addListener("appUrlOpen", (event) => {
          if (!isAttached) return;
          const url = event.url;
          if (url && /^https?:\/\/mp\.weixin\.qq\.com\/s[\/?]/.test(url)) {
            sessionStorage.setItem("super:pending-import-url", url);
            window.dispatchEvent(new CustomEvent("super:pending-import-url-trigger"));
          }
        });
        return handler;
      } catch (err) {
        console.warn("Failed to register appUrlOpen listener:", err);
      }
    };

    const handlerPromise = registerListener();
    return () => {
      isAttached = false;
      handlerPromise.then((h) => {
        if (h) h.remove();
      });
    };
  }, []);

  if (webUiAllowed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!webUiAllowed) {
    return <WebUiDisabledPage />;
  }

  // 检查是否是分享页面路由 /share/:token
  //
  // 字符集说明：后端 generateShareToken() 用 crypto.randomBytes(9).toString("base64url")
  // 输出 12 字符 base64url，字符集是 [A-Za-z0-9_-]（注意包含下划线和连字符）。
  //
  // 历史 BUG（必须保留下划线/连字符的支持）：
  //   早期正则写成 [A-Za-z0-9]+，碰到含 `-` / `_` 的 token 时匹配失败，
  //   App 直接落到 AuthGate 分支 → 未登录用户被导到登录页，
  //   被误诊为"可评论分享触发登录"。如果再次收紧此正则，请同步约束 token 生成。
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/([A-Za-z0-9_-]+)$/);
  if (shareMatch) {
    return (
      <ThemeProvider>
        <ConfirmProvider>
          <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 transition-colors">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-indigo-500" />
                <p className="text-sm text-zinc-400 dark:text-zinc-500">正在加载分享页面...</p>
              </div>
            </div>
          }>
            <SharedNoteView shareToken={shareMatch[1]} />
          </Suspense>
          <Toaster />
        </ConfirmProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <SiteSettingsProvider>
        <UserPreferencesProvider>
          <ConfirmProvider>
            <AuthGate />
            <Toaster />
          </ConfirmProvider>
        </UserPreferencesProvider>
      </SiteSettingsProvider>
    </ThemeProvider>
  );
}

export default App;
