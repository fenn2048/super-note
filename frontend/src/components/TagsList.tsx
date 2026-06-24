/**
 * 标签列表组件（从 Sidebar 提取）
 *
 * 显示用户的所有标签，支持折叠、点击筛选、长按/右键换色。
 * 原本内嵌在 Sidebar.tsx（~2238 行），抽取为独立组件以减少 Sidebar 的复杂度。
 */

import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import TagColorPopover from "@/components/TagColorPopover";
import { confirm as confirmDialog } from "@/components/ui/confirm";

export default function TagsList() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();

  const [tagsExpanded, setTagsExpanded] = useState(() => {
    try { return localStorage.getItem("super-tags-expanded") !== "0"; } catch { return true; }
  });
  const [tagColorPopover, setTagColorPopover] = useState<{
    tagId: string; tagName: string; color: string; x: number; y: number;
  } | null>(null);

  const toggleTagsExpanded = useCallback(() => {
    setTagsExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem("super-tags-expanded", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const tagLongPressTimer = useRef<any>();
  const tagLongPressFired = useRef(false);

  return (
    <div className="border-t border-app-border shrink-0">
      <button
        onClick={toggleTagsExpanded}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-app-hover transition-colors"
      >
        <span className="text-xs font-medium text-tx-tertiary uppercase tracking-wider">{t('sidebar.tags')}</span>
        <ChevronDown size={14} className={cn("text-tx-tertiary transition-transform duration-200", !tagsExpanded && "-rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {tagsExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0, overflow: "hidden" }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0, overflow: "hidden" }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div className="px-2 pb-2 space-y-0.5 overflow-y-auto" style={{ maxHeight: "min(35vh, 260px)" }}>
              {state.tags.length === 0 ? (
                <p className="text-[10px] text-tx-tertiary px-2 py-1">{t('sidebar.noTags')}</p>
              ) : (
                state.tags.map((tag) => {
                  const isActive = state.viewMode === "tag" && state.selectedTagId === tag.id;
                  return (
                    <div
                      key={tag.id}
                      className={cn(
                        "flex items-center gap-1.5 sm:gap-2 w-full px-1.5 sm:px-2 py-1 sm:py-1.5 rounded sm:rounded-md text-[11px] sm:text-xs transition-colors group/tag cursor-pointer",
                        isActive ? "bg-app-active text-tx-primary" : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
                      )}
                      onClick={() => {
                        if (tagLongPressFired.current) { tagLongPressFired.current = false; return; }
                        actions.setSelectedTag(tag.id);
                        actions.setSelectedNotebook(null);
                        actions.setViewMode("tag");
                        actions.setMobileSidebar(false);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setTagColorPopover({ tagId: tag.id, tagName: tag.name, color: tag.color, x: e.clientX, y: e.clientY });
                      }}
                      onTouchStart={(e) => {
                        const touch = e.touches[0];
                        if (!touch) return;
                        tagLongPressFired.current = false;
                        if (tagLongPressTimer.current) clearTimeout(tagLongPressTimer.current);
                        tagLongPressTimer.current = setTimeout(() => {
                          tagLongPressFired.current = true;
                          setTagColorPopover({ tagId: tag.id, tagName: tag.name, color: tag.color, x: touch.clientX, y: touch.clientY });
                        }, 500);
                      }}
                      onTouchEnd={() => { if (tagLongPressTimer.current) clearTimeout(tagLongPressTimer.current); }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                      <span className="flex-1 truncate">{tag.name}</span>
                      {tag.noteCount !== undefined && (
                        <span className="text-[10px] text-tx-tertiary tabular-nums group-hover/tag:hidden">{tag.noteCount}</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTagColorPopover({ tagId: tag.id, tagName: tag.name, color: tag.color, x: rect.left, y: rect.bottom + 4 });
                        }}
                        className="hidden group-hover/tag:flex items-center justify-center p-0.5 rounded text-tx-tertiary hover:text-tx-primary hover:bg-app-active/40"
                      >
                        <MoreHorizontal size={12} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {tagColorPopover && (
        <TagColorPopover
          x={tagColorPopover.x}
          y={tagColorPopover.y}
          currentColor={tagColorPopover.color}
          title={tagColorPopover.tagName}
          onPick={async (color: string) => {
            try {
              await api.updateTag(tagColorPopover.tagId, { color });
              if (tagColorPopover) setTagColorPopover({ ...tagColorPopover, color });
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch {}
          }}
          onRename={async () => {
            const newName = window.prompt(t("tags.promptRename", "请输入新的标签名称"), tagColorPopover.tagName);
            if (newName === null) return;
            const trimmed = newName.trim();
            if (!trimmed) {
              alert(t("tags.nameRequired", "标签名称不能为空"));
              return;
            }
            try {
              await api.updateTag(tagColorPopover.tagId, { name: trimmed });
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch (err) {
              console.error("Failed to rename tag:", err);
            }
          }}
          onDelete={async () => {
            const ok = await confirmDialog({
              title: t("sidebar.deleteTagTitle"),
              description: t("sidebar.confirmDeleteTag", { name: tagColorPopover.tagName }),
              danger: true,
            });
            if (!ok) return;
            try {
              await api.deleteTag(tagColorPopover.tagId);
              if (state.selectedTagId === tagColorPopover.tagId) {
                actions.setSelectedTag(null);
                actions.setViewMode("all");
              }
              const allTags = await api.getTags();
              actions.setTags(allTags);
            } catch (err) {
              console.error("Failed to delete tag:", err);
            }
          }}
          onClose={() => setTagColorPopover(null)}
        />
      )}
    </div>
  );
}
