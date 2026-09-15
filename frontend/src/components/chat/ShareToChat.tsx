/**
 * 分享笔记 / 说说 / 任务到 IM：
 *   - ShareItemPickerSheet：会话内挑选内容发出卡片
 *   - ShareConversationSheet：从内容页挑选会话发出
 *   - ImShareCardBubble：消息列表里的可点卡片
 */
import React, { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckSquare, ChevronRight, FileText, Highlighter, MessageCircle, Search } from "lucide-react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { BottomSheet } from "@/components/common/BottomSheet";
import { EmptyState, LoadingBlock } from "@/components/common/FeedbackStates";
import { fieldControlClass } from "@/components/ui/field";
import { toast } from "@/lib/toast";
import { isFamilyWorkspace, openSharedItem, parseImCard } from "@/lib/imCard";
import { cn } from "@/lib/utils";
import type { Diary, ImCardKind, ImConversation, NoteListItem, ProjectTask } from "@/types";

function currentWs(): string {
  return getCurrentWorkspace() || "";
}

export function ImShareCardBubble({
  body,
  disabled,
}: {
  body: string;
  disabled?: boolean;
}) {
  const card = parseImCard(body);
  if (!card) {
    return <span className="text-tx-tertiary text-sm">[卡片]</span>;
  }
  const Icon =
    card.kind === "note"
      ? FileText
      : card.kind === "diary"
        ? MessageCircle
        : card.kind === "book"
          ? BookOpen
          : card.kind === "bookNote"
            ? Highlighter
            : CheckSquare;
  const tone =
    card.kind === "note" || card.kind === "book"
      ? "text-accent-primary"
      : card.kind === "diary" || card.kind === "bookNote"
        ? "text-accent-secondary"
        : "text-accent-warning";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        openSharedItem(card.kind, card.id);
      }}
      className={cn(
        "w-[240px] max-w-full text-left rounded-card border border-app-border bg-app-elevated",
        "px-3 py-2.5 min-h-11 shadow-xs",
        "hover:bg-app-hover active:bg-app-active",
        "transition-colors duration-press ease-out",
        disabled && "pointer-events-none opacity-70",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={14} className={cn("shrink-0", tone)} />
        <span className={cn("text-[11px] font-medium", tone)}>{card.label}</span>
        <ChevronRight size={12} className="ml-auto shrink-0 text-tx-quaternary" />
      </div>
      <div className="text-sm font-medium text-tx-primary leading-snug line-clamp-2">
        {card.title || "未命名"}
      </div>
      {card.snippet ? (
        <div className="mt-0.5 text-[11px] text-tx-tertiary leading-snug line-clamp-2">
          {card.snippet}
        </div>
      ) : null}
    </button>
  );
}

type Tab = "note" | "diary" | "task";

