import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { api, getServerUrl, resolveAttachmentUrl } from "@/lib/api";
import { toast } from "@/lib/toast";
import { DocumentLoader, TOCItem } from "@/lib/bookDocument";
import { Book, BookConfig, BookNote } from "@/types";
import { cn } from "@/lib/utils";
import {
  readBookDetail,
  readBookNotes,
  readBookConfig,
  readBookFile
} from "@/lib/offlineRead";
import {
  putBooks,
  putBookNotes,
  putBookConfig,
  putBookFile,
  putSingleBookNote,
  deleteBookNote,
  getBookConfig
} from "@/lib/localStore";
import {
  applyNativeStatusBar,
  isAppDarkMode,
  syncStatusBarToAppTheme,
} from "@/hooks/useCapacitor";
import { useTheme } from "next-themes";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Settings,
  Type,
  Volume2,
  VolumeX,
  Search,
  Bookmark,
  Share2,
  List,
  MessageSquare,
  Play,
  Pause,
  Square,
  Plus,
  Trash2,
  Copy,
  ExternalLink,
  Loader2,
  Menu,
  RotateCcw,
  Sparkles,
  Columns,
  Eye,
  FileText,
  X,
  Check,
  Download,
  Highlighter,
  PenTool,
  Maximize,
  Minimize
} from "lucide-react";

const dashedUnderline = (rects: any[], options: any = {}) => {
  const { color = '#fbbf24', width: strokeWidth = 2, padding = 1, writingMode } = options;
  const createSVG = (tag: string) => document.createElementNS('http://www.w3.org/2000/svg', tag);
  const g = createSVG('g');
  g.setAttribute('fill', 'none');
  g.setAttribute('stroke', color);
  g.setAttribute('stroke-width', strokeWidth.toString());
  g.setAttribute('stroke-dasharray', '4, 4');
  
  const isVertical = writingMode === 'vertical-rl' || writingMode === 'vertical-lr';
  if (isVertical) {
    for (const { right, top, height } of rects) {
      const el = createSVG('line');
      el.setAttribute('x1', (right - strokeWidth / 2 + padding).toString());
      el.setAttribute('y1', top.toString());
      el.setAttribute('x2', (right - strokeWidth / 2 + padding).toString());
      el.setAttribute('y2', (top + height).toString());
      g.append(el);
    }
  } else {
    for (const { left, bottom, width } of rects) {
      const el = createSVG('line');
      el.setAttribute('x1', left.toString());
      el.setAttribute('y1', (bottom + strokeWidth / 2 + padding + 1.5).toString());
      el.setAttribute('x2', (left + width).toString());
      el.setAttribute('y2', (bottom + strokeWidth / 2 + padding + 1.5).toString());
      g.append(el);
    }
  }
  return g;
};

interface BookReaderProps {
  bookHash: string;
  onBack: () => void;
  workspaceId: string | null;
}

const DEFAULT_SETTINGS = {
  fontFamily: "lxgw",
  fontSize: 20,
  lineHeight: 1.6,
  theme: "classic", // "classic", "light", "sepia", "green", "dark"
  layoutMode: "paginated", // "paginated", "scrolling"
  columns: 0, // 0 means auto
  // New paragraph settings
  usePublisherStyles: false,
  paragraphSpacing: 1.0,
  wordSpacing: 0.0,
  letterSpacing: 0.0,
  firstLineIndent: 2.0,
  justifyText: true,
  hyphenation: true,
  // New page layout settings
  marginTop: 120,
  marginBottom: 120,
  marginLeft: 40,
  marginRight: 40,
  columnGap: 5,
  maxColumnWidth: 1200,
  maxColumnHeight: 1200,
  // Time display setting
  showTimeDisplay: true
};

const THEMES = {
  classic: { bg: "#d6d6d6", fg: "#111111", name: "水墨文楷", isDark: false },
  light: { bg: "#ffffff", fg: "#2c3e50", name: "日间明亮", isDark: false },
  sepia: { bg: "#f8f3e8", fg: "#5c4328", name: "护眼雅致", isDark: false },
  green: { bg: "#eef6eb", fg: "#2e4823", name: "清新绿意", isDark: false },
  dark: { bg: "#151b26", fg: "#abb2bf", name: "深邃暗夜", isDark: true }
};

/**
 * App 明暗 → 阅读器主题 key。
 * 深色 → 深邃暗夜 (dark)；浅色 → 水墨文楷 (classic)。
 * resolvedFromHook 优先（next-themes hydration 后），否则走 isAppDarkMode 多源判断。
 */
function readerThemeFromAppMode(resolvedFromHook?: string | null): "classic" | "dark" {
  if (resolvedFromHook === "dark") return "dark";
  if (resolvedFromHook === "light") return "classic";
  return isAppDarkMode() ? "dark" : "classic";
}

function buildDefaultSettings(resolvedFromHook?: string | null) {
  return { ...DEFAULT_SETTINGS, theme: readerThemeFromAppMode(resolvedFromHook) };
}

function themeDefOf(themeKey: string) {
  return THEMES[themeKey as keyof typeof THEMES] || THEMES.classic;
}

const renderExcerpt = (excerpt: any, query: string): string => {
  if (!excerpt) return "";
  if (typeof excerpt === "string") {
    const escaped = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    return excerpt.replace(new RegExp(escaped, "gi"), (match) => 
      `<mark class="bg-yellow-200 dark:bg-yellow-800 text-black px-0.5 rounded">${match}</mark>`
    );
  }
  if (typeof excerpt === "object") {
    const pre = excerpt.pre || "";
    const match = excerpt.match || "";
    const post = excerpt.post || "";
    return `<span>${pre}</span><mark class="bg-yellow-200 dark:bg-yellow-800 text-black px-0.5 rounded">${match}</mark><span>${post}</span>`;
  }
  return "";
};

