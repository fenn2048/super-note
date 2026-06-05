import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, MessageCircle, Send, Trash2, CheckCircle2, Circle, Reply, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { ShareComment } from "@/types";
import { cn } from "@/lib/utils";

interface CommentPanelProps {
  noteId: string;
  noteTitle: string;
  onClose: () => void;
}

export default function CommentPanel({ noteId, noteTitle, onClose }: CommentPanelProps) {
  const [comments, setComments] = useState<ShareComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadComments = useCallback(async () => {
    try {
      const data = await api.getNoteComments(noteId);
      setComments(data);
    } catch (e) {
      console.error("加载评论失败:", e);
    } finally {
      setLoading(false);
    }
  }, [noteId]);

  useEffect(() => {
    loadComments();
  }, [loadComments]);

  // 提交评论
  const handleSubmit = async () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    try {
      const comment = await api.addNoteComment(noteId, {
        content: newComment.trim(),
        parentId: replyTo || undefined,
      });
      setComments((prev) => [...prev, comment]);
      setNewComment("");
      setReplyTo(null);
    } catch (e: any) {
      console.error("提交评论失败:", e);
    } finally {
      setSubmitting(false);
    }
  };

  // 删除评论
  const handleDelete = async (commentId: string) => {
    try {
      await api.deleteNoteComment(noteId, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (e) {
      console.error("删除评论失败:", e);
    }
  };

  // 切换已解决状态
  const handleToggleResolved = async (commentId: string) => {
    try {
      const updated = await api.toggleCommentResolved(noteId, commentId);
      setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch (e) {
      console.error("更新评论状态失败:", e);
    }
  };

  // Ctrl+Enter 提交
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const formatTime = (date: string) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    if (diffMin < 1) return "刚刚";
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // 构建评论树（顶层 + 回复）
  const topComments = comments.filter((c) => !c.parentId);
  const getReplies = (parentId: string) => comments.filter((c) => c.parentId === parentId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg mx-4 bg-app-elevated rounded-xl shadow-2xl border border-app-border overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-app-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <MessageCircle size={16} className="text-blue-500" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-tx-primary">评论与批注</h2>
              <p className="text-[11px] text-tx-tertiary truncate max-w-[260px]">{noteTitle} · {comments.length} 条评论</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-app-hover text-tx-tertiary hover:text-tx-secondary transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 评论列表 */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-3">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-tx-tertiary" />
              </div>
            ) : comments.length === 0 ? (
              <div className="text-center py-12">
                <MessageCircle size={28} className="mx-auto mb-2 text-tx-tertiary/30" />
                <p className="text-xs text-tx-tertiary">暂无评论</p>
                <p className="text-[10px] text-tx-tertiary/60 mt-0.5">在下方输入框添加评论</p>
              </div>
            ) : (
              <div className="space-y-3">
                {topComments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    replies={getReplies(comment.id)}
                    onReply={(id) => { setReplyTo(id); inputRef.current?.focus(); }}
                    onDelete={handleDelete}
                    onToggleResolved={handleToggleResolved}
                    formatTime={formatTime}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 输入区域 */}
        <div className="px-5 py-3 border-t border-app-border bg-app-bg/50">
          {replyTo && (
            <div className="flex items-center gap-2 mb-2 text-[11px] text-tx-tertiary">
              <Reply size={12} />
              <span>回复评论</span>
              <button onClick={() => setReplyTo(null)} className="ml-auto text-tx-tertiary hover:text-tx-secondary">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={inputRef}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入评论... (Ctrl+Enter 发送)"
              rows={2}
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-app-border bg-app-bg text-tx-primary placeholder:text-tx-tertiary/50 focus:outline-none focus:border-accent-primary/50 resize-none"
            />
            <Button
              onClick={handleSubmit}
              disabled={!newComment.trim() || submitting}
              size="icon"
              className="h-auto w-10 shrink-0 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ===== 单条评论 ===== */
function CommentItem({
  comment,
  replies,
  onReply,
  onDelete,
  onToggleResolved,
  formatTime,
}: {
  comment: ShareComment;
  replies: ShareComment[];
  onReply: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleResolved: (id: string) => void;
  formatTime: (date: string) => string;
}) {
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", comment.isResolved ? "border-app-border/50 bg-app-bg/30 opacity-60" : "border-app-border bg-app-bg")}>
      {/* 评论头部 */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn(
          "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium",
          // 访客评论用更柔和的灰底，与登录用户的 accent-primary 区分
          comment.isGuest
            ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300"
            : "bg-accent-primary/20 text-accent-primary",
        )}>
          {((comment.displayName || comment.username || "?")[0] || "?").toUpperCase()}
        </div>
        <span className="text-[11px] font-medium text-tx-primary">
          {comment.displayName || comment.username || "匿名"}
        </span>
        {comment.isGuest && (
          <span className="px-1 text-[9px] rounded bg-zinc-100 dark:bg-zinc-800 text-tx-tertiary" title="未登录访客留言">
            访客
          </span>
        )}
        <span className="text-[10px] text-tx-tertiary/60">{formatTime(comment.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => onToggleResolved(comment.id)}
            className={cn(
              "p-1 rounded transition-colors",
              comment.isResolved
                ? "text-green-500 hover:bg-green-500/10"
                : "text-tx-tertiary hover:text-green-500 hover:bg-green-500/10"
            )}
            title={comment.isResolved ? "标记为未解决" : "标记为已解决"}
          >
            {comment.isResolved ? <CheckCircle2 size={13} /> : <Circle size={13} />}
          </button>
          <button onClick={() => onReply(comment.id)} className="p-1 rounded text-tx-tertiary hover:text-accent-primary hover:bg-accent-primary/10 transition-colors" title="回复">
            <Reply size={13} />
          </button>
          <button onClick={() => onDelete(comment.id)} className="p-1 rounded text-tx-tertiary hover:text-red-500 hover:bg-red-500/10 transition-colors" title="删除">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* 评论内容 */}
      <p className="text-xs text-tx-secondary leading-relaxed whitespace-pre-wrap">{comment.content}</p>

      {/* 回复列表 */}
      {replies.length > 0 && (
        <div className="mt-2.5 pl-3 border-l-2 border-app-border/50 space-y-2">
          {replies.map((reply) => (
            <div key={reply.id} className="text-xs">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="font-medium text-tx-primary text-[11px]">
                  {reply.displayName || reply.username || "匿名"}
                </span>
                {reply.isGuest && (
                  <span className="px-1 text-[9px] rounded bg-zinc-100 dark:bg-zinc-800 text-tx-tertiary">访客</span>
                )}
                <span className="text-[10px] text-tx-tertiary/60">{formatTime(reply.createdAt)}</span>
                <button onClick={() => onDelete(reply.id)} className="ml-auto p-0.5 rounded text-tx-tertiary/40 hover:text-red-500 transition-colors">
                  <Trash2 size={11} />
                </button>
              </div>
              <p className="text-tx-secondary leading-relaxed whitespace-pre-wrap">{reply.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
