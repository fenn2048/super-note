/**
 * 移动端通用顶栏（非各中心自管页）
 */
import React, { useState, useEffect } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";

export default function MobileTopBar() {
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
      case "settings":
        return t("settings.title", { defaultValue: "设置" });
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

  if (
    state.viewMode === "projects" ||
    state.viewMode === "diary" ||
    state.viewMode === "settings"
  ) {
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
            <span className="text-[15px] font-bold text-tx-primary truncate">
              消息盒子
            </span>
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
                window.dispatchEvent(
                  new CustomEvent("super:mark-all-mentions-read"),
                );
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

  if (["favorites", "trash", "ai-chat", "home"].includes(state.viewMode)) {
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
    <MobileChromeHeader variant="root" title={getTitle()} visible={visible} />
  );
}
