import React, { useEffect, useState, useRef } from "react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useMediaStore } from "@/store/mediaStore";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TimestampExtension } from "../extensions/TimestampExtension";
import MediaPlayer from "./MediaPlayer";
import MusicPlayer from "./MusicPlayer";
import AlistBrowser from "./AlistBrowser";
import {
  Film, Music, Plus, Search, Grid, List as ListIcon, Trash2, Edit3, Play,
  Settings, ChevronRight, Download, Upload, CheckCircle, MessageSquare, Clock,
  User, Tag, ChevronLeft, PlusCircle, Globe, Lock, ShieldAlert, SlidersHorizontal,
  X, AlertTriangle, Disc, Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";

interface Collection {
  id: string;
  title: string;
  type: "video" | "audio";
  cover_url?: string;
  description?: string;
  recommendation?: string;
  item_count: number;
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
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
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

  const [colForm, setColForm] = useState({ title: "", type: "video", cover_url: "", description: "", recommendation: "", sort_order: 0 });
  const [itemForm, setItemForm] = useState({ title: "", type: "video", collection_id: "", cover_url: "", description: "", alist_path: "", artist: "", duration: 0, year: new Date().getFullYear(), genre: "", sort_order: 0, tags: "" });

  const { playMedia, isPlaying, currentTime } = useMediaStore();

  // Load scope and roles
  useEffect(() => {
    const ws = getCurrentWorkspace();
    setWorkspaceId(ws === "personal" ? null : ws);
    
    // Check if user is admin
    api.getMe().then((me) => {
      setIsAdmin(me.role === "admin" || (ws !== "personal" && me.workspaceRole === "owner"));
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
      const res = await api.request<{ success: boolean; message: string }>("/media/import/json", {
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

  // Handle Collection Creation
  const handleCreateCollection = async () => {
    try {
      const q = workspaceId ? `?workspaceId=${workspaceId}` : "";
      await api.request(`/media/collections${q}`, {
        method: "POST",
        body: JSON.stringify({ ...colForm, type: mediaType })
      });
      setShowAddCollection(false);
      setColForm({ title: "", type: "video", cover_url: "", description: "", recommendation: "", sort_order: 0 });
      fetchData();
    } catch (err) {
      console.error(err);
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

  // Duration display formatter
  const formatDuration = (sec: number | undefined) => {
    if (!sec) return "00:00";
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
      
      {/* 1. Detail view mode */}
      <AnimatePresence mode="wait">
        {selectedItem ? (
          <motion.div 
            key="detail"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 overflow-y-auto p-4 md:p-6 max-w-5xl mx-auto w-full flex flex-col gap-6"
          >
            {/* Navigation back */}
            <div className="flex items-center justify-between shrink-0">
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
            <div className="w-full">
              {selectedItem.type === "video" ? (
                <MediaPlayer mediaId={selectedItem.id} />
              ) : (
                <MusicPlayer mediaId={selectedItem.id} />
              )}
            </div>

            {/* Details block */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Left Column: Metadata */}
              <div className="md:col-span-2 flex flex-col gap-4 bg-app-sidebar/10 border border-app-border/40 rounded-2xl p-5">
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
                  <h2 className="text-xl font-bold tracking-tight text-tx-primary">{selectedItem.title}</h2>
                  {selectedItem.artist && (
                    <p className="text-xs text-tx-secondary font-medium">歌手: {selectedItem.artist}</p>
                  )}
                  {selectedItem.collection_title && (
                    <p className="text-xs text-tx-tertiary mt-0.5">合集: <span className="font-semibold">{selectedItem.collection_title}</span></p>
                  )}
                </div>

                <div className="border-t border-app-border/30 pt-3 flex flex-col gap-2">
                  <span className="text-[10px] font-bold uppercase text-tx-tertiary tracking-wider">描述介绍</span>
                  <p className="text-xs text-tx-secondary leading-relaxed bg-app-bg/40 p-3 rounded-xl border border-app-border/30">
                    {selectedItem.description || "无详细描述介绍。"}
                  </p>
                </div>

                <div className="flex items-center gap-4 text-[10px] text-tx-tertiary select-none">
                  <span className="flex items-center gap-1"><Play size={12} /> 播放次数: {selectedItem.play_count}</span>
                  <span className="flex items-center gap-1"><Clock size={12} /> 时长: {formatDuration(selectedItem.duration)}</span>
                </div>
              </div>

              {/* Right Column: Mini Interactive Reviews */}
              <div className="flex flex-col gap-4 bg-app-sidebar/20 border border-app-border/40 rounded-2xl p-5 max-h-[500px]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase text-tx-tertiary tracking-wider flex items-center gap-1">
                    <MessageSquare size={14} /> 影评与讨论
                  </h3>
                  {selectedItem.type === "video" && isPlaying && (
                    <button
                      onClick={handleInsertTimestamp}
                      className="text-[10px] font-bold text-accent-primary bg-accent-primary/10 hover:bg-accent-primary/20 px-2 py-1 rounded transition-colors"
                    >
                      打点 {formatDuration(currentTime)}
                    </button>
                  )}
                </div>

                {/* Review listing */}
                <div 
                  onClick={handleTimestampClick}
                  className="flex-1 overflow-y-auto flex flex-col gap-3 min-h-[150px] pr-1"
                >
                  {reviews.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] text-tx-tertiary text-center p-4">
                      暂无评论或影评，点击下方发布首条评论吧！
                    </div>
                  ) : (
                    reviews.map((rev) => (
                      <div key={rev.id} className="p-3 bg-app-bg border border-app-border rounded-xl flex flex-col gap-1.5 relative group">
                        <div className="flex items-center justify-between text-[10px] text-tx-tertiary select-none">
                          <span className="font-semibold text-tx-secondary flex items-center gap-1">
                            <User size={10} /> {rev.username}
                          </span>
                          <span>{rev.created_at.substring(5, 16)}</span>
                        </div>
                        {rev.title && (
                          <h5 className="text-xs font-bold text-tx-primary">{rev.title}</h5>
                        )}
                        <div 
                          className="text-xs text-tx-secondary leading-relaxed break-words"
                          dangerouslySetInnerHTML={{ __html: rev.content }}
                        />
                        {isAdmin && (
                          <button 
                            onClick={() => handleDeleteReview(rev.id)}
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 text-accent-danger hover:bg-accent-danger/10 rounded"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Quick Editor Box */}
                {reviewEditor && (
                  <div className="flex flex-col gap-2 border-t border-app-border/30 pt-3">
                    <div className="flex items-center justify-between gap-2">
                      <select 
                        value={reviewType}
                        onChange={(e) => setReviewType(e.target.value as any)}
                        className="bg-app-bg border border-app-border text-[10px] rounded p-1 text-tx-secondary outline-none"
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
                          className="flex-1 bg-app-bg border border-app-border text-[10px] rounded p-1 text-tx-primary outline-none focus:border-accent-primary"
                        />
                      )}
                    </div>

                    <EditorContent editor={reviewEditor} />

                    <button
                      onClick={handlePostReview}
                      className="w-full py-1.5 bg-accent-primary hover:bg-accent-primary-hover text-white font-bold text-xs rounded-xl shadow transition-all"
                    >
                      发布互动
                    </button>
                  </div>
                )}

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
            
            {/* Sidebar filter lists */}
            <div className="w-full md:w-56 bg-app-sidebar border-b md:border-b-0 md:border-r border-app-border shrink-0 p-4 flex flex-col gap-4 overflow-y-auto">
              
              {/* Type Switcher */}
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-tx-tertiary uppercase tracking-wider select-none">媒体类型</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setMediaType("video"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-all",
                      mediaType === "video" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-lg shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                  >
                    <Film size={14} />
                    视频库
                  </button>
                  <button
                    onClick={() => { setMediaType("audio"); setSelectedCollection(null); }}
                    className={cn(
                      "flex-1 py-2 px-3 rounded-xl border flex items-center justify-center gap-1.5 text-xs font-bold transition-all",
                      mediaType === "audio" 
                        ? "bg-accent-primary border-accent-primary text-white shadow-lg shadow-accent-primary/10" 
                        : "border-app-border text-tx-secondary bg-app-bg hover:bg-app-hover"
                    )}
                  >
                    <Music size={14} />
                    音乐库
                  </button>
                </div>
              </div>

              {/* Collections Navigation list */}
              <div className="flex flex-col gap-2 flex-1 min-h-[150px]">
                <div className="flex items-center justify-between select-none">
                  <span className="text-[10px] font-bold text-tx-tertiary uppercase tracking-wider">全部合集</span>
                  {isAdmin && (
                    <button 
                      onClick={() => setShowAddCollection(true)}
                      className="text-accent-primary hover:bg-accent-primary/10 p-1 rounded transition-colors"
                      title="新建合集"
                    >
                      <PlusCircle size={14} />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-1 overflow-y-auto max-h-[300px] md:max-h-none">
                  <button
                    onClick={() => setSelectedCollection(null)}
                    className={cn(
                      "w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors",
                      selectedCollection === null 
                        ? "bg-accent-primary/10 text-accent-primary" 
                        : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                    )}
                  >
                    <span>全部单品 ({items.length})</span>
                  </button>
                  {collections.map(col => (
                    <button
                      key={col.id}
                      onClick={() => setSelectedCollection(col)}
                      className={cn(
                        "w-full text-left py-1.5 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-between transition-colors",
                        selectedCollection?.id === col.id 
                          ? "bg-accent-primary/10 text-accent-primary" 
                          : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary"
                      )}
                    >
                      <span className="truncate">{col.title}</span>
                      <span className="text-[9px] px-1 bg-app-border/40 text-tx-tertiary rounded">
                        {col.item_count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings direct access for System admin */}
              {isAdmin && (
                <div className="border-t border-app-border/40 pt-3 select-none">
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
                    className="w-full py-2 px-3 border border-app-border hover:bg-app-hover rounded-xl flex items-center justify-center gap-2 text-xs text-tx-secondary hover:text-tx-primary transition-all font-semibold"
                  >
                    <Settings size={14} />
                    Alist 挂载配置
                  </button>
                </div>
              )}

            </div>

            {/* Grid browser view */}
            <div className="flex-1 flex flex-col min-w-0 bg-app-bg">
              
              {/* Header filter actions */}
              <div className="p-4 border-b border-app-border flex flex-col md:flex-row md:items-center justify-between gap-3 select-none">
                
                {/* Search & Sort */}
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-tx-tertiary" />
                    <input
                      type="text"
                      placeholder="搜索标题、标签、介绍..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-app-sidebar border border-app-border text-xs rounded-xl outline-none text-tx-primary focus:border-accent-primary transition-colors"
                    />
                  </div>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-app-sidebar border border-app-border text-xs rounded-xl p-2 text-tx-secondary outline-none"
                  >
                    <option value="sort_order">自定义排序</option>
                    <option value="newest">最新上传</option>
                    <option value="oldest">最早上传</option>
                    <option value="play_count">最常播放</option>
                    <option value="title">拼音顺序</option>
                  </select>
                </div>

                {/* Import actions (admin/owner only) */}
                {isAdmin && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => setShowAlistBrowser(true)}
                      className="bg-accent-primary hover:bg-accent-primary-hover text-white text-xs font-bold py-2 px-3.5 rounded-xl shadow-lg shadow-accent-primary/10 flex items-center gap-1.5 transition-all"
                    >
                      <Plus size={14} />
                      网盘导入
                    </button>
                    <button
                      onClick={() => setShowImportJson(true)}
                      className="bg-app-sidebar border border-app-border hover:bg-app-hover text-tx-secondary text-xs font-semibold py-2 px-3 rounded-xl flex items-center gap-1.5 transition-all"
                    >
                      <Upload size={14} />
                      JSON 导入
                    </button>
                    <a
                      href="/api/media/import/template"
                      download="template.json"
                      className="bg-app-sidebar border border-app-border hover:bg-app-hover text-tx-secondary text-xs font-semibold py-2 px-3 rounded-xl flex items-center gap-1.5 transition-all"
                    >
                      <Download size={14} />
                      下载模板
                    </a>
                  </div>
                )}
              </div>

              {/* Items content list */}
              <div className="flex-1 overflow-y-auto p-4 md:p-6">
                
                {selectedCollection && (
                  <div className="mb-6 p-4 bg-app-sidebar/20 border border-app-border/40 rounded-2xl flex flex-col gap-2">
                    <h2 className="text-base font-bold text-tx-primary">{selectedCollection.title}</h2>
                    {selectedCollection.description && (
                      <p className="text-xs text-tx-secondary leading-relaxed">{selectedCollection.description}</p>
                    )}
                    {selectedCollection.recommendation && (
                      <div className="text-[10px] text-accent-primary font-medium bg-accent-primary/5 p-2 rounded-lg border border-accent-primary/10">
                        合集评语: {selectedCollection.recommendation}
                      </div>
                    )}
                  </div>
                )}

                {loading ? (
                  <div className="h-64 flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
                    <span className="text-xs text-tx-secondary">正在载入媒体文件...</span>
                  </div>
                ) : items.length === 0 ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-app-sidebar/10 rounded-2xl border border-dashed border-app-border/60">
                    <Film className="w-10 h-10 text-tx-tertiary mb-3 animate-pulse" />
                    <h4 className="text-xs font-bold text-tx-primary mb-1">暂无媒体文件</h4>
                    <p className="text-[10px] text-tx-tertiary">点击上方的“网盘导入”或“JSON 导入”录入第一批音视频！</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    {items.map(item => (
                      <div
                        key={item.id}
                        onClick={() => setSelectedItem(item)}
                        className="bg-app-sidebar/20 hover:bg-app-sidebar/40 border border-app-border/40 rounded-xl overflow-hidden shadow group cursor-pointer transition-all hover:scale-[1.02] flex flex-col"
                      >
                        {/* Cover image container */}
                        <div className="aspect-[2/3] bg-black/40 border-b border-app-border/20 relative flex items-center justify-center overflow-hidden">
                          {item.cover_url ? (
                            <img
                              src={item.cover_url}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-accent-primary/5 border border-accent-primary/15 flex items-center justify-center text-accent-primary">
                              {item.type === "video" ? <Film className="w-6 h-6" /> : <Disc className="w-6 h-6 animate-spin-slow" />}
                            </div>
                          )}
                          
                          {/* Hover Play icon overlay */}
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <div className="w-10 h-10 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-lg shadow-accent-primary/30 transform scale-90 group-hover:scale-100 transition-transform">
                              <Play size={18} className="fill-white translate-x-0.5" />
                            </div>
                          </div>

                          {/* Duration tag */}
                          {item.duration && (
                            <span className="absolute bottom-2 right-2 bg-black/75 px-1.5 py-0.5 rounded text-[9px] font-semibold text-white tracking-wide">
                              {formatDuration(item.duration)}
                            </span>
                          )}
                        </div>

                        {/* Text info */}
                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <h4 className="text-xs font-bold text-tx-primary line-clamp-2 leading-snug tracking-tight mb-0.5">
                              {item.title}
                            </h4>
                            {item.artist && (
                              <p className="text-[10px] text-tx-tertiary truncate">{item.artist}</p>
                            )}
                          </div>
                          <div className="flex items-center justify-between text-[9px] text-tx-tertiary mt-2">
                            <span>{item.play_count} 次播放</span>
                            {item.year && <span>{item.year}</span>}
                          </div>
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
                  alert(msg);
                  setShowAlistBrowser(false);
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
              <h3 className="text-md font-bold text-tx-primary">新建媒体合集</h3>
              
              <div className="flex flex-col gap-1">
                <label className="text-xs text-tx-secondary font-semibold">合集标题</label>
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
                  onClick={handleCreateCollection}
                  className="flex-1 py-2 bg-accent-primary text-white text-xs rounded-xl font-bold hover:bg-accent-primary-hover shadow"
                >
                  创建合集
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
