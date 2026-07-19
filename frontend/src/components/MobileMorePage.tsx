import React, { useEffect, useState, useMemo } from "react";
import { useApp, useAppActions } from "@/store/AppContext";
import { api, broadcastLogout, getCurrentWorkspace } from "@/lib/api";
import {
  FolderOpen, Heart, Bot, Bell, Settings, LogOut, Trash2, BookOpen, Film, Book,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import { getMobileMoreModules, setLibraryTab, type NavModule } from "@/lib/navigation.config";
import type { WorkspaceFeatures } from "@/types";

const MORE_ICONS: Record<string, React.ReactNode> = {
  notes: <BookOpen className="w-6 h-6 text-indigo-500" />,
  library: <FolderOpen className="w-6 h-6 text-teal-500" />,
  media: <Film className="w-6 h-6 text-sky-500" />,
  trash: <Trash2 className="w-6 h-6 text-red-500" />,
  favorites: <Heart className="w-6 h-6 text-red-500" fill="currentColor" />,
  ai: <Bot className="w-6 h-6 text-violet-500" />,
  mentions: <Bell className="w-6 h-6 text-amber-500" />,
  files: <FolderOpen className="w-6 h-6 text-emerald-500" />,
  books: <Book className="w-6 h-6 text-orange-500" />,
};

export default function MobileMorePage() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [features, setFeatures] = useState<WorkspaceFeatures | null>(null);
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
    const onChange = () => load();
    window.addEventListener("super:workspace-changed", onChange);
    window.addEventListener("super:workspace-features-changed", onChange);
    const onPack = () => setPackTick((n) => n + 1);
    window.addEventListener("super:module-pack-changed", onPack);
    return () => {
      window.removeEventListener("super:workspace-changed", onChange);
      window.removeEventListener("super:workspace-features-changed", onChange);
      window.removeEventListener("super:module-pack-changed", onPack);
    };
  }, []);

  const handleNavigate = (mod: NavModule) => {
    if (mod.action === "libraryTab" && mod.libraryTab) {
      setLibraryTab(mod.libraryTab);
    }
    if (mod.id === "library") {
      setLibraryTab("files");
    }
    actions.setViewMode(mod.mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
  };

  const modules = useMemo(() => getMobileMoreModules(features), [features, packTick]);

  const menuItems = [
    ...modules.map((mod) => ({
      id: mod.id,
      label: t(mod.labelKey, { defaultValue: mod.labelFallback }),
      icon: MORE_ICONS[mod.id] || <FolderOpen className="w-6 h-6 text-zinc-500" />,
      desc: mod.moreDesc || "",
      onClick: () => handleNavigate(mod),
    })),
    {
      id: "settings",
      label: t("sidebar.settings", { defaultValue: "设置" }),
      icon: <Settings className="w-6 h-6 text-emerald-500" />,
      desc: "个性化外观、账户与数据同步设置",
      onClick: () => {
        window.dispatchEvent(new CustomEvent("super:open-settings"));
      },
    },
  ];

  const handleLogout = () => {
    broadcastLogout("user_logout");
    window.location.reload();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg overflow-y-auto">
      <MobileChromeHeader
        variant="bare"
        title="我的"
        subtitle="资料库、AI、消息与设置"
      />
      <div className="px-6 pt-3 pb-2 md:pt-6">
        <h1 className="text-xl font-bold text-tx-primary leading-tight tracking-tight md:text-2xl">更多功能</h1>
        <p className="text-sm text-tx-tertiary mt-1">资料库、收藏、AI 与设置</p>
      </div>

      <div className="px-4 py-2 grid grid-cols-2 gap-3 flex-1 pb-6">
        {menuItems.map((item, idx) => (
          <motion.button
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            onClick={item.onClick}
            className="flex flex-col justify-between p-4 rounded-card border border-app-border/60 bg-app-elevated shadow-xs hover:shadow-sm hover:border-app-border active:scale-[0.98] transition-all duration-fast ease-soft text-left group min-h-[128px]"
          >
            <div className="w-11 h-11 rounded-card bg-app-bg border border-app-border/70 flex items-center justify-center shrink-0 shadow-xs group-hover:scale-110 transition-transform duration-fast relative">
              {item.icon}
              {item.id === "mentions" && state.unreadMentionCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-accent-danger text-white text-[8px] font-bold flex items-center justify-center leading-none shadow-sm border border-app-elevated">
                  {state.unreadMentionCount}
                </span>
              )}
            </div>
            <div className="mt-4">
              <div className="text-sm font-semibold text-tx-primary tracking-tight">{item.label}</div>
              <div className="text-[11px] text-tx-tertiary mt-1 line-clamp-2 leading-snug">{item.desc}</div>
            </div>
          </motion.button>
        ))}

        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: menuItems.length * 0.05 }}
          onClick={handleLogout}
          className="flex flex-col justify-between p-4 rounded-card border border-red-200/60 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 shadow-xs hover:shadow-sm active:scale-[0.98] transition-all duration-fast ease-soft text-left group min-h-[128px] col-span-2"
        >
          <div className="w-11 h-11 rounded-card bg-app-bg border border-app-border/70 flex items-center justify-center shrink-0 shadow-xs">
            <LogOut className="w-6 h-6 text-red-500" />
          </div>
          <div className="mt-4">
            <div className="text-sm font-semibold text-red-600 dark:text-red-400 tracking-tight">退出登录</div>
            <div className="text-[11px] text-tx-tertiary mt-1">安全退出当前账号</div>
          </div>
        </motion.button>
      </div>
    </div>
  );
}
