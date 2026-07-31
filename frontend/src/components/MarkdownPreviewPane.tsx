import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Note } from "@/types";
import { normalizeToMarkdown } from "@/lib/contentFormat";

interface MarkdownPreviewPaneProps {
  note: Note;
}

export default function MarkdownPreviewPane({ note }: MarkdownPreviewPaneProps) {
  // 兼容 Tiptap JSON / 纯 MD / contentText 兜底；CRDT 场景下 activeNote.content
  // 可能滞后，调用方应在进入预览前用 getSnapshot 回填。
  const markdownContent = useMemo(
    () => normalizeToMarkdown(note.content, note.contentText),
    [note.content, note.contentText],
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-surface text-tx-primary">
      {/* Title */}
      <div className="px-6 py-4 border-b border-app-border/40 shrink-0">
        <h1 className="text-xl font-bold font-serif tracking-tight leading-snug text-tx-primary">
          {note.title || "无标题笔记"}
        </h1>
      </div>

      {/* Rendered Markdown Body */}
      <ScrollArea className="flex-1 h-full">
        <div className="p-6 md:p-8 max-w-4xl mx-auto">
          <div className="markdown-body break-words prose prose-sm dark:prose-invert max-w-none leading-relaxed text-tx-primary">
            {markdownContent ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {markdownContent}
              </ReactMarkdown>
            ) : (
              <p className="text-xs italic text-tx-tertiary">没有内容进行预览</p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
