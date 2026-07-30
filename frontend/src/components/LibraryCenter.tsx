/**
 * 资料库统一壳（P1-3 + Page Contract）
 * ---------------------------------------------------------------------------
 * 桌面：PageHeader + 分段 Tab（文件 | 书库 | 媒体）+ 内容
 * 移动：Hub 三行列表 / 子页 → MobileChromeHeader 左返回
 */
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FolderOpen, Book, Film, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLibraryTab, setLibraryTab, type LibraryTab } from "@/lib/navigation.config";
import { getCurrentWorkspace } from "@/lib/api";
import { useAppActions } from "@/store/AppContext";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";
import ContentCanvas from "@/components/layout/ContentCanvas";
import { LoadingBlock } from "@/components/common/FeedbackStates";

const FileManager = React.lazy(() => import("@/components/FileManager"));
const BookCenter = React.lazy(() => import("@/components/books/BookCenter"));
const BookReader = React.lazy(() => import("@/components/books/BookReader"));
const MediaCenter = React.lazy(() => import("@/components/media/MediaCenter"));

const HUB_ITEMS: {
  id: LibraryTab;
  label: string;
  desc: string;
  icon: React.ReactNode;
  iconBg: string;
}[] = [
  {
    id: "files",
    label: "文件",
    desc: "附件与上传文件管理",
    icon: <FolderOpen size={22} className="text-emerald-500" />,
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
  },
  {
    id: "books",
    label: "书库",
    desc: "电子书阅读与划线",
    icon: <Book size={22} className="text-orange-500" />,
    iconBg: "bg-orange-500/10 border-orange-500/20",
  },
  {
    id: "media",
    label: "媒体",
    desc: "视频与音频库",
    icon: <Film size={22} className="text-sky-500" />,
    iconBg: "bg-sky-500/10 border-sky-500/20",
  },
];

const TABS: { id: LibraryTab; label: string; icon: React.ReactNode }[] = [
  { id: "files", label: "文件", icon: <FolderOpen size={15} /> },
  { id: "books", label: "书库", icon: <Book size={15} /> },
  { id: "media", label: "媒体", icon: <Film size={15} /> },
];

function Fallback({ label = "加载中…" }: { label?: string }) {
  return (
    <div className="flex-1 min-h-[12rem] flex flex-col items-center justify-center bg-app-bg">
      <LoadingBlock label={label} />
    </div>
  );
}

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

