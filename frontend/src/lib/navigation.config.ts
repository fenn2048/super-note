/**
 * 全局导航单一配置源（产品 IA P0）
 * ---------------------------------------------------------------------------
 * 产品决策（已锁定）：
 *   1. 主场景 = 家庭 OS / 工作台（笔记 + 任务 + 说说并重）
 *   2. 任务模型 = 方案 A：统一到 Project（无独立 Task 一级入口）
 *   3. 编辑器主格式 = RTE（tiptap）优先
 *
 * 所有壳（NavRail / 移动底栏 / 我的页 / 侧栏次级入口 / Cmd-K）应消费本文件，
 * 避免增删模块时多处漂移。
 */

import type { ViewMode, WorkspaceFeatures } from "@/types";
import { isModuleAllowedByPack } from "@/lib/modulePack";

/** 模块分层：控制默认可见性与「设置里启用」 */
export type NavTier = 0 | 1 | 2 | 3;

export type NavPlacement =
  | "desktopRail"
  | "mobileTab"
  | "mobileMore"
  | "sidebarSecondary"
  | "cmdk";

/** 资料库内 Tab */
export type LibraryTab = "files" | "books" | "media";

export interface NavModule {
  id: string;
  /** 对应 AppContext viewMode；部分 id 仅作跳转动作无独立 mode */
  mode: ViewMode;
  /** i18n key，如 sidebar.allNotes */
  labelKey: string;
  /** 无 i18n 时的中文兜底（家庭 OS 产品文案） */
  labelFallback: string;
  /** 关联工作区功能开关；undefined = 不依赖开关 */
  feature?: keyof WorkspaceFeatures;
  tier: NavTier;
  /** 出现在哪些壳上 */
  placements: NavPlacement[];
  /**
   * 点击时额外行为（可选）。
   * openMyTasks：进入项目模块并选中「我的任务」过滤器（方案 A）
   * openPlans：进入项目壳内的计划列表
   * libraryTab：进入资料库并切到指定 Tab
   */
  action?: "openMyTasks" | "openSettings" | "openPlans" | "libraryTab";
  /** action=libraryTab 时指定的子 Tab */
  libraryTab?: LibraryTab;
  /** 桌面 Rail 分组视觉（可选） */
  group?: "primary" | "secondary";
  /** 移动「我的」页描述 */
  moreDesc?: string;
}

/**
 * 模块清单（顺序 = 默认展示顺序）
 *
 * Tier 0：核心，永开
 * Tier 1：家庭 OS 默认开（任务/说说/AI/首页）
 * Tier 2：专业能力，默认仍进「我的」或可关（书库/媒体/文件）
 * Tier 3：边缘（不在此表主路径）
 */
