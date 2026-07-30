import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Trash2, X, RefreshCw, AlertCircle, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { Note, NoteListItem } from "@/types";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import TiptapEditor from "@/components/TiptapEditor";
import MarkdownPreviewPane from "@/components/MarkdownPreviewPane";
import HtmlPreviewPane, { isFullHtmlDocument } from "@/components/HtmlPreviewPane";
import { detectFormat } from "@/lib/contentFormat";
import { useAppActions } from "@/store/AppContext";

interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function TrashModal({ isOpen, onClose }: TrashModalProps) {
  const { t } = useTranslation();
  const actions = useAppActions();

  const [trashedNotes, setTrashedNotes] = useState<NoteListItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [loadingNote, setLoadingNote] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [emptyConfirmOpen, setEmptyConfirmOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);

  // 加载回收站列表
  const fetchTrashNotes = async () => {
    setLoadingList(true);
    try {
      const list = await api.getNotes({ isTrashed: "1", sortBy: "updatedAt", sortOrder: "desc" });
      setTrashedNotes(list);
      if (list.length > 0) {
        // 如果当前没有选中或者选中的已不在列表中，默认选中第一项
        if (!activeNoteId || !list.some((n) => n.id === activeNoteId)) {
          setActiveNoteId(list[0].id);
        }
      } else {
        setActiveNoteId(null);
        setActiveNote(null);
      }
    } catch (err: any) {
      console.error("加载回收站列表失败:", err);
      toast.error(err?.message || "加载回收站失败");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchTrashNotes();
    } else {
      setActiveNoteId(null);
      setActiveNote(null);
    }
  }, [isOpen]);

  // 当选中的笔记 ID 变化时加载完整详情
  useEffect(() => {
    if (!activeNoteId || !isOpen) {
      setActiveNote(null);
      return;
    }
    let cancelled = false;
    setLoadingNote(true);
    api
      .getNote(activeNoteId)
      .then((note) => {
        if (!cancelled) setActiveNote(note);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("加载已删除笔记详情失败:", err);
          toast.error("加载笔记详情失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingNote(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeNoteId, isOpen]);

  // 恢复笔记
  const handleRestore = async (noteId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRestoringId(noteId);
    try {
      await api.updateNote(noteId, { isTrashed: 0 } as any);
      toast.success(t("noteList.restoreSuccess") || "已恢复笔记");
      actions.refreshNotes();
      actions.refreshNotebooks();
      fetchTrashNotes();
    } catch (err: any) {
      toast.error(err?.message || t("noteList.restoreFailed") || "恢复失败");
    } finally {
      setRestoringId(null);
    }
  };

  // 彻底删除单条
  const handlePermanentDelete = async (noteId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setDeletingId(noteId);
    try {
      await api.deleteNote(noteId);
      toast.success(t("noteList.permanentDeleteSuccess") || "已彻底删除");
      actions.refreshNotes();
      actions.refreshNotebooks();
      fetchTrashNotes();
    } catch (err: any) {
      toast.error(err?.message || t("noteList.permanentDeleteFailed") || "删除失败");
    } finally {
      setDeletingId(null);
    }
  };

  // 清空回收站
  const handleEmptyTrash = async () => {
    setEmptying(true);
    try {
      const res = await api.emptyTrash();
      toast.success(t("sidebar.emptyTrashSuccess", { count: res.count }) || `彻底删除了 ${res.count} 条笔记`);
      actions.refreshNotes();
      actions.refreshNotebooks();
      setEmptyConfirmOpen(false);
      fetchTrashNotes();
    } catch (err: any) {
      toast.error(err?.message || t("sidebar.emptyTrashFailed") || "清空回收站失败");
    } finally {
      setEmptying(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-10 bg-black/50 backdrop-blur-xs">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-5xl h-[85vh] bg-app-elevated border border-app-border rounded-window shadow-2xl flex flex-col overflow-hidden"
        >
          {/* Modal Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-app-border bg-app-surface/50 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center">
                <Trash2 size={18} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-tx-primary">
                  {t("sidebar.trash") || "回收站"}
                </h3>
                <p className="text-[11px] text-tx-tertiary">
                  共 {trashedNotes.length} 条已删除笔记
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {trashedNotes.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEmptyConfirmOpen(true)}
                  className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/20"
                >
                  <Trash2 size={13} className="mr-1.5" />
                  {t("sidebar.emptyTrash") || "清空回收站"}
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-tx-tertiary hover:text-tx-primary"
              >
                <X size={18} />
              </Button>
            </div>
          </div>

          {/* Modal Body: Left List + Right Content */}
          <div className="flex-1 flex min-h-0 divide-x divide-app-border">
            {/* Left Note List */}
            <div className="w-72 md:w-80 flex flex-col shrink-0 bg-app-bg/50">
              <ScrollArea className="flex-1 min-h-0">
                {loadingList ? (
                  <div className="flex items-center justify-center py-16 text-tx-tertiary text-xs gap-2">
                    <Loader2 size={16} className="animate-spin text-accent-primary" />
                    <span>加载回收站...</span>
                  </div>
                ) : trashedNotes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
                    <Trash2 size={32} className="text-tx-tertiary/40 mb-2" />
                    <p className="text-xs font-medium text-tx-secondary">回收站是空的</p>
                    <p className="text-[11px] text-tx-tertiary mt-1">已被删除的笔记会显示在这里</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-1">
                    {trashedNotes.map((note) => {
                      const isSelected = activeNoteId === note.id;
                      return (
                        <div
                          key={note.id}
                          onClick={() => setActiveNoteId(note.id)}
                          className={cn(
                            "group p-3 rounded-lg border text-left transition-all cursor-pointer relative",
                            isSelected
                              ? "bg-app-active border-accent-primary/40 shadow-2xs"
                              : "border-transparent hover:bg-app-hover text-tx-secondary"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <h4 className={cn("text-xs font-semibold truncate", isSelected ? "text-tx-primary" : "text-tx-secondary")}>
                              {note.title || t("common.untitledNote") || "无标题笔记"}
                            </h4>
                          </div>
                          <p className="text-[11px] text-tx-tertiary line-clamp-2 leading-relaxed mb-2">
                            {note.contentText || "无内容"}
                          </p>
                          <div className="flex items-center justify-between text-[10px] text-tx-tertiary">
                            <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                            <div className="flex items-center gap-1 opacity-90 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => handleRestore(note.id, e)}
                                disabled={restoringId === note.id}
                                className="p-1 rounded text-accent-primary hover:bg-accent-primary/10"
                                title={t("noteList.restore") || "恢复"}
                              >
                                {restoringId === note.id ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              </button>
                              <button
                                onClick={(e) => handlePermanentDelete(note.id, e)}
                                disabled={deletingId === note.id}
                                className="p-1 rounded text-red-500 hover:bg-red-500/10"
                                title={t("noteList.permanentDelete") || "彻底删除"}
                              >
                                {deletingId === note.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Right Note Detail (ReadOnly Preview) */}
            <div className="flex-1 flex flex-col min-w-0 bg-app-bg relative">
              {loadingNote ? (
                <div className="flex-1 flex items-center justify-center text-tx-tertiary text-xs gap-2">
                  <Loader2 size={18} className="animate-spin text-accent-primary" />
                  <span>加载笔记内容...</span>
                </div>
              ) : !activeNote ? (
                <div className="flex-1 flex flex-col items-center justify-center text-tx-tertiary p-6 text-center">
                  <FileText size={36} className="text-tx-tertiary/30 mb-2" />
                  <p className="text-xs">选择左侧的笔记以预览内容</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Top Bar for Action */}
                  <div className="px-6 py-3 border-b border-app-border flex items-center justify-between bg-app-elevated/40 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-500 font-medium">
                        已在回收站 (只读)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(activeNote.id)}
                        disabled={restoringId === activeNote.id}
                        className="h-8 text-xs gap-1.5"
                      >
                        {restoringId === activeNote.id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        {t("noteList.restoreNote") || "恢复笔记"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handlePermanentDelete(activeNote.id)}
                        disabled={deletingId === activeNote.id}
                        className="h-8 text-xs gap-1.5"
                      >
                        {deletingId === activeNote.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                        {t("noteList.permanentDelete") || "彻底删除"}
                      </Button>
                    </div>
                  </div>

                  {/* Read-only Content View */}
                  <ScrollArea className="flex-1 min-h-0 px-8 py-6">
                    <div className="max-w-3xl mx-auto space-y-4">
                      <h1 className="text-2xl font-bold text-tx-primary tracking-tight">
                        {activeNote.title || t("common.untitledNote") || "无标题笔记"}
                      </h1>
                      <div className="text-xs text-tx-tertiary flex items-center gap-4 border-b border-app-border/40 pb-3">
                        <span>修改时间：{new Date(activeNote.updatedAt).toLocaleString()}</span>
                        <span>创建时间：{new Date(activeNote.createdAt).toLocaleString()}</span>
                      </div>

                      {/* Content Renderer */}
                      <div className="pt-2 select-text pointer-events-auto">
                        {isFullHtmlDocument(activeNote.content || activeNote.contentText || "") ? (
                          <HtmlPreviewPane
                            note={activeNote}
                            onUpdate={() => {}}
                          />
                        ) : detectFormat(activeNote.content || activeNote.contentText || "") === "md" ? (
                          <MarkdownPreviewPane note={activeNote} />
                        ) : (
                          <TiptapEditor
                            note={activeNote}
                            onUpdate={() => {}}
                            editable={false}
                          />
                        )}
                      </div>
                    </div>
                  </ScrollArea>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Empty Trash Confirm Dialog */}
      {emptyConfirmOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="w-full max-w-md bg-app-elevated border border-app-border rounded-window p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                <AlertCircle size={20} />
              </div>
              <div>
                <h4 className="text-base font-bold text-tx-primary">
                  {t("sidebar.emptyTrashConfirmTitle") || "确认清空回收站？"}
                </h4>
                <p className="text-xs text-tx-tertiary mt-1 leading-relaxed">
                  {t("sidebar.emptyTrashConfirmHint") || "此操作将永久删除回收站中的所有笔记，且无法恢复。"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEmptyConfirmOpen(false)}
                disabled={emptying}
              >
                {t("common.cancel") || "取消"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleEmptyTrash}
                disabled={emptying}
                className="gap-1.5"
              >
                {emptying && <Loader2 size={13} className="animate-spin" />}
                {t("sidebar.confirmEmpty") || "确定清空"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
