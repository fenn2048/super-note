/**
 * 主内容区视图注册表（VIEW_REGISTRY）
 * ---------------------------------------------------------------------------
 * 把 App.tsx 里冗长的 viewMode 三元链收敛为表驱动渲染。
 * 特殊布局（笔记三栏 + 编辑器）仍由 App 单独处理。
 */
import React, { Suspense } from "react";
import { Loader2 } from "lucide-react";
import type { ViewMode } from "@/types";
import MobileTopBar from "@/components/shell/MobileTopBar";

const Dashboard = React.lazy(() => import("@/components/Dashboard"));
const DiaryCenter = React.lazy(() => import("@/components/DiaryCenter"));
const MentionList = React.lazy(() => import("@/components/MentionList"));
const AIChatPanel = React.lazy(() => import("@/components/AIChatPanel"));
const ProjectCenter = React.lazy(() => import("@/components/ProjectCenter"));
const LibraryCenter = React.lazy(() => import("@/components/LibraryCenter"));
const FinanceCenter = React.lazy(() => import("@/components/finance/FinanceCenter"));
const MobileMorePage = React.lazy(() => import("@/components/MobileMorePage"));
const SettingsModal = React.lazy(() => import("@/components/SettingsModal"));

function ViewFallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-accent-primary" />
    </div>
  );
}

function Shell({
  children,
  topBar = false,
}: {
  children: React.ReactNode;
  topBar?: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {topBar && <MobileTopBar />}
      <Suspense fallback={<ViewFallback />}>{children}</Suspense>
    </div>
  );
}

export type RegistryHandlers = {
  onCloseSettings: () => void;
  settingsTab: import("@/components/SettingsModal").TabId;
  onAIClose: () => void;
  onAINavigateToNote: (noteId: string) => void;
};

/** 可表驱动的 viewMode（不含笔记三栏） */
export type RegistryViewMode = Exclude<
  ViewMode,
  | "all"
  | "notebook"
  | "favorites"
  | "search"
  | "tag"
  | "trash"
  | "tasks"
  | "plans"
  | "files"
  | "books"
  | "media"
>;

export function renderRegisteredView(
  viewMode: ViewMode,
  handlers: RegistryHandlers,
): React.ReactNode | null {
  switch (viewMode) {
    case "ai-chat":
      return (
        <Shell>
          <AIChatPanel
            onClose={handlers.onAIClose}
            onNavigateToNote={handlers.onAINavigateToNote}
          />
        </Shell>
      );
    case "diary":
      return (
        <Shell topBar>
          <DiaryCenter />
        </Shell>
      );
    case "projects":
      return (
        <Shell topBar>
          <ProjectCenter />
        </Shell>
      );
    case "library":
      return (
        <Shell>
          <LibraryCenter />
        </Shell>
      );
    case "finance":
      return (
        <Shell>
          <FinanceCenter />
        </Shell>
      );
    case "more":
      return (
        <Shell>
          <MobileMorePage />
        </Shell>
      );
    case "home":
      return (
        <Shell>
          <Dashboard />
        </Shell>
      );
    case "mentions":
      return (
        <Shell topBar>
          <MentionList />
        </Shell>
      );
    case "settings":
      return (
        <Shell>
          <SettingsModal
            presentation="page"
            defaultTab={handlers.settingsTab}
            onClose={handlers.onCloseSettings}
          />
        </Shell>
      );
    default:
      return null;
  }
}

/** 笔记相关 viewMode（走三栏布局） */
export function isNotesLayoutView(viewMode: ViewMode): boolean {
  return (
    viewMode === "all" ||
    viewMode === "notebook" ||
    viewMode === "favorites" ||
    viewMode === "search" ||
    viewMode === "tag" ||
    viewMode === "trash"
  );
}
