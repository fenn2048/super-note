/**
 * 资料库统一壳（P1-3 + Phase A StackChrome）
 * Tab：文件 | 书库 | 媒体 —— 内部复用既有业务组件，不复制逻辑。
 * 移动：栈页（无底栏/FAB），右上 × 关闭。
 */
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { FolderOpen, Book, Film, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLibraryTab, setLibraryTab, type LibraryTab } from "@/lib/navigation.config";
import { getCurrentWorkspace } from "@/lib/api";
import { useAppActions } from "@/store/AppContext";
import StackChrome from "@/components/common/StackChrome";

const FileManager = React.lazy(() => import("@/components/FileManager"));
const BookCenter = React.lazy(() => import("@/components/books/BookCenter"));
const BookReader = React.lazy(() => import("@/components/books/BookReader"));
const MediaCenter = React.lazy(() => import("@/components/media/MediaCenter"));

const TABS: { id: LibraryTab; label: string; icon: React.ReactNode }[] = [
  { id: "files", label: "文件", icon: <FolderOpen size={15} /> },
  { id: "books", label: "书库", icon: <Book size={15} /> },
  { id: "media", label: "媒体", icon: <Film size={15} /> },
];

function Fallback() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-accent-primary" />
    </div>
  );
}

export default function LibraryCenter() {
  const actions = useAppActions();
  const [tab, setTab] = useState<LibraryTab>(() => getLibraryTab());
  const [activeBookHash, setActiveBookHash] = useState<string | null>(null);
  const workspaceId = getCurrentWorkspace();

  /** 栈关闭：多从「我的」进入资料库 */
  const goBack = useCallback(() => {
    actions.setViewMode("more");
    actions.setMobileView("list");
  }, [actions]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent).detail as LibraryTab;
      if (detail === "files" || detail === "books" || detail === "media") {
        setTab(detail);
        if (detail !== "books") setActiveBookHash(null);
      }
    };
    window.addEventListener("super:library-tab-changed", onTab);
    return () => window.removeEventListener("super:library-tab-changed", onTab);
  }, []);

  // 从笔记链接 / 全局事件打开某本书
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem("super-open-book-hash");
      if (pending) {
        sessionStorage.removeItem("super-open-book-hash");
        setTab("books");
        setLibraryTab("books");
        setActiveBookHash(pending);
      }
    } catch { /* ignore */ }

    const onOpenBook = (e: Event) => {
      const hash = (e as CustomEvent<{ bookHash: string }>).detail?.bookHash;
      if (!hash) return;
      setTab("books");
      setLibraryTab("books");
      setActiveBookHash(hash);
    };
    window.addEventListener("super:open-book", onOpenBook);
    return () => window.removeEventListener("super:open-book", onOpenBook);
  }, []);

  const selectTab = useCallback((next: LibraryTab) => {
    setTab(next);
    setLibraryTab(next);
    if (next !== "books") setActiveBookHash(null);
  }, []);

  // 全屏阅读器：不显示 Tab 栏
  if (tab === "books" && activeBookHash) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Suspense fallback={<Fallback />}>
          <BookReader
            bookHash={activeBookHash}
            onBack={() => setActiveBookHash(null)}
            workspaceId={workspaceId}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg">
      <StackChrome onClose={goBack} closeLabel="关闭资料库">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 md:px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
              tab === t.id
                ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                : "border-transparent text-tx-tertiary hover:text-tx-primary hover:bg-app-hover",
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </StackChrome>

      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<Fallback />}>
          {tab === "files" && <FileManager />}
          {tab === "books" && (
            <BookCenter
              onOpenBook={(hash) => setActiveBookHash(hash)}
              workspaceId={workspaceId}
            />
          )}
          {tab === "media" && <MediaCenter />}
        </Suspense>
      </div>
    </div>
  );
}
