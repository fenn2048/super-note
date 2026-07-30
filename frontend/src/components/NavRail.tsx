/**
 * NavRail（v16 P3 双层导航 Rail）
 *
 * 设计目标：把"模块切换"从主侧栏拆出，放到左侧永久可见的 Rail。
 * 主侧栏因此可以专注于"当前模块的子内容"（笔记本/标签）。
 *
 * 视觉模式（由 useRailMode 控制）：
 *   - "icon"  ：48px 纯图标（紧凑）
 *   - "label" ：64px 图标 + 下方 10px 标签文字（识别度优先，企微/钉钉风格）
 *   - "hidden"：桌面变体下整块不渲染（由 App.tsx 处理，本组件不会被挂载）。
 *               mobile 变体下抽屉永远显式打开来看导航，不接受 hidden——遇到 hidden 时
 *               强制按 icon 渲染。
 *
 * 行为约定：
 * - desktop 变体：hidden md:flex，配合 sidebarCollapsed 由 App.tsx 控制可见性。
 *   折叠按钮、设置、登出 都收编到 Rail（替代主侧栏 Footer + Header 折叠按钮的位置）。
 * - mobile 变体（v16 P3 后续：移动端也拆 Rail+主区两栏）：
 *   只在抽屉里渲染（外层已 md:hidden），顶部按钮是"关闭抽屉" X 而非折叠；
 *   设置 / 登出同样收编到 Rail 底部，与桌面对齐视觉风格。
 *
 * 与 Sidebar 内 navItemsRaw 的关系：
 *   两边各持一份"导航项配置"——拆分得干净（NavRail 不依赖 Sidebar 的内部 state）。
 *   维护成本：增删模块时两处都要改。后续如果出现第三个消费者，可考虑提到统一 hook。
 *
 * 关于回收站清空：
 *   v15 的逻辑（带 lock 检测 / 体量统计 / VACUUM 提示）在 Sidebar 内，复杂且与 toast 强耦合。
 *   Rail 上不再支持"右键清空"——这是低频破坏性操作，用户进入「回收站」视图后再清空更合理。
 *   不为了功能对齐而把 ~80 行复杂逻辑复制到这里。
 */
import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  BookOpen, Book, Sparkles, NotebookPen, Briefcase, FolderOpen, Film,
  Settings, LogOut, PanelLeftClose, PanelLeft, X,
  Columns2, Columns3, Cloud, CloudOff, Home, ListTodo, Bell, Wallet,
} from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { api, broadcastLogout, getCurrentWorkspace, getServerUrl, clearServerUrl } from "@/lib/api";
import { ViewMode } from "@/types";
import { cn } from "@/lib/utils";
import MigrationModal from "@/components/MigrationModal";
import { useRailMode, nextRailMode, RailMode } from "@/hooks/useRailMode";
import { getAppInfo, isDesktop as isDesktopApp, switchDesktopToFull, type AppInfo } from "@/lib/desktopBridge";
import { clearLocalIdMap, clearQueue, getQueueLength } from "@/lib/offlineQueue";
import {
  getDesktopRailModules,
  isModuleActive,
  openTasksEntry,
  setLibraryTab,
  type NavModule,
} from "@/lib/navigation.config";
import { useWorkspaceFeatures } from "@/store/workspaceFeaturesStore";

// Rail 上图标统一 18px——比主侧栏 16px 略大，因为没有文字陪衬时需要更醒目；
// label 模式下也保持 18px，配 10px 字号视觉层级正好。
const RAIL_ICON_SIZE = 18;

const RAIL_ICONS: Record<string, React.ReactNode> = {
  home: <Home size={RAIL_ICON_SIZE} />,
  notes: <BookOpen size={RAIL_ICON_SIZE} />,
  tasks: <ListTodo size={RAIL_ICON_SIZE} />,
  diary: <NotebookPen size={RAIL_ICON_SIZE} />,
  ai: <Sparkles size={RAIL_ICON_SIZE} />,
  library: <FolderOpen size={RAIL_ICON_SIZE} />,
  files: <FolderOpen size={RAIL_ICON_SIZE} />,
  books: <Book size={RAIL_ICON_SIZE} />,
  media: <Film size={RAIL_ICON_SIZE} />,
  finance: <Wallet size={RAIL_ICON_SIZE} />,
};

