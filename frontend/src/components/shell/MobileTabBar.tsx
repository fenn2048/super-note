/**
 * 移动底栏：首页 | 任务 | 说说 | 我的（固定 4 Tab）
 * 笔记入口改到「我的」宫格。
 */
import React, { useMemo } from "react";
import { Home, ListTodo, NotebookPen, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { haptic } from "@/hooks/useCapacitor";
import {
  getMobileTabModules,
  isModuleActive,
  isMoreTabActive,
  openTasksEntry,
} from "@/lib/navigation.config";
import { useWorkspaceFeatures } from "@/store/workspaceFeaturesStore";
import type { ViewMode } from "@/types";

const TAB_ICONS: Record<string, React.ReactNode> = {
  home: <Home size={20} />,
  tasks: <ListTodo size={20} />,
  diary: <NotebookPen size={20} />,
};

export default function MobileTabBar({ visible }: { visible: boolean }) {
  const { state } = useApp();
  const actions = useAppActions();
  const { t } = useTranslation();
  const { features, packTick } = useWorkspaceFeatures();

  const handleTabClick = (mode: ViewMode, opts?: { openMyTasks?: boolean }) => {
    haptic.light();
    if (opts?.openMyTasks) openTasksEntry();
    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
    if (mode === "books" || mode === "library") {
      window.dispatchEvent(new CustomEvent("super:close-book"));
    }
    if (opts?.openMyTasks) openTasksEntry();
  };

  const tabModules = useMemo(
    () => getMobileTabModules(features),
    [features, packTick],
  );

  const tabs = [
    ...tabModules.map((m) => ({
      id: m.id,
      mode: m.mode,
      label: t(m.labelKey, { defaultValue: m.labelFallback }),
      icon: TAB_ICONS[m.id] || <Home size={20} />,
      active: isModuleActive(m, state.viewMode),
      openMyTasks: m.action === "openMyTasks",
    })),
    {
      id: "more",
      mode: "more" as ViewMode,
      label: t("sidebar.more", { defaultValue: "我的" }),
      icon: <UserIcon size={20} />,
      active: isMoreTabActive(state.viewMode),
      openMyTasks: false,
    },
  ];

  return (
    <nav
      className={cn(
        "mobile-tab-bar fixed bottom-0 left-0 right-0 z-rail-fab md:hidden flex items-center justify-around transition-all duration-300 ease-soft",
        visible
          ? "translate-y-0 opacity-100"
          : "translate-y-full opacity-0 pointer-events-none",
      )}
      style={{
        paddingBottom: "var(--safe-area-bottom)",
        minHeight: "calc(64px + var(--safe-area-bottom))",
        height: "calc(64px + var(--safe-area-bottom))",
        boxSizing: "border-box",
      }}
      aria-label="主导航"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => {
            handleTabClick(tab.mode, { openMyTasks: tab.openMyTasks });
          }}
          className={cn(
            "flex flex-col items-center justify-center flex-1 h-16 max-h-16 relative transition-all duration-fast ease-soft active:scale-95",
            tab.active
              ? "text-accent-primary"
              : "text-tx-tertiary hover:text-tx-primary",
          )}
          aria-current={tab.active ? "page" : undefined}
          aria-label={tab.label}
        >
          <div
            className={cn(
              "relative flex items-center justify-center w-11 h-7 rounded-full transition-all duration-fast ease-soft",
              tab.active && "bg-accent-primary/12",
            )}
          >
            {tab.icon}
            {tab.id === "more" && state.unreadMentionCount > 0 && (
              <span className="absolute top-0.5 right-1 w-2 h-2 rounded-full bg-accent-danger border border-app-elevated shadow-sm" />
            )}
            {tab.id === "tasks" && state.reminderActiveCount > 0 && (
              <span className="absolute -top-1 -right-0.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-accent-danger text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-sm">
                {state.reminderActiveCount}
              </span>
            )}
          </div>
          <span
            className={cn(
              "text-[10px] tracking-wide mt-0.5",
              tab.active ? "font-semibold" : "font-medium",
            )}
          >
            {tab.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
