import React, { useState, useEffect, useRef } from "react";
import { Project, ProjectDiscussion, ProjectTask, NoteListItem } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import {
  Send, Smile, Image as ImageIcon, Link2, X, MessageSquare,
  Bookmark, Briefcase, FileText, CheckCircle2, Circle, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";

interface ProjectDiscussionProps {
  project: Project;
  tasks: ProjectTask[];
}

export default function ProjectDiscussionView({ project, tasks }: ProjectDiscussionProps) {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();
  const [posts, setPosts] = useState<ProjectDiscussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  // Autocomplete @mention states
  const [composerCursorPos, setComposerCursorPos] = useState(0);
  const composerMention = useMentionState(content, composerCursorPos);

  // Link card state
  const [linkedCards, setLinkedCards] = useState<Array<{ type: "task" | "note"; id: string; title: string }>>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [linkType, setLinkType] = useState<"task" | "note">("task");
  const [linkSearchQuery, setLinkSearchQuery] = useState("");
  const [notesList, setNotesList] = useState<NoteListItem[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);

  // Emojis state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const EMOJIS = ["😊", "👍", "🙌", "🔥", "👏", "🎉", "💡", "🎯", "🚀", "🤔", "👀", "❌", "✅", "⚠️"];

  const fetchDiscussions = async () => {
    try {
      const data = await api.getProjectDiscussions(project.id);
      setPosts(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiscussions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    // Scroll to bottom on load or new post
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [posts]);

  // Fetch notes list when notes tab is active in the picker
  useEffect(() => {
    if (showLinkPicker && linkType === "note") {
      setLoadingNotes(true);
      api.getNotes()
        .then((data) => setNotesList(data))
        .catch(console.error)
        .finally(() => setLoadingNotes(false));
    }
  }, [showLinkPicker, linkType]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() && linkedCards.length === 0) return;

    setSending(true);
    try {
      const newPost = await api.createProjectDiscussion(project.id, {
        content: content.trim(),
        linkedCards,
        images: [],
        attachments: [],
      });
      setPosts((prev) => [...prev, newPost]);
      setContent("");
      setLinkedCards([]);
      setShowEmojiPicker(false);
    } catch (err: any) {
      toast.error(err?.message || "发布讨论失败");
    } finally {
      setSending(false);
    }
  };

  const addEmoji = (emoji: string) => {
    setContent((prev) => prev + emoji);
    setShowEmojiPicker(false);
  };

  const handleLinkCardSelect = (item: { id: string; title: string }) => {
    if (linkedCards.some((c) => c.id === item.id && c.type === linkType)) {
      toast.info("已经关联了该卡片");
      return;
    }
    setLinkedCards((prev) => [...prev, { type: linkType, id: item.id, title: item.title }]);
    setShowLinkPicker(false);
    setLinkSearchQuery("");
  };

  const removeLinkedCard = (id: string, type: "task" | "note") => {
    setLinkedCards((prev) => prev.filter((c) => !(c.id === id && c.type === type)));
  };

  // Filter items in the picker
  const filteredTasks = tasks.filter((t) =>
    t.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

  const filteredNotes = notesList.filter((n) =>
    n.title.toLowerCase().includes(linkSearchQuery.toLowerCase())
  );

  const handleCardClick = (card: { type: "task" | "note"; id: string; title: string }) => {
    if (card.type === "note") {
      // Navigate to note
      actions.setSelectedNotebook(null);
      actions.setViewMode("all");
      // Give a tiny timeout for viewmode setup before opening note
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("super:open-note", { detail: card.id }));
      }, 50);
    } else {
      // It's a task. Trigger event to let parent page open the task detail editor
      window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: card.id }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-app-bg pb-20 relative">
      {/* Scrollable Feed */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-accent-primary" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary h-full">
            <MessageSquare size={48} className="stroke-1 mb-2 opacity-50" />
            <p className="text-sm font-semibold">{t("projects.noDiscussions") || "暂无讨论内容"}</p>
            <p className="text-xs max-w-xs">{t("projects.noDiscussionsDesc") || "在下方输入框中发布讨论、@成员或关联卡片"}</p>
          </div>
        ) : (
          posts.map((post) => (
            <div key={post.id} className="flex items-start gap-3 group/post animate-in fade-in duration-300">
              {/* User Avatar */}
              {post.avatarUrl ? (
                <img
                  src={post.avatarUrl}
                  alt={post.displayName || post.username}
                  className="w-9 h-9 rounded-full border border-app-border shrink-0 object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-accent-primary/10 border border-app-border shrink-0 flex items-center justify-center text-xs font-bold text-accent-primary uppercase select-none">
                  {(post.displayName || post.username || "?").slice(0, 1)}
                </div>
              )}

              {/* Post Content */}
              <div className="flex-1 space-y-1.5 max-w-[85%]">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-bold text-tx-primary">
                    {post.displayName || post.username}
                  </span>
                  <span className="text-[10px] text-tx-tertiary font-mono">
                    {new Date(post.createdAt).toLocaleString()}
                  </span>
                </div>

                <div className="bg-app-sidebar border border-app-border rounded-2xl px-4 py-2.5 text-xs text-tx-secondary shadow-sm leading-relaxed whitespace-pre-wrap">
                  {post.content}

                  {/* Render Linked Cards */}
                  {post.linkedCards && post.linkedCards.length > 0 && (
                    <div className="mt-3 pt-2 border-t border-app-border/40 flex flex-wrap gap-2">
                      {post.linkedCards.map((card) => (
                        <div
                          key={card.id}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-app-hover border border-app-border hover:bg-app-active/50 transition-colors cursor-pointer select-none"
                          onClick={() => handleCardClick(card)}
                        >
                          {card.type === "note" ? (
                            <FileText size={12} className="text-accent-primary shrink-0" />
                          ) : (
                            <Briefcase size={12} className="text-amber-500 shrink-0" />
                          )}
                          <span className="text-[10px] font-semibold text-tx-secondary truncate max-w-[150px]">
                            {card.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Linked Cards preview in composer */}
      {linkedCards.length > 0 && (
        <div className="px-4 py-2 bg-app-sidebar border-t border-app-border flex flex-wrap gap-2 shrink-0 select-none">
          {linkedCards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-lg bg-app-hover border border-app-border text-[10px] text-tx-secondary font-semibold"
            >
              {card.type === "note" ? (
                <FileText size={11} className="text-accent-primary shrink-0" />
              ) : (
                <Briefcase size={11} className="text-amber-500 shrink-0" />
              )}
              <span className="truncate max-w-[120px]">{card.title}</span>
              <button
                type="button"
                onClick={() => removeLinkedCard(card.id, card.type)}
                className="p-0.5 hover:bg-app-active rounded text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Emojis Selector Bar */}
      {showEmojiPicker && (
        <div className="absolute bottom-16 left-4 bg-app-elevated border border-app-border p-2 rounded-xl shadow-xl z-20 flex gap-1 items-center max-w-sm flex-wrap select-none animate-in slide-in-from-bottom-2 duration-200">
          {EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => addEmoji(emoji)}
              className="w-7 h-7 flex items-center justify-center hover:bg-app-hover rounded text-sm transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {composerMention && (
        <div className="relative z-50 px-3 bg-app-sidebar/20">
          <MentionPicker
            search={composerMention.search}
            onSelect={(user) => {
              const newText = replaceMentionText(content, composerCursorPos, composerMention.startIndex, user.username);
              setContent(newText);
              setComposerCursorPos(composerMention.startIndex + user.username.length + 2);
              composerMention.clear();
            }}
            onClose={composerMention.clear}
          />
        </div>
      )}

      {/* Text Composer Form */}
      <form onSubmit={handleSend} className="p-3 border-t border-app-border bg-app-sidebar flex items-center gap-2 shrink-0">
        <div className="relative flex-1 flex items-center bg-app-bg border border-app-border rounded-xl px-3 py-1.5 focus-within:ring-1 focus-within:ring-accent-primary focus-within:border-accent-primary transition-all">
          <Input
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setComposerCursorPos(e.target.selectionStart || 0);
            }}
            onKeyUp={(e) => {
              const target = e.target as HTMLInputElement;
              setComposerCursorPos(target.selectionStart || 0);
            }}
            onSelect={(e) => {
              const target = e.target as HTMLInputElement;
              setComposerCursorPos(target.selectionStart || 0);
            }}
            placeholder={t("projects.typeMessage") || "输入讨论内容…"}
            className="flex-1 border-none bg-transparent h-7 text-xs focus-visible:ring-0 p-0 placeholder:text-tx-tertiary"
            disabled={sending}
          />
          <div className="flex items-center gap-1.5 shrink-0 pl-2 text-tx-tertiary">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="p-1 hover:bg-app-hover rounded-lg hover:text-tx-primary transition-colors"
              title={t("projects.addEmoji") || "添加表情"}
            >
              <Smile size={15} />
            </button>
            <button
              type="button"
              onClick={() => setShowLinkPicker(true)}
              className="p-1 hover:bg-app-hover rounded-lg hover:text-tx-primary transition-colors"
              title={t("projects.linkCard") || "关联卡片"}
            >
              <Link2 size={15} />
            </button>
          </div>
        </div>
        <Button
          type="submit"
          size="icon"
          className="h-8 w-8 rounded-xl shrink-0 bg-accent-primary hover:bg-accent-primary/90 text-white"
          disabled={sending || (!content.trim() && linkedCards.length === 0)}
        >
          {sending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Send size={14} />
          )}
        </Button>
      </form>

      {/* Link Card Dialog */}
      {showLinkPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowLinkPicker(false)}
          />
          <div className="relative bg-app-elevated w-full max-w-md p-5 rounded-2xl border border-app-border shadow-2xl flex flex-col max-h-[70vh] animate-in scale-in duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-app-border shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">
                {t("projects.linkCardTitle") || "关联项目卡片或笔记"}
              </h3>
              <button
                type="button"
                onClick={() => setShowLinkPicker(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Type tabs switcher */}
            <div className="flex bg-app-sidebar p-1 rounded-lg border border-app-border/40 mt-3 shrink-0">
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  linkType === "task" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-tertiary"
                }`}
                onClick={() => setLinkType("task")}
              >
                <Briefcase size={13} />
                <span>{t("projects.projectTask") || "项目任务"}</span>
              </button>
              <button
                type="button"
                className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-1.5 ${
                  linkType === "note" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-tertiary"
                }`}
                onClick={() => setLinkType("note")}
              >
                <FileText size={13} />
                <span>{t("projects.workspaceNote") || "空间笔记"}</span>
              </button>
            </div>

            {/* Search Input */}
            <div className="mt-3 shrink-0 relative">
              <Input
                placeholder={t("projects.searchLinkPlaceholder") || "搜索标题…"}
                value={linkSearchQuery}
                onChange={(e) => setLinkSearchQuery(e.target.value)}
                className="h-8 text-xs pl-3 border-app-border"
              />
            </div>

            {/* List */}
            <ScrollArea className="flex-1 min-h-0 mt-3 border border-app-border/40 rounded-xl bg-app-sidebar/20">
              <div className="p-1.5 space-y-1">
                {linkType === "task" ? (
                  filteredTasks.length === 0 ? (
                    <p className="text-xs text-tx-tertiary text-center py-6">没有找到匹配的任务</p>
                  ) : (
                    filteredTasks.map((t) => (
                      <div
                        key={t.id}
                        onClick={() => handleLinkCardSelect({ id: t.id, title: t.title })}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-app-hover cursor-pointer text-xs font-medium text-tx-secondary hover:text-tx-primary border border-transparent hover:border-app-border/40 transition-all"
                      >
                        <div className="flex items-center gap-2 truncate">
                          {t.isCompleted === 1 ? (
                            <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                          ) : (
                            <Circle size={13} className="text-tx-tertiary shrink-0" />
                          )}
                          <span className="truncate">{t.title}</span>
                        </div>
                      </div>
                    ))
                  )
                ) : loadingNotes ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={18} className="animate-spin text-accent-primary" />
                  </div>
                ) : filteredNotes.length === 0 ? (
                  <p className="text-xs text-tx-tertiary text-center py-6">没有找到匹配的笔记</p>
                ) : (
                  filteredNotes.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleLinkCardSelect({ id: n.id, title: n.title })}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-app-hover cursor-pointer text-xs font-medium text-tx-secondary hover:text-tx-primary border border-transparent hover:border-app-border/40 transition-all"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileText size={13} className="text-accent-primary shrink-0" />
                        <span className="truncate">{n.title || "无标题笔记"}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}