export default function NavRail({ variant = "desktop" }: { variant?: "desktop" | "mobile" } = {}) {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [railMode, setRailMode] = useRailMode();
  // mobile 变体：hidden 在抽屉里没意义（用户已经主动打开抽屉就是要看导航），
  // 强制按 icon 渲染——不修改持久化值，桌面端切回 hidden 仍然有效。
  const effectiveMode: RailMode = variant === "mobile" && railMode === "hidden" ? "icon" : railMode;
  const showLabel = effectiveMode === "label";
  const isMobile = variant === "mobile";

  // 工作区功能开关：全局 store（App 壳 bootstrap）
  const { features, packTick } = useWorkspaceFeatures();

  const [currentUser, setCurrentUser] = useState<any>(null);

  const fetchUser = useCallback(async () => {
    try {
      const user = await api.getMe();
      setCurrentUser(user);
    } catch (err) {
      console.error("Failed to fetch user in NavRail:", err);
    }
  }, []);

  useEffect(() => {
    fetchUser();
    window.addEventListener("super:profile-updated", fetchUser);
    return () => window.removeEventListener("super:profile-updated", fetchUser);
  }, [fetchUser]);

  // D-2：迁移向导弹窗。点"切换到云端"会先弹出，让用户选择是否把本地数据迁过去。
  const [showMigration, setShowMigration] = useState(false);
  const [desktopInfo, setDesktopInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    getAppInfo()
      .then((info) => {
        if (!cancelled) setDesktopInfo(info ?? null);
      })
      .catch(() => {
        if (!cancelled) setDesktopInfo(null);
      });
    return () => { cancelled = true; };
  }, []);

  const normalizeUrl = (url: string) => url.replace(/\/+$/, "").toLowerCase();
  const isLoopbackUrl = (url: string) => {
    try {
      const u = new URL(url);
      return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
    } catch {
      return false;
    }
  };
  const serverUrl = getServerUrl();
  const currentOrigin = typeof window !== "undefined" && window.location.origin.startsWith("http")
    ? window.location.origin
    : "";
  const desktopMode = desktopInfo?.mode ?? null;
  const usingDesktopLiteMode = desktopMode === "lite";
  const desktopLocalUrl = desktopInfo?.backendPort ? `http://127.0.0.1:${desktopInfo.backendPort}` : "";
  const usingCurrentLocalBackend = !!serverUrl && !!desktopLocalUrl && normalizeUrl(serverUrl) === normalizeUrl(desktopLocalUrl);
  // Electron 打包态是 file:// origin，不能用 "!currentOrigin" 判定远端；否则本地后端
  // http://127.0.0.1:<port> 也会被误判成云端，点击“本地”会反复清状态/刷新。
  const usingRemoteServer = !!serverUrl
    && !usingCurrentLocalBackend
    && (usingDesktopLiteMode || !isLoopbackUrl(serverUrl) || (!!currentOrigin && normalizeUrl(serverUrl) !== normalizeUrl(currentOrigin)));
  const canSwitchBackToLocal = isDesktopApp() && (usingRemoteServer || usingDesktopLiteMode);

  const items = useMemo(() => getDesktopRailModules(features), [features, packTick]);

  const handleClick = useCallback((mod: NavModule) => {
    if (mod.action === "openMyTasks") {
      openTasksEntry();
    }
    if (mod.action === "libraryTab" && mod.libraryTab) {
      setLibraryTab(mod.libraryTab);
    }
    if (mod.id === "library") {
      setLibraryTab("files");
    }
    actions.setViewMode(mod.mode);
    actions.setSelectedNotebook(null);
    if (mod.mode === "books" || mod.mode === "library") {
      window.dispatchEvent(new CustomEvent("super:close-book"));
    }

    // 笔记 / 任务相关视图展开中间栏；资料库与 AI 等全宽模块收起侧栏
    const isNoteOrProjectView =
      mod.id === "notes" ||
      mod.id === "tasks" ||
      mod.mode === "all" ||
      mod.mode === "favorites" ||
      mod.mode === "trash" ||
      mod.mode === "notebook" ||
      mod.mode === "tag" ||
      mod.mode === "search" ||
      mod.mode === "projects" ||
      mod.mode === "plans";
    if (isNoteOrProjectView) {
      actions.setSidebarCollapsed(false);
    } else {
      actions.setSidebarCollapsed(true);
    }

    if (isMobile) actions.setMobileSidebar(false);
  }, [actions, isMobile]);

  const handleDesktopCloudButton = useCallback(async () => {
    if (!canSwitchBackToLocal) {
      setShowMigration(true);
      return;
    }

    const queuedCount = getQueueLength();
    if (queuedCount > 0) {
      const confirmed = window.confirm(
        t('sidebar.switchToLocalConfirmWithQueue', '切回本地离线模式？当前云端账号还有未同步操作，切换后这些待同步操作会被丢弃，云端数据不会被删除。')
      );
      if (!confirmed) return;
    }

    // 桌面端切回本地统一交给主进程：写 settings、清 Electron session storage、
    // 停/启后端并 relaunch。renderer 内部 location.reload() 在 file:// + query serverUrl
    // 场景下容易和 AuthGate / serverUrl 持久化互相打架，表现为黑屏/闪屏。
    const result = await switchDesktopToFull();
    if (result?.ok !== false) return;

    // 旧版 preload 不支持 mode IPC 时的兜底：只做 renderer 级清理并刷新。
    clearQueue();
    clearLocalIdMap();
    broadcastLogout("switch_to_local");
    try {
      clearServerUrl();
      localStorage.removeItem("super-token");
      localStorage.removeItem("super-prefer-cloud");
      localStorage.removeItem("super-offline-queue");
      localStorage.removeItem("super-offline-id-map");
    } catch { /* ignore */ }
    window.location.reload();
  }, [canSwitchBackToLocal, t]);

  // ===== 尺寸常量 =====
  // icon 模式：48px 宽栏 / 40px 方按钮
  // label 模式：64px 宽栏 / 整宽纵向按钮（图标 + 文字两行）
  const railWidthClass = showLabel ? "w-16" : "w-12";
  const railWidthPx = showLabel ? 64 : 48;

  // 供全局音乐播放器等贴底组件避让 Rail（不覆盖左侧导航）
  useEffect(() => {
    if (isMobile) return;
    document.documentElement.style.setProperty("--nav-rail-width", `${railWidthPx}px`);
    return () => {
      document.documentElement.style.setProperty("--nav-rail-width", "0px");
    };
  }, [isMobile, railWidthPx]);
  const itemBaseClass = showLabel
    ? "relative w-14 py-1.5 rounded-button flex flex-col items-center justify-center gap-0.5 transition-all duration-fast ease-soft"
    : "relative w-10 h-10 rounded-button flex items-center justify-center transition-all duration-fast ease-soft";

  const renderItem = (mod: NavModule) => {
    const active = isModuleActive(mod, state.viewMode);
    const label = t(mod.labelKey, { defaultValue: mod.labelFallback });
    const icon = RAIL_ICONS[mod.id] || <Briefcase size={RAIL_ICON_SIZE} />;
    return (
      <button
        key={mod.id}
        onClick={() => handleClick(mod)}
        title={showLabel ? undefined : label}
        aria-label={label}
        className={cn(
          itemBaseClass,
          active
            ? "nav-active-pill"
            : "text-tx-tertiary hover:bg-app-hover hover:text-tx-primary",
        )}
      >
        {icon}
        {mod.id === "tasks" && state.reminderActiveCount > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-accent-danger text-[9px] font-bold text-white flex items-center justify-center leading-none z-10 shadow-sm">
            {state.reminderActiveCount}
          </span>
        )}
        {showLabel && (
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1 font-medium">
            {label}
          </span>
        )}
      </button>
    );
  };

  // 主路径 / 次要工具之间用细分隔线
  const primaryItems = items.filter((m) => m.group !== "secondary");
  const secondaryItems = items.filter((m) => m.group === "secondary");

  // mobile 变体下 Rail 模式切换只在 icon ↔ label 之间循环（hidden 被强制忽略）。
  // 这样用户能在抽屉里调整图标紧凑度，但不会把自己折叠成无导航死局。
  const mobileNextMode: RailMode = effectiveMode === "label" ? "icon" : "label";
  const MobileSwitchIcon = effectiveMode === "label" ? Columns2 : Columns3;

  return (
    <div
      className={cn(
        // desktop：桌面专用，md 及以上才显示
        // mobile：仅在抽屉里使用，本身已被 md:hidden 包裹的容器约束；这里再加 md:hidden 双保险
        isMobile
          ? "flex md:hidden h-full"
          : "hidden md:flex h-full self-stretch",
        "vibrancy-sidebar bg-app-sidebar border-r border-app-border/80 flex-col items-center shrink-0 transition-[width] duration-150",
        railWidthClass,
      )}
      style={{
        paddingTop: "calc(var(--safe-area-top) + 4px)",
        paddingBottom: "8px",
        // 实体侧栏色铺满整高，避免 vibrancy / 透明叠出底部发白
        backgroundColor: "var(--color-sidebar-solid, var(--color-sidebar))",
      }}
    >
      {/* 顶部按钮区：
          - desktop：折叠/展开主侧栏（合并 Sidebar 原 Header 折叠按钮的功能）。
          - mobile：关闭抽屉 X（替代 Sidebar mobile Header 的关闭按钮，统一收编到 Rail）+
                    Rail 模式切换（icon ↔ label）。
          决策：这两个按钮都是工具按钮，不属于"导航项"——保持 40px 方形紧凑感，
          不与下方导航项的 label 模式纵向对齐。 */}
      {isMobile ? (
        <>
          <button
            onClick={() => actions.setMobileSidebar(false)}
            title={t('common.close')}
            aria-label={t('common.close')}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-tx-tertiary hover:bg-app-hover hover:text-tx-primary transition-colors"
          >
            <X size={16} />
          </button>
          <button
            onClick={() => setRailMode(mobileNextMode)}
            title={t(`sidebar.railMode.switchTo.${mobileNextMode}`)}
            aria-label={t(`sidebar.railMode.switchTo.${mobileNextMode}`)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-tx-tertiary hover:bg-app-hover hover:text-tx-primary transition-colors"
          >
            <MobileSwitchIcon size={16} />
          </button>
        </>
      ) : (
        <button
          onClick={actions.toggleSidebar}
          title={state.sidebarCollapsed ? t('common.expand') : t('common.collapse')}
          aria-label={state.sidebarCollapsed ? t('common.expand') : t('common.collapse')}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-tx-tertiary hover:bg-app-hover hover:text-tx-primary transition-colors"
        >
          {state.sidebarCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      )}

      <div className={cn("my-2 border-t border-app-border/60", showLabel ? "w-8" : "w-6")} aria-hidden />

      {/* 桌面全局「+」已迁至屏幕右下角常驻 FAB（App.tsx），快捷键 Alt+C 仍可用 */}

      {/* 主导航：主路径 + 次要工具，组间细线分隔。来源：navigation.config */}
      <div className="flex-1 min-h-0 w-full overflow-y-auto no-scrollbar flex flex-col items-center gap-1 px-1">
        {primaryItems.map(renderItem)}
        {secondaryItems.length > 0 && (
          <>
            <div
              className={cn("my-1 border-t border-app-border/60", showLabel ? "w-8" : "w-6")}
              aria-hidden
            />
            {secondaryItems.map(renderItem)}
          </>
        )}
      </div>

      <div className={cn("my-2 border-t border-app-border/60", showLabel ? "w-8" : "w-6")} aria-hidden />

      {/* 用户头像与用户名首字 (在铃铛上方，悬停显示全名) */}
      {currentUser && (
        <div
          title={currentUser.displayName || currentUser.username}
          className={cn(
            itemBaseClass,
            "flex flex-col items-center justify-center gap-1 group/avatar cursor-pointer hover:bg-app-hover/50 rounded-lg p-1 text-tx-secondary transition-all mb-1"
          )}
          onClick={() => window.dispatchEvent(new CustomEvent("super:open-settings"))}
        >
          <div className="relative">
            {currentUser.avatarUrl ? (
              <img
                src={currentUser.avatarUrl.startsWith("http") ? currentUser.avatarUrl : `${getServerUrl()}${currentUser.avatarUrl}`}
                alt=""
                className="w-7 h-7 rounded-full object-cover border border-app-border group-hover/avatar:border-accent-primary transition-colors"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent-primary/10 border border-app-border flex items-center justify-center text-[11px] font-extrabold text-accent-primary uppercase group-hover/avatar:border-accent-primary transition-colors">
                {(currentUser.displayName || currentUser.username || "").slice(0, 1).toUpperCase()}
              </div>
            )}
          </div>
          <span className={cn(
            "text-[9px] leading-none mt-0.5 max-w-full truncate font-medium text-tx-tertiary group-hover/avatar:text-tx-secondary",
            showLabel && "text-[10px] font-bold text-tx-secondary"
          )}>
            {(currentUser.displayName || currentUser.username || "").slice(0, 1)}
          </span>
        </div>
      )}

      {/* 底部：消息盒子 + 设置 + 登出 */}
      <button
        onClick={() => {
          actions.setViewMode("mentions");
          if (isMobile) actions.setMobileSidebar(false);
        }}
        title={showLabel ? undefined : t("sidebar.mentions", { defaultValue: "消息" })}
        aria-label={t("sidebar.mentions", { defaultValue: "消息" })}
        className={cn(
          itemBaseClass,
          state.viewMode === "mentions"
            ? "nav-active-pill"
            : "text-tx-tertiary hover:bg-app-hover hover:text-accent-primary relative",
        )}
      >
        <Bell size={16} />
        {state.unreadMentionCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-[3px] rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center shadow-sm shadow-red-500/30">
            {state.unreadMentionCount > 99 ? "99+" : state.unreadMentionCount}
          </span>
        )}
        {showLabel && (
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
            {t("sidebar.mentions", { defaultValue: "消息" })}
          </span>
        )}
      </button>

      {/* 设置 + 登出 */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent("super:open-settings"))}
        title={showLabel ? undefined : t('sidebar.settings')}
        aria-label={t('sidebar.settings')}
        className={cn(
          itemBaseClass,
          "text-tx-tertiary hover:bg-app-hover hover:text-tx-primary",
        )}
      >
        <Settings size={16} />
        {showLabel && (
          <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
            {t('sidebar.settings')}
          </span>
        )}
      </button>
      {/*
        云端/本地模式切换（家庭场景以 Web 为主，隐藏此 Electron 专属功能）
        如需恢复，取消下方注释并将登出按钮的 onClick 内的 broadcastLogout 和
        location.reload() 恢复为原有的 isDesktopApp() 三目分支。
      */}
      {false ? (
        <button
          onClick={handleDesktopCloudButton}
          title={showLabel ? undefined : (canSwitchBackToLocal
            ? t('sidebar.switchToLocal', '切回本地离线模式')
            : t('sidebar.switchToCloud', '切换到云端账号'))}
          aria-label={canSwitchBackToLocal
            ? t('sidebar.switchToLocal', '切回本地离线模式')
            : t('sidebar.switchToCloud', '切换到云端账号')}
          className={cn(
            itemBaseClass,
            "text-tx-tertiary hover:bg-app-hover hover:text-accent-primary",
          )}
        >
          {canSwitchBackToLocal ? <CloudOff size={16} /> : <Cloud size={16} />}
          {showLabel && (
            <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
              {canSwitchBackToLocal
                ? t('sidebar.switchToLocalShort', '本地')
                : t('sidebar.switchToCloudShort', '云端')}
            </span>
          )}
        </button>
      ) : (
        <button
          onClick={() => {
            // L10: 广播给其他 tab 一起下线，与 Sidebar Footer 保持一致
            broadcastLogout("user_logout");
            window.location.reload();
          }}
          title={showLabel ? undefined : t('sidebar.logout')}
          aria-label={t('sidebar.logout')}
          className={cn(
            itemBaseClass,
            "text-tx-tertiary hover:text-accent-danger hover:bg-accent-danger/10",
          )}
        >
          <LogOut size={16} />
          {showLabel && (
            <span className="text-[10px] leading-none mt-0.5 max-w-full truncate px-1">
              {t('sidebar.logout')}
            </span>
          )}
        </button>
      )}

      {/* Settings Modal (now globally managed via custom event listener) */}
      <AnimatePresence>
        {showMigration && (
          <MigrationModal
            onClose={() => {
              // 迁移完成 → reload 进入云端模式（MigrationModal 已写好 token & url）
              setShowMigration(false);
              window.location.reload();
            }}
            onCancel={() => {
              // 取消 = 关弹窗，保持当前（本地）模式不动。
              // 不 reload、不清 token，避免出现"主页 → 闪登录页 → 主页"的抖动。
              // 若用户确实想去云端，再次点"切换云端"即可，或在登录页手动走流程。
              setShowMigration(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
