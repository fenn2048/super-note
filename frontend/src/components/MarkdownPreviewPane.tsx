import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Note } from "@/types";

interface MarkdownPreviewPaneProps {
  note: Note;
}

export default function MarkdownPreviewPane({ note }: MarkdownPreviewPaneProps) {
  // Ensure content is a string
  const markdownContent = typeof note.content === "string" ? note.content : "";

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-surface text-tx-primary">
      {/* Title */}
      <div className="px-6 py-4 border-b border-app-border/40 shrink-0">
        <h1 className="text-xl font-bold font-serif tracking-tight leading-snug">
          {note.title || "无标题笔记"}
        </h1>
      </div>

      {/* Rendered Markdown Body */}
      <ScrollArea className="flex-1 h-full">
        <div className="p-6 md:p-8 max-w-4xl mx-auto">
          <div className="markdown-body break-words prose prose-sm dark:prose-invert max-w-none leading-relaxed">
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