export default function BookReader({ bookHash, onBack, workspaceId }: BookReaderProps) {
  const { resolvedTheme } = useTheme();
  const [book, setBook] = useState<Book | null>(null);
  const [loadingState, setLoadingState] = useState<"loading" | "rendering" | "ready" | "error">("loading");
  const [loadingProgress, setLoadingProgress] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [toc, setToc] = useState<TOCItem[]>([]);
  const [notes, setNotes] = useState<BookNote[]>([]);
  // 首帧即按 App 明暗模式选阅读主题，加载页不会先闪成固定浅灰
  const [settings, setSettings] = useState(() => buildDefaultSettings());

  // Active sidebars
  const [activeSidebar, setActiveSidebar] = useState<"toc" | "search" | "notes" | "settings" | null>(null);
  const [showMarkerColors, setShowMarkerColors] = useState(false);
  const [lastColor, setLastColor] = useState("#ffeb3b");
  const [lastColorStyle, setLastColorStyle] = useState<"solid" | "underline" | "squiggly">("solid");
  const [showWriteThoughtsModal, setShowWriteThoughtsModal] = useState(false);
  const [thoughtText, setThoughtText] = useState("");
  const [thoughtVisibility, setThoughtVisibility] = useState<"public" | "private">("public");
  const [activeThoughtsCfi, setActiveThoughtsCfi] = useState<string | null>(null);
  const [commentsMap, setCommentsMap] = useState<Record<string, any[]>>({});
  const [likesState, setLikesState] = useState<Record<string, { count: number; liked: boolean }>>({});
  const [activeCommentNoteId, setActiveCommentNoteId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [notesPage, setNotesPage] = useState(1);
  const [noteFilter, setNoteFilter] = useState<'all' | 'mine'>('all');

  const notesRef = useRef(notes);
  notesRef.current = notes;

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const handleSectionLoadRef = useRef<any>(null);
  const handleCreateOverlayRef = useRef<any>(null);
  const handleRelocateRef = useRef<any>(null);
  const handleAnnotationClickRef = useRef<any>(null);

  const currentSectionIndexRef = useRef(0);
  const clickTimeoutRef = useRef<any>(null);
  const lastTapTimeRef = useRef<number>(0);
  const lastTapTimerRef = useRef<any>(null);

  // Sidebar size state
  const [sidebarWidth, setSidebarWidth] = useState(320);

  const handleSidebarDragInit = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const iframe = getActiveIframe();
    const iframeDoc = iframe?.contentDocument;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      // If event happened inside iframe, adjusting ClientX is needed
      let clientX = moveEvent.clientX;
      if (moveEvent.target && iframeDoc && iframeDoc.contains(moveEvent.target as Node)) {
        const iframeRect = iframe?.getBoundingClientRect();
        if (iframeRect) {
          clientX = moveEvent.clientX + iframeRect.left;
        }
      }

      const deltaX = clientX - startX;
      // Current fixed width (320px) is default minimum width. Max is 50% of screen.
      const maxWidth = Math.max(320, window.innerWidth * 0.5);
      const newWidth = Math.max(320, Math.min(maxWidth, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      if (iframeDoc) {
        iframeDoc.removeEventListener("mousemove", handleMouseMove);
        iframeDoc.removeEventListener("mouseup", handleMouseUp);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    if (iframeDoc) {
      iframeDoc.addEventListener("mousemove", handleMouseMove);
      iframeDoc.addEventListener("mouseup", handleMouseUp);
    }
  };

  // UI state
  const [currentCfi, setCurrentCfi] = useState("");
  const [readingProgressText, setReadingProgressText] = useState("0%");
  const [chapterTitle, setChapterTitle] = useState("");
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      setCurrentTime(`${hrs}:${mins}`);
    };
    update();
    const interval = setInterval(update, 10000);
    return () => clearInterval(interval);
  }, []);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Selection state
  const [selectionRange, setSelectionRange] = useState<{ cfi: string; text: string; page?: number } | null>(null);
  const [showSelectionPopup, setShowSelectionPopup] = useState(false);
  const [selectionCoords, setSelectionCoords] = useState({ x: 0, y: 0, position: "top" as "top" | "bottom" });
  const [annotationNote, setAnnotationNote] = useState("");

  // Active annotation inspector (for clicking highlights)
  const [inspectingNote, setInspectingNote] = useState<BookNote | null>(null);
  const [inspectingCoords, setInspectingCoords] = useState({ x: 0, y: 0, position: "top" as "top" | "bottom" });
  const [noteEditText, setNoteEditText] = useState("");

  // Annotation comments/replies states
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [loadingComments, setLoadingComments] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  // Share Modal State
  const [shareConfig, setShareConfig] = useState<{
    show: boolean;
    title: string;
    description: string;
    placeholder: string;
    onConfirm: (comment: string) => Promise<void>;
  }>({
    show: false,
    title: "",
    description: "",
    placeholder: "",
    onConfirm: async () => {}
  });
  const [shareComment, setShareComment] = useState("");
  const [sharing, setSharing] = useState(false);

  // TTS state
  const [ttsState, setTtsState] = useState<"stopped" | "playing" | "paused">("stopped");
  const [ttsRate, setTtsRate] = useState(1.2);
  const [ttsParagraphs, setTtsParagraphs] = useState<any[]>([]);
  const [ttsParagraphIndex, setTtsParagraphIndex] = useState(-1);
  const [ttsShowPlayer, setTtsShowPlayer] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [ttsVolume, setTtsVolume] = useState(1.0);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  // Voice selection: 'male' | 'female' | 'child'
  const [ttsVoiceType, setTtsVoiceType] = useState<'male' | 'female' | 'child'>('female');
  const [showVoicePanel, setShowVoicePanel] = useState(false);
  const ttsUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // Refs to avoid stale closures inside utterance callbacks
  const ttsVolumeRef = useRef(1.0);
  const ttsRateRef = useRef(1.2);
  const ttsVoiceTypeRef = useRef<'male' | 'female' | 'child'>('female');
  const ttsPausedAtIndexRef = useRef<number>(-1);  // for manual pause-by-cancel
  const ttsPausedListRef = useRef<any[]>([]);
  const volumeSliderHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Immersive mode and background audio playback keeping
  const [isImmersive, setIsImmersive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // Exit immersive mode when any settings panel is opened
  useEffect(() => {
    if (activeSidebar) {
      setIsImmersive(false);
    }
  }, [activeSidebar]);

  // Fullscreen enter/exit handler
  const handleToggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  // Sync fullscreen DOM state → React state, enter immersive on fullscreen
  useEffect(() => {
    const onFsChange = () => {
      const inFs = !!document.fullscreenElement;
      setIsFullscreen(inFs);
      if (inFs) {
        setIsImmersive(true);
        setActiveSidebar(null);
      } else {
        setIsImmersive(false);
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Keyboard navigation: arrow keys for page/scroll
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is typing in an input / textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;

      const isPaginated = settingsRef.current.layoutMode === "paginated";
      if (isPaginated) {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          viewRef.current?.next();
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          viewRef.current?.prev();
        }
      } else {
        // Scrolled mode: up/down arrow keys
        if (e.key === "ArrowDown") {
          e.preventDefault();
          viewRef.current?.next();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          viewRef.current?.prev();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Setup looping silent audio track to keep background audio alive on iOS/Android
  useEffect(() => {
    const silentUri = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
    const audio = new Audio(silentUri);
    audio.loop = true;
    silentAudioRef.current = audio;
    return () => {
      audio.pause();
    };
  }, []);

  // Ref container
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);

  const applyReaderStylesRef = useRef<(s?: any) => void>(() => {});

  /** 将 App 明暗同步到阅读主题 + 原生状态栏（加载页立刻生效） */
  const applyAppModeToReader = useCallback(
    (opts?: { persist?: boolean; forceStyles?: boolean }) => {
      const themeKey = readerThemeFromAppMode(resolvedTheme);
      const themeDef = themeDefOf(themeKey);
      const prevTheme = settingsRef.current.theme;
      const next = { ...settingsRef.current, theme: themeKey };
      settingsRef.current = next;
      if (prevTheme !== themeKey) {
        setSettings(next);
      } else {
        // 同 theme 也刷一次状态栏（Android 首帧可能被覆盖）
        setSettings((s) => (s.theme === themeKey ? s : next));
      }
      // 状态栏：深色表面 → 白图标；浅色 → 黑图标
      document.documentElement.setAttribute("data-reader-status-bar", "1");
      applyNativeStatusBar({
        isDarkSurface: themeDef.isDark,
        backgroundColor: themeDef.bg,
      });
      if (opts?.forceStyles) {
        applyReaderStylesRef.current(next);
      }
      if (opts?.persist) {
        api.books
          .saveConfig(bookHash, { viewSettings: JSON.stringify(next) })
          .catch(() => {});
        getBookConfig(bookHash)
          .then((existing) => {
            putBookConfig({
              userId: localStorage.getItem("super-self-userid") || "",
              bookHash,
              location: existing?.location || null,
              progress: existing?.progress || "0%",
              viewSettings: JSON.stringify(next),
              xpointer: existing?.xpointer || null,
              createdAt: existing?.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
          })
          .catch(() => {});
      }
    },
    [resolvedTheme, bookHash],
  );

  // 挂载立刻按 App 主题套用（含状态栏），避免加载页仍是水墨灰底
  useEffect(() => {
    document.documentElement.setAttribute("data-reader-status-bar", "1");
    applyAppModeToReader();
    return () => {
      document.documentElement.removeAttribute("data-reader-status-bar");
      syncStatusBarToAppTheme();
    };
    // 仅挂载/卸载；主题变化由下方 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // App 明暗切换（设置里改主题 / system）时，阅读中同步主题与状态栏
  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return;
    applyAppModeToReader({ forceStyles: loadingState === "ready" });
  }, [resolvedTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  // html.class 变化兜底（部分路径不经过 next-themes resolvedTheme）
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => {
      applyAppModeToReader({ forceStyles: loadingState === "ready" });
    });
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, [applyAppModeToReader, loadingState]);

  useEffect(() => {
    loadBookAndReader();
    return () => {
      // Clean up TTS
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [bookHash]);

  // Listen to custom go-to book note event
  useEffect(() => {
    const onGotoBookNote = (e: Event) => {
      const customEvent = e as CustomEvent<{ noteId: string }>;
      const noteId = customEvent.detail?.noteId;
      if (noteId && viewRef.current) {
        const targetNote = notes.find(n => n.id === noteId);
        if (targetNote && targetNote.cfi) {
          viewRef.current.goTo(targetNote.cfi);
          localStorage.removeItem("super-target-book-note-id");
          toast.success("已定位到指定划线内容");
        }
      }
    };
    window.addEventListener("super:goto-book-note", onGotoBookNote);
    return () => {
      window.removeEventListener("super:goto-book-note", onGotoBookNote);
    };
  }, [notes]);

  const loadBookAndReader = async () => {
    try {
      setLoadingState("loading");
      // 任何 await 之前先按 App 主题刷加载页 + 状态栏（深邃暗夜 / 水墨文楷）
      const bootTheme = readerThemeFromAppMode(resolvedTheme);
      const bootSettings = {
        ...settingsRef.current,
        theme: bootTheme,
      };
      settingsRef.current = bootSettings;
      setSettings(bootSettings);
      document.documentElement.setAttribute("data-reader-status-bar", "1");
      applyNativeStatusBar({
        isDarkSurface: themeDefOf(bootTheme).isDark,
        backgroundColor: themeDefOf(bootTheme).bg,
      });

      setLoadingProgress("正在获取书籍详情...");
      const bookData = await readBookDetail(bookHash, async () => {
        const data = await api.books.get(bookHash);
        await putBooks([data]);
        return data;
      });
      setBook(bookData);

      setLoadingProgress("正在获取划线标注...");
      const fetchedNotes = await readBookNotes(bookHash, async () => {
        const data = await api.books.getNotes(bookHash);
        await putBookNotes(bookHash, data);
        return data;
      });
      setNotes(fetchedNotes);

      setLoadingProgress("正在获取偏好配置...");
      const userConfig = await readBookConfig(bookHash, async () => {
        const configData = await api.books.getConfig(bookHash);
        await putBookConfig(configData);
        return configData;
      });
      // 进入阅读器时强制按 App 明暗套用主题：深色→深邃暗夜，浅色→水墨文楷
      // 其它排版偏好（字号、行距等）仍从书籍配置恢复；theme 字段始终被覆盖
      const appReaderTheme = readerThemeFromAppMode(resolvedTheme);
      let nextSettings = buildDefaultSettings(resolvedTheme);
      if (userConfig && userConfig.viewSettings) {
        try {
          const parsed = JSON.parse(userConfig.viewSettings);
          nextSettings = { ...DEFAULT_SETTINGS, ...parsed, theme: appReaderTheme };
        } catch {
          /* keep buildDefaultSettings */
        }
      }
      // 同步写 ref，避免后续 await 期间 applyReaderStyles 读到旧主题
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      applyNativeStatusBar({
        isDarkSurface: themeDefOf(appReaderTheme).isDark,
        backgroundColor: themeDefOf(appReaderTheme).bg,
      });

      setLoadingProgress("正在下载书籍文件...");
      const fileBlob = await readBookFile(bookHash, async () => {
        const token = localStorage.getItem("super-token") || "";
        const res = await fetch(`${getServerUrl()}/api/attachments/${bookData.attachmentId}?download=1`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error("下载书籍失败");
        const blob = await res.blob();
        await putBookFile(bookHash, blob);
        return blob;
      });
      const file = new File([fileBlob], `${bookData.title}.${bookData.format}`, { type: fileBlob.type });

      setLoadingProgress("正在解析图书结构...");
      const loader = new DocumentLoader(file);
      const { book: bookDoc } = await loader.open();
      setToc(bookDoc.toc || []);

      setLoadingState("rendering");
      setLoadingProgress("正在渲染阅读器...");

      // Dynamic import foliate-js
      await import("@/foliate-js/view.js");
      // @ts-ignore
      const { Overlayer } = await import("@/foliate-js/overlayer.js");
      
      // Clear old reader
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }

      const view = document.createElement("foliate-view") as any;
      view.id = `foliate-${bookHash}`;
      view.className = "w-full h-full block";
      containerRef.current?.appendChild(view);
      viewRef.current = view;

      // Event listeners
      view.addEventListener("load", (e: any) => handleSectionLoadRef.current?.(e));
      view.addEventListener("create-overlay", (e: any) => handleCreateOverlayRef.current?.(e));
      view.addEventListener("relocate", (e: any) => handleRelocateRef.current?.(e));
      view.addEventListener("show-annotation", (e: any) => handleAnnotationClickRef.current?.(e));
      view.addEventListener("draw-annotation", (e: any) => {
        const { draw, annotation, doc } = e.detail;
        const { color, style, note } = annotation;
        console.log("[BookReader debug] draw-annotation event details:", { color, style, note, value: annotation.value });
        const writingMode = doc ? (doc.body.style.writingMode || window.getComputedStyle(doc.body).writingMode) : 'horizontal';
        
        if (style === "underline") {
          draw(Overlayer.underline, { color });
        } else if (style === "squiggly") {
          draw(Overlayer.squiggly, { color });
        } else {
          draw(Overlayer.highlight, { color });
        }
        if (note) {
          draw(dashedUnderline, { color: color || '#fbbf24', width: 2, writingMode });
        }
      });

      // Open bookDoc
      await view.open(bookDoc);

      // Target book note redirection
      const targetNoteId = localStorage.getItem("super-target-book-note-id");
      let navigatedToTarget = false;
      if (targetNoteId) {
        const targetNote = fetchedNotes.find((n: any) => n.id === targetNoteId);
        if (targetNote && targetNote.cfi) {
          try {
            await view.goTo(targetNote.cfi);
            navigatedToTarget = true;
            localStorage.removeItem("super-target-book-note-id");
            toast.success("已定位到指定划线内容");
          } catch (err) {
            console.warn("跳转到指定划线失败:", err);
          }
        }
      }

      // Restore location progress if available
      if (!navigatedToTarget) {
        if (userConfig && userConfig.location) {
          try {
            await view.goTo(userConfig.location);
          } catch {
            console.warn("无法跳转到上次阅读位置:", userConfig.location);
            try {
              await view.goTo(0);
            } catch (err) {
              console.error("无法打开书籍首页(0):", err);
            }
          }
        } else {
          try {
            await view.goTo(0);
          } catch (err) {
            console.error("无法打开书籍首页(0):", err);
          }
        }
      }

      // 打开后强制把 App 主题样式注入 foliate（不依赖 section load 时序）
      applyReaderStyles(settingsRef.current);
      applyNativeStatusBar({
        isDarkSurface: themeDefOf(settingsRef.current.theme).isDark,
        backgroundColor: themeDefOf(settingsRef.current.theme).bg,
      });

      setLoadingState("ready");
    } catch (err) {
      console.error("阅读器加载失败:", err);
      setErrorMessage((err as Error).message || "未知错误");
      setLoadingState("error");
    }
  };

  const getActiveIframe = (): HTMLIFrameElement | null => {
    try {
      const renderer = viewRef.current?.renderer;
      if (!renderer) return null;
      
      // 1. Try getContents() first as it is the most reliable API of the paginator
      const contents = renderer.getContents?.();
      if (contents && contents.length > 0) {
        const frame = contents[0].doc?.defaultView?.frameElement;
        if (frame) return frame as HTMLIFrameElement;
      }
      
      // 2. Fallback: search shadow DOM for iframe
      return renderer.iframe || renderer.shadowRoot?.querySelector("iframe") || null;
    } catch (e) {
      console.warn("获取 active iframe 失败:", e);
      return null;
    }
  };

  const getIframeRect = () => {
    const iframe = getActiveIframe();
    if (iframe) {
      try {
        return iframe.getBoundingClientRect();
      } catch (e) {
        console.warn("获取 iframe rect 失败:", e);
      }
    }
    return { left: 0, top: 0, width: 0, height: 0 };
  };

  /**
   * 从 iframe 文档当前 Selection 打开划线菜单（桌面 mouseup / 移动端长按 selectionchange·touchend 共用）
   * 菜单项与桌面一致：复制 / 马克笔 / 波浪线 / 直线 / 写想法 / 删除划线
   */
  const tryOpenSelectionMenuFromDoc = useCallback((doc: Document | null | undefined) => {
    if (!doc) return false;
    try {
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return false;

      const renderer = viewRef.current?.renderer;
      const contents = renderer?.getContents?.();
      const content = contents?.find((c: any) => c.doc === doc);
      const index = content?.index ?? currentSectionIndexRef.current;
      const text = sel.toString();
      const range = sel.getRangeAt(0);
      const cfi = viewRef.current?.getCFI(index, range);
      if (!cfi) return false;

      const rect = range.getBoundingClientRect();
      let iframeRect = { left: 0, top: 0, width: 0, height: 0, bottom: 0, right: 0 };
      if (renderer?.shadowRoot) {
        const iframes = renderer.shadowRoot.querySelectorAll("iframe") as NodeListOf<HTMLIFrameElement>;
        for (const iframe of iframes) {
          if (iframe.contentDocument === doc) {
            iframeRect = iframe.getBoundingClientRect();
            break;
          }
        }
      }
      if (!iframeRect.width) iframeRect = getIframeRect() as any;

      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      // 移动端用底部菜单，坐标仅作兼容；桌面夹紧到视口避免贴边溢出
      let x = iframeRect.left + rect.left + rect.width / 2;
      let y = iframeRect.top + rect.top - 8;
      let position: "top" | "bottom" = "top";
      const isNearTop = iframeRect.top + rect.top < 220;
      if (isNearTop) {
        y = iframeRect.top + rect.bottom + 8;
        position = "bottom";
      }
      if (!isMobile) {
        const pad = 12;
        x = Math.min(Math.max(x, pad + 80), window.innerWidth - pad - 80);
        y = Math.min(Math.max(y, pad + 48), window.innerHeight - pad);
      }

      setSelectionRange({ cfi, text });
      setSelectionCoords({ x, y, position });
      setShowSelectionPopup(true);
      setShowMarkerColors(false);
      setAnnotationNote("");
      // 取消待翻页单击，避免选区松手后被当成点翻页
      if (lastTapTimerRef.current) {
        clearTimeout(lastTapTimerRef.current);
        lastTapTimerRef.current = null;
      }
      return true;
    } catch (err) {
      console.error("[BookReader] open selection menu failed:", err);
      return false;
    }
  }, []);

  const handleMouseUpListener = useCallback((e: MouseEvent) => {
    // Use event target's ownerDocument to get the correct doc (the iframe where mouseup occurred)
    const doc = (e.target as Element)?.ownerDocument;
    if (!doc) return;
    if (!tryOpenSelectionMenuFromDoc(doc)) {
      // 仅当确实没有选区时关闭（避免移动端选区过程中的冒泡 mouseup 误关）
      const sel = doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) {
        setShowSelectionPopup(false);
      }
    }
  }, [tryOpenSelectionMenuFromDoc]);

  const handleMouseDownListener = useCallback((e: MouseEvent) => {
    // 移动端：选区存在时用户拖动手柄会触发 mousedown，不要关掉菜单
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      const doc = (e.target as Element)?.ownerDocument;
      const sel = doc?.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim()) {
        return;
      }
    }
    setShowSelectionPopup(false);
    setInspectingNote(null);
  }, []);

  const handleHoverMouseMoveListener = useCallback((e: MouseEvent) => {
    try {
      const iframe = getActiveIframe();
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
      if (!doc) return;

      const renderer = viewRef.current?.renderer;
      const contents = renderer?.getContents().find((x: any) => x.index === currentSectionIndexRef.current);
      const overlayer = contents?.overlayer;
      if (overlayer) {
        const [value] = overlayer.hitTest(e);
        if (value) {
          const noteCfi = value.startsWith("foliate-note:") ? value.replace("foliate-note:", "") : value;
          const noteObj = notesRef.current.find(n => n.cfi === noteCfi);
          if (noteObj && noteObj.note) {
            doc.body.classList.add("hover-thought");
            return;
          }
        }
      }
      doc.body.classList.remove("hover-thought");
    } catch (err) {
      console.warn("Hover detection failed:", err);
    }
  }, []);

  const handleClickListener = useCallback((e: MouseEvent) => {
    const iframe = getActiveIframe();
    const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (!doc) return;

    // 1. Skip if text is currently selected
    const sel = doc.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      return;
    }

    // 2. Skip if clicking an interactive element
    const target = e.target as HTMLElement;
    if (target.closest("a") || target.closest("button") || target.closest(".annotation") || target.closest("[onclick]")) {
      return;
    }

    // 3. Skip if clicking a text area containing thought to let show-annotation event trigger thoughts list modal!
    const renderer = viewRef.current?.renderer;
    const contents = renderer?.getContents().find((x: any) => x.index === currentSectionIndexRef.current);
    const overlayer = contents?.overlayer;
    console.log("[BookReader debug] handleClickListener:", { hasOverlayer: !!overlayer, clientX: e.clientX, clientY: e.clientY });
    if (overlayer) {
      const [value] = overlayer.hitTest(e);
      console.log("[BookReader debug] handleClickListener hitTest result value:", value);
      if (value) {
        const noteCfi = value.startsWith("foliate-note:") ? value.replace("foliate-note:", "") : value;
        const noteObj = notesRef.current.find(n => n.cfi === noteCfi);
        console.log("[BookReader debug] handleClickListener matched noteObj:", noteObj);
        if (noteObj && noteObj.note) {
          return;
        }
      }
    }

    const clientWidth = doc.documentElement.clientWidth;
    const isMobile = window.innerWidth < 768;

    const now = Date.now();
    const isDoubleTap = now - lastTapTimeRef.current < 300;
    lastTapTimeRef.current = now;

    if (isDoubleTap) {
      // 捕获双击：取消待执行的单击翻页，在阅读器任意地方轻点两下均可切换/退出沉浸态
      if (lastTapTimerRef.current) {
        clearTimeout(lastTapTimerRef.current);
        lastTapTimerRef.current = null;
      }
      setIsImmersive((prev) => !prev);
    } else {
      // 单击：延迟 200ms 触发翻页，等待是否会触发第二次点击（双击）
      const clientX = e.clientX;
      const ratio = clientX / clientWidth;

      if (lastTapTimerRef.current) {
        clearTimeout(lastTapTimerRef.current);
      }

      lastTapTimerRef.current = setTimeout(() => {
        lastTapTimerRef.current = null;
        if (isMobile) {
          // 移动端单击：左侧 50% 区域上一页，右侧 50% 区域下一页
          if (ratio < 0.5) {
            viewRef.current?.prev();
          } else {
            viewRef.current?.next();
          }
        } else {
          setIsImmersive((prev) => !prev);
        }
      }, 200);
    }
  }, []);

  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (e.touches.length > 0) {
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
    }
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    // 长按选字后松手：延迟检测 Selection（系统选区有时在 touchend 后才稳定）
    const touchDoc = (e.target as Element)?.ownerDocument;
    let hasTextSelection = false;
    try {
      const sel = touchDoc?.getSelection();
      hasTextSelection = !!(sel && !sel.isCollapsed && sel.toString().trim());
    } catch {
      /* ignore */
    }

    window.setTimeout(() => {
      if (tryOpenSelectionMenuFromDoc(touchDoc)) return;
      const iframe = getActiveIframe();
      const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
      tryOpenSelectionMenuFromDoc(doc);
    }, 80);

    // 有文字选区时不做翻页手势，避免长按松手误翻页并冲掉菜单
    if (hasTextSelection) {
      touchStartY.current = null;
      touchStartX.current = null;
      if (lastTapTimerRef.current) {
        clearTimeout(lastTapTimerRef.current);
        lastTapTimerRef.current = null;
      }
      return;
    }

    if (touchStartY.current !== null && touchStartX.current !== null && e.changedTouches.length > 0) {
      const startX = touchStartX.current;
      const endY = e.changedTouches[0].clientY;
      const endX = e.changedTouches[0].clientX;
      const deltaY = endY - touchStartY.current;
      const deltaX = endX - startX;
      const mode = settingsRef.current?.layoutMode || "paginated";
      const windowWidth = window.innerWidth;

      // 1. 如果起点在系统手势边缘区（左右各 25px 内），避让 Android/iOS 系统侧滑返回手势
      const isEdgeGesture = startX < 25 || startX > windowWidth - 25;

      // 2. 如果移动距离极小（Tap 点击），交由 handleClickListener 统一处理，避免二次点击冲突
      if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
        touchStartY.current = null;
        touchStartX.current = null;
        return;
      }

      // 3. 滑动手势判断（避开边缘区）
      if (!isEdgeGesture) {
        // 横向轻扫（横向主导且滑动距离 > 50px）
        if (Math.abs(deltaX) > 50 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
          if (deltaX > 0) viewRef.current?.prev();
          else viewRef.current?.next();
        } 
        // 左右翻页模式下的竖直滑动（纵向主导且滑动距离 > 60px）
        else if (mode === "paginated" && Math.abs(deltaY) > 60 && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
          if (deltaY > 0) viewRef.current?.prev();
          else viewRef.current?.next();
        }
      }
    }
    touchStartY.current = null;
    touchStartX.current = null;
  }, [tryOpenSelectionMenuFromDoc]);

  // Refs to hold the latest version of listeners to avoid stale closures
  const handleMouseUpListenerRef = useRef(handleMouseUpListener);
  const handleMouseDownListenerRef = useRef(handleMouseDownListener);
  const handleHoverMouseMoveListenerRef = useRef(handleHoverMouseMoveListener);
  const handleClickListenerRef = useRef(handleClickListener);
  const handleTouchStartRef = useRef(handleTouchStart);
  const handleTouchEndRef = useRef(handleTouchEnd);

  useEffect(() => {
    handleMouseUpListenerRef.current = handleMouseUpListener;
  }, [handleMouseUpListener]);

  useEffect(() => {
    handleMouseDownListenerRef.current = handleMouseDownListener;
  }, [handleMouseDownListener]);

  useEffect(() => {
    handleHoverMouseMoveListenerRef.current = handleHoverMouseMoveListener;
  }, [handleHoverMouseMoveListener]);

  useEffect(() => {
    handleClickListenerRef.current = handleClickListener;
  }, [handleClickListener]);

  useEffect(() => {
    handleTouchStartRef.current = handleTouchStart;
  }, [handleTouchStart]);

  useEffect(() => {
    handleTouchEndRef.current = handleTouchEnd;
  }, [handleTouchEnd]);

  // Stable wrappers that delegate execution to the latest ref callbacks
  const mouseUpWrapper = useCallback((e: MouseEvent) => {
    handleMouseUpListenerRef.current(e);
  }, []);

  const mouseDownWrapper = useCallback((e: MouseEvent) => {
    handleMouseDownListenerRef.current(e);
  }, []);

  const mouseMoveWrapper = useCallback((e: MouseEvent) => {
    handleHoverMouseMoveListenerRef.current(e);
  }, []);

  const clickWrapper = useCallback((e: MouseEvent) => {
    handleClickListenerRef.current(e);
  }, []);

  const touchStartWrapper = useCallback((e: TouchEvent) => {
    handleTouchStartRef.current(e);
  }, []);

  const touchEndWrapper = useCallback((e: TouchEvent) => {
    handleTouchEndRef.current(e);
  }, []);

  // 移动端：选区变化时弹出与桌面一致的划线菜单（长按后 selectionchange 比 mouseup 更可靠）
  const selectionChangeWrapper = useCallback(() => {
    if (typeof window === "undefined" || window.innerWidth >= 768) return;
    const iframe = getActiveIframe();
    const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (!doc) return;
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
    // 略延迟，等选区手柄与 CFI 稳定
    window.setTimeout(() => tryOpenSelectionMenuFromDoc(doc), 120);
  }, [tryOpenSelectionMenuFromDoc]);

  const contextMenuWrapper = useCallback((e: Event) => {
    // 屏蔽系统「复制/共享」菜单，统一用应用内菜单（与桌面一致）
    e.preventDefault();
    const doc = (e.target as Element)?.ownerDocument || getActiveIframe()?.contentDocument;
    window.setTimeout(() => tryOpenSelectionMenuFromDoc(doc), 0);
  }, [tryOpenSelectionMenuFromDoc]);

  // 把点击/滑动监听绑到当前 iframe 文档。
  // 必须在 loadingState→ready、章节 load、侧栏开关后重绑，否则首次进入无法翻页。
  const attachDocListeners = useCallback(() => {
    const iframe = getActiveIframe();
    const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (!doc) return false;
    doc.removeEventListener("mouseup", mouseUpWrapper);
    doc.removeEventListener("mousedown", mouseDownWrapper);
    doc.removeEventListener("mousemove", mouseMoveWrapper);
    doc.removeEventListener("click", clickWrapper);
    doc.removeEventListener("touchstart", touchStartWrapper);
    doc.removeEventListener("touchend", touchEndWrapper);
    doc.removeEventListener("selectionchange", selectionChangeWrapper);
    doc.removeEventListener("contextmenu", contextMenuWrapper);

    doc.addEventListener("mouseup", mouseUpWrapper);
    doc.addEventListener("mousedown", mouseDownWrapper);
    doc.addEventListener("mousemove", mouseMoveWrapper);
    doc.addEventListener("click", clickWrapper);
    doc.addEventListener("touchstart", touchStartWrapper, { passive: true });
    doc.addEventListener("touchend", touchEndWrapper, { passive: true });
    // selectionchange 在 Document 上；部分 WebView 只在 document 冒泡
    doc.addEventListener("selectionchange", selectionChangeWrapper);
    doc.addEventListener("contextmenu", contextMenuWrapper);
    return true;
  }, [
    mouseUpWrapper,
    mouseDownWrapper,
    mouseMoveWrapper,
    clickWrapper,
    touchStartWrapper,
    touchEndWrapper,
    selectionChangeWrapper,
    contextMenuWrapper,
  ]);

  useEffect(() => {
    if (loadingState !== "ready") return;
    let cancelled = false;
    const tryAttach = (attempt: number) => {
      if (cancelled) return;
      if (attachDocListeners()) return;
      if (attempt < 5) {
        window.setTimeout(() => tryAttach(attempt + 1), 120 * (attempt + 1));
      }
    };
    tryAttach(0);
    const t1 = window.setTimeout(() => tryAttach(0), 350);
    const t2 = window.setTimeout(() => tryAttach(0), 800);
    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loadingState, activeSidebar, attachDocListeners]);

  const drawAnnotationsOnCurrentSection = useCallback(() => {
    if (!viewRef.current) return;
    const currentSectionNotes = notesRef.current.filter(n => n.cfi && n.style);
    currentSectionNotes.forEach(n => {
      try {
        viewRef.current?.deleteAnnotation({ value: n.cfi });
        viewRef.current?.deleteAnnotation({ value: `foliate-note:${n.cfi}` });
        viewRef.current?.addAnnotation({
          value: n.type === "note" ? `foliate-note:${n.cfi}` : n.cfi,
          style: n.style,
          color: n.color,
          note: n.note,
          userId: n.userId
        });
      } catch (err) {
        console.warn("渲染划线失败:", err);
      }
    });
  }, []);

  useEffect(() => {
    if (loadingState === "ready") {
      drawAnnotationsOnCurrentSection();
    }
  }, [notes, loadingState, drawAnnotationsOnCurrentSection]);

  // Section loaded (fires for BOTH primary and adjacent pre-loaded sections)
  // Do NOT update currentSectionIndexRef here - only relocate gives the truly visible index
  const handleSectionLoad = (e: any) => {
    const { doc, index } = e.detail;
    if (!doc) return;

    applyReaderStyles();
    drawAnnotationsOnCurrentSection();

    // Check if TTS should auto-start on this section
    const ttsAutoStart = localStorage.getItem("super-tts-auto-start") === "true";
    if (ttsAutoStart) {
      localStorage.removeItem("super-tts-auto-start");
      
      // Extract text paragraphs from this new document
      setTimeout(() => {
        const elements = Array.from(doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6"))
          .filter((el: any) => {
            const className = el.className || "";
            const id = el.id || "";
            const tagName = el.tagName.toLowerCase();
            if (tagName === "aside") return false;
            if (className.includes("footnote") || className.includes("annotation") || className.includes("comment")) return false;
            if (id.includes("footnote") || id.includes("annotation") || id.includes("comment")) return false;
            return true;
          })
          .map((el: any) => ({
            el,
            text: getCleanText(el)
          }))
          .filter(item => hasReadableContent(item.text));

        if (elements.length > 0) {
          setTtsParagraphs(elements);
          setTtsShowPlayer(true);
          playParagraph(elements, 0);
        } else {
          // If this section has no text, try the next one!
          handleNextSectionTts();
        }
      }, 300);
    }

    // Touch swipe gestures for mobile page flipping
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    doc.addEventListener("touchstart", (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    }, { passive: true });

    doc.addEventListener("touchend", (e: TouchEvent) => {
      if (e.changedTouches.length === 1) {
        const deltaX = e.changedTouches[0].clientX - touchStartX;
        const deltaY = e.changedTouches[0].clientY - touchStartY;
        const timeDiff = Date.now() - touchStartTime;

        if (Math.abs(deltaX) > 40 && Math.abs(deltaY) < 80 && timeDiff < 300) {
          if (deltaX > 0) {
            viewRef.current?.prev();
          } else {
            viewRef.current?.next();
          }
          return;
        }
      }
    });

    // 章节切换后重绑（含 touch / 选区菜单）
    attachDocListeners();
  };

  const handleCreateOverlay = (e: any) => {
    const { index } = e.detail;
    console.log("[BookReader debug] create-overlay event fired for index:", index);
    drawAnnotationsOnCurrentSection();
  };

  // Relocate event (page/scroll navigation change)
  // detail.index is the actually-visible section index from #getVisibleRange()
  const handleRelocate = (e: any) => {
    const detail = e.detail;
    if (!detail) return;

    // Update the current section index from the relocate event - this is the
    // ONLY reliable source of the truly-visible section (unlike load events which
    // also fire for adjacent pre-loaded sections)
    if (detail.index !== undefined) {
      currentSectionIndexRef.current = detail.index;
    }

    const cfi = detail.cfi;
    const progressPercent = Math.round(detail.fraction * 100);
    setCurrentCfi(cfi);
    setReadingProgressText(`${progressPercent}%`);

    if (detail.location) {
      setCurrentPage((detail.location.current ?? 0) + 1);
      setTotalPages(detail.location.total ?? 1);
    }

    // Get chapter title
    if (detail.tocItem) {
      setChapterTitle(detail.tocItem.label || "");
    } else {
      setChapterTitle("");
    }

    // Auto-save progress configuration to backend (debounced / on relocate)
    api.books.saveConfig(bookHash, {
      location: cfi,
      progress: `${progressPercent}%`,
    }).catch(err => console.warn("保存进度失败:", err));

    // Cache config locally
    getBookConfig(bookHash).then(existing => {
      const nextConfig = {
        userId: localStorage.getItem("super-self-userid") || "",
        bookHash,
        location: cfi,
        progress: `${progressPercent}%`,
        viewSettings: existing?.viewSettings || JSON.stringify(DEFAULT_SETTINGS),
        xpointer: existing?.xpointer || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      putBookConfig(nextConfig);
    }).catch(() => {});
  };

  // Highlighting annotation clicked
  const handleAnnotationClick = (e: any) => {
    const detail = e.detail;
    console.log("[BookReader debug] handleAnnotationClick triggered with detail:", detail);
    if (!detail) return;

    // Find the note
    const matchedNote = notesRef.current.find(n => n.cfi === detail.value || `foliate-note:${n.cfi}` === detail.value);
    if (!matchedNote) return;

    if (matchedNote.note) {
      // If it contains a thought, open the Thoughts List modal!
      setActiveThoughtsCfi(matchedNote.cfi);
    } else {
      // Otherwise, open the default highlight inspector
      const rect = detail.rect;
      const iframeRect = getIframeRect();
      setInspectingNote(matchedNote);
      setNoteEditText(matchedNote.note || "");
      const isNearTop = iframeRect.top + rect.top < 220;
      setInspectingCoords({
        x: iframeRect.left + rect.left + rect.width / 2,
        y: isNearTop ? (iframeRect.top + rect.bottom + 8) : (iframeRect.top + rect.top - 8),
        position: isNearTop ? "bottom" : "top"
      });
    }
  };

  // Keep listener refs up to date on each render
  handleSectionLoadRef.current = handleSectionLoad;
  handleCreateOverlayRef.current = handleCreateOverlay;
  handleRelocateRef.current = handleRelocate;
  handleAnnotationClickRef.current = handleAnnotationClick;

  const applyReaderStyles = (customSettings?: any) => {
    if (!viewRef.current || !viewRef.current.renderer) return;

    const currentSettings = customSettings || settingsRef.current;
    const theme = themeDefOf(currentSettings.theme);
    
    const paragraphMargin = currentSettings.usePublisherStyles ? "" : `margin-bottom: ${currentSettings.paragraphSpacing ?? 1.0}em !important;`;
    const textIndent = currentSettings.usePublisherStyles ? "" : `text-indent: ${currentSettings.firstLineIndent ?? 2.0}em !important;`;
    const textAlign = currentSettings.usePublisherStyles ? "" : `text-align: ${currentSettings.justifyText ? "justify" : "left"} !important;`;
    const wordSpacing = currentSettings.usePublisherStyles ? "" : `word-spacing: ${currentSettings.wordSpacing ?? 0}em !important;`;
    const letterSpacing = currentSettings.usePublisherStyles ? "" : `letter-spacing: ${currentSettings.letterSpacing ?? 0}px !important;`;
    const hyphenation = currentSettings.usePublisherStyles ? "" : `
      hyphens: ${currentSettings.hyphenation ? "auto" : "none"} !important;
      -webkit-hyphens: ${currentSettings.hyphenation ? "auto" : "none"} !important;
    `;

    // Build injected stylesheet
    const css = `
      @import url('/fonts/lxgw/style.css');
      html {
        --serif: "Georgia", serif;
        --sans-serif: "Inter", "Helvetica Neue", system-ui, sans-serif;
        --monospace: "Fira Code", "Courier New", monospace;
        --lxgw: "LXGW WenKai Screen", sans-serif;
        --theme-bg-color: ${theme.bg};
        --theme-fg-color: ${theme.fg};
        --override-color: true;
        color-scheme: ${theme.isDark ? "dark" : "light"};
      }
      body {
        background-color: var(--theme-bg-color) !important;
        color: var(--theme-fg-color) !important;
        font-family: ${currentSettings.fontFamily === "serif" ? "var(--serif)" : currentSettings.fontFamily === "monospace" ? "var(--monospace)" : currentSettings.fontFamily === "lxgw" ? "var(--lxgw)" : "var(--sans-serif)"} !important;
        font-size: ${currentSettings.fontSize}px !important;
        line-height: ${currentSettings.lineHeight} !important;
        ${wordSpacing}
        ${letterSpacing}
        ${hyphenation}
      }
      p {
        ${paragraphMargin}
        ${textIndent}
        ${textAlign}
      }
      img {
        max-width: 100% !important;
        height: auto !important;
      }
      a {
        color: var(--theme-primary-color, #3b82f6) !important;
        text-decoration: underline !important;
      }
      body.hover-thought, body.hover-thought * {
        cursor: pointer !important;
      }
    `;

    viewRef.current.renderer.setStyles?.(css);

    // Apply attributes on renderer
    const renderer = viewRef.current.renderer;
    if (currentSettings.layoutMode === "paginated") {
      renderer.removeAttribute("flow");
      if (currentSettings.columns > 0) {
        renderer.setAttribute("max-column-count", currentSettings.columns);
      } else {
        renderer.removeAttribute("max-column-count");
      }
    } else {
      renderer.setAttribute("flow", "scrolled");
      renderer.removeAttribute("max-column-count");
    }

    const isMobile = window.innerWidth < 768;
    const defMarginTop = isMobile ? 64 : 120;
    const defMarginBottom = isMobile ? 64 : 120;
    const defMarginLeft = isMobile ? 20 : 40;
    const defMarginRight = isMobile ? 20 : 40;

    renderer.setAttribute("margin-top", `${currentSettings.marginTop ?? defMarginTop}px`);
    renderer.setAttribute("margin-bottom", `${currentSettings.marginBottom ?? defMarginBottom}px`);
    renderer.setAttribute("margin-left", `${currentSettings.marginLeft ?? defMarginLeft}px`);
    renderer.setAttribute("margin-right", `${currentSettings.marginRight ?? defMarginRight}px`);
    renderer.setAttribute("gap", `${currentSettings.columnGap ?? 5}px`);
    renderer.setAttribute("max-inline-size", `${currentSettings.maxColumnWidth ?? 1200}px`);
    renderer.setAttribute("max-block-size", `${currentSettings.maxColumnHeight ?? 1200}px`);
  };
  applyReaderStylesRef.current = applyReaderStyles;

  const updateSetting = (key: string, value: any) => {
    const nextSettings = { ...settings, [key]: value };
    setSettings(nextSettings);
    settingsRef.current = nextSettings;
    
    // Save to backend
    api.books.saveConfig(bookHash, {
      viewSettings: JSON.stringify(nextSettings)
    }).catch(err => console.warn("保存设置失败:", err));

    // Force re-apply styles immediately using the updated settings
    applyReaderStyles(nextSettings);
    viewRef.current?.renderer?.relayout?.();
    if (key === "theme") {
      const td = themeDefOf(String(value));
      applyNativeStatusBar({
        isDarkSurface: td.isDark,
        backgroundColor: td.bg,
      });
    }

    // Cache settings locally
    getBookConfig(bookHash).then(existing => {
      const nextConfig = {
        userId: localStorage.getItem("super-self-userid") || "",
        bookHash,
        location: existing?.location || null,
        progress: existing?.progress || "0%",
        viewSettings: JSON.stringify(nextSettings),
        xpointer: existing?.xpointer || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      putBookConfig(nextConfig);
    }).catch(() => {});
  };

  const renderStepperSetting = (
    label: string, 
    settingKey: string, 
    min: number, 
    max: number, 
    step: number, 
    isFloat = false
  ) => {
    const val = (settings as any)[settingKey] ?? 0;
    
    const handleDecrease = () => {
      const next = isFloat ? +(val - step).toFixed(2) : val - step;
      updateSetting(settingKey, Math.max(min, next));
    };
    
    const handleIncrease = () => {
      const next = isFloat ? +(val + step).toFixed(2) : val + step;
      updateSetting(settingKey, Math.min(max, next));
    };

    const themeNow = THEMES[settings.theme as keyof typeof THEMES] || THEMES.sepia;
    return (
      <div
        className="flex justify-between items-center text-xs py-2 border-b"
        style={{ borderColor: `${themeNow.fg}18`, color: themeNow.fg }}
      >
        <span className="font-medium opacity-90">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-semibold w-10 text-right tabular-nums mr-1">{val}</span>
          <button
            onClick={handleDecrease}
            disabled={val <= min}
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm disabled:opacity-40 select-none"
            style={{
              border: `1px solid ${themeNow.fg}40`,
              backgroundColor: `${themeNow.fg}10`,
              color: themeNow.fg,
            }}
          >
            －
          </button>
          <button
            onClick={handleIncrease}
            disabled={val >= max}
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm disabled:opacity-40 select-none"
            style={{
              border: `1px solid ${themeNow.fg}40`,
              backgroundColor: `${themeNow.fg}10`,
              color: themeNow.fg,
            }}
          >
            ＋
          </button>
        </div>
      </div>
    );
  };

  const renderToggleSetting = (label: string, settingKey: string) => {
    const val = !!(settings as any)[settingKey];
    const themeNow = THEMES[settings.theme as keyof typeof THEMES] || THEMES.sepia;
    return (
      <div
        className="flex justify-between items-center text-xs py-2 border-b"
        style={{ borderColor: `${themeNow.fg}18`, color: themeNow.fg }}
      >
        <span className="font-medium opacity-90">{label}</span>
        <button
          onClick={() => updateSetting(settingKey, !val)}
          className={`w-9 h-5 rounded-full transition-colors relative flex items-center p-0.5 select-none ${
            val ? "bg-accent-primary" : ""
          }`}
          style={!val ? { backgroundColor: `${themeNow.fg}33` } : undefined}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
              val ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
    );
  };

  const handleResetSettings = () => {
    const next = buildDefaultSettings();
    setSettings(next);
    api.books.saveConfig(bookHash, {
      viewSettings: JSON.stringify(next)
    }).catch(err => console.warn("重置设置失败:", err));
    applyReaderStyles(next);
    viewRef.current?.renderer?.relayout?.();

    // Cache settings locally
    getBookConfig(bookHash).then(existing => {
      const nextConfig = {
        userId: localStorage.getItem("super-self-userid") || "",
        bookHash,
        location: existing?.location || null,
        progress: existing?.progress || "0%",
        viewSettings: JSON.stringify(next),
        xpointer: existing?.xpointer || null,
        createdAt: existing?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      putBookConfig(nextConfig);
    }).catch(() => {});
  };

  // Add Annotation Highlight
  const handleAddHighlight = async (color: string, style: "solid" | "underline" | "squiggly") => {
    if (!selectionRange) return;
    try {
      const type = annotationNote.trim() ? "note" : "highlight";
      const newNote = await api.books.createNote(bookHash, {
        type,
        cfi: selectionRange.cfi,
        text: selectionRange.text,
        style,
        color,
        note: annotationNote.trim(),
        chapterTitle,
        progress: readingProgressText
      });

      // Update state without duplicates
      setNotes(prev => {
        const index = prev.findIndex(n => n.id === newNote.id || (n.cfi === newNote.cfi && n.userId === newNote.userId));
        if (index > -1) {
          const next = [...prev];
          next[index] = newNote;
          return next;
        }
        return [...prev, newNote];
      });

      // Remove old annotation overlay if exists
      viewRef.current?.deleteAnnotation({ value: newNote.cfi });
      viewRef.current?.deleteAnnotation({ value: `foliate-note:${newNote.cfi}` });

      // Render highlight in Foliate
      viewRef.current?.addAnnotation({
        value: type === "note" ? `foliate-note:${newNote.cfi}` : newNote.cfi,
        style,
        color,
        note: newNote.note,
        userId: newNote.userId
      });

      // Cache single note locally
      await putSingleBookNote(newNote);

      setShowSelectionPopup(false);
      setSelectionRange(null);
    } catch (err) {
      console.error("创建划线失败:", err);
      alert("划线保存失败");
    }
  };

  const handleSaveNoteComment = async () => {
    if (!inspectingNote) return;
    try {
      const updated = await api.books.updateNote(bookHash, inspectingNote.id, {
        note: noteEditText.trim()
      });

      // Update state
      setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, note: updated.note } : n));
      
      // Update Foliate overlay
      if (updated.cfi) {
        viewRef.current?.deleteAnnotation({ value: updated.cfi });
        viewRef.current?.deleteAnnotation({ value: `foliate-note:${updated.cfi}` });
        
        const type = updated.note ? "note" : "highlight";
        viewRef.current?.addAnnotation({
          value: type === "note" ? `foliate-note:${updated.cfi}` : updated.cfi,
          style: updated.style as any,
          color: updated.color,
          note: updated.note,
          userId: updated.userId
        });
      }

      // Close inspector and show success toast
      setInspectingNote(null);
      toast.success("保存成功");
      
      // Cache single note locally
      await putSingleBookNote(updated);
    } catch (err) {
      console.error("更新批注失败:", err);
      toast.error("保存失败");
    }
  };

  const handleUpdateNoteInline = async (noteId: string) => {
    if (!editingNoteText.trim()) {
      toast.error("想法内容不能为空");
      return;
    }
    try {
      const updated = await api.books.updateNote(bookHash, noteId, {
        note: editingNoteText.trim()
      });

      // Update state
      setNotes(prev => prev.map(n => n.id === updated.id ? { ...n, note: updated.note } : n));
      
      // Update Foliate overlay
      if (updated.cfi) {
        viewRef.current?.deleteAnnotation({ value: updated.cfi });
        viewRef.current?.deleteAnnotation({ value: `foliate-note:${updated.cfi}` });
        
        const type = updated.note ? "note" : "highlight";
        viewRef.current?.addAnnotation({
          value: type === "note" ? `foliate-note:${updated.cfi}` : updated.cfi,
          style: updated.style as any,
          color: updated.color,
          note: updated.note,
          userId: updated.userId
        });
      }

      // Cache single note locally
      await putSingleBookNote(updated);
      
      // Close editing mode
      setEditingNoteId(null);
      setEditingNoteText("");
      toast.success("修改成功");
    } catch (err) {
      console.error("更新想法失败:", err);
      toast.error("修改失败");
    }
  };

  // Load comments when inspecting a note
  useEffect(() => {
    if (!inspectingNote) {
      setComments([]);
      setCommentText("");
      return;
    }

    let active = true;
    const fetchComments = async () => {
      setLoadingComments(true);
      try {
        const data = await api.books.getNoteComments(bookHash, inspectingNote.id);
        if (active) {
          setComments(data);
        }
      } catch (err) {
        console.error("加载评论失败:", err);
      } finally {
        if (active) {
          setLoadingComments(false);
        }
      }
    };

    fetchComments();
    return () => {
      active = false;
    };
  }, [inspectingNote?.id, bookHash]);

  // Add comment / reply
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectingNote || !commentText.trim() || postingComment) return;

    setPostingComment(true);
    try {
      const newComment = await api.books.addNoteComment(bookHash, inspectingNote.id, commentText.trim());
      setComments(prev => [...prev, newComment]);
      setCommentText("");
      toast.success("回复成功");
    } catch (err) {
      console.error("发表回复失败:", err);
      toast.error("回复失败");
    } finally {
      setPostingComment(false);
    }
  };

  const handleDeleteHighlight = async (noteId: string) => {
    if (!confirm("确定要删除这条划线吗？")) return;

    // Close modals immediately to prevent race conditions from confirm dialog click propagation
    setInspectingNote(null);
    setActiveThoughtsCfi(null);

    const noteToDelete = notes.find(n => n.id === noteId);

    // Optimistic UI updates
    setNotes(prev => prev.filter(n => n.id !== noteId));
    if (noteToDelete) {
      // Remove from Foliate
      if (noteToDelete.cfi) {
        viewRef.current?.addAnnotation({
          value: noteToDelete.cfi,
        }, true);
        viewRef.current?.addAnnotation({
          value: `foliate-note:${noteToDelete.cfi}`,
        }, true);
      }
      await deleteBookNote(noteId).catch(() => {});
    }

    try {
      await api.books.deleteNote(bookHash, noteId);
      toast.success("删除成功");
    } catch (err) {
      console.error("删除划线失败:", err);
      toast.error("删除失败，你只能删除自己创建的划线。");
      // Rollback on error
      if (noteToDelete) {
        setNotes(prev => [...prev, noteToDelete]);
        if (noteToDelete.cfi) {
          viewRef.current?.addAnnotation({
            value: noteToDelete.type === "note" ? `foliate-note:${noteToDelete.cfi}` : noteToDelete.cfi,
            style: noteToDelete.style as any,
            color: noteToDelete.color,
            note: noteToDelete.note,
            userId: noteToDelete.userId
          });
        }
        await putSingleBookNote(noteToDelete).catch(() => {});
      }
    }
  };

  const handleCopyTextFromSelection = () => {
    if (!selectionRange) return;
    navigator.clipboard.writeText(selectionRange.text);
    toast.success("已复制到剪贴板");
    setShowSelectionPopup(false);
    setSelectionRange(null);
  };

  const handleOpenWriteThoughts = () => {
    if (!selectionRange) return;
    setThoughtText("");
    setThoughtVisibility("public");
    setShowWriteThoughtsModal(true);
    setShowSelectionPopup(false);
  };

  const handleDeleteHighlightFromSelection = async (noteId: string) => {
    try {
      await api.books.deleteNote(bookHash, noteId);
      const noteToDelete = notes.find(n => n.id === noteId);
      if (noteToDelete) {
        viewRef.current?.addAnnotation({
          value: noteToDelete.type === "note" ? `foliate-note:${noteToDelete.cfi}` : noteToDelete.cfi,
        }, true);
      }
      setNotes(prev => prev.filter(n => n.id !== noteId));
      setShowSelectionPopup(false);
      setSelectionRange(null);
      await deleteBookNote(noteId);
      toast.success("删除成功");
    } catch (err) {
      console.error("删除划线失败:", err);
      toast.error("删除失败");
    }
  };

  const handleSaveThought = async () => {
    if (!selectionRange) return;
    try {
      const type = "note";
      const style = lastColorStyle;
      const color = lastColor;
      const noteText = thoughtText.trim();
      
      const newNote = await api.books.createNote(bookHash, {
        type,
        cfi: selectionRange.cfi,
        text: selectionRange.text,
        style,
        color,
        note: noteText,
        visibility: thoughtVisibility,
        chapterTitle,
        progress: readingProgressText
      });

      setNotes(prev => {
        const index = prev.findIndex(n => n.id === newNote.id || (n.cfi === newNote.cfi && n.userId === newNote.userId));
        if (index > -1) {
          const next = [...prev];
          next[index] = newNote;
          return next;
        }
        return [...prev, newNote];
      });

      viewRef.current?.deleteAnnotation({ value: newNote.cfi });
      viewRef.current?.deleteAnnotation({ value: `foliate-note:${newNote.cfi}` });

      viewRef.current?.addAnnotation({
        value: `foliate-note:${newNote.cfi}`,
        style,
        color,
        note: newNote.note,
        userId: newNote.userId
      });

      await putSingleBookNote(newNote);

      setShowWriteThoughtsModal(false);
      setThoughtText("");
      setShowSelectionPopup(false);
      setSelectionRange(null);
      toast.success("想法已保存");
    } catch (err) {
      console.error("创建想法失败:", err);
      toast.error("保存想法失败");
    }
  };

  // Thoughts List comments and likes helpers
  const toggleLike = (noteId: string) => {
    setLikesState(prev => {
      const cur = prev[noteId] || { count: 0, liked: false };
      const nextLiked = !cur.liked;
      return {
        ...prev,
        [noteId]: {
          count: nextLiked ? cur.count + 1 : Math.max(0, cur.count - 1),
          liked: nextLiked
        }
      };
    });
  };

  const fetchNoteComments = async (noteId: string) => {
    try {
      const list = await api.books.getNoteComments(bookHash, noteId);
      setCommentsMap(prev => ({ ...prev, [noteId]: list }));
    } catch (err) {
      console.warn("获取评论失败:", err);
    }
  };

  const handleAddThoughtComment = async (noteId: string) => {
    const content = newCommentText.trim();
    if (!content) return;
    try {
      await api.books.addNoteComment(bookHash, noteId, content);
      setNewCommentText("");
      setActiveCommentNoteId(null);
      await fetchNoteComments(noteId);
      toast.success("评论成功");
    } catch (err) {
      console.error("发表评论失败:", err);
      toast.error("发表评论失败");
    }
  };

  useEffect(() => {
    if (activeThoughtsCfi) {
      const cfiNotes = notes.filter(n => n.cfi === activeThoughtsCfi && n.note);
      cfiNotes.forEach(n => {
        fetchNoteComments(n.id);
      });
    }
  }, [activeThoughtsCfi, notes]);

  useEffect(() => {
    if (activeSidebar === "notes") {
      setNotesPage(1);
    }
  }, [activeSidebar]);

  // Full-text search inside Book
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim() || !viewRef.current) return;
    
    setIsSearching(true);
    setSearchResults([]);

    try {
      const results: any[] = [];
      // Foliate view search returns async generator
      for await (const result of viewRef.current.search({ query: searchQuery.trim() })) {
        if (result.subitems) {
          results.push(...result.subitems);
          setSearchResults([...results]);
        } else if (result.cfi) {
          results.push(result);
          setSearchResults([...results]);
        }
      }
    } catch (err) {
      console.error("内容检索失败:", err);
    } finally {
      setIsSearching(false);
    }
  };

  // Speech (TTS) — Note: speechSynthesis.pause() is broken in Chrome, so we
  // implement pause by cancelling the utterance and remembering the paragraph index.
  const handleToggleTts = () => {
    if (ttsState === "playing") {
      // Manual pause: cancel synthesis and remember where we stopped
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      ttsPausedAtIndexRef.current = ttsParagraphIndex;
      ttsPausedListRef.current = ttsParagraphs;
      setTtsState("paused");
      updateMediaSession("paused", ttsParagraphIndex, ttsParagraphs);
    } else if (ttsState === "paused") {
      // Resume: replay from the saved paragraph index
      const resumeIndex = ttsPausedAtIndexRef.current >= 0 ? ttsPausedAtIndexRef.current : 0;
      const resumeList = ttsPausedListRef.current.length > 0 ? ttsPausedListRef.current : ttsParagraphs;
      setTtsState("playing");
      updateMediaSession("playing", resumeIndex, resumeList);
      playParagraph(resumeList, resumeIndex);
    } else {
      startTts();
    }
  };

  const getCleanText = (el: HTMLElement): string => {
    const clone = el.cloneNode(true) as HTMLElement;
    const selectorsToRemove = [
      "sup", "sub", "img", "image", "svg", 
      "a.footnote", "a.fn", "a.note", 
      ".footnote", ".footnotes", "aside", 
      "script", "style", "iframe"
    ];
    selectorsToRemove.forEach(selector => {
      clone.querySelectorAll(selector).forEach(node => node.remove());
    });
    let text = clone.innerText || clone.textContent || "";
    text = text.replace(/\[\d+\]/g, "");
    text = text.replace(/\(\d+\)/g, "");
    text = text.replace(/\[注\]/g, "");
    return text.trim();
  };

  const hasReadableContent = (text: string): boolean => {
    return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(text);
  };

  const handleNextSectionTts = async () => {
    const view = viewRef.current;
    if (!view) {
      handleStopTts();
      return;
    }

    const currentIndex = currentSectionIndexRef.current;
    const totalSections = view.book?.sections?.length || 0;
    if (currentIndex + 1 < totalSections) {
      console.log("[TTS debug] Moving to next section:", currentIndex + 1);
      
      // Clear current paragraph highlights before changing sections
      ttsParagraphs.forEach(item => {
        try {
          item.el.style.backgroundColor = "";
          item.el.style.borderRadius = "";
          item.el.style.padding = "";
        } catch {}
      });

      localStorage.setItem("super-tts-auto-start", "true");
      await view.goTo(currentIndex + 1);
    } else {
      console.log("[TTS debug] End of book reached.");
      handleStopTts();
    }
  };

  // Voice profile: pitch + rate multiplier to simulate different voice types.
  // On macOS/Chrome, only one Chinese voice (Tingting, female) is typically exposed,
  // so we use pitch to create audible character differences that always work.
  const getVoiceProfile = (voiceType: 'male' | 'female' | 'child'): {
    voice: SpeechSynthesisVoice | null;
    pitch: number;
    rateMultiplier: number;
  } => {
    const voices = (typeof window !== "undefined" && window.speechSynthesis) ? window.speechSynthesis.getVoices() : [];
    const zhVoices = voices.filter(v => v.lang.startsWith('zh') || v.lang.startsWith('cmn'));
    const allVoices = zhVoices.length > 0 ? zhVoices : voices;

    // Keyword lists for each type (Windows / Edge TTS names)
    const malePhrases   = ['male', 'man', 'Kangkang', '大山', 'Yunyang', '云扬', 'Yunxi', '云希', 'Daniel', 'Lekinho', 'Reed'];
    const femalePhrases = ['female', 'woman', 'Xiaoxiao', '晓晓', 'Xiaoyi', '晓伊', 'Huihui', '慧慧', 'Tingting', '婷婷', 'Meijia', 'Sinji'];
    const childPhrases  = ['child', 'kid', 'Yaoyao', '姚姚', 'junior', 'young', 'Xiaobei'];

    const phrasesMap = { male: malePhrases, female: femalePhrases, child: childPhrases };
    const phrases = phrasesMap[voiceType];

    // Try to find a dedicated voice for this type
    const scored = allVoices.map(v => ({
      v,
      score: phrases.reduce((s, p) => v.name.toLowerCase().includes(p.toLowerCase()) ? s + 1 : s, 0),
    }));
    scored.sort((a, b) => b.score - a.score);
    const bestVoice = scored[0]?.score > 0 ? scored[0].v : (allVoices[0] || null);

    // Always apply pitch + rate to create a distinct sound character,
    // even when only one voice is available (common on macOS).
    // pitch range: 0 (lowest) – 2 (highest), default = 1
    const profiles = {
      male:   { pitch: 0.55, rateMultiplier: 0.92 },  // deep, slightly slower
      female: { pitch: 1.05, rateMultiplier: 1.0  },  // natural
      child:  { pitch: 1.75, rateMultiplier: 1.08 },  // high, slightly faster
    };

    return { voice: bestVoice, ...profiles[voiceType] };
  };

  const playParagraph = (paragraphsList: any[], index: number) => {
    if (index < 0 || index >= paragraphsList.length) {
      handleNextSectionTts();
      return;
    }

    // Always read from refs to avoid stale closures
    const currentVolume = ttsVolumeRef.current;
    const currentRate   = ttsRateRef.current;
    const currentVoiceType = ttsVoiceTypeRef.current;

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setTtsParagraphIndex(index);
    setTtsState("playing");
    updateMediaSession("playing", index, paragraphsList);

    // Clear previous paragraph highlights
    paragraphsList.forEach(item => {
      try {
        item.el.style.backgroundColor = "";
        item.el.style.borderRadius = "";
        item.el.style.padding = "";
      } catch {}
    });

    // Apply highlight to active paragraph
    const current = paragraphsList[index];
    if (current?.el) {
      current.el.style.backgroundColor = "rgba(0, 0, 0, 0.08)";
      current.el.style.borderRadius = "4px";
      current.el.style.padding = "2px 4px";
      current.el.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    const utterance = new SpeechSynthesisUtterance(current.text);
    utterance.lang = "zh-CN";
    utterance.volume = currentVolume;

    // Apply voice profile (voice object + pitch + rate multiplier)
    const { voice, pitch, rateMultiplier } = getVoiceProfile(currentVoiceType);
    if (voice) utterance.voice = voice;
    utterance.pitch = pitch;
    utterance.rate  = currentRate * rateMultiplier;

    utterance.onend = () => {
      const nextIndex = index + 1;
      setTtsParagraphIndex(nextIndex);
      playParagraph(paragraphsList, nextIndex);
    };
    utterance.onerror = (e) => {
      if ((e as any).error === 'interrupted') return; // cancelled intentionally
      console.error("TTS 播放出错:", e);
      setTimeout(() => {
        const nextIndex = index + 1;
        setTtsParagraphIndex(nextIndex);
        playParagraph(paragraphsList, nextIndex);
      }, 500);
    };

    ttsUtteranceRef.current = utterance;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleVolumeChange = (v: number) => {
    setTtsVolume(v);
    ttsVolumeRef.current = v;  // update ref immediately for stale closure safety
    // Immediately restart current utterance with new volume for instant effect
    if (ttsState === "playing" && ttsParagraphIndex >= 0 && ttsParagraphs.length > 0) {
      playParagraph(ttsParagraphs, ttsParagraphIndex);
    }
  };

  const startTts = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    // Extract text paragraphs from iframe body
    const iframe = getActiveIframe();
    const doc = iframe?.contentDocument;
    if (!doc) return;

    const elements = Array.from(doc.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6"))
      .filter((el: any) => {
        const className = el.className || "";
        const id = el.id || "";
        const tagName = el.tagName.toLowerCase();
        if (tagName === "aside") return false;
        if (className.includes("footnote") || className.includes("annotation") || className.includes("comment")) return false;
        if (id.includes("footnote") || id.includes("annotation") || id.includes("comment")) return false;
        return true;
      })
      .map((el: any) => ({
        el,
        text: getCleanText(el)
      }))
      .filter(item => hasReadableContent(item.text));

    if (elements.length === 0) {
      // If there are no text elements in this section, automatically try the next section!
      handleNextSectionTts();
      return;
    }

    setTtsParagraphs(elements);
    setTtsShowPlayer(true);
    // Ensure refs are up to date before first play
    ttsVolumeRef.current = ttsVolume;
    ttsRateRef.current = ttsRate;
    ttsVoiceTypeRef.current = ttsVoiceType;
    playParagraph(elements, 0);
  };

  const handleNextTts = () => {
    if (ttsParagraphs.length === 0 || ttsParagraphIndex === -1) return;
    const next = ttsParagraphIndex + 1;
    if (next < ttsParagraphs.length) {
      playParagraph(ttsParagraphs, next);
    } else {
      handleNextSectionTts();
    }
  };

  const handlePrevTts = () => {
    if (ttsParagraphs.length === 0 || ttsParagraphIndex === -1) return;
    const prev = Math.max(0, ttsParagraphIndex - 1);
    playParagraph(ttsParagraphs, prev);
  };

  const handleStopTts = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setTtsState("stopped");
    setTtsParagraphIndex(-1);
    setTtsShowPlayer(false);
    updateMediaSession("stopped");
    localStorage.removeItem("super-tts-auto-start");
    
    // Clear all paragraph highlights
    ttsParagraphs.forEach(item => {
      try {
        item.el.style.backgroundColor = "";
        item.el.style.borderRadius = "";
        item.el.style.padding = "";
      } catch {}
    });
  };

  // Sync background Media Session action controls to TTS synthesis
  const updateMediaSession = (state: "playing" | "paused" | "stopped", pIndex?: number, paragraphsList?: any[]) => {
    if (!('mediaSession' in navigator)) return;

    if (state === "stopped") {
      navigator.mediaSession.playbackState = "none";
      silentAudioRef.current?.pause();
      return;
    }

    const currentParagraph = paragraphsList && pIndex !== undefined ? paragraphsList[pIndex] : null;
    const desc = currentParagraph ? currentParagraph.text.slice(0, 40) + "..." : "";

    navigator.mediaSession.playbackState = state === "playing" ? "playing" : "paused";

    let coverUrl: string | null = null;
    if (book?.metadata) {
      try {
        const meta = JSON.parse(book.metadata);
        if (meta.coverAttachmentId) {
          coverUrl = resolveAttachmentUrl(`/api/attachments/${meta.coverAttachmentId}`);
        }
      } catch {}
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: book?.title || "电子书朗读",
      artist: chapterTitle || "super-note",
      album: desc || "正在语音朗读中...",
      artwork: coverUrl ? [
        { src: coverUrl, sizes: "256x256", type: "image/png" }
      ] : []
    });

    if (state === "playing") {
      silentAudioRef.current?.play().catch(err => console.log("Silent audio autoplay blocked or failed:", err));
    } else {
      silentAudioRef.current?.pause();
    }
  };

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler("play", () => {
      if (ttsState === "paused") {
        if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.resume();
        setTtsState("playing");
        updateMediaSession("playing", ttsParagraphIndex, ttsParagraphs);
      } else if (ttsState === "stopped") {
        startTts();
      }
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      if (ttsState === "playing") {
        if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.pause();
        setTtsState("paused");
        updateMediaSession("paused", ttsParagraphIndex, ttsParagraphs);
      }
    });

    navigator.mediaSession.setActionHandler("seekbackward", () => {
      handlePrevTts();
    });

    navigator.mediaSession.setActionHandler("seekforward", () => {
      handleNextTts();
    });

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);
      }
    };
  }, [ttsState, ttsParagraphIndex, ttsParagraphs, ttsRate, ttsVolume]);

  const getTtsRemainingTimeText = () => {
    if (ttsParagraphs.length === 0 || ttsParagraphIndex === -1) return "剩余 00:00";
    let remainingChars = 0;
    for (let i = ttsParagraphIndex; i < ttsParagraphs.length; i++) {
      remainingChars += ttsParagraphs[i].text.length;
    }
    const totalSeconds = Math.round(remainingChars / 5.5); // 5.5 characters per second
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `本章剩余 ${mins}:${String(secs).padStart(2, "0")}`;
  };

  const handleShareNoteToTalk = (note: BookNote) => {
    if (!book) return;
    setShareComment("");
    setShareConfig({
      show: true,
      title: "分享划线到“说说”",
      description: `📝 摘录原文：\n"${note.text}"`,
      placeholder: "写下你对这句段落的想法...",
      onConfirm: async (comment) => {
        try {
          // 1. If book is PRIVATE, change it to WORKSPACE visibility first
          if (book.visibility === "PRIVATE") {
            await api.books.update(bookHash, { visibility: "WORKSPACE" });
            setBook(prev => prev ? { ...prev, visibility: "WORKSPACE" } : null);
          }

          // 2. Post to diaries (说说)
          await api.postDiary({
            contentText: comment.trim(),
            bookHash,
            bookNoteId: note.id,
            visibility: "WORKSPACE"
          }, workspaceId || undefined);

          toast.success("成功分享至“说说”！");
        } catch (err) {
          console.error("分享说说失败:", err);
          toast.error("分享失败: " + (err as Error).message);
          throw err;
        }
      }
    });
  };

  const handleShareBookToTalk = () => {
    if (!book) return;
    setShareComment("");
    setShareConfig({
      show: true,
      title: "推荐整本图书到“说说”",
      description: `📖 您正在向工作区成员分享书籍《${book.title}》/ ${book.author || "未知作者"}。`,
      placeholder: "写下你对本书的推荐语或想法...",
      onConfirm: async (comment) => {
        try {
          // 1. Ensure book is shared in workspace
          if (book.visibility === "PRIVATE") {
            await api.books.update(bookHash, { visibility: "WORKSPACE" });
            setBook(prev => prev ? { ...prev, visibility: "WORKSPACE" } : null);
          }

          // 2. Post diary
          await api.postDiary({
            contentText: comment.trim(),
            bookHash,
            visibility: "WORKSPACE"
          }, workspaceId || undefined);

          toast.success("书籍分享成功！");
        } catch (err) {
          console.error("分享书籍失败:", err);
          toast.error("分享失败: " + (err as Error).message);
          throw err;
        }
      }
    });
  };

  // Export Notes to Markdown
  const handleExportNotes = () => {
    const myUserId = localStorage.getItem('super-self-userid');
    const filteredNotesToExport = noteFilter === 'mine' ? notes.filter(n => n.userId === myUserId || !n.userId) : notes;
    if (filteredNotesToExport.length === 0) {
      alert("暂无读书笔记可导出");
      return;
    }
    const header = `# 读书笔记: 《${book?.title}》\n作者: ${book?.author || "未知作者"}\n导出日期: ${new Date().toLocaleDateString()}\n\n---\n\n`;
    const content = filteredNotesToExport.map((n, i) => {
      const date = new Date(n.createdAt).toLocaleString();
      const chapterInfo = n.chapterTitle ? `\n- **章节**: ${n.chapterTitle}` : '';
      const progressInfo = n.progress ? `\n- **进度/页码**: ${n.progress}` : '';
      return `### 标注 ${i + 1}${chapterInfo}${progressInfo}\n- **原文**: ${n.text}\n- **批注**: ${n.note || "（无批注）"}\n- **日期**: ${date}\n\n`;
    }).join("");

    const blob = new Blob([header + content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book?.title}_读书笔记.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render outline items recursively
  const renderTocItem = (item: TOCItem, depth = 0) => {
    return (
      <div key={item.id} className="space-y-1">
        <button
          onClick={() => {
            viewRef.current?.goTo(item.href);
            // Auto close sidebar on mobile
            if (window.innerWidth < 640) setActiveSidebar(null);
          }}
          className="w-full text-left py-1.5 px-3 hover:bg-app-surface hover:text-accent-primary text-xs rounded transition-all truncate block"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          title={item.label}
        >
          {item.label}
        </button>
        {item.subitems && item.subitems.map(sub => renderTocItem(sub, depth + 1))}
      </div>
    );
  };

  // Layout Themes Palette Colors（与 App 明暗绑定后的阅读主题）
  const theme = themeDefOf(settings.theme);

  let bookCoverUrl: string | null = null;
  if (book?.metadata) {
    try {
      const meta = JSON.parse(book.metadata);
      if (meta.coverAttachmentId) {
        bookCoverUrl = resolveAttachmentUrl(`/api/attachments/${meta.coverAttachmentId}`);
      }
    } catch {}
  }

  const notesPerPage = 5;
  const myUserId = localStorage.getItem('super-self-userid');
  const filteredNotesForDisplay = noteFilter === 'mine' ? notes.filter(n => n.userId === myUserId || !n.userId) : notes;
  const totalNotesPages = Math.ceil(filteredNotesForDisplay.length / notesPerPage);
  const displayedNotes = filteredNotesForDisplay.slice((notesPage - 1) * notesPerPage, notesPage * notesPerPage);

  return (
    <div
      className="fixed inset-0 z-50 select-none overflow-hidden"
      style={{ backgroundColor: theme.bg, color: theme.fg }}
      data-reader-theme={settings.theme}
      data-reader-dark={theme.isDark ? "1" : "0"}
    >
      
      {/* Main Body Layout */}
      <div className="w-full h-full flex relative overflow-hidden">
        {/* Sidebar Container：移动端全屏 fixed，桌面可拖宽度侧栏 */}
        {activeSidebar && activeSidebar !== "notes" && (
          <div 
            style={{
              width: window.innerWidth < 768 ? "100%" : `${sidebarWidth}px`,
              // 移动全屏侧栏含安全区；跟随阅读主题色
              paddingTop: "var(--safe-area-top, 0px)",
              paddingBottom: "var(--safe-area-bottom, 0px)",
              backgroundColor: theme.bg,
              color: theme.fg,
            }}
            className="max-md:fixed max-md:inset-0 w-full md:relative md:h-full border-r border-black/10 flex flex-col shrink-0 z-[60] md:z-20 animate-slide-in"
          >
            {/* Drag Resize Handle (hidden on mobile) */}
            {window.innerWidth >= 768 && (
              <div
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-accent-primary/50 active:bg-accent-primary transition-colors z-30"
                onMouseDown={handleSidebarDragInit}
              />
            )}
            {/* Sidebar header：大关闭钮，高对比 */}
            <div
              className="px-3 py-2.5 border-b flex items-center justify-between shrink-0 gap-2"
              style={{ borderColor: `${theme.fg}22` }}
            >
              <h3 className="text-sm font-bold tracking-wide min-w-0 truncate" style={{ color: theme.fg }}>
                {activeSidebar === "toc" && "书籍大纲"}
                {activeSidebar === "search" && "全文搜索"}
                {(activeSidebar as any) === "notes" && "读书笔记"}
                {activeSidebar === "settings" && "排版设置"}
              </h3>
              <button
                type="button"
                onClick={() => setActiveSidebar(null)}
                className="inline-flex items-center gap-1 min-w-[44px] min-h-[44px] px-2.5 rounded-xl font-semibold text-xs shrink-0 active:scale-95 transition-all"
                style={{
                  color: theme.fg,
                  backgroundColor: `${theme.fg}14`,
                  border: `1px solid ${theme.fg}33`,
                }}
                aria-label="关闭"
                title="关闭"
              >
                <X size={18} strokeWidth={2.25} />
                <span className="md:hidden">关闭</span>
              </button>
            </div>

            {/* Sidebar content panels（搜索自管滚动，其余整体滚动） */}
            <div
              className={cn(
                "flex-1 min-h-0 p-4 flex flex-col",
                activeSidebar === "search" ? "overflow-hidden" : "overflow-y-auto",
              )}
            >
              {/* 1. Outline TOC */}
              {activeSidebar === "toc" && (
                <div className="space-y-1">
                  {toc.map(item => renderTocItem(item))}
                  {toc.length === 0 && (
                    <div className="text-xs italic text-center py-8 opacity-60">
                      本书暂无目录大纲
                    </div>
                  )}
                </div>
              )}

              {/* 2. Full-Text Search inside Book */}
              {activeSidebar === "search" && (
                <div className="flex flex-col flex-1 min-h-0 gap-4">
                  <form onSubmit={handleSearch} className="flex gap-2 items-stretch shrink-0 w-full min-w-0">
                    <input
                      type="search"
                      enterKeyHint="search"
                      placeholder="搜索书内关键词..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 min-w-0 min-h-[44px] px-3 py-2 border rounded-xl text-sm focus:outline-none focus:border-accent-primary"
                      style={{
                        borderColor: `${theme.fg}28`,
                        backgroundColor: `${theme.fg}0a`,
                        color: theme.fg,
                      }}
                    />
                    <button
                      type="submit"
                      disabled={isSearching || !searchQuery.trim()}
                      className="min-h-[44px] min-w-[44px] px-3 sm:px-4 bg-accent-primary text-white text-sm font-semibold rounded-xl hover:bg-accent-primary/95 disabled:opacity-50 transition-all shrink-0 inline-flex items-center justify-center gap-1.5"
                      aria-label="搜索"
                    >
                      {isSearching ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Search size={16} />
                      )}
                      <span className="hidden sm:inline">搜索</span>
                    </button>
                  </form>

                  {/* Results */}
                  <div className="flex flex-col flex-1 min-h-0 gap-2">
                    <span
                      className="text-[10px] uppercase font-bold tracking-wider shrink-0 opacity-60"
                      style={{ color: theme.fg }}
                    >
                      搜索结果 ({searchResults.length})
                    </span>
                    {searchResults.length === 0 && !isSearching && (
                      <div className="text-sm opacity-50 italic text-center py-12" style={{ color: theme.fg }}>
                        {searchQuery.trim() ? "未找到匹配结果" : "输入关键词开始搜索"}
                      </div>
                    )}
                    {isSearching && (
                      <div className="flex items-center justify-center gap-2 py-12 opacity-60" style={{ color: theme.fg }}>
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm">搜索中…</span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto overscroll-contain pr-0.5 pb-2">
                      {searchResults.map((item, idx) => {
                        const excerptHtml = renderExcerpt(item.excerpt, searchQuery);
                        return (
                          <div
                            key={idx}
                            role="button"
                            tabIndex={0}
                            onClick={async () => {
                              try {
                                if (viewRef.current) {
                                  await viewRef.current.goTo(item.cfi);
                                  // Auto close sidebar on mobile
                                  if (window.innerWidth < 768) setActiveSidebar(null);
                                }
                              } catch (err) {
                                console.warn("跳转到搜索结果失败:", err);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                (e.currentTarget as HTMLElement).click();
                              }
                            }}
                            className="p-3.5 border rounded-xl cursor-pointer transition-all text-left flex flex-col gap-1.5 active:scale-[0.99]"
                            style={{
                              borderColor: `${theme.fg}18`,
                              backgroundColor: `${theme.fg}08`,
                              color: theme.fg,
                            }}
                          >
                            <div
                              className="text-sm leading-relaxed break-words opacity-90"
                              dangerouslySetInnerHTML={{ __html: excerptHtml }}
                            />
                            {item.sectionName && (
                              <span className="text-[11px] font-medium tracking-tight truncate self-start opacity-55">
                                📍 {item.sectionName}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Book Notes List */}
              {(activeSidebar as any) === "notes" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-tx-tertiary">
                      全书划线/笔记 ({notes.length})
                    </span>
                    {notes.length > 0 && (
                      <button
                        onClick={handleExportNotes}
                        className="px-2.5 py-1 text-[10px] font-bold border border-app-border text-tx-secondary rounded-lg hover:bg-app-surface transition-all flex items-center gap-1 shrink-0"
                      >
                        <Download size={10} />
                        <span>导出 Markdown</span>
                      </button>
                    )}
                  </div>
                  {notes.length === 0 && (
                    <div className="text-xs italic text-center py-8 opacity-60">
                      本书暂无划线或笔记，选中文字可添加划线
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    {notes.map((n) => (
                      <div
                        key={n.id}
                        onClick={async () => {
                          try {
                            if (viewRef.current) {
                              await viewRef.current.goTo(n.cfi);
                              // Auto close sidebar on mobile (and desktop for notes view)
                              setActiveSidebar(null);
                            }
                          } catch (err) {
                            console.warn("跳转笔记失败:", err);
                          }
                        }}
                        className="p-3 border border-app-border/50 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 rounded-xl cursor-pointer transition-all text-left flex flex-col gap-2"
                      >
                        <p className="text-xs italic font-serif leading-relaxed opacity-95 border-l-2 pl-2" style={{ borderColor: n.color }}>
                          "{n.text}"
                        </p>
                        {n.note && (
                          <div className="text-xs font-medium text-tx-secondary leading-relaxed bg-black/5 dark:bg-white/5 p-2 rounded-lg break-words">
                            💡 {n.note}
                          </div>
                        )}
                        <div className="flex justify-between items-center text-[8px] opacity-60 font-medium">
                          <span>👤 {n.username || "我的笔记"}</span>
                          <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 4. Reading settings panel —— 颜色跟随阅读主题 */}
              {activeSidebar === "settings" && (
                <div className="space-y-4 text-left pb-8" style={{ color: theme.fg }}>
                  {/* 排版设置 */}
                  <div className="space-y-3">
                    <h4 className="font-bold opacity-90">字体样式</h4>
                    
                    {/* Font family selection */}
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "serif", name: "宋体/Serif" },
                        { id: "sans-serif", name: "黑体/Sans" },
                        { id: "monospace", name: "等宽/Mono" },
                        { id: "lxgw", name: "霞鹜文楷" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => updateSetting("fontFamily", item.id)}
                          className="py-2 px-3 rounded-lg border text-xs font-semibold transition-all"
                          style={{
                            borderColor: settings.fontFamily === item.id ? "var(--color-accent-primary, #8b7cf6)" : `${theme.fg}33`,
                            backgroundColor: settings.fontFamily === item.id ? `${theme.fg}12` : "transparent",
                            color: theme.fg,
                          }}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>

                    <div className="space-y-1 mt-2">
                      {renderStepperSetting("字体大小", "fontSize", 12, 48, 1)}
                      {renderStepperSetting("行高比例", "lineHeight", 1.0, 3.0, 0.1)}
                    </div>
                  </div>

                  {/* 布局主题 */}
                  <div className="space-y-2 border-t pt-4" style={{ borderColor: `${theme.fg}22` }}>
                    <h4 className="font-bold opacity-90">阅读主题</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(THEMES).map(([key, value]) => (
                        <button
                          key={key}
                          onClick={() => updateSetting("theme", key)}
                          className="py-2 px-3 rounded-lg border flex items-center justify-between text-xs font-semibold transition-all"
                          style={{
                            backgroundColor: value.bg,
                            color: value.fg,
                            borderColor: settings.theme === key ? "var(--color-accent-primary, #8b7cf6)" : `${value.fg}33`,
                            boxShadow: settings.theme === key ? `0 0 0 1px var(--color-accent-primary, #8b7cf6)` : undefined,
                          }}
                        >
                          <span>{value.name}</span>
                          {settings.theme === key && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 分栏与布局 */}
                  <div className="space-y-2 border-t pt-4" style={{ borderColor: `${theme.fg}22` }}>
                    <h4 className="font-bold opacity-90">页面排版模式</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: "paginated", name: "左右翻页" },
                        { id: "scrolling", name: "竖向滚动" }
                      ].map((item) => (
                        <button
                          key={item.id}
                          onClick={() => updateSetting("layoutMode", item.id)}
                          className="py-2 px-3 rounded-lg border text-xs font-semibold transition-all"
                          style={{
                            borderColor: settings.layoutMode === item.id ? "var(--color-accent-primary, #8b7cf6)" : `${theme.fg}33`,
                            backgroundColor: settings.layoutMode === item.id ? `${theme.fg}12` : "transparent",
                            color: theme.fg,
                          }}
                        >
                          {item.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 详细版面规格调整 */}
                  <div className="space-y-2 border-t pt-4" style={{ borderColor: `${theme.fg}22` }}>
                    <h4 className="font-bold opacity-90">版面规格设置</h4>
                    <div className="space-y-1">
                      {renderStepperSetting("上边距", "marginTop", 0, 120, 2)}
                      {renderStepperSetting("下边距", "marginBottom", 0, 120, 2)}
                      {renderStepperSetting("左边距", "marginLeft", 0, 120, 2)}
                      {renderStepperSetting("右边距", "marginRight", 0, 120, 2)}
                      {renderStepperSetting("列间距", "columnGap", 0, 40, 1)}
                      {renderStepperSetting("分栏数", "columns", 0, 4, 1)}
                      {renderStepperSetting("最大列宽", "maxColumnWidth", 300, 1200, 20)}
                      {renderStepperSetting("最大列高", "maxColumnHeight", 400, 2400, 20)}
                    </div>
                  </div>

                  {/* 其他设置 */}
                  <div className="space-y-2 border-t pt-4" style={{ borderColor: `${theme.fg}22` }}>
                    <h4 className="font-bold opacity-90">其他设置</h4>
                    <div className="space-y-1">
                      {renderToggleSetting("显示当前时间", "showTimeDisplay")}
                    </div>
                  </div>

                  {/* TTS Speech Synthesis Settings */}
                  <div className="space-y-2 border-t pt-4" style={{ borderColor: `${theme.fg}22` }}>
                    <h4 className="font-bold opacity-90 flex items-center gap-1.5">
                      <Volume2 size={14} />
                      语音朗读速度
                    </h4>
                    <div className="flex gap-2 items-center">
                      <button
                        onClick={() => {
                          const rate = Math.max(0.6, +(ttsRate - 0.2).toFixed(1));
                          setTtsRate(rate);
                          ttsRateRef.current = rate;
                          if (ttsState === "playing") startTts();
                        }}
                        className="flex-1 py-2 rounded-lg border text-center text-xs font-semibold"
                        style={{ borderColor: `${theme.fg}33`, color: theme.fg }}
                      >
                        慢速
                      </button>
                      <span className="px-2 font-bold">{ttsRate}x</span>
                      <button
                        onClick={() => {
                          const rate = Math.min(3.0, +(ttsRate + 0.2).toFixed(1));
                          setTtsRate(rate);
                          ttsRateRef.current = rate;
                          if (ttsState === "playing") startTts();
                        }}
                        className="flex-1 py-2 rounded-lg border text-center text-xs font-semibold"
                        style={{ borderColor: `${theme.fg}33`, color: theme.fg }}
                      >
                        快速
                      </button>
                    </div>
                    {ttsState === "stopped" ? (
                      <button
                        onClick={handleToggleTts}
                        className="w-full mt-2 py-2 bg-accent-primary text-white rounded-lg font-semibold hover:bg-accent-primary/95 flex items-center justify-center gap-2"
                      >
                        <Play size={12} fill="currentColor" />
                        <span>开始语音朗读</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleToggleTts}
                        className="w-full mt-2 py-2 border border-accent-primary text-accent-primary bg-accent-primary/5 rounded-lg font-semibold hover:bg-accent-primary/10 flex items-center justify-center gap-2"
                      >
                        {ttsState === "playing" ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
                        <span>{ttsState === "playing" ? "暂停朗读" : "继续朗读"}</span>
                      </button>
                    )}
                  </div>

                  {/* Reset Settings */}
                  <button
                    onClick={handleResetSettings}
                    className="w-full mt-4 py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 font-semibold text-sm"
                    style={{
                      border: `1px solid ${theme.fg}33`,
                      color: theme.fg,
                      backgroundColor: `${theme.fg}08`,
                    }}
                  >
                    <RotateCcw size={12} />
                    <span>恢复默认排版设置</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reader Viewport area */}
        <div className="flex-1 h-full flex flex-col relative overflow-hidden">
          {/* Loading status screens */}
          {loadingState === "loading" && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4"
              style={{ backgroundColor: theme.bg, color: theme.fg }}
            >
              <Loader2 size={32} className="animate-spin text-accent-primary" />
              <div className="text-xs font-semibold" style={{ color: theme.fg }}>
                {loadingProgress}
              </div>
            </div>
          )}

          {loadingState === "rendering" && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4"
              style={{ backgroundColor: theme.bg, color: theme.fg }}
            >
              <Loader2 size={32} className="animate-spin text-accent-primary" />
              <div className="text-xs font-semibold" style={{ color: theme.fg }}>
                {loadingProgress}
              </div>
            </div>
          )}

          {loadingState === "error" && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 text-center p-6"
              style={{ backgroundColor: theme.bg, color: theme.fg }}
            >
              <VolumeX size={48} className="text-red-500" />
              <h3 className="text-sm font-bold" style={{ color: theme.fg }}>
                阅读器加载失败
              </h3>
              <p className="text-xs max-w-sm opacity-70" style={{ color: theme.fg }}>
                {errorMessage}
              </p>
              <button
                onClick={loadBookAndReader}
                className="mt-2 px-4 py-1.5 bg-accent-primary text-white rounded-lg text-xs font-semibold hover:bg-accent-primary/95"
              >
                重试加载
              </button>
            </div>
          )}

          {/* Foliate container */}
          <div ref={containerRef} className="w-full h-full relative overflow-hidden" />

          {/* Pagination Buttons for Reflowable/Paging books */}
          {loadingState === "ready" && settings.layoutMode === "paginated" && (
            <>
              {/* Bottom Left Page Flip Button */}
              <button
                onClick={() => viewRef.current?.prev()}
                className="absolute left-6 bottom-[49px] flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs z-30 transition-all active:scale-95 hidden md:flex"
                style={{
                  borderColor: `${theme.fg}40`,
                  color: theme.fg,
                  backgroundColor: `${theme.bg}a0`,
                  backdropFilter: "blur(4px)"
                }}
                title="上一页"
              >
                <ChevronLeft size={14} />
                <span>上一页</span>
              </button>

              {/* Bottom Right Page Flip Button */}
              <button
                onClick={() => viewRef.current?.next()}
                className="absolute right-6 bottom-[49px] flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs z-30 transition-all active:scale-95 hidden md:flex"
                style={{
                  borderColor: `${theme.fg}40`,
                  color: theme.fg,
                  backgroundColor: `${theme.bg}a0`,
                  backdropFilter: "blur(4px)"
                }}
                title="下一页"
              >
                <span>下一页</span>
                <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Top Header Bar Overlay
          移动：仅返回 + 标题（避免右侧按钮挤出屏幕）
          桌面：保留完整动作区 */}
      <div 
        className={cn(
          "absolute top-0 left-0 right-0 border-b border-app-border/40 px-3 md:px-4 flex items-center justify-between bg-app-surface/90 dark:bg-zinc-950/90 backdrop-blur-md transition-transform duration-300 z-20 shrink-0 select-none text-tx-primary cursor-pointer",
          isImmersive ? "-translate-y-full" : "translate-y-0"
        )}
        style={{
          height: "calc(56px + var(--safe-area-top, 0px))",
          paddingTop: "var(--safe-area-top, 0px)",
          color: theme.fg,
          backgroundColor: `${theme.bg}e6`,
        }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (!target.closest("button") && !target.closest("a") && !target.closest("input")) {
            setIsImmersive(true);
          }
        }}
      >
        <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
          <button
            onClick={onBack}
            className="p-2 -ml-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-inherit transition-all active:scale-95 shrink-0"
            aria-label="返回"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-xs font-bold truncate">
              {book?.title}
            </span>
            {chapterTitle && (
              <span className="text-[10px] opacity-75 truncate font-medium">
                {chapterTitle}
              </span>
            )}
          </div>
        </div>

        {/* 桌面端顶栏动作 */}
        <div className="hidden md:flex items-center gap-1 sm:gap-2 shrink-0">
          <button
            onClick={handleToggleFullscreen}
            className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all text-inherit"
            title={isFullscreen ? "退出全屏 (Esc)" : "全屏阅读"}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          {ttsState !== "stopped" && (
            <div className="flex items-center gap-1 bg-black/10 dark:bg-white/10 rounded-lg px-2 py-1 text-xs">
              <button onClick={handleStopTts} className="p-1 hover:text-red-500 rounded" title="停止播放">
                <Square size={12} fill="currentColor" />
              </button>
              <button onClick={handleToggleTts} className="p-1 hover:text-accent-primary rounded" title={ttsState === "playing" ? "暂停" : "继续播放"}>
                {ttsState === "playing" ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
              </button>
              <span className="text-[9px] opacity-75">{ttsRate}x</span>
            </div>
          )}
          <button
            onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "toc" ? null : "toc"); }}
            className={`p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all ${activeSidebar === "toc" ? "bg-black/10 dark:bg-white/10 text-accent-primary" : ""}`}
            title="大纲目录"
          >
            <List size={16} />
          </button>
          <button
            onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "search" ? null : "search"); }}
            className={`p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all ${activeSidebar === "search" ? "bg-black/10 dark:bg-white/10 text-accent-primary" : ""}`}
            title="全文搜索"
          >
            <Search size={16} />
          </button>
          <button
            onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "notes" ? null : "notes"); }}
            className={`p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all ${activeSidebar === "notes" ? "bg-black/10 dark:bg-white/10 text-accent-primary" : ""}`}
            title="读书笔记"
          >
            <MessageSquare size={16} />
          </button>
          <button
            onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "settings" ? null : "settings"); }}
            className={`p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all ${activeSidebar === "settings" ? "bg-black/10 dark:bg-white/10 text-accent-primary" : ""}`}
            title="字体排版设置"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={handleShareBookToTalk}
            className="p-2 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-all text-inherit"
            title="推荐分享本书到说说"
          >
            <Share2 size={16} />
          </button>
        </div>
      </div>

      {/* Bottom chrome：移动 = 动作栏 + 进度；桌面 = 仅进度 */}
      {loadingState === "ready" && (
        <div 
          className={cn(
            "absolute bottom-0 left-0 right-0 border-t border-app-border/30 bg-app-surface/90 dark:bg-zinc-950/90 backdrop-blur-md transition-transform duration-300 z-20 shrink-0 select-none text-tx-primary",
            isImmersive ? "translate-y-full" : "translate-y-0"
          )}
          style={{
            paddingBottom: "var(--safe-area-bottom, 0px)",
            color: theme.fg,
            backgroundColor: `${theme.bg}e6`,
          }}
        >
          {/* 移动端动作栏（原顶栏右侧按钮下沉） */}
          <div className="md:hidden flex items-center justify-around gap-0.5 px-1 pt-1.5 pb-0.5">
            <button
              type="button"
              onClick={() => viewRef.current?.prev()}
              className="flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10"
              title="上一页"
              aria-label="上一页"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "toc" ? null : "toc"); }}
              className={cn("flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10", activeSidebar === "toc" && "text-accent-primary")}
              title="大纲"
            >
              <List size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "search" ? null : "search"); }}
              className={cn("flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10", activeSidebar === "search" && "text-accent-primary")}
              title="搜索"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "notes" ? null : "notes"); }}
              className={cn("flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10", activeSidebar === "notes" && "text-accent-primary")}
              title="笔记"
            >
              <MessageSquare size={18} />
            </button>
            <button
              type="button"
              onClick={() => { setIsImmersive(false); setActiveSidebar(activeSidebar === "settings" ? null : "settings"); }}
              className={cn("flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10", activeSidebar === "settings" && "text-accent-primary")}
              title="设置"
              aria-label="排版设置"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              onClick={handleShareBookToTalk}
              className="flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10"
              title="分享"
            >
              <Share2 size={18} />
            </button>
            <button
              type="button"
              onClick={() => viewRef.current?.next()}
              className="flex flex-col items-center justify-center min-w-[44px] min-h-[40px] rounded-lg active:bg-black/10"
              title="下一页"
              aria-label="下一页"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          {/* 进度信息 */}
          <div className="px-4 md:px-6 flex items-center justify-between text-[10px] opacity-80 py-1.5 md:py-2">
            <span className="truncate max-w-[40%] md:max-w-[120px] sm:max-w-md">{chapterTitle || "阅读中..."}</span>
            <div className="flex items-center gap-3 shrink-0">
              {settings.showTimeDisplay && currentTime && (
                <span className="font-semibold tabular-nums">{currentTime}</span>
              )}
              <span>页码: {currentPage}/{totalPages}</span>
              <span>进度: {readingProgressText}</span>
            </div>
          </div>
        </div>
      )}

      {/* 1. Selection Popover — 桌面悬浮条；移动端底部条，动作与桌面完全一致 */}
      {showSelectionPopup && selectionRange && (() => {
        const existingAnnotation = notes.find(n => n.cfi === selectionRange.cfi);
        const isMobileMenu = typeof window !== "undefined" && window.innerWidth < 768;
        const btnClass = cn(
          "px-2.5 py-1.5 rounded transition-all flex items-center gap-1 shrink-0",
          theme.isDark ? "hover:bg-white/10 active:bg-white/15" : "hover:bg-black/5 active:bg-black/10",
        );

        const menuBody = showMarkerColors ? (
          <div className="flex items-center gap-2 px-1 py-0.5">
            <button
              type="button"
              onClick={() => setShowMarkerColors(false)}
              className={cn(
                "p-1 rounded transition-colors text-inherit",
                theme.isDark ? "hover:bg-white/10" : "hover:bg-black/5",
              )}
            >
              <ArrowLeft size={13} />
            </button>
            {["#ffeb3b", "#ff4081", "#00e676", "#29b6f6", "#e0e0e0"].map((color) => (
              <button
                type="button"
                key={color}
                onClick={() => {
                  setLastColor(color);
                  setLastColorStyle("solid");
                  void handleAddHighlight(color, "solid");
                  setShowMarkerColors(false);
                }}
                className="w-7 h-7 rounded-full border border-white/20 shadow hover:scale-110 active:scale-95 transition-transform"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1 text-[11px] font-semibold text-inherit overflow-x-auto no-scrollbar">
            <button type="button" onClick={handleCopyTextFromSelection} className={btnClass}>
              <Copy size={13} />
              <span>复制</span>
            </button>
            <button type="button" onClick={() => setShowMarkerColors(true)} className={btnClass}>
              <Highlighter size={13} />
              <span>马克笔</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLastColorStyle("squiggly");
                setLastColor("#ff4081");
                void handleAddHighlight("#ff4081", "squiggly");
              }}
              className={btnClass}
            >
              <Sparkles size={13} />
              <span>波浪线</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setLastColorStyle("underline");
                setLastColor("#29b6f6");
                void handleAddHighlight("#29b6f6", "underline");
              }}
              className={btnClass}
            >
              <Type size={13} className="underline" />
              <span>直线</span>
            </button>
            <button type="button" onClick={handleOpenWriteThoughts} className={btnClass}>
              <PenTool size={13} />
              <span>写想法</span>
            </button>
            {existingAnnotation && (
              <button
                type="button"
                onClick={() => void handleDeleteHighlightFromSelection(existingAnnotation.id)}
                className={cn(
                  btnClass,
                  "text-red-500",
                  theme.isDark ? "hover:bg-red-500/20" : "hover:bg-red-500/10",
                )}
              >
                <Trash2 size={13} />
                <span>删除划线</span>
              </button>
            )}
          </div>
        );

        return createPortal(
          isMobileMenu ? (
            // 移动端：贴底菜单栏（动作与桌面一致），避免被系统选区菜单抢走 / 坐标跑出屏
            <div className="fixed inset-0 z-[9999] flex flex-col justify-end pointer-events-none">
              <div
                className="pointer-events-auto absolute inset-0 bg-black/25"
                onClick={() => {
                  setShowSelectionPopup(false);
                  setShowMarkerColors(false);
                }}
              />
              <div
                className="pointer-events-auto relative w-full shadow-2xl border-t p-2 pb-[max(10px,var(--safe-area-bottom))] animate-in slide-in-from-bottom-2 duration-200"
                style={{
                  backgroundColor: theme.bg,
                  color: theme.fg,
                  borderColor: `${theme.fg}20`,
                }}
              >
                <div className="flex justify-center pb-1.5">
                  <div className="w-9 h-1 rounded-full opacity-30" style={{ backgroundColor: theme.fg }} />
                </div>
                <p className="px-2 pb-2 text-[10px] opacity-50 line-clamp-1">
                  {selectionRange.text}
                </p>
                {menuBody}
              </div>
            </div>
          ) : (
            <div
              className="fixed z-[9999] animate-fade-in flex flex-col shadow-xl rounded-xl border p-1.5"
              style={{
                left: `${selectionCoords.x}px`,
                top: `${selectionCoords.y}px`,
                transform:
                  selectionCoords.position === "bottom"
                    ? "translate(-50%, 0)"
                    : "translate(-50%, -100%)",
                backgroundColor: theme.bg,
                color: theme.fg,
                borderColor: `${theme.fg}20`,
              }}
            >
              {menuBody}
            </div>
          ),
          document.body,
        );
      })()}

      {/* 2. Highlight / Note Annotation Inspector Popover */}
      {inspectingNote && createPortal(
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
          onClick={() => setInspectingNote(null)}
        >
          <div
            className="w-full max-w-sm border rounded-2xl shadow-xl overflow-hidden flex flex-col animate-scale-in p-5 gap-3"
            style={{
              backgroundColor: theme.bg,
              color: theme.fg,
              borderColor: `${theme.fg}20`
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Note owner header */}
            <div className="flex justify-between items-center text-[10px] opacity-75 border-b pb-2" style={{ borderColor: `${theme.fg}15` }}>
              <span className="font-semibold">
                {inspectingNote.displayName || inspectingNote.username ? `@${inspectingNote.displayName || inspectingNote.username} 的标注` : "我的标注"}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="opacity-60">{new Date(inspectingNote.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => setInspectingNote(null)}
                  className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  style={{ color: theme.fg }}
                  title="关闭"
                >
                  <X size={10} />
                </button>
              </div>
            </div>

            {/* Selected text */}
            <p className="text-xs italic font-serif opacity-80 border-l-2 pl-2.5 leading-relaxed whitespace-pre-wrap" style={{ borderColor: inspectingNote.color }}>
              "{inspectingNote.text}"
            </p>

            {/* Editable comment by owner, or read-only if shared by other users */}
            {inspectingNote.userId === localStorage.getItem("super-self-userid") || !inspectingNote.userId ? (
              <div className="space-y-1.5 mt-1">
                <textarea
                  value={noteEditText}
                  onChange={(e) => setNoteEditText(e.target.value)}
                  placeholder="添加批注内容..."
                  className="w-full h-32 p-3 bg-transparent border rounded-xl text-xs focus:outline-none focus:border-accent-primary transition-all resize-none"
                  style={{
                    borderColor: `${theme.fg}20`,
                    color: theme.fg
                  }}
                />
                <div className="flex justify-between items-center">
                  <button
                    onClick={() => handleDeleteHighlight(inspectingNote.id)}
                    className="p-1 hover:text-red-500 rounded transition-colors text-[9px] font-bold flex items-center gap-1"
                  >
                    <Trash2 size={10} />
                    <span>删除</span>
                  </button>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleShareNoteToTalk(inspectingNote)}
                      className="p-1 hover:text-accent-primary rounded transition-colors text-[9px] font-bold flex items-center gap-1"
                      title="分享至说说"
                    >
                      <Share2 size={10} />
                      <span>分享</span>
                    </button>
                    <button
                      onClick={handleSaveNoteComment}
                      className="px-2.5 py-1 bg-accent-primary text-white hover:bg-accent-primary/95 text-[9px] rounded font-bold"
                    >
                      保存
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-1 space-y-1.5">
                {inspectingNote.note ? (
                  <div className="text-[10px] p-2 rounded-lg leading-relaxed" style={{ backgroundColor: `${theme.fg}08` }}>
                    {inspectingNote.note}
                  </div>
                ) : (
                  <div className="text-[9px] italic opacity-60">（该成员仅做了划线，未写批注）</div>
                )}
                <div className="text-[8px] opacity-50 text-right">只读，不可修改他人标注</div>
              </div>
            )}

            {/* Comments/Replies list */}
            <div className="border-t pt-2 flex flex-col gap-2 max-h-48 overflow-y-auto" style={{ borderColor: `${theme.fg}15` }}>
              <span className="text-[9px] font-semibold opacity-75">回复评论 ({comments.length})</span>
              
              {loadingComments ? (
                <div className="flex justify-center py-2">
                  <Loader2 size={12} className="animate-spin opacity-50" />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {comments.map((c) => (
                    <div key={c.id} className="text-[10px] flex flex-col gap-0.5 border-b pb-1.5 last:border-0 last:pb-0" style={{ borderColor: `${theme.fg}10` }}>
                      <div className="flex justify-between items-center opacity-75">
                        <span className="font-bold text-accent-primary">@{c.displayName || c.username}</span>
                        <span className="text-[8px] opacity-60">{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="leading-relaxed break-words opacity-90">{c.content}</p>
                    </div>
                  ))}
                  {comments.length === 0 && (
                    <span className="text-[9px] italic opacity-50">暂无评论回复，写一条评论交流吧~</span>
                  )}
                </div>
              )}
            </div>

            {/* Comment reply input */}
            <form onSubmit={handleAddComment} className="flex gap-2 border-t pt-2 shrink-0" style={{ borderColor: `${theme.fg}15` }}>
              <input
                type="text"
                placeholder="撰写评论回复..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="flex-1 px-3 py-1 bg-transparent border rounded-lg text-xs focus:outline-none focus:border-accent-primary placeholder-tx-tertiary/75 transition-colors"
                style={{
                  borderColor: `${theme.fg}20`,
                  color: theme.fg
                }}
              />
              <button
                type="submit"
                disabled={postingComment || !commentText.trim()}
                className="px-2.5 py-1 bg-accent-primary hover:bg-accent-primary/95 disabled:opacity-50 text-white text-[10px] rounded-lg font-bold shrink-0 transition-colors"
              >
                {postingComment ? <Loader2 size={10} className="animate-spin" /> : "发送"}
              </button>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Floating Audio Player */}
      {ttsShowPlayer && (
        <div className={cn(
          "fixed left-1/2 -translate-x-1/2 bottom-14 z-45 max-w-[420px] w-[calc(100%-2rem)] bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 shadow-2xl rounded-2xl p-2.5 flex items-center justify-between gap-3 select-none text-zinc-850 dark:text-zinc-100 transition-all duration-300 animate-fade-in",
          isImmersive ? "translate-y-24 opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
        )}>
          {/* Cover & Info */}
          <div className="flex items-center gap-2 overflow-hidden flex-1">
            {/* Book Cover */}
            <div className="w-10 h-14 bg-zinc-100 dark:bg-zinc-900 rounded overflow-hidden shrink-0 shadow-sm flex items-center justify-center">
              {bookCoverUrl ? (
                <img src={bookCoverUrl} alt="cover" className="w-full h-full object-cover" />
              ) : (
                <BookOpen size={18} className="opacity-40" />
              )}
            </div>
            {/* Titles */}
            <div className="flex flex-col text-left min-w-0">
              <span className="text-[11px] font-bold text-zinc-900 dark:text-zinc-50 truncate">
                {book?.title}
              </span>
              <span className="text-[9px] text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                {chapterTitle || "正在朗读"} · {getTtsRemainingTimeText()}
              </span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Skip Backward */}
            <button
              onClick={handlePrevTts}
              className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
              title="上一段"
            >
              <ChevronLeft size={16} />
            </button>
            {/* Play/Pause */}
            <button
              onClick={handleToggleTts}
              className="w-8 h-8 rounded-full bg-accent-primary text-white flex items-center justify-center shadow hover:scale-105 active:scale-95 transition-all"
              title={ttsState === "playing" ? "暂停" : "播放"}
            >
              {ttsState === "playing" ? (
                <Pause size={12} fill="currentColor" className="ml-[0.5px]" />
              ) : (
                <Play size={12} fill="currentColor" className="ml-[1.5px]" />
              )}
            </button>
            {/* Skip Forward */}
            <button
              onClick={handleNextTts}
              className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
              title="下一段"
            >
              <ChevronRight size={16} />
            </button>

            {/* Voice selection */}
            <div className="relative flex items-center">
              <button
                onClick={() => setShowVoicePanel(prev => !prev)}
                className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
                title="选择声音"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              </button>
              {showVoicePanel && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl z-50 overflow-hidden min-w-[140px]">
                  <div className="px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">选择声音</div>
                  {([
                    { key: 'male', label: '磁性男声', icon: '👨' },
                    { key: 'female', label: '温柔女声', icon: '👩' },
                    { key: 'child', label: '奶萌孩童', icon: '🧒' },
                  ] as const).map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setTtsVoiceType(key);
                        ttsVoiceTypeRef.current = key;
                        setShowVoicePanel(false);
                        // Restart current paragraph with new voice
                        if (ttsState === 'playing' && ttsParagraphIndex >= 0) {
                          playParagraph(ttsParagraphs, ttsParagraphIndex);
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        ttsVoiceType === key ? 'text-accent-primary font-semibold' : 'text-zinc-700 dark:text-zinc-300'
                      }`}
                    >
                      <span>{icon}</span>
                      <span>{label}</span>
                      {ttsVoiceType === key && <span className="ml-auto text-accent-primary">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Volume control */}
            <div
              className="relative flex items-center"
              onMouseEnter={() => {
                if (volumeSliderHideTimerRef.current) clearTimeout(volumeSliderHideTimerRef.current);
                setShowVolumeSlider(true);
              }}
              onMouseLeave={() => {
                volumeSliderHideTimerRef.current = setTimeout(() => setShowVolumeSlider(false), 150);
              }}
            >
              <button
                onClick={() => setShowVolumeSlider(prev => !prev)}
                className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors"
                title="音量"
              >
                {ttsVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {showVolumeSlider && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 p-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl flex flex-col items-center gap-2 z-50">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={ttsVolume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="h-20 w-1 accent-accent-primary cursor-pointer"
                    style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
                  />
                  <span className="text-[9px] font-bold tabular-nums text-zinc-500 dark:text-zinc-400">{Math.round(ttsVolume * 100)}%</span>
                  <button
                    onClick={() => handleVolumeChange(ttsVolume === 0 ? 1.0 : 0)}
                    className="text-[9px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                  >
                    {ttsVolume === 0 ? '取消静音' : '静音'}
                  </button>
                </div>
              )}
            </div>

            {/* Close */}
            <button
              onClick={handleStopTts}
              className="p-1.5 rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400 dark:text-zinc-500 hover:text-red-500 transition-colors ml-1 border-l border-zinc-200 dark:border-zinc-800 pl-2"
              title="关闭播放器"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Custom Share Modal */}
      {shareConfig.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-full max-w-md bg-app-surface border border-app-border rounded-2xl shadow-xl overflow-hidden flex flex-col animate-scale-in text-tx-primary">
            {/* Header */}
            <div className="px-5 py-4 border-b border-app-border flex justify-between items-center bg-app-surface/50">
              <h3 className="text-sm font-bold text-tx-primary flex items-center gap-2">
                <Share2 size={16} className="text-accent-primary" />
                {shareConfig.title}
              </h3>
              <button
                onClick={() => setShareConfig(prev => ({ ...prev, show: false }))}
                className="p-1 rounded-lg hover:bg-app-border text-tx-tertiary transition-colors"
                disabled={sharing}
              >
                <X size={16} />
              </button>
            </div>
            
            {/* Body */}
            <div className="p-5 space-y-4">
              {shareConfig.description && (
                <div className="p-3 bg-app-bg border border-app-border rounded-xl text-xs text-tx-secondary italic font-serif leading-relaxed whitespace-pre-wrap">
                  {shareConfig.description}
                </div>
              )}
              
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                  我的感想与推荐语
                </label>
                <textarea
                  autoFocus
                  placeholder={shareConfig.placeholder}
                  value={shareComment}
                  onChange={(e) => setShareComment(e.target.value)}
                  className="w-full h-24 p-3 bg-app-bg border border-app-border rounded-xl text-xs focus:outline-none focus:border-accent-primary transition-all resize-none text-tx-primary placeholder-tx-tertiary"
                  disabled={sharing}
                />
              </div>
            </div>
            
            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-app-border bg-app-surface/50 flex justify-end gap-3">
              <button
                onClick={() => setShareConfig(prev => ({ ...prev, show: false }))}
                className="px-4 py-1.5 border border-app-border hover:bg-app-border text-tx-secondary rounded-lg text-xs font-semibold transition-all active:scale-95"
                disabled={sharing}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  setSharing(true);
                  try {
                    await shareConfig.onConfirm(shareComment);
                    setShareComment("");
                    setShareConfig(prev => ({ ...prev, show: false }));
                  } catch (err) {
                    console.error(err);
                  } finally {
                    setSharing(false);
                  }
                }}
                className="flex items-center gap-2 px-5 py-1.5 bg-accent-primary hover:bg-accent-primary/95 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all active:scale-95 shadow"
                disabled={sharing}
              >
                {sharing ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    <span>正在分享...</span>
                  </>
                ) : (
                  <span>确认分享</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Custom Write Thoughts Modal */}
      {showWriteThoughtsModal && selectionRange && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div
            className="w-full max-w-lg border rounded-2xl shadow-xl overflow-hidden flex flex-col animate-scale-in"
            style={{
              backgroundColor: theme.bg,
              color: theme.fg,
              borderColor: `${theme.fg}20`
            }}
          >
            {/* Header */}
            <div
              className="px-5 py-4 border-b flex justify-between items-center bg-black/5 dark:bg-white/5"
              style={{ borderColor: `${theme.fg}15` }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Sparkles size={16} className="text-accent-primary" />
                <span>写想法</span>
              </h3>
              <button
                onClick={() => setShowWriteThoughtsModal(false)}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-tx-tertiary transition-colors"
                style={{ color: theme.fg }}
              >
                <X size={16} />
              </button>
            </div>
            
            {/* Body */}
            <div className="p-5 space-y-4">
              <div
                className="p-3 border rounded-xl text-xs italic font-serif leading-relaxed whitespace-pre-wrap max-h-24 overflow-y-auto"
                style={{
                  borderColor: `${theme.fg}15`,
                  backgroundColor: `${theme.fg}08`,
                  color: theme.fg
                }}
              >
                {selectionRange.text}
              </div>
              
              <div className="space-y-1.5">
                <textarea
                  autoFocus
                  placeholder="这一刻的想法..."
                  value={thoughtText}
                  onChange={(e) => setThoughtText(e.target.value)}
                  className="w-full h-32 p-3 bg-transparent border rounded-xl text-xs focus:outline-none focus:border-accent-primary transition-all resize-none"
                  style={{
                    borderColor: `${theme.fg}20`,
                    color: theme.fg
                  }}
                />
              </div>

              {/* Visibility Switch */}
              <div className="flex items-center justify-between text-xs pt-1.5">
                <span className="opacity-75 font-medium">想法可见性</span>
                <div className="flex items-center gap-1 border rounded-lg p-0.5" style={{ borderColor: `${theme.fg}20` }}>
                  <button
                    type="button"
                    onClick={() => setThoughtVisibility("public")}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all font-semibold text-[10px]",
                      thoughtVisibility === "public"
                        ? "bg-accent-primary text-white"
                        : "opacity-75 hover:opacity-100"
                    )}
                  >
                    🌐 公开可见
                  </button>
                  <button
                    type="button"
                    onClick={() => setThoughtVisibility("private")}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all font-semibold text-[10px]",
                      thoughtVisibility === "private"
                        ? "bg-accent-primary text-white"
                        : "opacity-75 hover:opacity-100"
                    )}
                  >
                    🔒 私有
                  </button>
                </div>
              </div>
            </div>
            
            {/* Footer */}
            <div
              className="px-5 py-3 border-t flex justify-end gap-3 bg-black/5 dark:bg-white/5"
              style={{ borderColor: `${theme.fg}15` }}
            >
              <button
                onClick={() => setShowWriteThoughtsModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: theme.fg }}
              >
                取消
              </button>
              <button
                onClick={handleSaveThought}
                className="px-4 py-1.5 bg-accent-primary hover:bg-accent-primary/95 text-white text-xs rounded-xl font-semibold transition-all active:scale-95 shadow-sm"
              >
                发表想法
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Custom Notes List Dialog — 移动全屏 / 桌面居中卡片 */}
      {activeSidebar === "notes" && (
        <div
          className="fixed inset-0 z-[9998] flex items-stretch justify-center md:items-center bg-black/60 backdrop-blur-sm md:p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && window.innerWidth >= 768) {
              setActiveSidebar(null);
            }
          }}
        >
          <div
            className="w-full h-full md:h-[min(80vh,720px)] md:max-w-3xl md:border md:rounded-2xl shadow-xl overflow-hidden flex flex-col md:animate-scale-in"
            style={{
              backgroundColor: theme.bg,
              color: theme.fg,
              borderColor: `${theme.fg}20`,
              paddingTop: "var(--safe-area-top, 0px)",
              paddingBottom: "var(--safe-area-bottom, 0px)",
            }}
          >
            {/* Header：移动端分两行，避免标题竖排 + 控件挤爆 */}
            <div
              className="px-4 py-3 md:px-5 md:py-4 border-b flex flex-col gap-3 shrink-0 bg-black/5 dark:bg-white/5"
              style={{ borderColor: `${theme.fg}15` }}
            >
              <div className="flex items-center justify-between gap-3 min-w-0">
                <h3 className="text-sm font-bold flex items-center gap-2 min-w-0">
                  <MessageSquare size={16} className="text-accent-primary shrink-0" />
                  <span className="truncate">全书划线/读书笔记 ({notes.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setActiveSidebar(null)}
                  className="inline-flex items-center justify-center gap-1 min-w-[44px] min-h-[44px] px-2.5 rounded-xl font-semibold text-xs shrink-0 active:scale-95 transition-all"
                  style={{
                    color: theme.fg,
                    backgroundColor: `${theme.fg}14`,
                    border: `1px solid ${theme.fg}33`,
                  }}
                  aria-label="关闭"
                >
                  <X size={18} strokeWidth={2.25} />
                  <span className="md:hidden">关闭</span>
                </button>
              </div>
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <select
                  value={noteFilter}
                  onChange={(e) => {
                    setNoteFilter(e.target.value as "all" | "mine");
                    setNotesPage(1);
                  }}
                  className="flex-1 min-w-0 min-h-[40px] px-2.5 py-1.5 bg-transparent border rounded-xl text-xs focus:outline-none"
                  style={{ borderColor: `${theme.fg}30`, color: theme.fg }}
                >
                  <option value="all">全部人员</option>
                  <option value="mine">仅看自己</option>
                </select>
                {notes.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportNotes}
                    className="min-h-[40px] px-3 py-1.5 text-xs font-bold border rounded-xl transition-all inline-flex items-center justify-center gap-1.5 shrink-0 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
                    style={{
                      borderColor: `${theme.fg}30`,
                      color: theme.fg,
                    }}
                  >
                    <Download size={12} />
                    <span>导出</span>
                  </button>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 md:p-6">
              {notes.length === 0 && (
                <div className="text-sm italic text-center py-20 opacity-60">
                  本书暂无划线或笔记，选中文字可添加划线
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 md:gap-4">
                {displayedNotes.map((n) => (
                  <div
                    key={n.id}
                    onClick={async () => {
                      try {
                        if (viewRef.current) {
                          await viewRef.current.goTo(n.cfi);
                          setActiveSidebar(null);
                        }
                      } catch (err) {
                        console.warn("跳转笔记失败:", err);
                      }
                    }}
                    className={cn(
                      "p-3.5 md:p-4 border rounded-xl cursor-pointer transition-all text-left flex flex-col justify-between gap-3 active:scale-[0.99]",
                      theme.isDark
                        ? "border-white/10 bg-white/5 hover:bg-white/10"
                        : "border-black/10 bg-black/5 hover:bg-black/10",
                    )}
                    style={{
                      borderColor: `${theme.fg}15`,
                    }}
                  >
                    <div className="space-y-2 min-w-0">
                      <p
                        className="text-sm md:text-xs italic font-serif leading-relaxed opacity-95 border-l-2 pl-2.5 break-words"
                        style={{ borderColor: n.color }}
                      >
                        &ldquo;{n.text}&rdquo;
                      </p>
                      {editingNoteId === n.id ? (
                        <div className="space-y-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          <textarea
                            autoFocus
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            className="w-full h-24 md:h-20 p-2.5 text-sm md:text-xs bg-transparent border rounded-lg focus:outline-none focus:border-accent-primary resize-none"
                            style={{ borderColor: `${theme.fg}20`, color: theme.fg }}
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingNoteId(null);
                                setEditingNoteText("");
                              }}
                              className="min-h-[36px] px-3 py-1.5 text-xs rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-medium"
                              style={{ color: theme.fg }}
                            >
                              取消
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateNoteInline(n.id)}
                              className="min-h-[36px] px-3 py-1.5 bg-accent-primary text-white text-xs rounded-lg font-bold"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        n.note && (
                          <div
                            className="text-sm md:text-xs font-medium leading-relaxed p-3 rounded-lg break-words"
                            style={{
                              backgroundColor: `${theme.fg}08`,
                              color: theme.fg,
                            }}
                          >
                            💡 {n.note}
                          </div>
                        )
                      )}
                    </div>
                    {/* 元信息：窄屏换行，操作与日期分列 */}
                    <div
                      className="flex flex-col gap-2 text-[11px] md:text-[10px] opacity-70 font-medium border-t pt-2.5"
                      style={{ borderColor: `${theme.fg}10` }}
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                        <span className="shrink-0">
                          👤 {n.displayName || n.username || "我的笔记"}
                        </span>
                        {n.chapterTitle && (
                          <span className="min-w-0 truncate max-w-full" title="章节">
                            📖 {n.chapterTitle}
                          </span>
                        )}
                        {n.progress && (
                          <span className="shrink-0 opacity-80" title="进度/页数">
                            📍 {n.progress}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          {(n.userId === localStorage.getItem("super-self-userid") || !n.userId) && (
                            <>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingNoteId(n.id);
                                  setEditingNoteText(n.note || "");
                                }}
                                className="min-h-[32px] px-2 py-1 hover:text-accent-primary rounded-lg transition-colors text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                                title="编辑想法"
                              >
                                <PenTool size={12} />
                                <span>编辑</span>
                              </button>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await handleDeleteHighlight(n.id);
                                }}
                                className="min-h-[32px] px-2 py-1 hover:text-red-500 rounded-lg transition-colors text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                                title="删除"
                              >
                                <Trash2 size={12} />
                                <span>删除</span>
                              </button>
                            </>
                          )}
                        </div>
                        <span className="shrink-0 tabular-nums opacity-80">
                          {new Date(n.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {totalNotesPages > 1 && (
                <div
                  className="flex flex-wrap items-center justify-center gap-2 pt-6 border-t mt-6 select-none"
                  style={{ borderColor: `${theme.fg}15` }}
                >
                  <button
                    type="button"
                    disabled={notesPage === 1}
                    onClick={() => setNotesPage((prev) => Math.max(1, prev - 1))}
                    className="min-h-[40px] px-3 rounded-xl border text-xs font-semibold disabled:opacity-40 transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
                    style={{ borderColor: `${theme.fg}20`, color: theme.fg }}
                  >
                    上一页
                  </button>
                  {Array.from({ length: totalNotesPages }).map((_, idx) => {
                    const p = idx + 1;
                    return (
                      <button
                        type="button"
                        key={p}
                        onClick={() => setNotesPage(p)}
                        className={cn(
                          "min-w-[36px] min-h-[36px] rounded-xl border text-xs font-bold transition-all inline-flex items-center justify-center active:scale-95",
                          notesPage === p
                            ? "bg-accent-primary text-white border-transparent"
                            : "hover:bg-black/5 dark:hover:bg-white/5",
                        )}
                        style={
                          notesPage === p
                            ? undefined
                            : { borderColor: `${theme.fg}15`, color: theme.fg }
                        }
                      >
                        {p}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={notesPage === totalNotesPages}
                    onClick={() =>
                      setNotesPage((prev) => Math.min(totalNotesPages, prev + 1))
                    }
                    className="min-h-[40px] px-3 rounded-xl border text-xs font-semibold disabled:opacity-40 transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
                    style={{ borderColor: `${theme.fg}20`, color: theme.fg }}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 6. Custom Thoughts List Modal */}
      {activeThoughtsCfi && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div
            className="w-full max-w-lg max-h-[85vh] border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scale-in"
            style={{
              backgroundColor: theme.bg,
              color: theme.fg,
              borderColor: `${theme.fg}20`
            }}
          >
            {/* Header */}
            <div
              className="px-5 py-4 border-b flex justify-between items-center bg-black/5 dark:bg-white/5"
              style={{ borderColor: `${theme.fg}15` }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2">
                <MessageSquare size={16} className="text-accent-primary" />
                <span>书友想法列表</span>
              </h3>
              <button
                onClick={() => setActiveThoughtsCfi(null)}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-tx-tertiary transition-colors"
                style={{ color: theme.fg }}
              >
                <X size={18} />
              </button>
            </div>
            
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Quoted Text */}
              <div
                className="p-3.5 border-l-4 rounded-r-xl text-xs italic font-serif leading-relaxed"
                style={{
                  borderColor: theme.fg,
                  backgroundColor: `${theme.fg}08`,
                  color: theme.fg
                }}
              >
                "{notes.find(n => n.cfi === activeThoughtsCfi)?.text}"
              </div>
              
              {/* Thoughts list */}
              <div className="space-y-4">
                {notes.filter(n => n.cfi === activeThoughtsCfi && n.note).map((noteItem) => {
                  const comments = commentsMap[noteItem.id] || [];
                  const likes = likesState[noteItem.id] || { count: 0, liked: false };
                  const isPrivate = noteItem.visibility === "private";

                  return (
                    <div
                      key={noteItem.id}
                      className="p-4 border rounded-xl space-y-3 text-left"
                      style={{ borderColor: `${theme.fg}15`, backgroundColor: `${theme.fg}03` }}
                    >
                      {/* Author Info */}
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          {noteItem.avatarUrl ? (
                            <img
                              src={noteItem.avatarUrl.startsWith("http") ? noteItem.avatarUrl : `${getServerUrl()}${noteItem.avatarUrl}`}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover"
                              style={{ border: `1px solid ${theme.fg}20` }}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-accent-primary/10 flex items-center justify-center font-bold text-xs uppercase" style={{ color: theme.fg, border: `1px solid ${theme.fg}20` }}>
                              {noteItem.displayName ? noteItem.displayName.slice(0, 2) : (noteItem.username ? noteItem.username.slice(0, 2) : "书")}
                            </div>
                          )}
                          <div>
                            <div className="text-xs font-bold">{noteItem.displayName || noteItem.username || "匿名书友"}</div>
                            <div className="text-[10px] opacity-60">{new Date(noteItem.createdAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                        {isPrivate && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full border opacity-70 flex items-center gap-1" style={{ borderColor: `${theme.fg}20` }}>
                            🔒 私有
                          </span>
                        )}
                      </div>
                      
                      {/* Thought Content / Inline Edit */}
                      {editingNoteId === noteItem.id ? (
                        <div className="space-y-2 mt-2" onClick={(e) => e.stopPropagation()}>
                          <textarea
                            autoFocus
                            value={editingNoteText}
                            onChange={(e) => setEditingNoteText(e.target.value)}
                            className="w-full h-20 p-2 text-xs bg-transparent border rounded-lg focus:outline-none focus:border-accent-primary resize-none"
                            style={{ borderColor: `${theme.fg}20`, color: theme.fg }}
                          />
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setEditingNoteId(null);
                                setEditingNoteText("");
                              }}
                              className="px-2.5 py-1 text-[10px] rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors font-medium"
                              style={{ color: theme.fg }}
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleUpdateNoteInline(noteItem.id)}
                              className="px-2.5 py-1 bg-accent-primary text-white text-[10px] rounded-lg font-bold"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs leading-relaxed font-medium pl-1">{noteItem.note}</p>
                          
                          {/* Action buttons */}
                          <div className="flex items-center gap-4 pt-1 text-[11px] font-bold border-t border-dashed" style={{ borderColor: `${theme.fg}10` }}>
                            <button
                              onClick={() => toggleLike(noteItem.id)}
                              className={cn(
                                "flex items-center gap-1 transition-colors",
                                likes.liked ? "text-red-500" : "opacity-75 hover:opacity-100"
                              )}
                            >
                              <svg className="w-3.5 h-3.5" fill={likes.liked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                              </svg>
                              <span>赞 {likes.count}</span>
                            </button>
                            <button
                              onClick={() => {
                                setActiveCommentNoteId(activeCommentNoteId === noteItem.id ? null : noteItem.id);
                                setNewCommentText("");
                              }}
                              className="flex items-center gap-1 opacity-75 hover:opacity-100"
                            >
                              <MessageSquare size={13} />
                              <span>评论 {comments.length}</span>
                            </button>
                            {noteItem.userId === localStorage.getItem("super-self-userid") && (
                              <>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingNoteId(noteItem.id);
                                    setEditingNoteText(noteItem.note || "");
                                  }}
                                  className="flex items-center gap-1 text-accent-primary opacity-75 hover:opacity-100 ml-auto"
                                  title="编辑想法"
                                >
                                  <PenTool size={13} />
                                  <span>编辑</span>
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await handleDeleteHighlight(noteItem.id);
                                  }}
                                  className="flex items-center gap-1 text-red-500 opacity-75 hover:opacity-100"
                                  title="删除"
                                >
                                  <Trash2 size={13} />
                                  <span>删除</span>
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      )}

                      {/* Comments List */}
                      {comments.length > 0 && (
                        <div className="space-y-2 mt-2 p-2.5 rounded-lg text-[11px]" style={{ backgroundColor: `${theme.fg}05` }}>
                          {comments.map((comment) => (
                            <div key={comment.id} className="space-y-0.5">
                              <div className="flex justify-between items-center">
                                <span className="font-bold opacity-90">{comment.displayName || comment.username || "匿名书友"}:</span>
                                <span className="text-[9px] opacity-50">{new Date(comment.createdAt).toLocaleDateString()}</span>
                              </div>
                              <p className="opacity-80 pl-1">{comment.content}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Comment Input Box */}
                      {activeCommentNoteId === noteItem.id && (
                        <div className="space-y-2 mt-2 pt-2 border-t border-dashed" style={{ borderColor: `${theme.fg}10` }}>
                          <textarea
                            autoFocus
                            placeholder="写下你的评论想法..."
                            value={newCommentText}
                            onChange={(e) => setNewCommentText(e.target.value)}
                            className="w-full h-16 p-2 text-xs bg-transparent border rounded-lg focus:outline-none focus:border-accent-primary resize-none"
                            style={{ borderColor: `${theme.fg}20`, color: theme.fg }}
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setActiveCommentNoteId(null)}
                              className="px-2.5 py-1 text-[10px] font-semibold opacity-70 hover:opacity-100"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleAddThoughtComment(noteItem.id)}
                              className="px-3 py-1 bg-accent-primary hover:bg-accent-primary/95 text-white text-[10px] font-semibold rounded-md shadow-sm"
                            >
                              发送评论
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
