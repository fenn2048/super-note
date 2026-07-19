/**
 * 首页快捷操作（从 Dashboard 抽出 · God 组件轻拆）
 * 按模块包隐藏未授权入口
 */
import { useEffect, useState } from "react";
import { FileText, MessageCircle, ListTodo } from "lucide-react";
import { cn } from "@/lib/utils";
import { isModuleAllowedByPack } from "@/lib/modulePack";

export interface DashboardQuickActionsProps {
  onCreateNote: () => void;
  onWriteSays: () => void;
  onAddTask: () => void;
}

export default function DashboardQuickActions({
  onCreateNote,
  onWriteSays,
  onAddTask,
}: DashboardQuickActionsProps) {
  // 模块包变更时强制刷新
  const [packTick, setPackTick] = useState(0);
  useEffect(() => {
    const onPack = () => setPackTick((n) => n + 1);
    window.addEventListener("super:module-pack-changed", onPack);
    return () => window.removeEventListener("super:module-pack-changed", onPack);
  }, []);

  void packTick;
  const showNotes = isModuleAllowedByPack("notes");
  const showDiary = isModuleAllowedByPack("diary");
  const showTasks = isModuleAllowedByPack("tasks");
  const count = [showNotes, showDiary, showTasks].filter(Boolean).length;
  if (count === 0) return null;

  return (
    <div>
      <h2 className="text-[11px] font-semibold text-tx-tertiary uppercase tracking-wider mb-3.5 px-0.5">
        快捷操作
      </h2>
      <div
        className={cn(
          "grid gap-2.5 sm:gap-3",
          count >= 3 ? "grid-cols-3" : "grid-cols-2",
        )}
        role="group"
        aria-label="快捷操作"
      >
        {showNotes && (
          <button
            type="button"
            onClick={onCreateNote}
            aria-label="记笔记"
            className="flex flex-col items-center justify-center p-3.5 sm:p-4 rounded-card border border-app-border/50 bg-app-bg/60 hover:bg-app-hover hover:border-app-border hover:shadow-sm transition-all duration-fast ease-soft active:scale-[0.97] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-card bg-gradient-to-br from-amber-400/25 to-orange-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform duration-fast shadow-xs">
              <FileText size={20} aria-hidden />
            </div>
            <span className="text-xs font-semibold text-tx-primary">记笔记</span>
            <span className="text-[10px] text-tx-tertiary mt-0.5 hidden sm:block">
              记录创意想法
            </span>
          </button>
        )}
        {showDiary && (
          <button
            type="button"
            onClick={onWriteSays}
            aria-label="写说说"
            className="flex flex-col items-center justify-center p-3.5 sm:p-4 rounded-card border border-app-border/50 bg-app-bg/60 hover:bg-app-hover hover:border-app-border hover:shadow-sm transition-all duration-fast ease-soft active:scale-[0.97] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-card bg-gradient-to-br from-violet-500/25 to-fuchsia-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform duration-fast shadow-xs">
              <MessageCircle size={20} aria-hidden />
            </div>
            <span className="text-xs font-semibold text-tx-primary">写说说</span>
            <span className="text-[10px] text-tx-tertiary mt-0.5 hidden sm:block">
              记录日常生活
            </span>
          </button>
        )}
        {showTasks && (
          <button
            type="button"
            onClick={onAddTask}
            aria-label="加待办"
            className="flex flex-col items-center justify-center p-3.5 sm:p-4 rounded-card border border-app-border/50 bg-app-bg/60 hover:bg-app-hover hover:border-app-border hover:shadow-sm transition-all duration-fast ease-soft active:scale-[0.97] group cursor-pointer"
          >
            <div className="w-11 h-11 rounded-card bg-gradient-to-br from-emerald-400/25 to-teal-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform duration-fast shadow-xs">
              <ListTodo size={20} aria-hidden />
            </div>
            <span className="text-xs font-semibold text-tx-primary">加待办</span>
            <span className="text-[10px] text-tx-tertiary mt-0.5 hidden sm:block">
              管理计划日程
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
