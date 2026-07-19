import React, { useEffect, useState, useRef } from "react";
import { api, getCurrentWorkspace, resolveAttachmentUrl } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useMediaStore } from "@/store/mediaStore";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TimestampExtension } from "../extensions/TimestampExtension";
import MediaPlayer from "./MediaPlayer";
import MusicPlayer from "./MusicPlayer";
import AlistBrowser from "./AlistBrowser";
import {
  Film, Music, Plus, Search, Grid, List as ListIcon, Trash2, Edit3, Play, Pause, Info,
  Settings, ChevronRight, Download, Upload, CheckCircle, MessageSquare, Clock,
  User, Tag, ChevronLeft, PlusCircle, Globe, Lock, ShieldAlert, SlidersHorizontal,
  X, AlertTriangle, Disc, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AudioCover } from "@/lib/id3";

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
  
  // Modals
  const [showAlistBrowser, setShowAlistBrowser] = useState<boolean>(false);
  const [showAlistSettings, setShowAlistSettings] = useState<boolean>(false);
  const [showImportJson, setShowImportJson] = useState<boolean>(false);
  const [showAddCollection, setShowAddCollection] = useState<boolean>(false);
  const [showAddItem, setShowAddItem] = useState<boolean>(false);
  
  // Forms states
  const [alistUrl, setAlistUrl] = useState<string>("");
  const [alistToken, setAlistToken] = useState<string>("");
  const [testStatus, setTestStatus] = useState<{ status: string; message: string } | null>(null);
  const [testing, setTesting] = useState<boolean>(false);
  
  const [jsonImportText, setJsonImportText] = useState<string>("");
  const [importError, setImportError] = useState<string>("");

  // Batch deletion states
  const [isBatchMode, setIsBatchMode] = useState<boolean>(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [fetchingMetadata, setFetchingMetadata] = useState<boolean>(false);
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null);

  const selectedItemRef = React.useRef<MediaItem | null>(null);
  useEffect(() => {
    selectedItemRef.current = selectedItem;
  }, [selectedItem]);

  const [colForm, setColForm] = useState({ title: "", type: "video", cover_url: "", description: "", recommendation: "", sort_order: 0 });
  const [itemForm, setItemForm] = useState({ title: "", type: "video", collection_id: "", cover_url: "", description: "", alist_path: "", artist: "", duration: 0, year: new Date().getFullYear(), genre: "", sort_order: 0, tags: "" });

  const { playMedia, isPlaying, currentTime } = useMediaStore();

  // Load scope and roles
  useEffect(() => {
    const ws = getCurrentWorkspace();
    setWorkspaceId(!ws || ws === "personal" ? null : ws);
    
    // Check if user is admin
    api.getMe().then(async (me) => {
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
    } catch (err) {
      console.error("Failed to fetch media data:", err);
    } finally {
      setLoading(false);
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
          }).catch(err => {
            console.error("Failed to load item from hash:", err);
            setSelectedItem(null);
            if (window.location.hash !== "#/media") {
              window.location.hash = "#/media";
            }
          });
        }
      } else if (hash === "#/media" || hash === "#/media/") {
        if (selectedItemRef.current) {
          setSelectedItem(null);
        }
      }
    };

    window.addEventListener("hashchange", handleHashChange);
    // Call once on mount to handle initial load
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []); // Run only once to prevent re-binding and loops

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

  // Handle JSON batch import
  const handleJsonImport = async () => {
    setImportError("");
    try {
      const parsed = JSON.parse(jsonImportText);
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      const res = await api.request<{ success: boolean; message: string }>(`/media/import/json${q}`, {
        method: "POST",
        body: JSON.stringify(parsed)
      });
      if (res && res.success) {
        setShowImportJson(false);
        setJsonImportText("");
        fetchData();
      }
    } catch (err: any) {
      setImportError(err.message || "JSON 格式解析错误");
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
        class: "prose prose-sm dark:prose-invert focus:outline-none min-h-[100px] max-h-[200px] overflow-y-auto bg-app-bg border border-app-border rounded-xl p-3 text-xs text-tx-primary",
      }
    }
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
            className="flex-1 overflow-y-auto max-w-5xl mx-auto w-full flex flex-col md:gap-6 pb-[calc(1.5rem+var(--safe-area-bottom))] md:pb-6"
          >
            {/* Navigation back */}
            <div
              className="flex items-center justify-between shrink-0 px-4 md:px-6 md:pt-6 mb-4 md:mb-0"
              style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 12px)" }}
            >
              <button 
                onClick={() => setSelectedItem(null)}
                className="flex items-center gap-1.5 text-xs font-semibold text-tx-secondary hover:text-tx-primary bg-app-sidebar/40 border border-app-border/40 px-3 py-1.5 rounded-lg transition-colors"
              >
                <ChevronLeft size={16} />
                返回媒体列表
              </button>
              {isAdmin && (
                <button
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
              )}
            </div>

            {/* Media Player wrapper */}
            <div className="w-full md:px-6">
              {selectedItem.type === "video" ? (
                <MediaPlayer
                  mediaId={selectedItem.id}
                  onExitFullscreen={() => setSelectedItem(null)}
                />
              ) : (
                <MusicPlayer mediaId={selectedItem.id} />
              )}
            </div>

            {/* Details block */}
            <div className="flex flex-col gap-6 px-4 md:px-6 mt-4 md:mt-0 max-w-5xl mx-auto w-full mb-10">
              
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

                  <div className="flex items-center gap-4 text-[10px] text-tx-tertiary select-none">
                    <span className="flex items-center gap-1"><Play size={12} /> 播放次数: {selectedItem.play_count}</span>
                    <span className="flex items-center gap-1"><Clock size={12} /> 时长: {formatDuration(selectedItem.duration)}</span>
                  </div>
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

                  {/* Quick Editor Box */}
                  {!showReviewInput ? (
                    <div className="flex justify-center mt-4">
                      <button
                        onClick={() => setShowReviewInput(true)}
                        className="px-6 py-2.5 bg-app-sidebar border border-app-border hover:bg-app-hover hover:border-accent-primary/50 text-tx-secondary hover:text-accent-primary font-bold text-sm rounded-xl shadow-sm flex items-center gap-2 transition-all group"
                      >
                        <MessageSquare size={16} className="group-hover:scale-110 transition-transform" />
                        写评论 / 影评
                      </button>
                    </div>
                  ) : reviewEditor && (
                    <div className="flex flex-col gap-3 border-t border-app-border/30 pt-4 mt-2 animate-fade-in">
                      <div className="flex items-center justify-between gap-3">
                        <select 
                          value={reviewType}
                          onChange={(e) => setReviewType(e.target.value as any)}
                          className="bg-app-bg border border-app-border text-xs rounded-lg p-1.5 text-tx-secondary outline-none"
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
                            className="flex-1 bg-app-bg border border-app-border text-xs rounded-lg p-1.5 text-tx-primary outline-none focus:border-accent-primary"
                          />
                        )}
                      </div>

                      <EditorContent editor={reviewEditor} />

                      <div className="flex items-center justify-end gap-3 mt-1">
                        <button
                          onClick={() => {
                            setShowReviewInput(false);
                            reviewEditor.commands.setContent("");
                            setReviewTitle("");
                          }}
                          className="px-5 py-2 bg-app-sidebar hover:bg-app-hover border border-app-border text-tx-secondary text-xs font-semibold rounded-xl transition-all"
                        >
                          取消
                        </button>
                        <button
                          onClick={handlePostReview}
                          className="px-6 py-2 bg-accent-primary hover:bg-accent-primary-hover text-white font-bold text-sm rounded-xl shadow transition-all"
                        >
                          发布互动
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        ) : (
          /* 2. Main Browser Dashboard view mode */
          <motion.div 
            key="browser"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex-1 flex flex-col min-h-0 md:flex-row overflow-hidden"
          >
            
            {/* Sidebar / Top filter list for mobile — 移动端压成单行紧凑条 */}
            <div className="w-full md:w-56 bg-app-sidebar border-b md:border-b-0 md:border-r border-app-border shrink-0 px-2 py-1.5 md:p-4 flex flex-row md:flex-col gap-1.5 md:gap-4 overflow-x-auto md:overflow-y-auto max-md:whitespace-nowrap items-center md:items-stretch">
              
              {/* Type Switcher */}
              <div className="flex md:flex-col gap-1.5 shrink-0">
                <span className="text-xs font-bold text-tx-tertiary uppercase tracking-wider select-none max-md:hidden">媒体类型</span>
                <div className="flex gap-1 md:gap-2">
                  <button
                    onClick={() => { setMediaType("video"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-1 md:py-2 px-2 md:px-3 rounded-lg md:rounded-xl border flex items-center justify-center gap-1.5 text-sm font-bold transition-all",
                      mediaType === "video" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-md shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                    title="视频库"
                    aria-label="视频库"
                  >
                    <Film size={15} />
                    <span className="max-md:hidden">视频库</span>
                  </button>
                  <button
                    onClick={() => { setMediaType("audio"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-1 md:py-2 px-2 md:px-3 rounded-lg md:rounded-xl border flex items-center justify-center gap-1.5 text-sm font-bold transition-all",
                      mediaType === "audio" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-md shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                    title="音乐库"
                    aria-label="音乐库"
                  >
                    <Music size={15} />
                    <span className="max-md:hidden">音乐库</span>
                  </button>
                </div>
              </div>

              {/* Collections Navigation list */}
              <div className="flex flex-row md:flex-col gap-1 md:gap-2 flex-1 min-w-0 items-center md:items-stretch">
                <div className="flex items-center justify-between select-none shrink-0">
                  <span className="text-xs font-bold text-tx-tertiary uppercase tracking-wider max-md:hidden">全部合集</span>
                  {isAdmin && (
                    <button 
                      onClick={handleOpenAddCollection}
                      className="hidden md:inline-flex text-accent-primary hover:bg-accent-primary/10 p-1.5 rounded transition-colors"
                      title="新建合集"
                    >
                      <PlusCircle size={16} />
                    </button>
                  )}
                </div>

                <div className="flex flex-row md:flex-col gap-1 md:gap-1 overflow-x-auto md:overflow-y-auto max-md:scrollbar-hide min-w-0">
                  <button
                    onClick={() => setSelectedCollection(null)}
                    className={cn(
                      "w-auto md:w-full text-left py-1 md:py-1.5 px-2 md:px-2.5 rounded-md md:rounded-lg text-xs md:text-sm font-semibold flex items-center justify-between transition-colors shrink-0",
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
                        "w-auto md:w-full text-left py-1 md:py-1.5 px-2 md:px-2.5 rounded-md md:rounded-lg text-xs md:text-sm font-semibold flex items-center gap-1.5 md:gap-2 md:justify-between transition-colors shrink-0",
                        selectedCollection?.id === col.id 
                          ? "bg-accent-primary/10 text-accent-primary" 
                          : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                      )}
                    >
                      <span className="truncate max-w-[100px] md:max-w-[150px]">{col.title}</span>
                      <span className="text-[10px] md:text-xs px-1 md:px-1.5 py-0.5 bg-app-border/40 text-tx-tertiary rounded font-normal shrink-0">
                        {col.item_count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings direct access for System admin */}
              {isAdmin && (
                <div className="md:border-t border-app-border/40 md:pt-3 select-none shrink-0 max-md:ml-auto">
                  <button
                    onClick={async () => {
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
                    }}
                    className="w-auto md:w-full py-1 md:py-2 px-2 md:px-3 border border-app-border hover:bg-app-hover rounded-lg md:rounded-xl flex items-center justify-center gap-2 text-sm text-tx-secondary hover:text-tx-primary transition-all font-semibold"
                    title="Alist 挂载配置"
                    aria-label="Alist 挂载配置"
                  >
                    <Settings size={15} />
                    <span className="max-md:hidden">Alist 挂载配置</span>
                  </button>
                </div>
              )}

            </div>

            {/* Grid browser view */}
            <div className="flex-1 flex flex-col min-w-0 bg-app-bg">
              
              {/* Header filter actions — 移动端单行：搜索 + 排序/视图/操作图标 */}
              <div className="px-2 py-1.5 md:p-4 border-b border-app-border flex flex-row items-center gap-1.5 md:gap-3 select-none">
                
                {/* Search & Sort */}
                <div className="flex items-center gap-1.5 md:gap-2 flex-1 min-w-0 md:max-w-md">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-2.5 md:left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 md:w-4.5 md:h-4.5 text-tx-tertiary" />
                    <input
                      type="text"
                      placeholder="搜索..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 md:pl-9 pr-2 md:pr-4 py-1.5 md:py-2 bg-app-sidebar border border-app-border text-xs md:text-sm rounded-lg md:rounded-xl outline-none text-tx-primary focus:border-accent-primary transition-colors"
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-app-sidebar border border-app-border text-[11px] md:text-sm rounded-lg md:rounded-xl py-1.5 md:p-2 px-1.5 md:px-2 text-tx-secondary outline-none shrink-0 max-w-[5.5rem] md:max-w-none"
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
                  <div className="flex items-center bg-app-sidebar border border-app-border rounded-lg md:rounded-xl p-0.5 shrink-0">
                    <button
                      onClick={() => setViewStyle("grid")}
                      className={cn(
                        "p-1 md:p-1.5 rounded-md md:rounded-lg transition-colors",
                        viewStyle === "grid" 
                          ? "bg-accent-primary text-white" 
                          : "text-tx-secondary hover:text-tx-primary"
                      )}
                      title="网格视图"
                    >
                      <Grid size={14} className="md:w-4 md:h-4" />
                    </button>
                    <button
                      onClick={() => setViewStyle("list")}
                      className={cn(
                        "p-1 md:p-1.5 rounded-md md:rounded-lg transition-colors",
                        viewStyle === "list" 
                          ? "bg-accent-primary text-white" 
                          : "text-tx-secondary hover:text-tx-primary"
                      )}
                      title="列表视图"
                    >
                      <ListIcon size={14} className="md:w-4 md:h-4" />
                    </button>
                  </div>
                </div>

                {/* Import actions (admin/owner only) — 移动端图标化，与搜索同一行 */}
                {isAdmin && (
                  <div className="flex items-center gap-1 md:gap-2 shrink-0">
                    <button
                      onClick={() => {
                        setIsBatchMode(!isBatchMode);
                        setSelectedItemIds(new Set());
                      }}
                      className={cn(
                        "text-sm font-semibold py-1.5 md:py-2 px-2 md:px-3 rounded-lg md:rounded-xl flex items-center gap-1.5 transition-all border",
                        isBatchMode 
                          ? "bg-accent-danger/10 border-accent-danger/25 text-accent-danger hover:bg-accent-danger/20"
                          : "bg-app-sidebar border-app-border hover:bg-app-hover text-tx-secondary"
                      )}
                      title={isBatchMode ? "退出管理" : "批量管理"}
                      aria-label={isBatchMode ? "退出管理" : "批量管理"}
                    >
                      <SlidersHorizontal size={15} />
                      <span className="max-md:hidden">{isBatchMode ? "退出管理" : "批量管理"}</span>
                    </button>
                    <button
                      onClick={() => setShowAlistBrowser(true)}
                      className="bg-accent-primary hover:bg-accent-primary-hover text-white text-sm font-bold py-1.5 md:py-2 px-2 md:px-4 rounded-lg md:rounded-xl shadow-md shadow-accent-primary/10 flex items-center gap-1 transition-all"
                      title="网盘导入"
                      aria-label="网盘导入"
                    >
                      <Plus size={15} />
                      <span className="max-md:hidden">网盘导入</span>
                    </button>
                    <button
                      onClick={() => setShowImportJson(true)}
                      className="hidden md:flex bg-app-sidebar border border-app-border hover:bg-app-hover text-tx-secondary text-sm font-semibold py-2 px-3.5 rounded-xl items-center gap-1.5 transition-all"
                    >
                      <Upload size={16} />
                      JSON 导入
                    </button>
                    <a
                      href="/api/media/import/template"
                      download="template.json"
                      className="hidden md:flex bg-app-sidebar border border-app-border hover:bg-app-hover text-tx-secondary text-sm font-semibold py-2 px-3.5 rounded-xl items-center gap-1.5 transition-all"
                    >
                      <Download size={16} />
                      下载模板
                    </a>
                  </div>
                )}
              </div>

              {/* Items content list */}
              <div className="flex-1 overflow-y-auto p-3 md:p-6">
                
                {selectedCollection && (
                  <div className="mb-6 p-4 bg-app-sidebar/20 border border-app-border/40 rounded-2xl flex flex-col gap-2 relative group">
                    <div className="flex items-center justify-between gap-4">
                      <h2 className="text-lg font-bold text-tx-primary">{selectedCollection.title}</h2>
                      {isAdmin && (
                        <div className="flex items-center gap-2 select-none">
                          <button
                            onClick={() => handleOpenEditCollection(selectedCollection)}
                            className="p-1 px-2 text-[11px] font-semibold text-tx-secondary hover:text-tx-primary border border-app-border hover:bg-app-hover rounded-lg flex items-center gap-1 transition-all"
                            title="编辑合集"
                          >
                            <Edit3 size={12} />
                            编辑合集
                          </button>
                          <button
                            onClick={() => handleDeleteCollection(selectedCollection)}
                            className="p-1 px-2 text-[11px] font-semibold text-accent-danger hover:text-white hover:bg-accent-danger border border-accent-danger/20 rounded-lg flex items-center gap-1 transition-all"
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
                  <div className="h-64 flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
                    <span className="text-sm text-tx-secondary">正在载入媒体文件...</span>
                  </div>
                ) : items.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-app-sidebar/10 rounded-2xl border border-dashed border-app-border/60">
                    <Film className="w-10 h-10 text-tx-tertiary mb-3 animate-pulse" />
                    <h4 className="text-sm font-bold text-tx-primary mb-1">暂无媒体文件</h4>
                    <p className="text-xs text-tx-tertiary">点击上方的“网盘导入”或“JSON 导入”录入第一批音视频！</p>
                  </div>
                ) : viewStyle === "list" ? (
                  /* LIST VIEW — 无封面列；移动用卡片行，桌面用 table */
                  <>
                    {/* 移动列表 */}
                    <div className="flex flex-col gap-1 md:hidden">
                      {items.map((item) => (
                        <div
                          key={item.id}
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
                                  {item.type === "audio" && (
                                    <button onClick={() => setSelectedItem(item)} className="text-tx-secondary hover:text-accent-primary p-1.5 rounded" title="详情">
                                      <Info size={14} />
                                    </button>
                                  )}
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
                          "group cursor-pointer transition-all flex flex-col relative",
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
                          "relative flex items-center justify-center overflow-hidden rounded-xl bg-black/30 border border-app-border/20",
                          item.type === "video" ? "aspect-video" : "aspect-square"
                        )}>
                          {item.type === "audio" ? (
                            <AudioCover item={item} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" fallbackIconSize={20} />
                          ) : item.cover_url ? (
                            <img
                              src={resolveAttachmentUrl(item.cover_url)}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <img
                              src="/default_video_cover.jpg"
                              alt={item.title}
                              className="w-full h-full object-cover opacity-75 group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          )}

                          {item.type === "audio" && !isBatchMode && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedItem(item);
                              }}
                              className="absolute top-1.5 right-1.5 z-10 bg-black/60 backdrop-blur text-white hover:bg-accent-primary p-1 rounded-full shadow transition-colors"
                              title="详情介绍"
                            >
                              <Info size={11} />
                            </button>
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

      {/* Modal: Alist directory browser */}
      <AnimatePresence>
        {showAlistBrowser && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-4xl h-[80vh]"
            >
              <AlistBrowser 
                workspaceId={workspaceId} 
                collections={collections}
                onImportSuccess={(msg) => {
                  setShowAlistBrowser(false);
                  setTimeout(() => alert(msg), 10);
                  fetchData();
                }}
                onClose={() => setShowAlistBrowser(false)}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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

      {/* Modal: JSON Import */}
      <AnimatePresence>
        {showImportJson && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="border border-app-border rounded-2xl w-full max-w-lg p-6 flex flex-col gap-4 shadow-2xl"
              style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
            >
              <div>
                <h3 className="text-md font-bold text-tx-primary">JSON 批量导入</h3>
                <p className="text-xs text-tx-tertiary">粘贴按合集和单品数组构造的 JSON 字符串进行批量录入</p>
              </div>

              <textarea
                value={jsonImportText}
                onChange={(e) => setJsonImportText(e.target.value)}
                placeholder='{\n  "collection": { "title": "系列合集", "type": "video" },\n  "items": [\n    { "title": "电影1", "alist_path": "/path1.mp4" }\n  ]\n}'
                className="w-full min-h-[250px] font-mono text-xs p-3 bg-app-sidebar border border-app-border rounded-xl focus:border-accent-primary outline-none text-tx-primary resize-y"
              />

              {importError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-xs rounded-xl leading-relaxed">
                  {importError}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowImportJson(false)}
                  className="flex-1 py-2 bg-app-sidebar border border-app-border text-xs rounded-xl hover:bg-app-hover"
                >
                  取消
                </button>
                <button
                  onClick={handleJsonImport}
                  className="flex-1 py-2 bg-accent-primary text-white text-xs rounded-xl font-bold hover:bg-accent-primary-hover shadow"
                >
                  导入
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
                      className="text-[10px] text-accent-primary hover:bg-accent-primary/10 px-2 py-0.5 rounded-lg border border-accent-primary/20 transition-all font-semibold flex items-center gap-1 disabled:opacity-50"
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

      {/* Floating Batch Action Bar */}
      <AnimatePresence>
        {isBatchMode && (
          <motion.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 50, opacity: 0 }}
            className="fixed bottom-6 left-1/2 transform -translate-x-1/2 bg-app-sidebar border border-app-border rounded-2xl py-3.5 px-6 shadow-2xl z-40 flex items-center gap-4 min-w-[320px] max-w-lg select-none"
            style={{ backgroundColor: "var(--color-elevated-solid, #181824)" }}
          >
            <div className="flex-1 text-xs text-tx-secondary font-semibold">
              已选中 <span className="text-accent-primary font-bold">{selectedItemIds.size}</span> 个媒体
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (selectedItemIds.size === items.length) {
                    setSelectedItemIds(new Set());
                  } else {
                    setSelectedItemIds(new Set(items.map(item => item.id)));
                  }
                }}
                className="py-1.5 px-3 bg-app-sidebar border border-app-border text-[11px] font-semibold hover:bg-app-hover rounded-xl transition-all"
              >
                {selectedItemIds.size === items.length ? "取消全选" : "全选"}
              </button>
              
              <button
                onClick={async () => {
                  if (selectedItemIds.size === 0) return;
                  if (window.confirm(`确认要删除选中的 ${selectedItemIds.size} 个单品吗？`)) {
                    try {
                      await api.request("/media/items/batch-delete", {
                        method: "POST",
                        body: JSON.stringify({ ids: Array.from(selectedItemIds) })
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
                  "py-1.5 px-3.5 text-[11px] font-bold rounded-xl transition-all flex items-center gap-1 shadow",
                  selectedItemIds.size > 0
                    ? "bg-accent-danger hover:bg-accent-danger-hover text-white"
                    : "bg-app-sidebar border border-app-border/40 text-tx-tertiary cursor-not-allowed"
                )}
              >
                <Trash2 size={13} />
                批量删除
              </button>
              
              <button
                onClick={() => {
                  setIsBatchMode(false);
                  setSelectedItemIds(new Set());
                }}
                className="py-1.5 px-3 bg-app-sidebar border border-app-border text-[11px] font-semibold hover:bg-app-hover rounded-xl transition-all text-tx-secondary"
              >
                取消
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
