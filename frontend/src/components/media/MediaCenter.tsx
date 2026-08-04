import React, { useEffect, useState, useRef, useSyncExternalStore, useCallback } from "react";
import { BottomSheet } from "@/components/common/BottomSheet";
import { createPortal } from "react-dom";
import { api, getCurrentWorkspace, resolveAttachmentUrl } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useMediaStore } from "@/store/mediaStore";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TimestampExtension } from "../extensions/TimestampExtension";
import MediaPlayer from "./MediaPlayer";
import MusicPlayer from "./MusicPlayer";
import AlistBrowser from "./AlistBrowser";
import AssignCollectionModal from "./AssignCollectionModal";
import MediaCacheSheet from "./MediaCacheSheet";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import {
  Film, Music, Plus, Search, Grid, List as ListIcon, Trash2, Edit3, Play, Pause, Info,
  Settings, ChevronRight, CheckCircle, MessageSquare, Clock,
  User, Tag, ChevronLeft, PlusCircle, Globe, Lock, ShieldAlert, SlidersHorizontal,
  X, AlertTriangle, Disc, Loader2, Check, MoreHorizontal, FolderInput, Car,
  HardDrive, DownloadCloud
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AudioCover } from "@/lib/id3";
import { EmptyState, LoadingBlock } from "@/components/common/FeedbackStates";
import { pushNativeMediaCatalog, type NativeMediaTrack } from "@/lib/nativeMedia";
import { isNativePlatform } from "@/hooks/useCapacitor";
import {
  subscribeMediaCache,
  getCachedMediaIdSet,
  getMediaCacheVersion,
  refreshCachedMediaIdSet,
  setMediaCacheUser,
  isMediaCacheReady,
} from "@/lib/mediaFileCache";
import {
  enqueueMediaCache,
  removeLocalMediaCache,
  removeLocalMediaCaches,
  getMediaCacheJob,
  subscribeMediaCacheQueue,
  getMediaCacheQueueVersion,
  pauseMediaCacheJob,
  resumeMediaCacheJob,
} from "@/lib/mediaCacheQueue";
import { toast } from "@/lib/toast";

interface Collection {
  id: string;
  title: string;
  type: "video" | "audio";
  cover_url?: string;
  description?: string;
  recommendation?: string;
  item_count: number;
  sort_order?: number;
}

interface MediaItem {
  id: string;
  collection_id?: string;
  collection_title?: string;
  title: string;
  type: "video" | "audio";
  cover_url?: string;
  description?: string;
  alist_path: string;
  artist?: string;
  album?: string;
  duration?: number; // in seconds
  year?: number;
  genre?: string; // JSON string of array
  play_count: number;
  last_played_at?: string;
  created_at: string;
}

interface Review {
  id: string;
  media_id: string;
  user_id: number;
  username: string;
  avatarUrl?: string;
  type: "long_review" | "short_comment" | "recommendation";
  title?: string;
  content: string;
  created_at: string;
}