export const NAV_MODULES: NavModule[] = [
  // ── Tier 0/1 主路径 ──
  {
    id: "home",
    mode: "home",
    labelKey: "sidebar.home",
    labelFallback: "首页",
    tier: 1,
    placements: ["desktopRail", "cmdk"],
    group: "primary",
  },
  {
    id: "notes",
    mode: "all",
    labelKey: "sidebar.allNotesShort",
    labelFallback: "笔记",
    feature: "notes",
    tier: 0,
    // 移动端走底栏「笔记」，不在「我的」重复入口
    placements: ["desktopRail", "mobileTab", "cmdk"],
    group: "primary",
    moreDesc: "浏览和管理所有核心笔记",
  },
  {
    id: "tasks",
    mode: "projects",
    labelKey: "sidebar.tasks",
    labelFallback: "任务",
    feature: "projects",
    tier: 1,
    placements: ["desktopRail", "mobileTab", "cmdk"],
    group: "primary",
    action: "openMyTasks",
  },
  {
    id: "diary",
    mode: "diary",
    labelKey: "sidebar.diary",
    labelFallback: "说说",
    feature: "diaries",
    tier: 1,
    placements: ["desktopRail", "mobileTab", "cmdk"],
    group: "primary",
  },
  {
    id: "ai",
    mode: "ai-chat",
    labelKey: "sidebar.aiChat",
    labelFallback: "AI",
    tier: 1,
    placements: ["desktopRail", "mobileMore", "cmdk"],
    group: "secondary",
    moreDesc: "智能问答与写作辅助",
  },

  // ── 侧栏/我的：笔记派生视图 ──
  {
    id: "favorites",
    mode: "favorites",
    labelKey: "sidebar.favorites",
    labelFallback: "收藏",
    feature: "favorites",
    tier: 0,
    placements: ["sidebarSecondary", "mobileMore"],
    moreDesc: "快速查看收藏的笔记和说说",
  },
  {
    id: "trash",
    mode: "trash",
    labelKey: "sidebar.trash",
    labelFallback: "回收站",
    tier: 0,
    placements: ["sidebarSecondary", "mobileMore"],
    moreDesc: "查看和恢复已删除的笔记",
  },

  // ── Tier 2：资料库统一壳（桌面 Rail 一项；移动可进「我的」）
  {
    id: "library",
    mode: "library",
    labelKey: "sidebar.library",
    labelFallback: "资料库",
    tier: 2,
    placements: ["desktopRail", "mobileMore", "cmdk"],
    group: "secondary",
    moreDesc: "文件、书库与媒体",
  },
  // 移动快捷：仍保留分项，进入 library + 对应 tab
  {
    id: "files",
    mode: "library",
    labelKey: "sidebar.fileManager",
    labelFallback: "文件",
    feature: "files",
    tier: 2,
    // 移动「我的」不单独入口，统一走资料库 Tab
    placements: ["cmdk"],
    group: "secondary",
    moreDesc: "附件与上传文件管理",
    action: "libraryTab",
    libraryTab: "files",
  },
  {
    id: "books",
    mode: "library",
    labelKey: "sidebar.books",
    labelFallback: "书库",
    tier: 2,
    // 移动「我的」不单独入口，统一走资料库 Tab
    placements: ["cmdk"],
    group: "secondary",
    moreDesc: "电子书阅读与划线",
    action: "libraryTab",
    libraryTab: "books",
  },
  {
    id: "media",
    mode: "library",
    labelKey: "sidebar.mediaLibrary",
    labelFallback: "媒体库",
    feature: "media",
    tier: 2,
    // 移动「我的」不单独入口，统一走资料库 Tab
    placements: ["cmdk"],
    group: "secondary",
    moreDesc: "音视频媒体管理与播放",
    action: "libraryTab",
    libraryTab: "media",
  },
  {
    id: "mentions",
    mode: "mentions",
    labelKey: "sidebar.mentions",
    labelFallback: "消息",
    tier: 1,
    placements: ["mobileMore", "cmdk"],
    moreDesc: "提及与工作区通知",
  },
];

/** 桌面 Rail：主路径 + 资料/AI 次要区 */
export function getDesktopRailModules(
  features: WorkspaceFeatures | null,
): NavModule[] {
  return NAV_MODULES.filter(
    (m) =>
      m.placements.includes("desktopRail") &&
      isModuleVisible(m, features),
  );
}

/** 移动底栏：笔记 | 任务 | 说说 | 我的（「我的」由壳层单独渲染） */
export function getMobileTabModules(
  features: WorkspaceFeatures | null,
): NavModule[] {
  return NAV_MODULES.filter(
    (m) =>
      m.placements.includes("mobileTab") &&
      isModuleVisible(m, features),
  );
}

/** 移动「我的」宫格 */
export function getMobileMoreModules(
  features: WorkspaceFeatures | null,
): NavModule[] {
  return NAV_MODULES.filter(
    (m) =>
      m.placements.includes("mobileMore") &&
      isModuleVisible(m, features),
  );
}

/** 侧栏次级（收藏/回收站/文件等） */
export function getSidebarSecondaryModules(
  features: WorkspaceFeatures | null,
): NavModule[] {
  return NAV_MODULES.filter(
    (m) =>
      m.placements.includes("sidebarSecondary") &&
      isModuleVisible(m, features),
  );
}

function isFeatureEnabled(
  m: NavModule,
  features: WorkspaceFeatures | null,
): boolean {
  if (!m.feature || !features) return true;
  return features[m.feature] !== false;
}

function isModuleVisible(
  m: NavModule,
  features: WorkspaceFeatures | null,
): boolean {
  return isFeatureEnabled(m, features) && isModuleAllowedByPack(m.id);
}

/**
 * 进入「任务」统一入口：项目模块 + 我的任务过滤器。
 * 供 NavRail / 底栏 / Cmd-K / 旧 viewMode=tasks 重定向共用。
 */
export function openTasksEntry(): void {
  const filter = { type: "my-tasks" as const };
  try {
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent("super:project-filter-changed", { detail: filter }),
  );
  // 懒加载 ProjectCenter 时监听器可能尚未注册：下一帧再派一次，确保落到 my-tasks
  if (typeof window !== "undefined") {
    window.setTimeout(() => {
      try {
        sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
      } catch { /* ignore */ }
      window.dispatchEvent(
        new CustomEvent("super:project-filter-changed", { detail: filter }),
      );
    }, 0);
  }
}

