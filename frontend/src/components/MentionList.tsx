/**
 * 消息盒子（原 MentionList）
 * ---------------------------------------------------------------------------
 * 统一展示 notifications：@提及、任务到点提醒、协作动态。
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Bell,
  CheckCheck,
  MessageCircle,
  FileText,
  CheckSquare,
  Loader2,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useApp, useAppActions } from "@/store/AppContext";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { openTaskById, openTasksEntry, openChat, openBookReader } from "@/lib/navigation.config";

type InboxItem = {
  id: string;
  type: string;
  sourceType: string | null;
  sourceId: string | null;
  sourceTitle: string | null;
  actorName: string | null;
  label: string;
  createdAt: string;
  readAt: string | null;
};

// 来源类型 → 图标映射
function SourceIcon({ type }: { type: string }) {
  switch (type) {
    case "diary":
      return <MessageCircle size={14} />;
    case "note":
      return <FileText size={14} />;
    case "task":
      return <CheckSquare size={14} />;
    case "chat":
      return <MessageCircle size={14} />;
    default:
      return <Bell size={14} />;
  }
}

// 相对时间
function relativeTime(dateStr: string, t: (key: string) => string): string {
  const now = Date.now();
  const date = new Date(dateStr.replace(" ", "T") + "Z").getTime();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return t("diary.justNow") || "刚刚";
  if (diffMin < 60) return `${diffMin}分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}天前`;
  return dateStr.slice(0, 10);
}

// 来源类型 → 中文名
function sourceLabel(type: string): string {
  switch (type) {
    case "diary": return "说说";
    case "note": return "笔记";
    case "task": return "任务";
    case "chat": return "聊天";
    default: return "";
  }
}

function itemHeadline(item: InboxItem): { actor: string; rest: string } {
  const actor = item.actorName || "系统";
  if (item.type === "mention") {
    return { actor, rest: "中 @了你" };
  }
  if (item.type === "task_reminder") {
    return { actor: actor || "任务提醒", rest: "" };
  }
  if (item.label) {
    return { actor, rest: item.label };
  }
  return { actor, rest: "" };
}

export default function MentionList() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    try {
      const cursor = reset ? undefined : nextCursor || undefined;
      const data = await api.notifications.list(cursor);
      if (reset) {
        setItems(data.items);
      } else {
        setItems((prev) => [...prev, ...data.items]);
      }
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
    } catch (e) {
      console.error("Load notifications failed:", e);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [nextCursor]);

  useEffect(() => {
    loadInbox(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClick = useCallback(async (item: InboxItem) => {
    if (!item.readAt) {
      try {
        await api.notifications.markRead(item.id);
        setItems((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, readAt: new Date().toISOString() } : m)),
        );
        actions.setUnreadMentionCount(Math.max(0, (state.unreadMentionCount || 1) - 1));
      } catch {}
    }

    const sourceType = item.sourceType || (item.type === "task_reminder" ? "task" : "");
    const sourceId = item.sourceId;
    if (!sourceType || !sourceId) return;

    try {
      switch (sourceType) {
        case "note":
          try {
            const { bookHash } = await api.books.getNoteInfo(sourceId);
            openBookReader(bookHash);
            localStorage.setItem("super-target-book-note-id", sourceId);
            window.dispatchEvent(new CustomEvent("super:goto-book-note", { detail: { noteId: sourceId } }));
          } catch {
            await api.getNote(sourceId);
            actions.setViewMode("all");
            window.dispatchEvent(new CustomEvent("super:open-note", { detail: sourceId }));
          }
          break;
        case "diary":
          actions.setViewMode("diary");
          break;
        case "task":
          openTasksEntry();
          actions.setViewMode("projects");
          openTaskById(sourceId);
          break;
        case "chat":
          actions.setViewMode("chat");
          openChat(sourceId);
          break;
      }
    } catch {
      toast.error("暂无权限查看该内容");
    }
  }, [state.unreadMentionCount, actions]);

  const handleMarkAllRead = useCallback(async () => {
    try {
      await api.notifications.markAllRead();
      setItems((prev) => prev.map((m) => ({ ...m, readAt: m.readAt || new Date().toISOString() })));
      actions.setUnreadMentionCount(0);
      toast.success("全部已读");
    } catch {
      toast.error("操作失败");
    }
  }, [actions]);

  // 初始加载时刷新未读数
  useEffect(() => {
    actions.refreshMentionCount();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleMarkAllReadEvent = () => {
      void handleMarkAllRead();
    };
    window.addEventListener("super:mark-all-mentions-read", handleMarkAllReadEvent);
    return () => {
      window.removeEventListener("super:mark-all-mentions-read", handleMarkAllReadEvent);
    };
  }, [handleMarkAllRead]);

  const unreadCount = items.filter((m) => !m.readAt).length;

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-bg">
      <div className="hidden md:flex items-center justify-between px-4 py-3 border-b border-app-border">
        <div className="flex items-center gap-2">
          <Bell size={16} className="text-accent-primary" />
          <span className="text-sm font-bold text-tx-primary">消息盒子</span>
          {state.unreadMentionCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500 text-white font-bold">
              {state.unreadMentionCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="flex items-center gap-1 text-[11px] text-accent-primary hover:underline font-medium"
          >
            <CheckCheck size={12} />
            全部已读
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin text-accent-primary" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <div className="w-12 h-12 rounded-2xl bg-app-hover/60 flex items-center justify-center mb-3">
              <Bell size={22} className="text-tx-tertiary" />
            </div>
            <p className="text-sm text-tx-secondary font-medium">暂无消息</p>
            <p className="text-xs text-tx-tertiary mt-1">任务到期、@提及和协作动态会显示在这里</p>
          </div>
        ) : (
          <div className="divide-y divide-app-border/50">
            {items.map((item) => {
              const line = itemHeadline(item);
              const sourceType = item.sourceType || (item.type === "task_reminder" ? "task" : "");
              return (
              <button
                key={item.id}
                onClick={() => handleClick(item)}
                className={cn(
                  "w-full text-left px-4 py-3 transition-colors hover:bg-app-hover/50 flex items-start gap-3",
                  !item.readAt && "bg-accent-primary/[0.02]",
                )}
              >
                <div className="pt-1 shrink-0">
                  {!item.readAt ? (
                    <div className="w-2 h-2 rounded-full bg-accent-primary" />
                  ) : (
                    <div className="w-2 h-2" />
                  )}
                </div>

                <div className="w-7 h-7 rounded-full bg-app-hover flex items-center justify-center text-[10px] font-medium text-tx-secondary overflow-hidden shrink-0">
                  {line.actor[0]}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-xs text-tx-primary leading-relaxed">
                    <span className="font-semibold">{line.actor}</span>
                    {item.type === "mention" && sourceType ? (
                      <>
                        <span className="text-tx-tertiary"> 在</span>{" "}
                        <span className="inline-flex items-center gap-1 text-accent-primary px-1.5 py-0.5 rounded bg-accent-primary/5 text-[10px] font-medium">
                          <SourceIcon type={sourceType} />
                          {sourceLabel(sourceType)}
                        </span>{" "}
                        <span className="text-tx-tertiary">{line.rest}</span>
                      </>
                    ) : line.rest ? (
                      <span className="text-tx-tertiary"> {line.rest}</span>
                    ) : sourceType ? (
                      <>
                        {" "}
                        <span className="inline-flex items-center gap-1 text-accent-primary px-1.5 py-0.5 rounded bg-accent-primary/5 text-[10px] font-medium">
                          <SourceIcon type={sourceType} />
                          {sourceLabel(sourceType) || item.label || "提醒"}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {item.sourceTitle && (
                    <p className="text-[11px] text-tx-tertiary mt-0.5 truncate">
                      {item.sourceTitle}
                    </p>
                  )}
                  <p className="text-[10px] text-tx-tertiary/60 mt-1">
                    {relativeTime(item.createdAt, t)}
                  </p>
                </div>

                <ExternalLink size={12} className="text-tx-tertiary/40 mt-1 shrink-0" />
              </button>
              );
            })}

            {/* 加载更多 */}
            {hasMore && (
              <div className="flex justify-center py-3">
                <button
                  onClick={() => loadInbox(false)}
                  disabled={loadingMore}
                  className="flex items-center gap-1 text-xs text-tx-tertiary hover:text-tx-secondary transition-colors"
                >
                  {loadingMore ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <ChevronDown size={12} />
                  )}
                  <span>加载更多</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