export function ShareItemPickerSheet({
  open,
  onClose,
  conversationId,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  conversationId: string;
  onSent?: (message: import("@/types").ImMessage) => void;
}) {
  const [tab, setTab] = useState<Tab>("note");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [diaries, setDiaries] = useState<Diary[]>([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    const ws = currentWs();
    const needle = q.trim();
    try {
      if (tab === "note") {
        const params: Record<string, string> = {};
        if (needle) params.search = needle;
        const list = await api.getNotes(params);
        setNotes((list || []).filter((n) => !n.isTrashed).slice(0, 40));
      } else if (tab === "diary") {
        const page = await api.getDiaryTimeline(undefined, 40, undefined, "all", undefined, needle || undefined);
        setDiaries(page.items || []);
      } else {
        const list = await api.getMyTasks(ws, "all");
        const scoped = (list || []).filter((t) => !t.projectWorkspaceId || t.projectWorkspaceId === ws);
        const filtered = needle
          ? scoped.filter((t) => (t.title || "").toLowerCase().includes(needle.toLowerCase()))
          : scoped;
        setTasks(filtered.slice(0, 40));
      }
    } catch (e: any) {
      toast.error(e?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  }, [open, tab, q]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => void load(), q ? 220 : 0);
    return () => window.clearTimeout(t);
  }, [open, load, q]);

  useEffect(() => {
    if (!open) {
      setQ("");
      setTab("note");
    }
  }, [open]);

  const send = async (kind: ImCardKind, id: string) => {
    if (sendingId) return;
    setSendingId(id);
    try {
      const sent = await api.im.send(conversationId, {
        type: "card",
        body: JSON.stringify({ kind, id }),
      });
      onSent?.(sent);
      toast.success("已分享到聊天");
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "分享失败");
    } finally {
      setSendingId(null);
    }
  };

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "note", label: "笔记" },
    { id: "diary", label: "说说" },
    { id: "task", label: "任务" },
  ];

  return (
    <BottomSheet open={open} onClose={onClose} title="分享到聊天" maxHeight="80vh">
      <div className="flex gap-1 p-0.5 mb-2 rounded-button bg-app-hover">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex-1 min-h-11 rounded-button text-sm font-medium",
              tab === t.id ? "bg-app-elevated text-tx-primary shadow-xs" : "text-tx-tertiary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="relative mb-2">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-quaternary" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tab === "note" ? "搜索笔记" : tab === "diary" ? "搜索说说" : "搜索任务"}
          className={cn(fieldControlClass, "pl-8")}
        />
      </div>
      <div className="min-h-[240px] max-h-[50vh] overflow-y-auto -mx-1">
        {loading ? (
          <LoadingBlock label="加载中…" size="sm" />
        ) : tab === "note" ? (
          notes.length === 0 ? (
            <EmptyState title="没有可分享的笔记" className="py-8" />
          ) : (
            <ul>
              {notes.map((n) => (
                <li key={n.id}>
                  <PickerRow
                    icon={<FileText size={16} className="text-accent-primary" />}
                    title={n.title || "无标题笔记"}
                    subtitle={n.contentText}
                    busy={sendingId === n.id}
                    onClick={() => void send("note", n.id)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : tab === "diary" ? (
          diaries.length === 0 ? (
            <EmptyState title="没有可分享的说说" className="py-8" />
          ) : (
            <ul>
              {diaries.map((d) => (
                <li key={d.id}>
                  <PickerRow
                    icon={<MessageCircle size={16} className="text-accent-secondary" />}
                    title={(d.contentText || "").replace(/\s+/g, " ").trim() || "说说"}
                    subtitle={d.creatorName || undefined}
                    busy={sendingId === d.id}
                    onClick={() => void send("diary", d.id)}
                  />
                </li>
              ))}
            </ul>
          )
        ) : tasks.length === 0 ? (
          <EmptyState title="没有可分享的任务" className="py-8" />
        ) : (
          <ul>
            {tasks.map((t) => (
              <li key={t.id}>
                <PickerRow
                  icon={<CheckSquare size={16} className="text-accent-warning" />}
                  title={t.title || "未命名任务"}
                  subtitle={[t.projectName, t.stageName].filter(Boolean).join(" · ")}
                  busy={sendingId === t.id}
                  onClick={() => void send("task", t.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

export function ShareConversationSheet({
  open,
  onClose,
  card,
  zClassName,
}: {
  open: boolean;
  onClose: () => void;
  card: { kind: ImCardKind; id: string };
  zClassName?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ImConversation[]>([]);
  const family = isFamilyWorkspace(currentWs());

  useEffect(() => {
    if (!open) return;
    if (!family) return;
    setLoading(true);
    api.im
      .conversations()
      .then((r) => setConversations(r.items || []))
      .catch((e: any) => toast.error(e?.message || "加载会话失败"))
      .finally(() => setLoading(false));
  }, [open, family]);

  const send = async (conv: ImConversation) => {
    if (sendingId) return;
    setSendingId(conv.id);
    try {
      await api.im.send(conv.id, {
        type: "card",
        body: JSON.stringify({ kind: card.kind, id: card.id }),
      });
      toast.success(`已分享到「${conv.title || "聊天"}」`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "分享失败");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} title="分享到聊天" zClassName={zClassName || "z-popover"}>
      {!family ? (
        <p className="text-sm text-tx-tertiary text-center py-8 px-2">聊天仅在家庭工作区可用</p>
      ) : loading ? (
        <LoadingBlock label="加载会话…" size="sm" />
      ) : conversations.length === 0 ? (
        <EmptyState title="还没有聊天会话" className="py-8" />
      ) : (
        <ul className="py-1">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                disabled={!!sendingId}
                onClick={() => void send(c)}
                className="w-full flex items-center gap-3 min-h-12 px-2 rounded-button hover:bg-app-hover text-left"
              >
                <span
                  className={cn(
                    "shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold",
                    c.type === "group"
                      ? "bg-accent-primary/12 text-accent-primary"
                      : "bg-accent-secondary/12 text-accent-secondary",
                  )}
                >
                  {(c.title || "?").slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-tx-primary truncate">{c.title}</span>
                  {c.lastPreview ? (
                    <span className="block text-[11px] text-tx-tertiary truncate">{c.lastPreview}</span>
                  ) : null}
                </span>
                {sendingId === c.id ? (
                  <span className="text-[11px] text-tx-tertiary">发送中…</span>
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-tx-quaternary" />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </BottomSheet>
  );
}

function PickerRow({
  icon,
  title,
  subtitle,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className="w-full flex items-center gap-3 min-h-12 px-2 rounded-button hover:bg-app-hover text-left"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-tx-primary truncate">{title}</span>
        {subtitle ? (
          <span className="block text-[11px] text-tx-tertiary truncate">{subtitle}</span>
        ) : null}
      </span>
      {busy ? <span className="text-[11px] text-tx-tertiary">发送中…</span> : null}
    </button>
  );
}
