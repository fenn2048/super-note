import React from "react";
import { useApp, useAppActions } from "@/store/AppContext";
import { broadcastLogout } from "@/lib/api";
import { FolderOpen, Heart, Bot, Bell, Settings, LogOut, Trash2, BookOpen, Film } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";

export default function MobileMorePage() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();

  const handleNavigate = (mode: any) => {
    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
  };

  const menuItems = [
    {
      id: "all",
      label: "所有笔记",
      icon: <BookOpen className="w-6 h-6 text-indigo-500" />,
      desc: "浏览和管理所有核心笔记",
      onClick: () => handleNavigate("all"),
    },
    {
      id: "media",
      label: "媒体库",
      icon: <Film className="w-6 h-6 text-sky-500" />,
      desc: "浏览和管理云端媒体资源",
      onClick: () => handleNavigate("media"),
    },
    {
      id: "trash",
      label: "回收站",
      icon: <Trash2 className="w-6 h-6 text-red-500" />,
      desc: "查看和恢复已删除的笔记",
      onClick: () => {
        actions.setViewMode("trash");
        actions.setMobileView("list");
      },
    },
    {
      id: "favorites",
      label: "我的收藏",
      icon: <Heart className="w-6 h-6 text-red-500" fill="currentColor" />,
      desc: "快速查看收藏的笔记和说说",
      onClick: () => handleNavigate("favorites"),
    },
    {
      id: "ai-chat",
      label: "AI 问答",
      icon: <Bot className="w-6 h-6 text-violet-500" />,
      desc: "开启智能问答，获取写作辅助",
      onClick: () => handleNavigate("ai-chat"),
    },
    {
      id: "mentions",
      label: "消息中心",
      icon: <Bell className="w-6 h-6 text-amber-500" />,
      desc: "查看提及和工作区通知",
      onClick: () => handleNavigate("mentions"),
    },
    {
      id: "settings",
      label: "设置",
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
        subtitle="文件、收藏、AI 与设置"
      />
      <div className="px-6 pt-3 pb-2 md:pt-6">
        <h1 className="text-xl font-bold text-tx-primary leading-tight tracking-tight md:text-2xl">更多功能</h1>
        <p className="text-sm text-tx-tertiary mt-1">文件、收藏、AI 与设置都在这里</p>
      </div>

      {/* 宫格菜单 */}
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

        {/* 退出登录 */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: menuItems.length * 0.05 }}
          onClick={handleLogout}
          className="col-span-2 flex items-center gap-4 p-4 rounded-card border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 active:scale-[0.98] transition-all duration-fast ease-soft text-left mt-1 group shadow-xs"
        >
          <div className="w-10 h-10 rounded-button bg-red-500/10 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform">
            <LogOut className="w-5 h-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-500">退出登录</div>
            <div className="text-[10px] text-red-500/70 mt-0.5">安全退出当前账号的登录状态</div>
          </div>
        </motion.button>
      </div>

      <div className="h-6 shrink-0" />
    </div>
  );
}