export default function MediaCenter() {
  const { t } = useTranslation();
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => {
    const ws = getCurrentWorkspace();
    return !ws || ws === "personal" ? null : ws;
  });
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  
  // States
  const [collections, setCollections] = useState<Collection[]>([]);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  
  // Filters and UI
  const [mediaType, setMediaType] = useState<"video" | "audio">("video");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [sortBy, setSortBy] = useState<string>("sort_order");
  const [viewStyle, setViewStyle] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState<boolean>(true);

  /** 移动端浏览层级：类型 → 合集 → 文件列表（桌面仍用侧栏一体布局） */
  type MobileBrowseLevel = "type" | "collections" | "items";
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768,
  );
  const [mobileLevel, setMobileLevel] = useState<MobileBrowseLevel>("type");
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showItemsMenu, setShowItemsMenu] = useState(false);
  const mobileSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (showMobileSearch) {
      const t = window.setTimeout(() => {
        mobileSearchRef.current?.focus({ preventScroll: true });
      }, 50);
      return () => window.clearTimeout(t);
    }
  }, [showMobileSearch]);
  
  // Modals
  const [showAlistBrowser, setShowAlistBrowser] = useState<boolean>(false);
  const [showAlistSettings, setShowAlistSettings] = useState<boolean>(false);
  const [showAddCollection, setShowAddCollection] = useState<boolean>(false);
  const [showAddItem, setShowAddItem] = useState<boolean>(false);
  
  // Forms states
  const [alistUrl, setAlistUrl] = useState<string>("");
  const [alistToken, setAlistToken] = useState<string>("");
  const [testStatus, setTestStatus] = useState<{ status: string; message: string } | null>(null);
  const [testing, setTesting] = useState<boolean>(false);

  // Batch deletion states
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [fetchingMetadata, setFetchingMetadata] = useState<boolean>(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  // 合入合集
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignMediaIds, setAssignMediaIds] = useState<string[]>([]);

  // 本地缓存
  const [showCacheSheet, setShowCacheSheet] = useState(false);
  useSyncExternalStore(subscribeMediaCache, getMediaCacheVersion, () => 0);
  const cachedIds = getCachedMediaIdSet();
  // 订阅队列以刷新角标进度
  useSyncExternalStore(subscribeMediaCacheQueue, getMediaCacheQueueVersion, () => 0);

  // 右键菜单
  const [ctxMenu, setCtxMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    item: MediaItem | null;
  }>({ open: false, x: 0, y: 0, item: null });
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);

  const openAssignForIds = (ids: string[]) => {
    if (ids.length === 0) return;
    setAssignMediaIds(ids);
    setAssignOpen(true);
  };

  const openItemContextMenu = (e: React.MouseEvent, item: MediaItem) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ open: true, x: e.clientX, y: e.clientY, item });
  };

  const closeItemContextMenu = () => {
    setCtxMenu((s) => ({ ...s, open: false, item: null }));
  };

  useEffect(() => {
    if (!ctxMenu.open) return;
    const onDown = (ev: MouseEvent) => {
      const el = ctxMenuRef.current;
      if (el && el.contains(ev.target as Node)) return;
      closeItemContextMenu();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeItemContextMenu();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu.open]);

  const cacheItem = useCallback((item: MediaItem) => {
    enqueueMediaCache({
      mediaId: item.id,
      type: item.type,
      title: item.title,
      alistPath: item.alist_path,
    });
  }, []);

  const uncacheItem = useCallback(async (item: MediaItem) => {
    await removeLocalMediaCache(item.id);
    toast.success(`已删除「${item.title}」的本地缓存`);
  }, []);

  const handleCtxMenuAction = async (actionId: string) => {
    const item = ctxMenu.item;
    closeItemContextMenu();
    if (!item) return;
    if (actionId === "detail") {
      setSelectedItem(item);
    } else if (actionId === "assign") {
      openAssignForIds([item.id]);
    } else if (actionId === "cache") {
      if (!isMobile) return;
      cacheItem(item);
    } else if (actionId === "uncache") {
      if (!isMobile) return;
      await uncacheItem(item);
    } else if (actionId === "delete") {
      if (!isAdmin) return;
      if (!window.confirm(`确认删除「${item.title}」吗？`)) return;
      try {
        await api.request(`/media/items/${item.id}`, { method: "DELETE" });
        fetchData();
      } catch (err) {
        console.error("Delete failed:", err);
        alert("删除失败");
      }
    }
  };

  const batchCacheSelected = useCallback(() => {
    const list = items.filter((it) => selectedItemIds.has(it.id));
    if (list.length === 0) return;
    enqueueMediaCache(
      list.map((it) => ({
        mediaId: it.id,
        type: it.type,
        title: it.title,
        alistPath: it.alist_path,
      })),
    );
  }, [items, selectedItemIds]);

  const batchUncacheSelected = useCallback(async () => {
    const ids = Array.from(selectedItemIds).filter((id) => cachedIds.has(id));
    if (ids.length === 0) {
      toast.info("选中项中没有本地缓存");
      return;
    }
    if (!window.confirm(`确认删除选中 ${ids.length} 项的本地缓存？`)) return;
    await removeLocalMediaCaches(ids);
  }, [selectedItemIds, cachedIds]);

  const selectedItemRef = React.useRef<MediaItem | null>(null);
  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const [colForm, setColForm] = useState({ title: "", type: "video", cover_url: "", description: "", recommendation: "", sort_order: 0 });
  const [itemForm, setItemForm] = useState({ title: "", type: "video", collection_id: "", cover_url: "", description: "", alist_path: "", artist: "", duration: 0, year: new Date().getFullYear(), genre: "", sort_order: 0, tags: "" });

  const { playMedia, isPlaying, currentTime } = useMediaStore();

  // Load scope and roles + 绑定媒体缓存用户
  useEffect(() => {
    const ws = getCurrentWorkspace();
    setWorkspaceId(!ws || ws === "personal" ? null : ws);
    
    // Check if user is admin
    api.getMe().then(async (me) => {
      if (me?.id && !isMediaCacheReady()) {
        setMediaCacheUser(String(me.id));
      }
      void refreshCachedMediaIdSet();
      let isWsOwner = false;
      if (ws !== "personal") {
        try {
          const list = await api.getWorkspaces();
          const currentWs = list.find(w => w.id === ws);
          isWsOwner = currentWs?.role === "owner";
        } catch (e) {
          console.error("Failed to load workspace role:", e);
        }
      }
      setIsAdmin(me.role === "admin" || isWsOwner);
    }).catch(() => setIsAdmin(false));
  }, []);

  const [showCarMode, setShowCarMode] = useState(false);

  // Fetch Collections & Items
  const fetchData = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (workspaceId) q.set("workspaceId", workspaceId);
      q.set("type", mediaType);

      // Collections
      const cols = await api.request<Collection[]>(`/media/collections?${q.toString()}`);
      setCollections(cols || []);

      // Items (Filtered by active collection if any)
      if (selectedCollection) {
        q.set("collection_id", selectedCollection.id);
      }
      q.set("sort", sortBy);
      if (searchQuery) q.set("search", searchQuery);

      const resItems = await api.request<MediaItem[]>(`/media/items?${q.toString()}`);
      setItems(resItems || []);

      // Android 车载：同步音频库快照（合集树 + 最近）
      if (isNativePlatform() && mediaType === "audio") {
        void syncCarCatalog(cols || [], resItems || []);
      }
    } catch (err) {
      console.error("Failed to fetch media data:", err);
    } finally {
      setLoading(false);
    }
  };

  const toNativeTrack = (it: MediaItem): NativeMediaTrack => {
    const cover = it.cover_url
      ? it.cover_url.startsWith("/") && !it.cover_url.startsWith("/api")
        ? `${window.location.origin}${it.cover_url}`
        : resolveAttachmentUrl(it.cover_url)
      : undefined;
    return {
      id: it.id,
      title: it.title || "未知曲目",
      artist: it.artist || "",
      album: it.album || "",
      duration: it.duration || 0,
      coverUrl: cover,
    };
  };

  /** 推送合集树：为每个合集再拉一次 items（限流） */
  const syncCarCatalog = async (cols: Collection[], allItems: MediaItem[]) => {
    try {
      const recent = [...allItems]
        .sort((a, b) => (b.last_played_at || b.created_at || "").localeCompare(a.last_played_at || a.created_at || ""))
        .slice(0, 40)
        .map(toNativeTrack);

      const collectionsPayload: { id: string; title: string; tracks: NativeMediaTrack[] }[] = [];
      const audioCols = cols.filter((c) => c.type === "audio").slice(0, 30);
      for (const col of audioCols) {
        try {
          const q = new URLSearchParams();
          if (workspaceId) q.set("workspaceId", workspaceId);
          q.set("type", "audio");
          q.set("collection_id", col.id);
          q.set("sort", "sort_order");
          const tracks = await api.request<MediaItem[]>(`/media/items?${q.toString()}`);
          collectionsPayload.push({
            id: col.id,
            title: col.title,
            tracks: (tracks || []).slice(0, 80).map(toNativeTrack),
          });
        } catch {
          /* skip one collection */
        }
      }
      // 若当前是「全部」且无合集明细，至少推 recent
      if (collectionsPayload.length === 0 && allItems.length > 0) {
        collectionsPayload.push({
          id: "_all",
          title: "全部音频",
          tracks: allItems.slice(0, 80).map(toNativeTrack),
        });
      }
      await pushNativeMediaCatalog({ recent, collections: collectionsPayload });
    } catch (e) {
      console.warn("[car] push catalog failed", e);
    }
  };

  useEffect(() => {
    fetchData();
  }, [workspaceId, mediaType, selectedCollection, sortBy, searchQuery]);

  // Load reviews when active item changes
  useEffect(() => {
    if (selectedItem) {
      api.request<Review[]>(`/media/items/${selectedItem.id}/reviews`).then(setReviews).catch(() => setReviews([]));
    }
  }, [selectedItem]);

  // Handle hash change to open specific media item
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.startsWith("#/media/items/")) {
        const id = hash.replace("#/media/items/", "");
        if (!selectedItemRef.current || selectedItemRef.current.id !== id) {
          api.request<MediaItem>(`/media/items/${id}`).then(item => {
            setSelectedItem(item);
            setMediaType(item.type);
            // 深链进详情时，关掉后应回到文件列表而非类型选择
            setMobileLevel("items");
          }).catch(err => {
            console.error("Failed to load item from hash:", err);
            setSelectedItem(null);
            history.replaceState(null, "", window.location.pathname + window.location.search);
          });
        }
      } else {
        if (selectedItemRef.current) {
          setSelectedItem(null);
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []); // Run only once to prevent re-binding and loops

  useEffect(() => {
    const handleCloseDetail = () => {
      console.log("[MediaCenter Debug] Received super:media-close-detail");
      setSelectedItem(null);
      if (window.location.hash.startsWith("#/media/items/")) {
        window.location.hash = "#/media";
      }
    };
    window.addEventListener("super:media-close-detail", handleCloseDetail);
    return () => {
      window.removeEventListener("super:media-close-detail", handleCloseDetail);
      if (window.location.hash.startsWith("#/media/items/")) {
        window.location.hash = "#/media";
      }
    };
  }, []);

  // 移动端：资料库返回键优先回退媒体内层级
  useEffect(() => {
    const onNavBack = (e: Event) => {
      const detail = (e as CustomEvent<{ handled: boolean }>).detail;
      if (!detail) return;
      if (selectedItemRef.current) {
        setSelectedItem(null);
        detail.handled = true;
        return;
      }
      if (!isMobile) return;
      if (mobileLevel === "items") {
        setShowItemsMenu(false);
        setShowMobileSearch(false);
        setIsBatchMode(false);
        setSelectedItemIds(new Set());
        setMobileLevel("collections");
        detail.handled = true;
        return;
      }
      if (mobileLevel === "collections") {
        setSelectedCollection(null);
        setMobileLevel("type");
        detail.handled = true;
        return;
      }
      // type 层不消费，交给 LibraryCenter 回资料库 Hub
    };
    window.addEventListener("super:media-navigate-back", onNavBack);
    return () => window.removeEventListener("super:media-navigate-back", onNavBack);
  }, [isMobile, mobileLevel]);

  // 移动端 titlebar：合集文件列表显示「合集名（数量）」
  useEffect(() => {
    if (!isMobile) return;
    let title: string | null = null;
    if (mobileLevel === "items" && !selectedItem) {
      const name = selectedCollection?.title?.trim() || "全部";
      title = `${name}（${items.length}）`;
    }
    window.dispatchEvent(
      new CustomEvent("super:media-chrome-title", { detail: { title } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("super:media-chrome-title", { detail: { title: null } }),
      );
    };
  }, [
    isMobile,
    mobileLevel,
    selectedCollection?.id,
    selectedCollection?.title,
    items.length,
    selectedItem,
  ]);

  const openAlistSettings = async () => {
    setShowAlistSettings(true);
    try {
      const cfg = await api.request<{ url: string; token: string }>("/media/settings/alist");
      if (cfg) {
        setAlistUrl(cfg.url || "");
        setAlistToken(cfg.token || "");
      }
    } catch (err) {
      console.error("Failed to load Alist config:", err);
    }
  };

  const enterMediaType = (type: "video" | "audio") => {
    setMediaType(type);
    setSelectedCollection(null);
    setSearchQuery("");
    setIsBatchMode(false);
    setSelectedItemIds(new Set());
    setMobileLevel("collections");
  };

  const enterCollection = (col: Collection | null) => {
    setSelectedCollection(col);
    setSearchQuery("");
    setShowMobileSearch(false);
    setShowItemsMenu(false);
    setIsBatchMode(false);
    setSelectedItemIds(new Set());
    setMobileLevel("items");
  };

  const totalItemCount = collections.reduce((sum, c) => sum + (c.item_count || 0), 0);
  const sortLabel =
    sortBy === "newest"
      ? "最新"
      : sortBy === "oldest"
        ? "最早"
        : sortBy === "play_count"
          ? "热门"
          : sortBy === "title"
            ? "拼音"
            : "默认排序";

  // Sync selected item state back to URL hash
  useEffect(() => {
    if (selectedItem) {
      const targetHash = `#/media/items/${selectedItem.id}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
    } else {
      if (window.location.hash.startsWith("#/media/items/")) {
        window.location.hash = "#/media";
      }
    }
  }, [selectedItem]);

  // Alist configuration connection check
  const testAlistConnection = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      // First save settings
      await api.request("/media/settings/alist", {
        method: "PUT",
        body: JSON.stringify({ url: alistUrl, token: alistToken })
      });
      // Then check connection status
      const res = await api.request<{ configured: boolean; status: string; message: string }>("/media/settings/alist/status");
      setTestStatus({ status: res.status, message: res.message });
    } catch (err: any) {
      setTestStatus({ status: "error", message: err.message || "连接失败" });
    } finally {
      setTesting(false);
    }
  };

  // Handle Open Add Collection Modal
  const handleOpenAddCollection = () => {
    setColForm({
      title: "",
      type: mediaType,
      cover_url: "",
      description: "",
      recommendation: "",
      sort_order: 0
    });
    setEditingCollectionId(null);
    setShowAddCollection(true);
  };

  // Handle Open Edit Collection Modal
  const handleOpenEditCollection = (col: Collection) => {
    setColForm({
      title: col.title || "",
      type: col.type || "video",
      cover_url: col.cover_url || "",
      description: col.description || "",
      recommendation: col.recommendation || "",
      sort_order: col.sort_order || 0
    });
    setEditingCollectionId(col.id);
    setShowAddCollection(true);
  };

  // Handle Save Collection (Create or Edit)
  const handleSaveCollection = async () => {
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      if (editingCollectionId) {
        // Edit mode
        const res = await api.request<Collection>(`/media/collections/${editingCollectionId}${q}`, {
          method: "PUT",
          body: JSON.stringify(colForm)
        });
        if (res) {
          setShowAddCollection(false);
          if (selectedCollection?.id === editingCollectionId) {
            setSelectedCollection(res);
          }
          fetchData();
        }
      } else {
        // Create mode
        await api.request(`/media/collections${q}`, {
          method: "POST",
          body: JSON.stringify({ ...colForm, type: mediaType })
        });
        setShowAddCollection(false);
        setColForm({ title: "", type: "video", cover_url: "", description: "", recommendation: "", sort_order: 0 });
        fetchData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Delete Collection
  const handleDeleteCollection = async (col: Collection) => {
    if (!window.confirm(`确定要删除合集《${col.title}》吗？关联的单品不会被删除，仅解除绑定关系。`)) {
      return;
    }
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      await api.request(`/media/collections/${col.id}${q}`, {
        method: "DELETE"
      });
      if (selectedCollection?.id === col.id) {
        setSelectedCollection(null);
        if (isMobile) setMobileLevel("collections");
      }
      fetchData();
    } catch (err) {
      console.error("Failed to delete collection:", err);
    }
  };

  // Handle Single Item Creation
  const handleCreateItem = async () => {
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      const genreArray = itemForm.genre.split(",").map(g => g.trim()).filter(Boolean);
      const tagsArray = itemForm.tags.split(",").map(t => ({ name: t.trim() })).filter(t => t.name);
      
      await api.request(`/media/items${q}`, {
        method: "POST",
        body: JSON.stringify({
          ...itemForm,
          type: mediaType,
          genre: genreArray,
          tags: tagsArray
        })
      });
      setShowAddItem(false);
      setItemForm({ title: "", type: "video", collection_id: "", cover_url: "", description: "", alist_path: "", artist: "", duration: 0, year: new Date().getFullYear(), genre: "", sort_order: 0, tags: "" });
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Duration display formatter — null/0 shows placeholder so "全 0" 不误导
  const formatDuration = (sec: number | undefined | null) => {
    if (sec == null || !sec || isNaN(Number(sec))) return "--:--";
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = Math.floor(sec % 60);
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Reviews interactive Tiptap editor setup
  const reviewEditor = useEditor({
    extensions: [StarterKit, TimestampExtension],
    content: "",
    editorProps: {
      attributes: {
        // 移动端评论 sheet 高度有限：编辑区适中即可，过大易把底栏挤出
        class:
          "prose prose-sm dark:prose-invert focus:outline-none min-h-[7.5rem] max-h-[min(40vh,220px)] overflow-y-auto bg-app-bg border border-app-border rounded-xl p-3 text-xs text-tx-primary",
      },
    },
  });

  const [reviewType, setReviewType] = useState<"long_review" | "short_comment" | "recommendation">("short_comment");
  const [reviewTitle, setReviewTitle] = useState<string>("");
  const [showReviewInput, setShowReviewInput] = useState<boolean>(false);

  // Inline edit states
  const [editingTitle, setEditingTitle] = useState<boolean>(false);
  const [editTitleValue, setEditTitleValue] = useState<string>("");
  const [editingDescription, setEditingDescription] = useState<boolean>(false);
  const [editDescValue, setEditDescValue] = useState<string>("");

  const handleUpdateItem = async (updates: Partial<MediaItem>) => {
    if (!selectedItem) return;
    try {
      await api.request(`/media/items/${selectedItem.id}`, {
        method: "PUT",
        body: JSON.stringify({ ...selectedItem, ...updates })
      });
      setSelectedItem({ ...selectedItem, ...updates });
      setItems(items.map(item => item.id === selectedItem.id ? { ...item, ...updates } : item));
    } catch (err) {
      console.error("Failed to update item:", err);
      alert("更新失败");
    }
  };

  const handleInsertTimestamp = () => {
    if (!reviewEditor) return;
    const formatTime = (sec: number) => {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };
    const label = `[${formatTime(currentTime)}]`;
    reviewEditor.commands.setTimestamp(currentTime, label);
  };

  const handlePostReview = async () => {
    if (!reviewEditor || !selectedItem) return;
    const html = reviewEditor.getHTML();
    if (!html || html === "<p></p>") return;

    try {
      await api.request(`/media/items/${selectedItem.id}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          type: reviewType,
          title: reviewType === "long_review" ? reviewTitle : null,
          content: html
        })
      });
      reviewEditor.commands.setContent("");
      setReviewTitle("");
      setShowReviewInput(false);
      // Reload reviews
      const freshReviews = await api.request<Review[]>(`/media/items/${selectedItem.id}/reviews`);
      setReviews(freshReviews || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteReview = async (reviewId: string) => {
    if (!window.confirm("确定删除这条评论吗？")) return;
    try {
      await api.request(`/media/reviews/${reviewId}`, { method: "DELETE" });
      setReviews(reviews.filter(r => r.id !== reviewId));
    } catch (err) {
      console.error(err);
    }
  };

  // Click timestamp in reviews handler
  const handleTimestampClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("timestamp-link") || target.closest(".timestamp-link")) {
      e.preventDefault();
      const link = target.closest(".timestamp-link") as HTMLAnchorElement;
      const timeStr = link.getAttribute("data-time");
      if (timeStr) {
        const time = parseInt(timeStr, 10);
        if (!isNaN(time)) {
          useMediaStore.getState().triggerSeek(time);
        }
      }
    }
  };

  // 列表/浏览态有左侧媒体侧栏（md:w-56）；详情页无侧栏。供全局播放器 left 避让。
  useEffect(() => {
    const hasSidebar = !selectedItem;
    const apply = () => {
      const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches;
      document.documentElement.style.setProperty(
        "--media-sidebar-width",
        desktop && hasSidebar ? "14rem" : "0px",
      );
    };
    apply();
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      document.documentElement.style.setProperty("--media-sidebar-width", "0px");
    };
  }, [selectedItem]);

  // 通知资料库壳：详情打开时隐藏「文件|书库|媒体」StackChrome，改由详情顶栏接管
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("super:media-detail-chrome", { detail: { open: !!selectedItem } }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("super:media-detail-chrome", { detail: { open: false } }),
      );
    };
  }, [selectedItem]);

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary select-none">
      {/* 列表态不再叠一层 MobileChromeHeader：资料库 Tab 已提供入口上下文，省垂直空间 */}
      
      {/* 1. Detail view mode */}
      <AnimatePresence mode="wait">
        {selectedItem ? (
          <motion.div 
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto w-full flex flex-col md:gap-0 pb-[calc(1.5rem+var(--safe-area-bottom))] md:pb-6"
          >
            {/* 桌面详情顶栏：替换资料库 StackChrome（文件|书库|媒体）；返回左、删除右上
                移动端仍走 StackChrome 返回 + 右上删除 icon */}
            <div
              className={cn(
                "hidden md:flex items-center justify-between shrink-0 sticky top-0 z-30",
                "px-4 lg:px-6 py-2.5 border-b border-app-border",
                "bg-app-surface/95 backdrop-blur-md",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-tx-secondary hover:text-tx-primary bg-app-sidebar/40 border border-app-border/40 px-3 py-1.5 rounded-lg transition-colors"
              >
                <ChevronLeft size={16} />
                返回媒体列表
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={async () => {
                    if (window.confirm("确认要删除这个单品吗？")) {
                      await api.request(`/media/items/${selectedItem.id}`, { method: "DELETE" });
                      setSelectedItem(null);
                      fetchData();
                    }
                  }}
                  className="text-xs text-accent-danger hover:bg-accent-danger/10 px-3 py-1.5 rounded-lg border border-accent-danger/20 transition-colors"
                >
                  删除单品
                </button>
              ) : (
                <div className="w-10" aria-hidden />
              )}
            </div>

            {/* 移动端：删除 icon 放到顶栏右上角（StackChrome 右侧空位） */}
            {isAdmin &&
              createPortal(
                <button
                  type="button"
                  data-media-chrome
                  onClick={async () => {
                    if (window.confirm("确认要删除这个单品吗？")) {
                      await api.request(`/media/items/${selectedItem.id}`, { method: "DELETE" });
                      setSelectedItem(null);
                      fetchData();
                    }
                  }}
                  className="md:hidden fixed z-[45] w-10 h-10 rounded-xl text-accent-danger hover:bg-accent-danger/10 active:scale-95 flex items-center justify-center"
                  style={{
                    top: "calc(var(--safe-area-top, 0px) + 12px)",
                    right: "10px",
                  }}
                  title="删除单品"
                  aria-label="删除单品"
                >
                  <Trash2 size={18} />
                </button>,
                document.body,
              )}

            {/* 详情正文限宽居中 */}
            <div className="w-full max-w-5xl mx-auto flex flex-col md:gap-6 flex-1 min-h-0">
            {/* Media Player wrapper：上滑评论时吸顶；移动端去掉冗余导航条后顶到 StackChrome 下方 */}
            <div className="relative w-full md:px-6 sticky top-0 z-20 bg-app-bg md:static md:z-auto">
              {selectedItem.type === "video" ? (
                <MediaPlayer
                  mediaId={selectedItem.id}
                  media={{
                    title: selectedItem.title,
                    type: selectedItem.type,
                    alist_path: selectedItem.alist_path,
                    cover_url: selectedItem.cover_url,
                    duration: selectedItem.duration,
                    artist: selectedItem.artist,
                    album: selectedItem.album,
                  }}
                  // 全屏返回：仅退出全屏并暂停，不离开详情页
                  onExitFullscreen={undefined}
                />
              ) : (
                <MusicPlayer mediaId={selectedItem.id} />
              )}
            </div>

            {/* Details block */}
            <div className="flex flex-col gap-6 px-4 md:px-6 mt-4 md:mt-0 w-full mb-10">
              
              {/* Metadata & Reviews Container */}
              <div className="flex flex-col bg-app-sidebar/10 border border-app-border/40 rounded-2xl p-5 md:p-6">
                
                {/* 1. Metadata Section */}
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {selectedItem.year && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-app-hover border border-app-border rounded-md text-tx-secondary">
                          {selectedItem.year} 年
                        </span>
                      )}
                      {selectedItem.genre && (() => {
                        try {
                          const parsed = JSON.parse(selectedItem.genre || "[]");
                          return parsed.map((g: string, idx: number) => (
                            <span key={idx} className="text-[10px] font-bold px-1.5 py-0.5 bg-accent-primary/10 border border-accent-primary/20 rounded-md text-accent-primary">
                              {g}
                            </span>
                          ));
                        } catch {
                          return null;
                        }
                      })()}
                    </div>
                    {editingTitle ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={editTitleValue}
                          onChange={(e) => setEditTitleValue(e.target.value)}
                          className="flex-1 bg-app-sidebar border border-accent-primary text-xl font-bold tracking-tight text-tx-primary rounded-lg px-2 py-1 outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleUpdateItem({ title: editTitleValue });
                              setEditingTitle(false);
                            } else if (e.key === 'Escape') {
                              setEditingTitle(false);
                            }
                          }}
                        />
                        <button onClick={() => { handleUpdateItem({ title: editTitleValue }); setEditingTitle(false); }} className="text-xs font-bold text-white bg-accent-primary hover:bg-accent-primary-hover px-3 py-1.5 rounded-lg shadow">保存</button>
                        <button onClick={() => setEditingTitle(false)} className="text-xs font-semibold text-tx-secondary hover:text-tx-primary bg-app-sidebar hover:bg-app-hover border border-app-border px-3 py-1.5 rounded-lg">取消</button>
                      </div>
                    ) : (
                      <h2 className="text-xl font-bold tracking-tight text-tx-primary group/title flex items-center gap-2">
                        {selectedItem.title}
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setEditTitleValue(selectedItem.title);
                              setEditingTitle(true);
                            }}
                            className="opacity-0 group-hover/title:opacity-100 transition-opacity text-tx-tertiary hover:text-accent-primary p-1"
                            title="编辑标题"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}
                      </h2>
                    )}
                    {(selectedItem.artist || selectedItem.album) && (
                      <p className="text-xs text-tx-secondary font-medium mt-0.5">
                        {selectedItem.artist || "未知歌手"}
                        {selectedItem.album ? ` · ${selectedItem.album}` : ""}
                      </p>
                    )}
                    {selectedItem.collection_title && (
                      <p className="text-xs text-tx-tertiary mt-0.5">合集: <span className="font-semibold">{selectedItem.collection_title}</span></p>
                    )}
                  </div>

                  <div className="border-t border-app-border/30 pt-3 flex flex-col gap-2 group/desc relative">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase text-tx-tertiary tracking-wider">描述介绍</span>
                      {isAdmin && !editingDescription && (
                        <button
                          onClick={() => {
                            setEditDescValue(selectedItem.description || "");
                            setEditingDescription(true);
                          }}
                          className="opacity-0 group-hover/desc:opacity-100 transition-opacity text-tx-tertiary hover:text-accent-primary p-1 flex items-center gap-1 text-[10px] font-semibold"
                        >
                          <Edit3 size={12} /> 编辑描述
                        </button>
                      )}
                    </div>
                    {editingDescription ? (
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={editDescValue}
                          onChange={(e) => setEditDescValue(e.target.value)}
                          className="w-full bg-app-sidebar border border-accent-primary text-xs text-tx-primary rounded-xl p-3 outline-none min-h-[100px] resize-y"
                          autoFocus
                          placeholder="添加视频/音频的详细描述..."
                        />
                        <div className="flex items-center gap-2 self-end">
                          <button onClick={() => setEditingDescription(false)} className="text-xs font-semibold text-tx-secondary hover:text-tx-primary bg-app-sidebar hover:bg-app-hover border border-app-border px-4 py-1.5 rounded-lg">取消</button>
                          <button onClick={() => { handleUpdateItem({ description: editDescValue }); setEditingDescription(false); }} className="text-xs font-bold text-white bg-accent-primary hover:bg-accent-primary-hover px-4 py-1.5 rounded-lg shadow">保存描述</button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-tx-secondary leading-relaxed bg-app-bg/40 p-3 rounded-xl border border-app-border/30">
                        {selectedItem.description || "无详细描述介绍。"}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-4 text-[10px] text-tx-tertiary select-none flex-wrap">
                    <span className="flex items-center gap-1"><Play size={12} /> 播放次数: {selectedItem.play_count}</span>
                    <span className="flex items-center gap-1"><Clock size={12} /> 时长: {formatDuration(selectedItem.duration)}</span>
                    {isMobile && cachedIds.has(selectedItem.id) && (
                      <span className="flex items-center gap-1 text-accent-primary font-semibold">
                        <HardDrive size={12} /> 已本地缓存
                      </span>
                    )}
                  </div>

                  {/* 本地缓存操作（仅移动端） */}
                  {isMobile && (
                    <div className="flex items-center gap-2">
                      {cachedIds.has(selectedItem.id) ? (
                        <button
                          type="button"
                          onClick={() => void uncacheItem(selectedItem)}
                          className="min-h-11 flex-1 px-3 rounded-xl border border-app-border text-xs font-semibold text-tx-secondary flex items-center justify-center gap-1.5 active:bg-app-hover"
                        >
                          <HardDrive size={14} />
                          删除本地缓存
                        </button>
                      ) : (() => {
                        const job = getMediaCacheJob(selectedItem.id);
                        if (job?.status === "downloading" || job?.status === "queued") {
                          const pct =
                            job.progress >= 0
                              ? Math.round(job.progress * 100)
                              : null;
                          return (
                            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
                              <div className="min-h-11 px-3 rounded-xl border border-accent-primary/30 bg-accent-primary/5 text-xs font-semibold text-accent-primary flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex justify-between gap-2">
                                    <span>
                                      {job.status === "queued"
                                        ? "排队中"
                                        : pct != null
                                          ? `缓存中 ${pct}%`
                                          : "缓存中…"}
                                    </span>
                                  </div>
                                  <div className="mt-1 h-1 rounded-full bg-accent-primary/15 overflow-hidden">
                                    <div
                                      className={cn(
                                        "h-full bg-accent-primary rounded-full",
                                        job.progress < 0 && "w-1/3 animate-pulse",
                                      )}
                                      style={
                                        pct != null ? { width: `${pct}%` } : undefined
                                      }
                                    />
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="shrink-0 px-2 py-1 rounded-lg text-tx-secondary"
                                  onClick={() => pauseMediaCacheJob(selectedItem.id)}
                                >
                                  暂停
                                </button>
                              </div>
                            </div>
                          );
                        }
                        if (job?.status === "paused") {
                          const pct =
                            job.progress >= 0
                              ? Math.round(job.progress * 100)
                              : 0;
                          return (
                            <button
                              type="button"
                              onClick={() => resumeMediaCacheJob(selectedItem.id)}
                              className="min-h-11 flex-1 px-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1.5"
                            >
                              继续缓存{pct > 0 ? ` ${pct}%` : ""}
                            </button>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => cacheItem(selectedItem)}
                            className="min-h-11 flex-1 px-3 rounded-xl bg-accent-primary text-white text-xs font-bold flex items-center justify-center gap-1.5 active:opacity-90"
                          >
                            <DownloadCloud size={14} />
                            缓存到本地
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* 2. Reviews Section (Moved here, taking full width of the container) */}
                <div className="mt-6 pt-6 border-t border-app-border/40 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase text-tx-tertiary tracking-wider flex items-center gap-1.5">
                      <MessageSquare size={16} /> 影评与讨论
                    </h3>
                    {selectedItem.type === "video" && isPlaying && (
                      <button
                        onClick={handleInsertTimestamp}
                        className="text-xs font-bold text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        打点 {formatDuration(currentTime)}
                      </button>
                    )}
                  </div>

                  {/* Review listing */}
                  <div 
                    onClick={handleTimestampClick}
                    className="flex flex-col gap-3 min-h-[100px]"
                  >
                    {reviews.length === 0 ? (
                      <div className="h-[100px] flex items-center justify-center text-xs text-tx-tertiary text-center p-4 bg-app-sidebar/5 rounded-xl border border-app-border/20 border-dashed">
                        暂无评论或影评，点击下方发布首条评论吧！
                      </div>
                    ) : (
                      reviews.map((rev) => (
                        <div key={rev.id} className="p-4 bg-app-bg/50 hover:bg-app-bg border border-app-border rounded-xl flex flex-col gap-2 relative group transition-colors">
                          <div className="flex items-center justify-between text-xs text-tx-tertiary select-none">
                            <span className="font-semibold text-tx-secondary flex items-center gap-1.5">
                              <User size={12} /> {rev.username}
                            </span>
                            <span>{rev.created_at.substring(5, 16)}</span>
                          </div>
                          {rev.title && (
                            <h5 className="text-sm font-bold text-tx-primary">{rev.title}</h5>
                          )}
                          <div 
                            className="text-sm text-tx-secondary leading-relaxed break-words mt-1"
                            dangerouslySetInnerHTML={{ __html: rev.content }}
                          />
                          {isAdmin && (
                            <button 
                              onClick={() => handleDeleteReview(rev.id)}
                              className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-accent-danger hover:bg-accent-danger/10 rounded"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* 写评论入口：编辑区以弹窗形式出现（移动/桌面一致） */}
                  <div className="flex justify-center mt-4">
                    <button
                      type="button"
                      onClick={() => setShowReviewInput(true)}
                      className="px-6 py-2.5 bg-app-sidebar border border-app-border hover:bg-app-hover hover:border-accent-primary/50 text-tx-secondary hover:text-accent-primary font-bold text-sm rounded-xl shadow-sm flex items-center gap-2 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out group"
                    >
                      <MessageSquare size={16} className="group-[@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 transition-transform" />
                      写评论 / 影评
                    </button>
                  </div>
                </div>
              </div>

            </div>
            </div>{/* end max-w content shell */}
          </motion.div>
        ) : isMobile ? (
          /* 2a. Mobile: 类型 → 合集 → 文件列表 */
          <motion.div
            key={`mobile-${mobileLevel}`}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18 }}
            className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg"
          >
            {mobileLevel === "type" && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* titlebar 右上角：车载入口（始终）+ Alist 设置（管理员） */}
                {typeof document !== "undefined" &&
                  createPortal(
                    <div
                      data-media-chrome
                      className="md:hidden fixed z-[45] flex items-center gap-0.5"
                      style={{
                        top: "calc(var(--safe-area-top, 0px) + 12px)",
                        right: "10px",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setShowCarMode(true)}
                        className="w-11 h-11 min-w-11 min-h-11 rounded-xl text-tx-secondary hover:text-tx-primary hover:bg-app-hover active:scale-95 flex items-center justify-center transition-colors duration-press"
                        title="车载 / CarLife"
                        aria-label="车载 / CarLife"
                      >
                        <Car size={20} />
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void openAlistSettings()}
                          className="w-11 h-11 min-w-11 min-h-11 rounded-xl text-tx-secondary hover:text-tx-primary hover:bg-app-hover active:scale-95 flex items-center justify-center transition-colors duration-press"
                          title="Alist 挂载配置"
                          aria-label="Alist 挂载配置"
                        >
                          <Settings size={20} />
                        </button>
                      )}
                    </div>,
                    document.body,
                  )}
                {/* 紧贴 titlebar 下方，无居中大标题 */}
                <div className="flex-1 overflow-y-auto px-4 pt-3 pb-[calc(5.5rem+var(--safe-area-bottom,0px))] flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => enterMediaType("video")}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-app-border bg-app-sidebar/40 hover:bg-app-hover active:scale-[0.99] transition-[transform,background-color,border-color,color] duration-press ease-out text-left"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/25 flex items-center justify-center shrink-0">
                      <Film size={24} className="text-sky-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-tx-primary">视频</p>
                      <p className="text-xs text-tx-tertiary mt-0.5">电影、剧集与其它视频合集</p>
                    </div>
                    <ChevronRight size={18} className="text-tx-tertiary shrink-0" />
                  </button>
                  <button
                    type="button"
                    onClick={() => enterMediaType("audio")}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-app-border bg-app-sidebar/40 hover:bg-app-hover active:scale-[0.99] transition-[transform,background-color,border-color,color] duration-press ease-out text-left"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
                      <Music size={24} className="text-violet-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-tx-primary">音频</p>
                      <p className="text-xs text-tx-tertiary mt-0.5">音乐、播客与其它音频合集</p>
                    </div>
                    <ChevronRight size={18} className="text-tx-tertiary shrink-0" />
                  </button>
                  {/* 车载 / CarLife：说明与同步入口（非 CarLife 合作 SDK） */}
                  <button
                    type="button"
                    onClick={() => setShowCarMode(true)}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border border-app-border bg-app-sidebar/40 hover:bg-app-hover active:scale-[0.99] transition-[transform,background-color,border-color,color] duration-press ease-out text-left"
                  >
                    <div className="w-12 h-12 rounded-2xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center shrink-0">
                      <Car size={24} className="text-accent-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-tx-primary">车载 / CarLife</p>
                      <p className="text-xs text-tx-tertiary mt-0.5">
                        蓝牙与车机控制说明 · 同步音乐库
                      </p>
                    </div>
                    <ChevronRight size={18} className="text-tx-tertiary shrink-0" />
                  </button>
                </div>
              </div>
            )}

            {mobileLevel === "collections" && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* 新建合集：仅加号，portal 到 titlebar 右上角 */}
                {isAdmin &&
                  createPortal(
                    <button
                      type="button"
                      data-media-chrome
                      onClick={handleOpenAddCollection}
                      className="md:hidden fixed z-[45] w-10 h-10 rounded-xl text-accent-primary hover:bg-accent-primary/10 active:scale-95 flex items-center justify-center"
                      style={{
                        top: "calc(var(--safe-area-top, 0px) + 12px)",
                        right: "10px",
                      }}
                      title="新建合集"
                      aria-label="新建合集"
                    >
                      <Plus size={22} strokeWidth={2.25} />
                    </button>,
                    document.body,
                  )}
                <div className="flex-1 overflow-y-auto px-3 pt-3 pb-[calc(5.5rem+var(--safe-area-bottom,0px))]">
                  {loading ? (
                    <LoadingBlock label="正在载入合集…" className="h-48" />
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => enterCollection(null)}
                        className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-app-border bg-app-sidebar/30 hover:bg-app-hover active:scale-[0.99] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out text-left"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-tx-primary">全部</p>
                          <p className="text-[11px] text-tx-tertiary mt-0.5">查看该类型下所有文件</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-app-border/50 text-tx-secondary font-semibold">
                            {totalItemCount}
                          </span>
                          <ChevronRight size={16} className="text-tx-tertiary" />
                        </div>
                      </button>
                      {collections.map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => enterCollection(col)}
                          className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-app-border bg-app-sidebar/30 hover:bg-app-hover active:scale-[0.99] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out text-left"
                        >
                          <div className="min-w-0 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/15 flex items-center justify-center shrink-0">
                              {mediaType === "audio" ? (
                                <Music size={18} className="text-accent-primary" />
                              ) : (
                                <Film size={18} className="text-accent-primary" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-bold text-tx-primary truncate">{col.title}</p>
                              {col.description ? (
                                <p className="text-[11px] text-tx-tertiary truncate mt-0.5">{col.description}</p>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] px-2 py-0.5 rounded-md bg-app-border/50 text-tx-secondary font-semibold">
                              {col.item_count}
                            </span>
                            <ChevronRight size={16} className="text-tx-tertiary" />
                          </div>
                        </button>
                      ))}
                      {collections.length === 0 && (
                        <EmptyState
                          icon={mediaType === "audio" ? Music : Film}
                          title="暂无合集"
                          description={isAdmin ? "点击右上角 + 新建合集，或稍后从网盘导入" : "还没有可浏览的合集"}
                          className="h-48 rounded-2xl border border-dashed border-app-border/60 bg-app-surface/30 mt-4"
                        />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {mobileLevel === "items" && (
              <div className="flex-1 flex flex-col min-h-0 relative">
                {/* 搜索 + 面包屑菜单：portal 到 titlebar 右上角（与「媒体」同一水平线） */}
                {typeof document !== "undefined" &&
                  createPortal(
                    <div
                      data-media-chrome
                      className="md:hidden fixed z-[45] flex items-center gap-0.5"
                      style={{
                        top: "calc(var(--safe-area-top, 0px) + 12px)",
                        right: "10px",
                      }}
                    >
                      {!showMobileSearch && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setShowItemsMenu(false);
                              setShowMobileSearch(true);
                            }}
                            className="w-10 h-10 rounded-xl flex items-center justify-center text-tx-secondary hover:text-tx-primary hover:bg-app-hover active:scale-95"
                            title="搜索"
                            aria-label="搜索"
                          >
                            <Search size={20} />
                          </button>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setShowItemsMenu((v) => !v)}
                              className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center active:scale-95 transition-colors",
                                showItemsMenu
                                  ? "text-accent-primary bg-accent-primary/10"
                                  : "text-tx-secondary hover:text-tx-primary hover:bg-app-hover",
                              )}
                              title={selectedCollection?.title || "全部 · 更多"}
                              aria-label="更多操作"
                            >
                              {/* 面包屑式菜单入口（替代原「全部 >」文案按钮） */}
                              <MoreHorizontal size={22} />
                            </button>
                            {showItemsMenu && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setShowItemsMenu(false)}
                                />
                                <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-2xl border border-app-border bg-app-elevated shadow-2xl py-1.5 overflow-hidden">
                                  <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-bold text-tx-tertiary truncate">
                                    {mediaType === "video" ? "视频" : "音频"}
                                    {" / "}
                                    {selectedCollection?.title || "全部"}
                                  </p>
                                  <div className="my-1 border-t border-app-border/60" />
                                  <button
                                    type="button"
                                    className={cn(
                                      "w-full px-3.5 py-2.5 text-left text-sm hover:bg-app-hover flex items-center gap-2",
                                      isBatchMode ? "text-accent-danger" : "text-tx-primary",
                                    )}
                                    onClick={() => {
                                      setShowItemsMenu(false);
                                      setIsBatchMode(!isBatchMode);
                                      setSelectedItemIds(new Set());
                                    }}
                                  >
                                    <SlidersHorizontal size={15} />
                                    {isBatchMode ? "退出选择" : "选择 / 批量缓存"}
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full px-3.5 py-2.5 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center gap-2"
                                    onClick={() => {
                                      setShowItemsMenu(false);
                                      setShowCacheSheet(true);
                                    }}
                                  >
                                    <HardDrive size={15} />
                                    缓存管理
                                  </button>
                                  {isAdmin && (
                                    <>
                                      <div className="my-1 border-t border-app-border/60" />
                                      <button
                                        type="button"
                                        className="w-full px-3.5 py-2.5 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center gap-2"
                                        onClick={() => {
                                          setShowItemsMenu(false);
                                          setShowAlistBrowser(true);
                                        }}
                                      >
                                        <Plus size={15} className="text-accent-primary" />
                                        网盘导入
                                      </button>
                                      <div className="my-1 border-t border-app-border/60" />
                                    </>
                                  )}
                                  <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                                    展示方式
                                  </p>
                                  <button
                                    type="button"
                                    className="w-full px-3.5 py-2 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center justify-between"
                                    onClick={() => {
                                      setViewStyle("grid");
                                      setShowItemsMenu(false);
                                    }}
                                  >
                                    <span className="flex items-center gap-2">
                                      <Grid size={15} /> 九宫格
                                    </span>
                                    {viewStyle === "grid" && <Check size={14} className="text-accent-primary" />}
                                  </button>
                                  <button
                                    type="button"
                                    className="w-full px-3.5 py-2 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center justify-between"
                                    onClick={() => {
                                      setViewStyle("list");
                                      setShowItemsMenu(false);
                                    }}
                                  >
                                    <span className="flex items-center gap-2">
                                      <ListIcon size={15} /> 列表
                                    </span>
                                    {viewStyle === "list" && <Check size={14} className="text-accent-primary" />}
                                  </button>
                                  <div className="my-1 border-t border-app-border/60" />
                                  <p className="px-3.5 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-tx-tertiary">
                                    排序 · {sortLabel}
                                  </p>
                                  {(
                                    [
                                      ["sort_order", "默认排序"],
                                      ["newest", "最新"],
                                      ["oldest", "最早"],
                                      ["play_count", "热门"],
                                      ["title", "拼音"],
                                    ] as const
                                  ).map(([value, label]) => (
                                    <button
                                      key={value}
                                      type="button"
                                      className="w-full px-3.5 py-2 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center justify-between"
                                      onClick={() => {
                                        setSortBy(value);
                                        setShowItemsMenu(false);
                                      }}
                                    >
                                      <span>{label}</span>
                                      {sortBy === value && <Check size={14} className="text-accent-primary" />}
                                    </button>
                                  ))}
                                  {selectedCollection && isAdmin && (
                                    <>
                                      <div className="my-1 border-t border-app-border/60" />
                                      <button
                                        type="button"
                                        className="w-full px-3.5 py-2.5 text-left text-sm text-tx-primary hover:bg-app-hover flex items-center gap-2"
                                        onClick={() => {
                                          setShowItemsMenu(false);
                                          handleOpenEditCollection(selectedCollection);
                                        }}
                                      >
                                        <Edit3 size={15} />
                                        编辑合集
                                      </button>
                                      <button
                                        type="button"
                                        className="w-full px-3.5 py-2.5 text-left text-sm text-accent-danger hover:bg-accent-danger/10 flex items-center gap-2"
                                        onClick={() => {
                                          setShowItemsMenu(false);
                                          void handleDeleteCollection(selectedCollection);
                                        }}
                                      >
                                        <Trash2 size={15} />
                                        删除合集
                                      </button>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>,
                    document.body,
                  )}

                {/* 展开搜索时：贴 titlebar 下的搜索条 */}
                {showMobileSearch && (
                  <div className="shrink-0 px-3 py-2 border-b border-app-border flex items-center gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-tx-tertiary" />
                      <input
                        ref={mobileSearchRef}
                        type="search"
                        placeholder="搜索文件…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-8 py-2 bg-app-sidebar border border-app-border text-sm rounded-xl outline-none text-tx-primary focus:border-accent-primary"
                      />
                      {searchQuery ? (
                        <button
                          type="button"
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-tx-tertiary"
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowMobileSearch(false);
                        setSearchQuery("");
                      }}
                      className="text-xs font-semibold text-accent-primary px-1 shrink-0"
                    >
                      取消
                    </button>
                  </div>
                )}

                {/* 文件列表：直接上移到 titlebar 下 */}
                <div className="flex-1 overflow-y-auto p-3 pt-3 pb-[calc(5.5rem+var(--safe-area-bottom,0px)+var(--mobile-extra-bottom,0px))]">
                  {selectedCollection?.recommendation && (
                    <div className="mb-3 text-xs text-accent-primary font-medium bg-accent-primary/5 p-2.5 rounded-xl border border-accent-primary/10">
                      合集评语: {selectedCollection.recommendation}
                    </div>
                  )}
                  {loading ? (
                    <LoadingBlock label="正在载入媒体文件…" className="h-64" />
                  ) : items.length === 0 ? (
                    <EmptyState
                      icon={mediaType === "audio" ? Music : Film}
                      title="暂无媒体文件"
                      description={isAdmin ? "通过右上角菜单导入文件" : "该合集还没有内容"}
                      className="h-64 rounded-2xl border border-dashed border-app-border/60 bg-app-surface/30"
                    />
                  ) : viewStyle === "list" ? (
                    <div className="flex flex-col gap-1">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isBatchMode) {
                              const next = new Set(selectedItemIds);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              setSelectedItemIds(next);
                            } else if (item.type === "audio") {
                              playMedia(item, items);
                            } else {
                              playMedia(item, items);
                              setSelectedItem(item);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-3 p-2.5 rounded-xl border border-app-border/50 bg-app-sidebar/20 active:bg-app-hover",
                            isBatchMode && selectedItemIds.has(item.id) && "border-accent-primary/40 bg-accent-primary/5",
                          )}
                        >
                          {isBatchMode && (
                            <div
                              className={cn(
                                "w-5 h-5 rounded-md border flex items-center justify-center shrink-0",
                                selectedItemIds.has(item.id)
                                  ? "bg-accent-primary border-accent-primary text-white"
                                  : "border-app-border",
                              )}
                            >
                              {selectedItemIds.has(item.id) && <Check size={12} />}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-tx-primary truncate flex items-center gap-1.5">
                              <span className="truncate">{item.title}</span>
                              {cachedIds.has(item.id) && (
                                <HardDrive
                                  size={12}
                                  className="shrink-0 text-accent-primary"
                                  aria-label="已缓存"
                                />
                              )}
                              {getMediaCacheJob(item.id)?.status === "downloading" && (
                                <span className="shrink-0 text-[10px] font-bold text-accent-primary tabular-nums flex items-center gap-0.5">
                                  <Loader2 size={11} className="animate-spin" />
                                  {getMediaCacheJob(item.id)!.progress >= 0
                                    ? `${Math.round(getMediaCacheJob(item.id)!.progress * 100)}%`
                                    : "…"}
                                </span>
                              )}
                              {getMediaCacheJob(item.id)?.status === "paused" && (
                                <span className="shrink-0 text-[10px] font-bold text-amber-500 tabular-nums">
                                  暂停
                                  {getMediaCacheJob(item.id)!.progress > 0
                                    ? ` ${Math.round(getMediaCacheJob(item.id)!.progress * 100)}%`
                                    : ""}
                                </span>
                              )}
                              {getMediaCacheJob(item.id)?.status === "queued" && (
                                <span className="shrink-0 text-[10px] text-tx-tertiary">排队</span>
                              )}
                            </p>
                            <p className="text-[11px] text-tx-tertiary truncate">
                              {item.type === "audio"
                                ? [item.artist, item.album].filter(Boolean).join(" · ") || "未知歌手"
                                : item.collection_title || formatDuration(item.duration)}
                            </p>
                          </div>
                          <span className="text-[10px] text-tx-tertiary shrink-0">
                            {formatDuration(item.duration)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2.5">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isBatchMode) {
                              const next = new Set(selectedItemIds);
                              if (next.has(item.id)) next.delete(item.id);
                              else next.add(item.id);
                              setSelectedItemIds(next);
                            } else if (item.type === "audio") {
                              playMedia(item, items);
                            } else {
                              playMedia(item, items);
                              setSelectedItem(item);
                            }
                          }}
                          className="group relative"
                        >
                          <div
                            className={cn(
                              // 与桌面网格一致：视频 16:9，音频方图
                              "relative rounded-xl overflow-hidden border border-app-border/40",
                              item.type === "video"
                                ? "aspect-video bg-black/20"
                                : "aspect-square bg-app-sidebar",
                              isBatchMode && selectedItemIds.has(item.id) && "ring-2 ring-accent-primary",
                            )}
                          >
                            {cachedIds.has(item.id) && (
                              <span
                                className="absolute top-1 left-1 z-10 w-6 h-6 rounded-lg bg-black/55 text-white flex items-center justify-center"
                                title="已缓存"
                              >
                                <HardDrive size={12} />
                              </span>
                            )}
                            {getMediaCacheJob(item.id)?.status === "downloading" && (
                              <span className="absolute top-1 left-1 z-10 w-6 h-6 rounded-lg bg-black/55 text-white flex items-center justify-center">
                                <Loader2 size={12} className="animate-spin" />
                              </span>
                            )}
                            {item.type === "audio" ? (
                              <AudioCover
                                item={item}
                                className="w-full h-full object-cover"
                                fallbackIconSize={28}
                              />
                            ) : item.cover_url ? (
                              <img
                                src={resolveAttachmentUrl(item.cover_url) || item.cover_url}
                                alt={item.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  const el = e.currentTarget;
                                  if (!el.dataset.fallback) {
                                    el.dataset.fallback = "1";
                                    el.src = "/default_video_cover.jpg";
                                  }
                                }}
                              />
                            ) : (
                              <img
                                src="/default_video_cover.jpg"
                                alt={item.title}
                                className="w-full h-full object-cover opacity-75"
                                loading="lazy"
                              />
                            )}
                            {isBatchMode && (
                              <div
                                className={cn(
                                  "absolute top-1.5 left-1.5 w-5 h-5 rounded-md border flex items-center justify-center",
                                  selectedItemIds.has(item.id)
                                    ? "bg-accent-primary border-accent-primary text-white"
                                    : "bg-black/40 border-white/40 text-white",
                                )}
                              >
                                {selectedItemIds.has(item.id) && <Check size={12} />}
                              </div>
                            )}
                            {!!item.duration && (
                              <span className="absolute bottom-1 right-1 bg-black/75 rounded px-1 py-0.5 text-[9px] text-white font-semibold">
                                {formatDuration(item.duration)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-[11px] font-semibold text-tx-primary line-clamp-2 leading-snug">
                            {item.title}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          /* 2b. Desktop Browser Dashboard */
          <motion.div 
            key="browser"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0 md:flex-row overflow-hidden relative"
          >
            
            {/* Sidebar — 桌面 fixed：顶边避让资料库 StackChrome（--library-chrome-height），
                底贴视口；勿 top:0 以免盖住「文件|书库|媒体」分段控件 */}
            <div
              className={cn(
                "w-full md:w-56 border-b md:border-b-0 md:border-r border-app-border shrink-0",
                "px-2 py-1.5 md:p-4 flex flex-row md:flex-col gap-1.5 md:gap-4",
                "overflow-x-auto md:overflow-y-auto items-center md:items-stretch bg-app-sidebar",
                "md:fixed md:bottom-0 md:z-[25]",
              )}
              style={{
                backgroundColor: "var(--color-sidebar-solid, var(--color-sidebar))",
                left: "var(--nav-rail-width, 0px)",
                top: "var(--library-chrome-height, 0px)",
              }}
            >
              
              {/* Type Switcher */}
              <div className="flex md:flex-col gap-1.5 shrink-0">
                <span className="text-xs font-bold text-tx-tertiary uppercase tracking-wider select-none">媒体类型</span>
                <div className="flex gap-1 md:gap-2">
                  <button
                    onClick={() => { setMediaType("video"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-sm font-bold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
                      mediaType === "video" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-md shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                    title="视频库"
                    aria-label="视频库"
                  >
                    <Film size={15} />
                    <span>视频库</span>
                  </button>
                  <button
                    onClick={() => { setMediaType("audio"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-sm font-bold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
                      mediaType === "audio" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-md shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                    title="音乐库"
                    aria-label="音乐库"
                  >
                    <Music size={15} />
                    <span>音乐库</span>
                  </button>
                </div>
              </div>

              {/* Collections Navigation list */}
              <div className="flex flex-row md:flex-col gap-1 md:gap-2 flex-1 min-w-0 items-center md:items-stretch">
                <div className="flex items-center justify-between select-none shrink-0">
                  <span className="text-xs font-bold text-tx-tertiary uppercase tracking-wider">全部合集</span>
                  {isAdmin && (
                    <button 
                      onClick={handleOpenAddCollection}
                      className="inline-flex text-accent-primary hover:bg-accent-primary/10 p-1.5 rounded transition-colors"
                      title="新建合集"
                    >
                      <PlusCircle size={16} />
                    </button>
                  )}
                </div>

                <div className="flex flex-row md:flex-col gap-1 md:gap-1 overflow-x-auto md:overflow-y-auto min-w-0">
                  <button
                    onClick={() => setSelectedCollection(null)}
                    className={cn(
                      "w-full text-left py-1.5 px-2.5 rounded-lg text-sm font-semibold flex items-center justify-between transition-colors shrink-0",
                      selectedCollection === null 
                        ? "bg-accent-primary/10 text-accent-primary" 
                        : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                    )}
                  >
                    <span>全部 ({items.length})</span>
                  </button>
                  {collections.map(col => (
                    <button
                      key={col.id}
                      onClick={() => setSelectedCollection(col)}
                      className={cn(
                        "w-full text-left py-1.5 px-2.5 rounded-lg text-sm font-semibold flex items-center gap-2 justify-between transition-colors shrink-0",
                        selectedCollection?.id === col.id 
                          ? "bg-accent-primary/10 text-accent-primary" 
                          : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                      )}
                    >
                      <span className="truncate max-w-[150px]">{col.title}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-app-border/40 text-tx-tertiary rounded font-normal shrink-0">
                        {col.item_count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings + 车载 */}
              <div className="border-t border-app-border/40 pt-3 select-none shrink-0 space-y-2">
                <button
                  type="button"
                  onClick={() => setShowCarMode(true)}
                  className="w-full py-2 px-3 border border-app-border hover:bg-app-hover rounded-xl flex items-center justify-center gap-2 text-sm text-tx-secondary hover:text-tx-primary transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out font-semibold"
                  title="车载 / CarLife"
                  aria-label="车载 / CarLife"
                >
                  <Car size={15} />
                  <span>车载 / CarLife</span>
                </button>
                {isAdmin && (
                  <button
                    onClick={() => void openAlistSettings()}
                    className="w-full py-2 px-3 border border-app-border hover:bg-app-hover rounded-xl flex items-center justify-center gap-2 text-sm text-tx-secondary hover:text-tx-primary transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out font-semibold"
                    title="Alist 挂载配置"
                    aria-label="Alist 挂载配置"
                  >
                    <Settings size={15} />
                    <span>Alist 挂载配置</span>
                  </button>
                )}
              </div>

            </div>

            {/* Grid browser view — 桌面为 fixed 侧栏留出等宽占位 */}
            <div className="flex-1 flex flex-col min-w-0 bg-app-bg md:ml-56">
              
              {/* Header filter actions */}
              <div className="p-4 border-b border-app-border flex flex-row items-center gap-3 select-none">
                
                {/* Search & Sort */}
                <div className="flex items-center gap-2 flex-1 min-w-0 max-w-md">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-tx-tertiary" />
                    <input
                      type="text"
                      placeholder="搜索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-app-sidebar border border-app-border text-sm rounded-xl outline-none text-tx-primary focus:border-accent-primary transition-colors"
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-app-sidebar border border-app-border text-sm rounded-xl p-2 text-tx-secondary outline-none shrink-0"
                    title="排序"
                    aria-label="排序"
                  >
                    <option value="sort_order">排序</option>
                    <option value="newest">最新</option>
                    <option value="oldest">最早</option>
                    <option value="play_count">热门</option>
                    <option value="title">拼音</option>
                  </select>

                  {/* Layout Switcher */}
                  <div className="flex items-center bg-app-sidebar border border-app-border rounded-xl p-0.5 shrink-0">
                    <button
                      onClick={() => setViewStyle("grid")}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        viewStyle === "grid" 
                          ? "bg-accent-primary text-white" 
                          : "text-tx-secondary hover:text-tx-primary"
                      )}
                      title="网格视图"
                    >
                      <Grid size={16} />
                    </button>
                    <button
                      onClick={() => setViewStyle("list")}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        viewStyle === "list" 
                          ? "bg-accent-primary text-white" 
                          : "text-tx-secondary hover:text-tx-primary"
                      )}
                      title="列表视图"
                    >
                      <ListIcon size={16} />
                    </button>
                  </div>
                </div>

                {/* 批量选择：桌面仅 admin（合入/删除）；缓存仅移动端 */}
                <div className="flex items-center gap-2 shrink-0">
                  {isAdmin && (
                    <button
                      onClick={() => {
                        setIsBatchMode(!isBatchMode);
                        setSelectedItemIds(new Set());
                      }}
                      className={cn(
                        "text-sm font-semibold py-2 px-3 rounded-xl flex items-center gap-1.5 transition-colors border",
                        isBatchMode
                          ? "bg-accent-danger/10 border-accent-danger/25 text-accent-danger hover:bg-accent-danger/20"
                          : "bg-app-sidebar border-app-border hover:bg-app-hover text-tx-secondary",
                      )}
                      title={isBatchMode ? "退出选择" : "批量选择"}
                      aria-label={isBatchMode ? "退出选择" : "批量选择"}
                    >
                      <SlidersHorizontal size={15} />
                      <span>{isBatchMode ? "退出选择" : "批量选择"}</span>
                    </button>
                  )}
                  {isAdmin && (
                    <>
                      <button
                        onClick={() => setShowAlistBrowser(true)}
                        className="bg-accent-primary hover:bg-accent-primary-hover text-white text-sm font-bold py-2 px-4 rounded-xl shadow-md shadow-accent-primary/10 flex items-center gap-1 transition-colors"
                        title="网盘导入"
                        aria-label="网盘导入"
                      >
                        <Plus size={15} />
                        <span>网盘导入</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Items content list — 底部为迷你播放器/批量条留白（栈页 tab-h=0 时仍够用） */}
              <div className="flex-1 overflow-y-auto p-3 md:p-6 pb-[calc(5.5rem+var(--safe-area-bottom,0px)+var(--mobile-extra-bottom,0px))]">
                
                {selectedCollection && (
                  <div className="mb-6 p-4 bg-app-sidebar/20 border border-app-border/40 rounded-2xl flex flex-col gap-2 relative group">
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-lg font-bold text-tx-primary">{selectedCollection.title}</h2>
                      {isAdmin && (
                        <div className="flex items-center gap-2 select-none">
                          <button
                            onClick={() => handleOpenEditCollection(selectedCollection)}
                            className="p-1 px-2 text-[11px] font-semibold text-tx-secondary hover:text-tx-primary border border-app-border hover:bg-app-hover rounded-lg flex items-center gap-1 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                            title="编辑合集"
                          >
                            <Edit3 size={12} />
                            编辑合集
                          </button>
                          <button
                            onClick={() => handleDeleteCollection(selectedCollection)}
                            className="p-1 px-2 text-[11px] font-semibold text-accent-danger hover:text-white hover:bg-accent-danger border border-accent-danger/20 rounded-lg flex items-center gap-1 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                            title="删除合集"
                          >
                            <Trash2 size={12} />
                            删除合集
                          </button>
                        </div>
                      )}
                    </div>
                    {selectedCollection.description && (
                      <p className="text-sm text-tx-secondary leading-relaxed">{selectedCollection.description}</p>
                    )}
                    {selectedCollection.recommendation && (
                      <div className="text-xs text-accent-primary font-medium bg-accent-primary/5 p-2 rounded-lg border border-accent-primary/10">
                        合集评语: {selectedCollection.recommendation}
                      </div>
                    )}
                  </div>
                )}

                {loading ? (
                  <LoadingBlock label="正在载入媒体文件…" className="h-64" />
                ) : items.length === 0 ? (
                  <EmptyState
                    icon={mediaType === "audio" ? Music : Film}
                    title="暂无媒体文件"
                    description="使用上方导入，录入第一批音视频"
                    className="h-64 rounded-2xl border border-dashed border-app-border/60 bg-app-surface/30"
                  />
                ) : viewStyle === "list" ? (
                  /* LIST VIEW — 无封面列；移动用卡片行，桌面用 table */
                  <>
                    {/* 移动列表 */}
                    <div className="flex flex-col gap-1 md:hidden">
                      {items.map((item) => (
                        <div
                          key={item.id}
                          onContextMenu={(e) => openItemContextMenu(e, item)}
                          onClick={() => {
                            if (isBatchMode) {
                              const newSelected = new Set(selectedItemIds);
                              if (newSelected.has(item.id)) newSelected.delete(item.id);
                              else newSelected.add(item.id);
                              setSelectedItemIds(newSelected);
                            } else if (item.type === "audio") {
                              playMedia(item, items);
                            } else {
                              playMedia(item, items);
                              setSelectedItem(item);
                            }
                          }}
                          className={cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-xl border border-app-border/30 bg-app-sidebar/10 active:bg-app-hover",
                            selectedItemIds.has(item.id) && isBatchMode && "border-accent-primary bg-accent-primary/5"
                          )}
                        >
                          <button
                            type="button"
                            className="w-9 h-9 rounded-full bg-accent-primary/10 text-accent-primary flex items-center justify-center shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (item.type === "audio") {
                                const st = useMediaStore.getState();
                                if (st.currentMedia?.id === item.id) {
                                  st.isPlaying ? st.pauseMedia() : st.resumeMedia();
                                } else {
                                  playMedia(item, items);
                                }
                              } else {
                                playMedia(item, items);
                                setSelectedItem(item);
                              }
                            }}
                          >
                            {item.type === "audio" && useMediaStore.getState().currentMedia?.id === item.id && useMediaStore.getState().isPlaying ? (
                              <Pause size={14} className="fill-accent-primary" />
                            ) : (
                              <Play size={14} className="fill-accent-primary translate-x-0.5" />
                            )}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-tx-primary truncate">{item.title}</p>
                            <p className="text-[11px] text-tx-tertiary truncate mt-0.5">
                              {item.type === "audio"
                                ? [item.artist || "未知歌手", item.album].filter(Boolean).join(" · ")
                                : (item.collection_title || `${item.play_count} 次播放`)}
                            </p>
                          </div>
                          <span className="text-[11px] text-tx-tertiary tabular-nums shrink-0">{formatDuration(item.duration)}</span>
                        </div>
                      ))}
                    </div>
                    {/* 桌面 table，去掉封面列 */}
                    <div className="hidden md:flex flex-col border border-app-border/40 rounded-2xl bg-app-sidebar/5 overflow-hidden select-none">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-app-border/40 bg-app-sidebar/30 text-tx-tertiary font-semibold select-none">
                            <th className="p-3 w-12 text-center">操作</th>
                            <th className="p-3">标题</th>
                            {mediaType === "audio" && <th className="p-3 w-36">歌手</th>}
                            {mediaType === "audio" && <th className="p-3 w-36">专辑</th>}
                            <th className="p-3 w-40">合集</th>
                            <th className="p-3 w-28">播放次数</th>
                            <th className="p-3 w-24">时长</th>
                            <th className="p-3 w-16 text-center">管理</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr
                              key={item.id}
                              onContextMenu={(e) => openItemContextMenu(e, item)}
                              onClick={() => {
                                if (isBatchMode) {
                                  const newSelected = new Set(selectedItemIds);
                                  if (newSelected.has(item.id)) newSelected.delete(item.id);
                                  else newSelected.add(item.id);
                                  setSelectedItemIds(newSelected);
                                } else if (item.type === "audio") {
                                  playMedia(item, items);
                                } else {
                                  playMedia(item, items);
                                  setSelectedItem(item);
                                }
                              }}
                              className={cn(
                                "border-b border-app-border/20 hover:bg-app-hover/50 cursor-pointer transition-colors",
                                selectedItemIds.has(item.id) && isBatchMode && "bg-accent-primary/5"
                              )}
                            >
                              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={() => {
                                    if (item.type === "audio") {
                                      const st = useMediaStore.getState();
                                      if (st.currentMedia?.id === item.id) {
                                        st.isPlaying ? st.pauseMedia() : st.resumeMedia();
                                      } else {
                                        playMedia(item, items);
                                      }
                                    } else {
                                      playMedia(item, items);
                                      setSelectedItem(item);
                                    }
                                  }}
                                  className="w-7 h-7 rounded-full bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary inline-flex items-center justify-center"
                                >
                                  {item.type === "audio" && useMediaStore.getState().currentMedia?.id === item.id && useMediaStore.getState().isPlaying ? (
                                    <Pause size={12} className="fill-accent-primary" />
                                  ) : (
                                    <Play size={12} className="fill-accent-primary translate-x-0.5" />
                                  )}
                                </button>
                              </td>
                              <td className="p-3 font-semibold text-tx-primary">
                                <p className="hover:text-accent-primary line-clamp-1">{item.title}</p>
                              </td>
                              {mediaType === "audio" && (
                                <td className="p-3 text-tx-secondary">{item.artist || "-"}</td>
                              )}
                              {mediaType === "audio" && (
                                <td className="p-3 text-tx-secondary">{item.album || "-"}</td>
                              )}
                              <td className="p-3 text-tx-tertiary">{item.collection_title || "-"}</td>
                              <td className="p-3 text-tx-secondary">{item.play_count} 次</td>
                              <td className="p-3 text-tx-secondary">{formatDuration(item.duration)}</td>
                              <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center justify-center gap-1.5">
                                  {isAdmin && (
                                    <button
                                      onClick={async () => {
                                        if (window.confirm("确认要删除这个单品吗？")) {
                                          await api.request(`/media/items/${item.id}`, { method: "DELETE" });
                                          fetchData();
                                        }
                                      }}
                                      className="text-accent-danger hover:bg-accent-danger/10 p-1.5 rounded"
                                      title="删除"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  /* GRID VIEW — 视频横版/音频方图；移动端原尺寸，Web/md+ 封面同比约一半（列数加倍） */
                  <div className={cn(
                    "grid gap-3 sm:gap-4",
                    mediaType === "video"
                      ? "grid-cols-2 sm:grid-cols-2 md:grid-cols-6 lg:grid-cols-8"
                      : "grid-cols-3 sm:grid-cols-3 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12"
                  )}>
                    {items.map(item => (
                      <div
                        key={item.id}
                        onContextMenu={(e) => openItemContextMenu(e, item)}
                        onClick={() => {
                          if (isBatchMode) {
                            const newSelected = new Set(selectedItemIds);
                            if (newSelected.has(item.id)) newSelected.delete(item.id);
                            else newSelected.add(item.id);
                            setSelectedItemIds(newSelected);
                          } else if (item.type === "audio") {
                            playMedia(item, items);
                          } else {
                            playMedia(item, items);
                            setSelectedItem(item);
                          }
                        }}
                        className={cn(
                          "group cursor-pointer transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out flex flex-col relative",
                          selectedItemIds.has(item.id) && isBatchMode && "ring-2 ring-accent-primary rounded-xl"
                        )}
                      >
                        {isBatchMode && (
                          <div className="absolute top-2 left-2 z-10 bg-black/60 backdrop-blur rounded-full p-1 border border-white/10 shadow-lg">
                            {selectedItemIds.has(item.id) ? (
                              <CheckCircle className="w-5 h-5 text-accent-primary fill-accent-primary" />
                            ) : (
                              <div className="w-5 h-5 rounded-full border-2 border-white/60" />
                            )}
                          </div>
                        )}

                        <div className={cn(
                          "relative flex items-center justify-center overflow-hidden rounded-xl border border-app-border/25",
                          item.type === "video" ? "aspect-video bg-black/20" : "aspect-square bg-app-surface/40",
                        )}>
                          {item.type === "audio" ? (
                            <AudioCover
                              item={item}
                              className="w-full h-full object-cover group-[@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 transition-transform duration-300"
                              fallbackIconSize={32}
                            />
                          ) : item.cover_url ? (
                            <img
                              src={
                                item.cover_url.startsWith("/") && !item.cover_url.startsWith("/api")
                                  ? item.cover_url
                                  : resolveAttachmentUrl(item.cover_url)
                              }
                              alt={item.title}
                              className="w-full h-full object-cover group-[@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                              onError={(e) => {
                                const el = e.currentTarget;
                                if (!el.dataset.fallback) {
                                  el.dataset.fallback = "1";
                                  el.src = "/default_video_cover.jpg";
                                  el.classList.add("opacity-75");
                                }
                              }}
                            />
                          ) : (
                            <img
                              src="/default_video_cover.jpg"
                              alt={item.title}
                              className="w-full h-full object-cover opacity-75 group-[@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          )}

                          {!isBatchMode && (
                            <div className="absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <div className="w-10 h-10 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-lg">
                                <Play size={18} className="fill-white translate-x-0.5" />
                              </div>
                            </div>
                          )}

                          {!!item.duration && (
                            <span className="absolute bottom-1.5 right-1.5 bg-black/75 rounded px-1.5 py-0.5 text-[10px] text-white font-semibold">
                              {formatDuration(item.duration)}
                            </span>
                          )}
                        </div>

                        <div className="mt-2 px-0.5">
                          <h4 className="font-semibold text-tx-primary line-clamp-2 leading-snug text-[12px] sm:text-[13px]">
                            {item.title}
                          </h4>
                          {item.type === "audio" && (
                            <p className="text-tx-tertiary truncate text-[11px] mt-0.5">
                              {[item.artist, item.album].filter(Boolean).join(" · ") || "未知歌手"}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

              </div>
            </div>

          </motion.div>
        )}
      </AnimatePresence>

      {/* =========================================================================== */}
      {/* 3. MODALS AND FORMS */}
      {/* =========================================================================== */}

      {/* Modal: Alist directory browser
          注意：不用 framer transform 包滚动层——Android WebView 在 transform 祖先下 overflow 滚动常失效。
          portal 到 body + 固定 vh 高度 + 子组件 absolute 滚动区。 */}
      {showAlistBrowser &&
        typeof document !== "undefined" &&
        createPortal(
          <AlistImportModalShell
            onBackdropClick={() => setShowAlistBrowser(false)}
          >
            <AlistBrowser
              workspaceId={workspaceId}
              collections={collections}
              defaultCollectionId={selectedCollection?.id ?? null}
              defaultImportType={selectedCollection?.type ?? mediaType}
              onImportSuccess={(msg) => {
                setShowAlistBrowser(false);
                setTimeout(() => alert(msg), 10);
                fetchData();
              }}
              onClose={() => setShowAlistBrowser(false)}
            />
          </AlistImportModalShell>,
          document.body,
        )}

      <AssignCollectionModal
        open={assignOpen}
        mediaIds={assignMediaIds}
        mediaType={mediaType}
        collections={collections}
        workspaceId={workspaceId}
        onClose={() => setAssignOpen(false)}
        onSuccess={() => {
          fetchData();
          // 合入/合并完成后退出批量编辑态
          setSelectedItemIds(new Set());
          setIsBatchMode(false);
          alert("合入成功");
        }}
      />

      {/* 写评论 / 影评
          移动端必须给 panel 明确高度，否则仅 maxHeight 时 flex 底栏会被裁切
          （用户看到编辑区后无「取消 / 发布」）。结构：可滚表单 + 固定底栏。 */}
      {showReviewInput && reviewEditor && (
        <BottomSheet
          open
          onClose={() => {
            setShowReviewInput(false);
            reviewEditor.commands.setContent("");
            setReviewTitle("");
          }}
          title="写评论 / 影评"
          maxHeight="min(88dvh, 100%)"
          zClassName="z-[80]"
          className={cn(
            // 明确高度：flex 子项才不会把底栏挤出可视区
            "h-[min(72dvh,100%)]",
            "sm:max-w-lg sm:mx-auto sm:h-[min(640px,85dvh)]",
          )}
          bodyClassName="flex flex-col min-h-0 overflow-hidden p-0"
        >
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-1 pb-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={reviewType}
                onChange={(e) => setReviewType(e.target.value as any)}
                className="bg-app-bg border border-app-border text-xs rounded-lg p-2 text-tx-secondary outline-none min-h-11"
              >
                <option value="short_comment">短评</option>
                <option value="long_review">影评 / 乐评</option>
                <option value="recommendation">推荐语</option>
              </select>
              {reviewType === "long_review" && (
                <input
                  type="text"
                  placeholder="影评标题..."
                  value={reviewTitle}
                  onChange={(e) => setReviewTitle(e.target.value)}
                  className="flex-1 min-w-[8rem] bg-app-bg border border-app-border text-xs rounded-lg p-2 text-tx-primary outline-none focus:border-accent-primary min-h-11"
                />
              )}
              {selectedItem?.type === "video" && isPlaying && (
                <button
                  type="button"
                  onClick={handleInsertTimestamp}
                  className="text-xs font-bold text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 px-2.5 py-2 rounded-lg transition-colors ml-auto min-h-11"
                >
                  打点 {formatDuration(currentTime)}
                </button>
              )}
            </div>
            <EditorContent editor={reviewEditor} />
          </div>
          <div className="shrink-0 px-4 py-3 border-t border-app-border bg-app-card flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowReviewInput(false);
                reviewEditor.commands.setContent("");
                setReviewTitle("");
              }}
              className="px-5 py-2.5 bg-app-sidebar hover:bg-app-hover border border-app-border text-tx-secondary text-xs font-semibold rounded-xl min-h-11"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handlePostReview}
              className="px-6 py-2.5 bg-accent-primary hover:bg-accent-primary-hover text-white font-bold text-sm rounded-xl shadow min-h-11"
            >
              发布互动
            </button>
          </div>
        </BottomSheet>
      )}

      {/* 车载 / CarLife 说明 */}
      <AnimatePresence>
        {showCarMode && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
            onClick={() => setShowCarMode(false)}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="w-full max-w-md rounded-2xl border border-app-border bg-app-elevated shadow-xl p-5 space-y-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Car size={18} className="text-accent-primary" />
                  <h3 className="text-base font-bold text-tx-primary">车载 / CarLife</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCarMode(false)}
                  className="p-1 rounded-md text-tx-tertiary hover:bg-app-hover"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="text-xs text-tx-secondary space-y-2 leading-relaxed">
                <p>
                  Super Note 通过 Android 标准媒体会话（MediaSession + MediaBrowser）对接蓝牙车机与
                  CarLife 音频通道，无需百度官方 SDK 合作。
                </p>
                <ul className="list-disc pl-4 space-y-1.5">
                  <li>
                    <strong className="text-tx-primary">蓝牙</strong>
                    ：连接车机后播放音乐库音频，方向盘可暂停/上下曲，仪表显示曲名。
                  </li>
                  <li>
                    <strong className="text-tx-primary">CarLife</strong>
                    ：手机用 CarLife 连车后，在本 App 播放音频；车机侧通常可控制正在播放的曲目（不会自动出现在
                    CarLife 官方「合作音乐 App」侧栏 Logo，那需百度审核）。
                  </li>
                  <li>
                    <strong className="text-tx-primary">浏览</strong>
                    ：支持媒体浏览器中的「当前队列 / 最近播放 / 音频合集」。请先在本页打开
                    <strong className="text-tx-primary"> 音乐库 </strong>
                    以同步目录。
                  </li>
                  <li>请允许通知与后台播放；锁屏后保持 App 可被系统拉起。</li>
                </ul>
                <p className="text-tx-tertiary">
                  提示：仅音频与「视频仅听」进入车载队列；先在手机上点播一首，再切到车机控制更稳。
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowCarMode(false);
                    // 移动端进入音频合集层；桌面仅切换类型（mobileLevel 无影响）
                    enterMediaType("audio");
                    void fetchData();
                  }}
                  className="flex-1 py-2.5 min-h-11 rounded-xl text-xs font-bold bg-accent-primary text-white hover:opacity-90"
                >
                  打开音乐库并同步
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // 尝试打开百度 CarLife（常见包名）
                    try {
                      const schemes = [
                        "baiducarlife://",
                        "carlife://",
                      ];
                      for (const s of schemes) {
                        window.location.href = s;
                        break;
                      }
                    } catch {
                      alert("未检测到 CarLife，请从应用商店安装百度 CarLife 后连接车机。");
                    }
                  }}
                  className="flex-1 py-2.5 min-h-11 rounded-xl text-xs font-semibold border border-app-border bg-app-surface text-tx-primary hover:bg-app-hover"
                >
                  尝试打开 CarLife
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ContextMenu
        isOpen={ctxMenu.open}
        x={ctxMenu.x}
        y={ctxMenu.y}
        menuRef={ctxMenuRef}
        header={ctxMenu.item?.title}
        onAction={(id) => void handleCtxMenuAction(id)}
        items={
          [
            { id: "detail", label: "详情", icon: <Info size={14} /> },
            // 本地缓存仅移动端
            ...(isMobile
              ? [
                  ctxMenu.item && cachedIds.has(ctxMenu.item.id)
                    ? {
                        id: "uncache",
                        label: "删除本地缓存",
                        icon: <HardDrive size={14} />,
                      }
                    : {
                        id: "cache",
                        label: "缓存到本地",
                        icon: <DownloadCloud size={14} />,
                      },
                ]
              : []),
            ...(isAdmin
              ? ([
                  { id: "assign", label: "合入", icon: <FolderInput size={14} /> },
                  { id: "sep1", label: "", separator: true },
                  {
                    id: "delete",
                    label: "删除",
                    icon: <Trash2 size={14} />,
                    danger: true,
                  },
                ] as ContextMenuItem[])
              : []),
          ] as ContextMenuItem[]
        }
      />

      {/* 缓存管理仅移动端 */}
      <MediaCacheSheet
        open={showCacheSheet && isMobile}
        onClose={() => setShowCacheSheet(false)}
        filterType={mediaType}
      />

      {/* Modal: Alist settings */}
      <AnimatePresence>
        {showAlistSettings && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border border-app-border rounded-2xl w-full max-w-md p-6 flex flex-col gap-4 shadow-2xl"
              style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
            >
              <div>
                <h3 className="text-md font-bold text-tx-primary">Alist 挂载配置</h3>
                <p className="text-xs text-tx-tertiary">配置内网 Docker 的 Alist 容器接口，以便获取直链播放与扫描导入</p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-tx-secondary font-semibold">Alist 后端地址</label>
                <input 
                  type="text" 
                  value={alistUrl}
                  onChange={(e) => setAlistUrl(e.target.value)}
                  placeholder="e.g. http://alist:5244"
                  className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 outline-none focus:border-accent-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-tx-secondary font-semibold">Alist Token</label>
                <input 
                  type="password" 
                  value={alistToken}
                  onChange={(e) => setAlistToken(e.target.value)}
                  placeholder="Alist 后台生成的 Token..."
                  className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 outline-none focus:border-accent-primary"
                />
              </div>

              {testStatus && (
                <div className={cn(
                  "p-3 rounded-xl border text-xs leading-relaxed",
                  testStatus.status === "ok" 
                    ? "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400"
                    : "bg-red-500/10 border-red-500/20 text-red-500"
                )}>
                  {testStatus.message}
                </div>
              )}

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={testAlistConnection}
                  disabled={testing}
                  className="flex-1 py-2 bg-app-sidebar border border-app-border text-xs rounded-xl font-semibold hover:bg-app-hover"
                >
                  {testing ? "测试中..." : "测试并保存"}
                </button>
                <button
                  onClick={() => setShowAlistSettings(false)}
                  className="flex-1 py-2 bg-accent-primary text-white text-xs rounded-xl font-bold hover:bg-accent-primary-hover shadow"
                >
                  确定
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Add Collection */}
      <AnimatePresence>
        {showAddCollection && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border border-app-border rounded-2xl w-full max-w-md p-6 flex flex-col gap-4 shadow-2xl"
              style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
            >
              <h3 className="text-md font-bold text-tx-primary">
                {editingCollectionId ? "编辑媒体合集" : "新建媒体合集"}
              </h3>
              
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-tx-secondary font-semibold">合集标题</label>
                  {colForm.title && (
                    <button
                      type="button"
                      disabled={fetchingMetadata}
                      onClick={async () => {
                        setFetchingMetadata(true);
                        try {
                          const res = await api.request<{ cover_url: string; description: string }>(
                            `/media/collections/fetch-metadata?title=${encodeURIComponent(colForm.title)}`
                          );
                          if (res) {
                            setColForm(prev => ({
                              ...prev,
                              cover_url: res.cover_url || prev.cover_url,
                              description: res.description || prev.description
                            }));
                          }
                        } catch (err) {
                          console.error("Auto fetch failed:", err);
                        } finally {
                          setFetchingMetadata(false);
                        }
                      }}
                      className="text-[10px] text-accent-primary hover:bg-accent-primary/10 px-2 py-0.5 rounded-lg border border-accent-primary/20 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out font-semibold flex items-center gap-1 disabled:opacity-50"
                    >
                      {fetchingMetadata ? (
                        <>
                          <Loader2 size={11} className="animate-spin" />
                          获取中...
                        </>
                      ) : (
                        "自动获取海报及简介"
                      )}
                    </button>
                  )}
                </div>
                <input 
                  type="text" 
                  value={colForm.title}
                  onChange={(e) => setColForm({ ...colForm, title: e.target.value })}
                  placeholder="e.g. 指环王三部曲"
                  className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 outline-none focus:border-accent-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-tx-secondary font-semibold">封面海报 URL</label>
                <input 
                  type="text" 
                  value={colForm.cover_url}
                  onChange={(e) => setColForm({ ...colForm, cover_url: e.target.value })}
                  placeholder="https://xxx.jpg"
                  className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 outline-none focus:border-accent-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs text-tx-secondary font-semibold">合集简介</label>
                <textarea 
                  value={colForm.description}
                  onChange={(e) => setColForm({ ...colForm, description: e.target.value })}
                  placeholder="写入合集背景或推荐介绍..."
                  className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 outline-none focus:border-accent-primary resize-none h-20"
                />
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setShowAddCollection(false)}
                  className="flex-1 py-2 bg-app-sidebar border border-app-border text-xs rounded-xl hover:bg-app-hover"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveCollection}
                  className="flex-1 py-2 bg-accent-primary text-white text-xs rounded-xl font-bold hover:bg-accent-primary-hover shadow"
                >
                  {editingCollectionId ? "保存修改" : "创建合集"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 批量操作条：Portal + 固定 CSS 贴底（避开 Tab），不依赖 framer transform 以免 fixed 错位 */}
      {typeof document !== "undefined" &&
        isBatchMode &&
        createPortal(
          <div
            className={cn(
              "media-batch-bar flex items-center gap-2 md:gap-4 select-none",
              "bg-app-elevated/95 backdrop-blur-md border border-app-border shadow-2xl",
              "px-3 py-2.5 md:px-6 md:py-3.5 rounded-2xl",
            )}
            role="toolbar"
            aria-label="批量操作"
          >
                <div className="flex-1 min-w-0 text-xs text-tx-secondary font-semibold whitespace-nowrap truncate">
                  已选中{" "}
                  <span className="text-accent-primary font-bold">
                    {selectedItemIds.size}
                  </span>{" "}
                  个
                </div>

                <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedItemIds.size === items.length) {
                        setSelectedItemIds(new Set());
                      } else {
                        setSelectedItemIds(new Set(items.map((item) => item.id)));
                      }
                    }}
                    className="py-1.5 px-2.5 md:px-3 bg-app-sidebar border border-app-border text-[11px] font-semibold hover:bg-app-hover rounded-xl transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out whitespace-nowrap"
                  >
                    {selectedItemIds.size === items.length ? "取消全选" : "全选"}
                  </button>

                  {/* 批量缓存仅移动端 */}
                  {isMobile && (
                    <button
                      type="button"
                      onClick={() => batchCacheSelected()}
                      disabled={selectedItemIds.size === 0}
                      className={cn(
                        "py-1.5 px-2.5 text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shadow whitespace-nowrap",
                        selectedItemIds.size > 0
                          ? "bg-accent-primary hover:bg-accent-primary-hover text-white"
                          : "bg-app-sidebar border border-app-border/40 text-tx-tertiary cursor-not-allowed",
                      )}
                      title="缓存到本地"
                    >
                      <DownloadCloud size={13} />
                      缓存
                    </button>
                  )}

                  {isMobile && (
                    <button
                      type="button"
                      onClick={() => void batchUncacheSelected()}
                      disabled={selectedItemIds.size === 0}
                      className={cn(
                        "py-1.5 px-2.5 text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shadow whitespace-nowrap",
                        selectedItemIds.size > 0
                          ? "bg-app-sidebar border border-app-border text-tx-primary hover:bg-app-hover"
                          : "bg-app-sidebar border border-app-border/40 text-tx-tertiary cursor-not-allowed",
                      )}
                      title="删除本地缓存"
                    >
                      <HardDrive size={13} />
                      缓存
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => openAssignForIds(Array.from(selectedItemIds))}
                      disabled={selectedItemIds.size === 0}
                      className={cn(
                        "py-1.5 px-2.5 md:px-3.5 text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shadow whitespace-nowrap max-md:hidden",
                        selectedItemIds.size > 0
                          ? "bg-accent-primary hover:bg-accent-primary-hover text-white"
                          : "bg-app-sidebar border border-app-border/40 text-tx-tertiary cursor-not-allowed",
                      )}
                      title="合入到其它合集（不移出原合集）"
                    >
                      <FolderInput size={13} />
                      合入
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (selectedItemIds.size === 0) return;
                        if (
                          window.confirm(
                            `确认要删除选中的 ${selectedItemIds.size} 个单品吗？`,
                          )
                        ) {
                          try {
                            await api.request("/media/items/batch-delete", {
                              method: "POST",
                              body: JSON.stringify({
                                ids: Array.from(selectedItemIds),
                              }),
                            });
                            setSelectedItemIds(new Set());
                            setIsBatchMode(false);
                            fetchData();
                          } catch (err) {
                            console.error("Batch delete failed:", err);
                          }
                        }
                      }}
                      disabled={selectedItemIds.size === 0}
                      className={cn(
                        "py-1.5 px-2.5 md:px-3.5 text-[11px] font-bold rounded-xl transition-colors flex items-center gap-1 shadow whitespace-nowrap",
                        selectedItemIds.size > 0
                          ? "bg-accent-danger hover:bg-accent-danger-hover text-white"
                          : "bg-app-sidebar border border-app-border/40 text-tx-tertiary cursor-not-allowed",
                      )}
                    >
                      <Trash2 size={13} />
                      <span className="max-md:hidden">批量</span>
                      删除
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setIsBatchMode(false);
                      setSelectedItemIds(new Set());
                    }}
                    className="py-1.5 px-2.5 md:px-3 bg-app-sidebar border border-app-border text-[11px] font-semibold hover:bg-app-hover rounded-xl transition-colors text-tx-secondary whitespace-nowrap"
                  >
                    取消
                  </button>
                </div>
          </div>,
          document.body,
        )}

    </div>
  );
}

/** 网盘导入弹窗外壳：固定 vh、无 transform，打开时锁 body 滚动 */
function AlistImportModalShell({
  children,
  onBackdropClick,
}: {
  children: React.ReactNode;
  onBackdropClick: () => void;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
      style={{
        paddingTop: "var(--safe-area-top, 0px)",
        paddingBottom: "var(--safe-area-bottom, 0px)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onBackdropClick();
      }}
    >
      <div
        className={cn(
          "w-full max-w-4xl flex flex-col overflow-hidden",
          "rounded-t-2xl md:rounded-2xl",
        )}
        style={{
          // vh 兼容旧 Android WebView；dvh 在支持时更准
          height: "min(94dvh, 94vh)",
          maxHeight: "min(94dvh, 94vh)",
          transform: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}