export default function LibraryCenter() {
  const actions = useAppActions();
  const isMobile = useIsMobile();
  // 移动端：null = Hub 列表；有值 = 已进入子 Tab
  // 桌面：始终有 tab
  const [tab, setTab] = useState<LibraryTab | null>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      // 深链 / 外部 setLibraryTab 时直接进子页；默认 Hub
      try {
        const forced = sessionStorage.getItem("super-library-enter-tab");
        if (forced === "files" || forced === "books" || forced === "media") {
          sessionStorage.removeItem("super-library-enter-tab");
          return forced;
        }
      } catch { /* ignore */ }
      return null;
    }
    return getLibraryTab();
  });
  const [activeBookHash, setActiveBookHash] = useState<string | null>(null);
  /** 媒体内页动态标题，如「雍正王朝（108）」；null 时用默认 Tab 名 */
  const [mediaChromeTitle, setMediaChromeTitle] = useState<string | null>(null);
  /** 桌面媒体详情打开时隐藏分段顶栏，改由详情顶栏接管 */
  const [mediaDetailOpen, setMediaDetailOpen] = useState(false);
  const libraryChromeRef = useRef<HTMLDivElement>(null);
  const workspaceId = getCurrentWorkspace();

  /** 退出资料库：回「我的」或笔记 */
  const leaveLibrary = useCallback(() => {
    if (isMobile) {
      actions.setViewMode("more");
      actions.setMobileView("list");
    } else {
      actions.setViewMode("all");
    }
  }, [actions, isMobile]);

  /** 子页返回：移动回 Hub；桌面关资料库 */
  const goBack = useCallback(() => {
    console.log("[LibraryCenter Back Debug]", { isMobile, tab, hash: window.location.hash });
    if (tab === "media") {
      if (window.location.hash.startsWith("#/media/items/")) {
        window.dispatchEvent(new CustomEvent("super:media-close-detail"));
        return;
      }
      // 媒体中心内部多级导航（类型 → 合集 → 列表）优先消费返回
      if (isMobile) {
        const detail = { handled: false };
        window.dispatchEvent(
          new CustomEvent("super:media-navigate-back", { detail }),
        );
        if (detail.handled) return;
      }
      if (window.location.hash.startsWith("#/media")) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    if (isMobile && tab !== null) {
      setTab(null);
      return;
    }
    leaveLibrary();
  }, [isMobile, tab, leaveLibrary]);

  useEffect(() => {
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent).detail as LibraryTab;
      if (detail === "files" || detail === "books" || detail === "media") {
        setTab(detail);
        if (detail !== "books") setActiveBookHash(null);
        if (detail !== "media") setMediaChromeTitle(null);
      }
    };
    window.addEventListener("super:library-tab-changed", onTab);
    return () => window.removeEventListener("super:library-tab-changed", onTab);
  }, []);

  // 媒体中心上报 titlebar 文案（合集列表：合集名（数量））
  useEffect(() => {
    const onMediaTitle = (e: Event) => {
      const title = (e as CustomEvent<{ title?: string | null }>).detail?.title;
      setMediaChromeTitle(title && String(title).trim() ? String(title).trim() : null);
    };
    window.addEventListener("super:media-chrome-title", onMediaTitle);
    return () => window.removeEventListener("super:media-chrome-title", onMediaTitle);
  }, []);

  // 媒体详情打开：隐藏资料库分段顶栏（桌面）
  useEffect(() => {
    const onDetail = (e: Event) => {
      const open = !!(e as CustomEvent<{ open?: boolean }>).detail?.open;
      setMediaDetailOpen(open);
    };
    window.addEventListener("super:media-detail-chrome", onDetail);
    return () => window.removeEventListener("super:media-detail-chrome", onDetail);
  }, []);

  // 供媒体侧栏 fixed top 避让：写入资料库顶栏实际高度
  useLayoutEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (mediaDetailOpen || !libraryChromeRef.current) {
        root.style.setProperty("--library-chrome-height", "0px");
        return;
      }
      const h = libraryChromeRef.current.getBoundingClientRect().height;
      root.style.setProperty("--library-chrome-height", `${Math.ceil(h)}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      root.style.setProperty("--library-chrome-height", "0px");
    };
  }, [mediaDetailOpen, isMobile, tab, mediaChromeTitle]);

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
    if (next === "media") {
      if (window.location.hash.startsWith("#/media/items/")) {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
    setTab(next);
    setLibraryTab(next);
    if (next !== "books") setActiveBookHash(null);
  }, []);

  // 全屏阅读器
  if (activeBookHash) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <Suspense fallback={<Fallback label="正在打开阅读器…" />}>
          <BookReader
            bookHash={activeBookHash}
            onBack={() => {
              setActiveBookHash(null);
              setTab("books");
              setLibraryTab("books");
              try {
                sessionStorage.removeItem("super-open-book-hash");
                sessionStorage.setItem("super-library-enter-tab", "books");
              } catch {}
              if (window.location.hash.startsWith("#/books/")) {
                window.location.hash = "#/library";
              }
              window.dispatchEvent(new CustomEvent("super:close-book"));
            }}
            workspaceId={workspaceId}
          />
        </Suspense>
      </div>
    );
  }

  // ── 移动 Hub：文件 / 书库 / 媒体 三行 ──
  if (isMobile && tab === null) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg">
        <MobileChromeHeader
          variant="stack"
          title="资料库"
          onLeadingClick={leaveLibrary}
          leadingLabel="返回"
        />
        <ContentCanvas className="pb-[calc(1.5rem+var(--safe-area-bottom))]">
          <div className="space-y-2">
            {HUB_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                className="w-full flex items-center gap-3 p-4 rounded-card border border-app-border/60 bg-app-elevated shadow-xs active:scale-[0.99] transition-all text-left"
              >
                <div
                  className={cn(
                    "w-11 h-11 rounded-card border flex items-center justify-center shrink-0",
                    item.iconBg,
                  )}
                >
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-tx-primary">{item.label}</div>
                  <div className="text-[11px] text-tx-tertiary mt-0.5">{item.desc}</div>
                </div>
                <ChevronRight size={18} className="text-tx-tertiary shrink-0" />
              </button>
            ))}
          </div>
        </ContentCanvas>
      </div>
    );
  }

  const activeTab = tab || "files";
  const tabLabel =
    HUB_ITEMS.find((h) => h.id === activeTab)?.label || "资料库";
  const mobileTitle =
    isMobile && activeTab === "media" && mediaChromeTitle
      ? mediaChromeTitle
      : isMobile
        ? tabLabel
        : undefined;

  /** 桌面媒体详情：隐藏分段顶栏，避免与「返回媒体列表」叠两层 */
  const showLibraryChrome = !(mediaDetailOpen && activeTab === "media" && !isMobile);

  const loadingLabel =
    activeTab === "files"
      ? "正在加载文件…"
      : activeTab === "books"
        ? "正在加载书库…"
        : activeTab === "media"
          ? "正在加载媒体…"
          : "加载中…";

  const tabSwitcher = (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-card bg-app-bg border border-app-border/70 shrink-0">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => selectTab(t.id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-button transition-all min-h-[36px]",
            activeTab === t.id
              ? "bg-app-elevated text-accent-primary shadow-sm"
              : "text-tx-tertiary hover:text-tx-primary",
          )}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg">
      {showLibraryChrome && (
        <div ref={libraryChromeRef}>
          {/* 移动：栈顶栏（返回 Hub / 退出） */}
          <MobileChromeHeader
            variant="stack"
            title={mobileTitle || tabLabel}
            onLeadingClick={goBack}
            leadingLabel={isMobile && tab !== null ? "返回资料库" : "关闭资料库"}
          />
          {/* 桌面：标题 + 文件|书库|媒体 分段 */}
          <PageHeader
            mdOnly
            dense
            title="资料库"
            actions={tabSwitcher}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        <Suspense fallback={<Fallback label={loadingLabel} />}>
          {activeTab === "files" && <FileManager />}
          {activeTab === "books" && (
            <BookCenter
              onOpenBook={(hash) => setActiveBookHash(hash)}
              workspaceId={workspaceId}
            />
          )}
          {activeTab === "media" && <MediaCenter />}
        </Suspense>
      </div>
    </div>
  );
}
