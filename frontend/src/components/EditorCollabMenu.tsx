/**
 * 协作入口聚合（P2-3）
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Users,
  Share2,
  History,
  MessageCircle,
  ChevronDown,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PresenceUser } from "@/hooks/useRealtimeNote";

export interface EditorCollabMenuProps {
  presenceUsers: PresenceUser[];
  isConnected: boolean;
  onShare: () => void;
  onHistory: () => void;
  onComments: () => void;
  collabModeHint?: string;
  className?: string;
}

export default function EditorCollabMenu({
  presenceUsers,
  isConnected,
  onShare,
  onHistory,
  onComments,
  collabModeHint,
  className,
}: EditorCollabMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const others = presenceUsers; // 列表通常已排除自己；全部展示即可
  const count = others.length;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "h-7 px-2 rounded-md inline-flex items-center gap-1 text-xs font-medium transition-colors",
          open
            ? "bg-accent-primary/12 text-accent-primary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        )}
        title="协作"
      >
        <Users size={14} />
        <span className="hidden sm:inline">协作</span>
        {count > 0 && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
            {count}
          </span>
        )}
        <ChevronDown size={12} className={cn("opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-app-border bg-app-elevated shadow-xl py-1.5">
          <div className="px-3 py-2 border-b border-app-border/60">
            <div className="flex items-center gap-1.5 text-xs font-medium text-tx-primary">
              {isConnected ? (
                <Wifi size={12} className="text-emerald-500" />
              ) : (
                <WifiOff size={12} className="text-tx-tertiary" />
              )}
              {isConnected ? "实时已连接" : "离线 / 未连接"}
            </div>
            {count > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {others.slice(0, 5).map((u) => (
                  <li key={u.connectionId || u.userId} className="text-[11px] text-tx-secondary truncate">
                    {u.username || u.userId}
                    {u.editing ? " · 编辑中" : ""}
                  </li>
                ))}
                {others.length > 5 && (
                  <li className="text-[11px] text-tx-tertiary">+{others.length - 5} 人</li>
                )}
              </ul>
            ) : (
              <p className="text-[11px] text-tx-tertiary mt-1">暂无其他在线成员</p>
            )}
            {collabModeHint && (
              <p className="text-[10px] text-tx-tertiary mt-1.5 leading-snug">{collabModeHint}</p>
            )}
          </div>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-app-hover"
            onClick={() => run(onShare)}
          >
            <Share2 size={14} className="text-emerald-500" />
            分享笔记
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-app-hover"
            onClick={() => run(onHistory)}
          >
            <History size={14} className="text-violet-500" />
            版本历史
          </button>
          <button
            type="button"
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-tx-primary hover:bg-app-hover"
            onClick={() => run(onComments)}
          >
            <MessageCircle size={14} className="text-blue-500" />
            评论批注
          </button>
        </div>
      )}
    </div>
  );
}
