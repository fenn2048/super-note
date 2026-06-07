import React from "react";
import { useAppActions } from "@/store/AppContext";
import { broadcastLogout } from "@/lib/api";
import { FolderOpen, Heart, Bot, Bell, Settings, LogOut, Briefcase } from "lucide-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";

export default function MobileMorePage() {
  const { t } = useTranslation();
  const actions = useAppActions();

  const handleNavigate = (mode: any) => {
    actions.setViewMode(mode);
    actions.setSelectedNotebook(null);
    actions.setMobileView("list");
  };

  const menuItems = [
    {
      id: "projects",
      label: "项目管理",
      icon: <Briefcase className="w-6 h-6 text-blue-500" />,
      desc: "项目任务管理，看板与团队协作",
      onClick: () => handleNavigate("projects"),
    },
    {
      id: "files",
      label: "文件管理",
      icon: <FolderOpen className="w-6 h-6 text-indigo-500" />,
      desc: "管理所有上传的文件与图片附件",
      onClick: () => handleNavigate("files"),
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
        window.dispatchEvent(new CustomEvent("nowen:open-settings"));
      },
    },
  ];

  const handleLogout = () => {
    broadcastLogout("user_logout");
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-app-bg overflow-y-auto" style={{ paddingTop: "calc(var(--safe-area-top) + 16px)" }}>
      {/* 头部装饰 */}
      <div className="px-6 py-4">
        <h1 className="text-2xl font-bold text-tx-primary leading-tight">更多功能</h1>
        <p className="text-xs text-tx-tertiary mt-1">发现更多工具，定制你的个性化空间</p>
      </div>

      {/* 宫格菜单 */}
      <div className="px-4 py-2 grid grid-cols-1 gap-3 flex-1">
        {menuItems.map((item, idx) => (
          <motion.button
            key={item.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.05 }}
            onClick={item.onClick}
            className="flex items-center gap-4 p-4 rounded-2xl border border-app-border/40 bg-app-surface/30 hover:bg-app-hover active:scale-[0.98] transition-all text-left group"
          >
            <div className="w-12 h-12 rounded-xl bg-app-surface border border-app-border flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-tx-primary">{item.label}</div>
              <div className="text-[11px] text-tx-tertiary mt-0.5 truncate">{item.desc}</div>
            </div>
          </motion.button>
        ))}

        {/* 退出登录 */}
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: menuItems.length * 0.05 }}
          onClick={handleLogout}
          className="flex items-center gap-4 p-4 rounded-2xl border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 active:scale-[0.98] transition-all text-left mt-4 group"
        >
          <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0 shadow-sm group-hover:scale-110 transition-transform">
            <LogOut className="w-6 h-6 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-500">退出登录</div>
            <div className="text-[11px] text-red-500/70 mt-0.5">安全退出当前账号的登录状态</div>
          </div>
        </motion.button>
      </div>

      <div className="h-6 shrink-0" />
    </div>
  );
}