/**
 * 进入「计划」：并入任务壳（ProjectCenter filter=plans），不再独立 viewMode 心智。
 */
export function openPlansEntry(): void {
  const filter = { type: "plans" as const };
  try {
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(
    new CustomEvent("super:project-filter-changed", { detail: filter }),
  );
}

/** 资料库 Tab 记忆 */

export function setLibraryTab(tab: LibraryTab): void {
  try {
    sessionStorage.setItem("super-library-tab", tab);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("super:library-tab-changed", { detail: tab }));
}

export function getLibraryTab(): LibraryTab {
  try {
    const t = sessionStorage.getItem("super-library-tab");
    if (t === "files" || t === "books" || t === "media") return t;
  } catch {
    /* ignore */
  }
  return "files";
}

/**
 * viewMode 是否应视为「任务」高亮（方案 A：projects + plans + 历史 tasks）
 */
export function isTasksViewMode(viewMode: ViewMode): boolean {
  return viewMode === "projects" || viewMode === "plans" || viewMode === "tasks";
}

/**
 * 笔记派生视图高亮「笔记」Rail
 */
export function isNotesViewMode(viewMode: ViewMode): boolean {
  return (
    viewMode === "all" ||
    viewMode === "notebook" ||
    viewMode === "search" ||
    viewMode === "tag"
  );
}

// ── 移动壳层规则（Phase A · 体验蓝图固化）────────────────────────────────
// Web = Rail + 内容；移动 = 底栏三主 + 我的 + 栈页。
// 栈页：无底栏、无 FAB；用 StackChrome 右上 × 关闭。

/** 资料库及遗留分项：栈式全屏 */
export function isLibraryStackViewMode(viewMode: ViewMode): boolean {
  return (
    viewMode === "library" ||
    viewMode === "media" ||
    viewMode === "books" ||
    viewMode === "files"
  );
}

export interface MobileShellContext {
  viewMode: ViewMode;
  /** 笔记列表 vs 编辑器 */
  mobileView?: "list" | "editor" | string;
  /** 项目详情打开时不显示底栏 */
  isProjectDetailOpen?: boolean;
  /** 底栏滚动显隐 */
  barsVisible?: boolean;
  /** 软键盘 */
  keyboardVisible?: boolean;
}

/**
 * 是否显示移动底栏（根页）
 * 根：首页 / 笔记列表 / 任务非详情 / 说说 / 我的
 * 非根：资料库栈、回收站、编辑器、项目详情…
 */
export function shouldShowMobileTabBar(ctx: MobileShellContext): boolean {
  const { viewMode, mobileView, isProjectDetailOpen } = ctx;
  if (isLibraryStackViewMode(viewMode)) return false;
  if (viewMode === "trash") return false;
  if (viewMode === "home") return true;
  if (viewMode === "more") return true;
  if (viewMode === "diary") return true;
  if (viewMode === "projects" || viewMode === "plans" || viewMode === "tasks") {
    return !isProjectDetailOpen;
  }
  if (isNotesViewMode(viewMode) || viewMode === "favorites") {
    return mobileView !== "editor";
  }
  return false;
}

/**
 * 是否显示全局「+」FAB
 * 根页且非「我的」、非栈页
 */
export function shouldShowMobileFAB(ctx: MobileShellContext): boolean {
  if (!shouldShowMobileTabBar(ctx)) return false;
  if (ctx.viewMode === "more") return false;
  return true;
}

/**
 * 同步移动端贴底 CSS 变量（Tab / 播放器额外高度）
 * --mobile-tab-h：底栏内容高；隐栏或栈页时为 0
 */
export function syncMobileShellCssVars(opts: {
  tabBarVisible: boolean;
  extraBottomPx?: number;
}): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty(
    "--mobile-tab-h",
    opts.tabBarVisible ? "64px" : "0px",
  );
  if (opts.extraBottomPx !== undefined) {
    root.style.setProperty(
      "--mobile-extra-bottom",
      `${Math.max(0, opts.extraBottomPx)}px`,
    );
  }
}

/**
 * 内容区底部避让（可读 CSS 变量组合）
 * 用于 inline style 或文档说明；运行时优先用 var(--mobile-content-pb)
 */
export function getMobileContentPaddingBottom(): string {
  return "var(--mobile-content-pb)";
}
