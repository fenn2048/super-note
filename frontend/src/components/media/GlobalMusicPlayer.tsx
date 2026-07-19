import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaStore, PlayMode, MediaPlayItem } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, 
  Volume2, VolumeX, ListMusic, ChevronDown, Music, Loader2, X, Minimize2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AudioCover, useID3Cover } from "@/lib/id3";

export default function GlobalMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastReportedTime = useRef<number>(0);
  
  const {
    isPlaying,
    currentMedia,
    currentTime,
    duration,
    volume,
    isMuted,
    playlist,
    currentIndex,
    playMode,
    pauseMedia,
    resumeMedia,
    setCurrentTime,
    setDuration,
    nextMedia,
    prevMedia,
    setVolume,
    setMuted,
    setPlayMode,
    seekTime,
    resetSeek,
    playMedia,
    removeFromPlaylist,
    clearPlaylist,
    patchCurrentMedia,
  } = useMediaStore();

  const [playUrl, setPlayUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showQueue, setShowQueue] = useState<boolean>(false);
  const [isMiniMode, setIsMiniMode] = useState<boolean>(false);
  const [currentHash, setCurrentHash] = useState<string>(window.location.hash);

  useEffect(() => {
    const handleHash = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const { coverUrl: id3Cover, meta: id3Meta } = useID3Cover(currentMedia?.id, currentMedia?.cover_url, currentMedia?.type);
  const coverToUse = id3Cover || currentMedia?.cover_url;

  // ID3 歌手/专辑回填到播放状态
  useEffect(() => {
    if (!currentMedia || !id3Meta) return;
    const patch: { artist?: string; album?: string } = {};
    if (id3Meta.artist && !currentMedia.artist) patch.artist = id3Meta.artist;
    if (id3Meta.album && !currentMedia.album) patch.album = id3Meta.album;
    if (Object.keys(patch).length > 0) {
      patchCurrentMedia(patch);
    }
  }, [currentMedia?.id, id3Meta?.artist, id3Meta?.album]);

  // 1. Fetch play URL when currentMedia changes (only for audio)
  useEffect(() => {
    if (!currentMedia || currentMedia.type !== "audio") {
      setPlayUrl("");
      return;
    }

    const mediaId = currentMedia.id;
    let active = true;
    setLoading(true);
    setError("");

    async function fetchPlayUrl() {
      try {
        const res = await api.request<{ url: string }>(`/media/items/${mediaId}/play-url`);
        if (!active) return;

        if (res && res.url) {
          setPlayUrl(res.url);
        } else {
          setError("无法获取播放直链");
        }
      } catch (err: any) {
        if (!active) return;
        setError(err.message || "获取播放链接失败，请检查 Alist 配置");
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchPlayUrl();
    
    // Reset reporting tracker
    lastReportedTime.current = 0;

    return () => {
      active = false;
    };
  }, [currentMedia?.id]);

  // 2. Play / Pause syncing
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playUrl) return;

    if (isPlaying && currentMedia?.type === "audio") {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn("Global audio playback failed:", err);
        });
      }
    } else {
      audio.pause();
    }
  }, [isPlaying, playUrl, currentMedia?.type]);

  // 3. Sync volume and mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  // 4. Sync Seek commands
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (seekTime !== null) {
      audio.currentTime = seekTime;
      resetSeek();
    }
  }, [seekTime, resetSeek]);

  // Progress Reporting to backend
  const reportProgress = async (mediaId: string, progressSeconds: number) => {
    try {
      await api.request(`/media/items/${mediaId}/play`, {
        method: "POST",
        body: JSON.stringify({ progress: Math.floor(progressSeconds) })
      });
    } catch (err) {
      console.warn("Failed to report play progress:", err);
    }
  };

  // Audio element events
  const handleTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    setCurrentTime(audio.currentTime);

    // Report play progress to backend every 10s
    if (currentMedia && Math.abs(audio.currentTime - lastReportedTime.current) >= 10) {
      lastReportedTime.current = audio.currentTime;
      reportProgress(currentMedia.id, audio.currentTime);
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const audio = e.currentTarget;
    const d = audio.duration;
    if (!d || isNaN(d)) return;
    setDuration(d);
    // 回写时长到 store / 后端（仅当库里没有有效时长时）
    if (currentMedia && (!currentMedia.duration || currentMedia.duration <= 0)) {
      patchCurrentMedia({ duration: Math.floor(d) });
      api.request(`/media/items/${currentMedia.id}/metadata`, {
        method: "PATCH",
        body: JSON.stringify({ duration: Math.floor(d) }),
      }).catch(() => {});
    }
  };

  // Media Session（Android 锁屏 / 系统媒体控件）
  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentMedia || currentMedia.type !== "audio") {
      return;
    }

    const artwork: MediaImage[] = [];
    const cover = coverToUse || currentMedia.cover_url;
    if (cover) {
      artwork.push(
        { src: cover, sizes: "96x96", type: "image/jpeg" },
        { src: cover, sizes: "256x256", type: "image/jpeg" },
        { src: cover, sizes: "512x512", type: "image/jpeg" },
      );
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentMedia.title || "未知曲目",
        artist: currentMedia.artist || "未知歌手",
        album: currentMedia.album || "",
        artwork,
      });
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    } catch (err) {
      console.warn("mediaSession metadata failed:", err);
    }

    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch { /* some actions unsupported */ }
    };

    setHandler("play", () => resumeMedia());
    setHandler("pause", () => pauseMedia());
    setHandler("previoustrack", () => prevMedia());
    setHandler("nexttrack", () => nextMedia(false));
    setHandler("seekto", (details) => {
      if (details.seekTime != null && audioRef.current) {
        audioRef.current.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });

    return () => {
      setHandler("play", null);
      setHandler("pause", null);
      setHandler("previoustrack", null);
      setHandler("nexttrack", null);
      setHandler("seekto", null);
    };
  }, [currentMedia?.id, currentMedia?.title, currentMedia?.artist, currentMedia?.album, coverToUse, isPlaying]);

  // 同步 mediaSession position state
  useEffect(() => {
    if (!("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) return;
    if (!duration || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        playbackRate: 1,
        position: Math.min(currentTime || 0, duration || 0),
      });
    } catch { /* ignore */ }
  }, [currentTime, duration, isPlaying]);

  const handleEnded = () => {
    if (currentMedia) {
      reportProgress(currentMedia.id, 0); // Reset progress on end
    }
    nextMedia(true); // Trigger auto next
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (vol > 0 && isMuted) {
      setMuted(false);
    }
  };

  const cyclePlayMode = () => {
    if (playMode === "sequence") {
      setPlayMode("random");
    } else if (playMode === "random") {
      setPlayMode("loop");
    } else {
      setPlayMode("sequence");
    }
  };

  const formatDuration = (sec: number) => {
    if (isNaN(sec) || !sec) return "00:00";
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // PR4：迷你条占用底部额外高度，抬升 FAB / 主内容 padding
  useEffect(() => {
    const root = document.documentElement;
    const active =
      !!currentMedia &&
      currentMedia.type === "audio" &&
      !isExpanded &&
      !isMiniMode;
    // 迷你条高度约 56 + 间距 8 ≈ 64
    root.style.setProperty("--mobile-extra-bottom", active ? "64px" : "0px");
    return () => {
      root.style.setProperty("--mobile-extra-bottom", "0px");
    };
  }, [currentMedia?.id, currentMedia?.type, isExpanded, isMiniMode]);

  // If no audio is loaded, do not render player components
  if (!currentMedia || currentMedia.type !== "audio") return null;

  const isOnCurrentAudioDetailsPage = currentHash === `#/media/items/${currentMedia.id}`;

  return (
    <>
      {/* Hidden Audio Node */}
      <audio
        ref={audioRef}
        src={playUrl}
        {...{ referrerPolicy: "no-referrer" }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPause={pauseMedia}
        onPlay={resumeMedia}
      />

      {/* Hide UI if we are viewing the details page of the currently playing audio */}
      {!isOnCurrentAudioDetailsPage && (
        <>
          {/* ----------------------------------------------------------------------- */}
          {/* MINI MODE DRAGGABLE CD PLAYER */}
          {/* ----------------------------------------------------------------------- */}
          <AnimatePresence>
        {isMiniMode && (
          <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="fixed z-[100] top-24 right-6 w-16 h-16 rounded-full border border-app-border/40 shadow-2xl overflow-hidden cursor-move group bg-black/40 backdrop-blur-sm"
          >
            <AudioCover
              item={currentMedia}
              className={cn(
                "w-full h-full object-cover rounded-full pointer-events-none select-none media-disc-spin",
                !isPlaying && "media-disc-spin-paused",
              )}
              fallbackIconSize={24}
            />
            {/* Hover overlay with play/pause */}
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  isPlaying ? pauseMedia() : resumeMedia();
                }}
                className="text-white hover:scale-110 active:scale-95 transition-transform"
              >
                {isPlaying ? <Pause size={20} className="fill-white" /> : <Play size={20} className="fill-white translate-x-0.5" />}
              </button>
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setIsMiniMode(false);
                }}
                className="absolute top-0 right-0 w-5 h-5 bg-accent-primary/80 hover:bg-accent-primary rounded-full text-white flex items-center justify-center opacity-0 group-hover:opacity-100 shadow-md transition-all z-10"
                title="恢复完整播放器"
              >
                <X size={10} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------------- */}
      {/* PERSISTENT BOTTOM BAR — Portal 到 body，相对视口贴底（抬过 Tab） */}
      {/* ----------------------------------------------------------------------- */}
      {!isMiniMode &&
        typeof document !== "undefined" &&
        createPortal(
        <div 
        className={cn(
          "z-40 bg-app-sidebar/85 dark:bg-[#181824]/85 backdrop-blur-xl border border-app-border/60 shadow-xl flex items-center justify-between select-none transition-all duration-300",
          // 全端 fixed：移动 bottom 用 --mobile-music-bottom（随 Tab 显隐）
          "fixed left-3 right-3 mobile-music-mini rounded-2xl px-3 py-2.5 md:left-6 md:right-6 md:bottom-6 md:py-3.5 md:px-4",
          isExpanded && "max-md:opacity-0 max-md:pointer-events-none"
        )}
      >
        {/* Left: Album cover & Song Details */}
        <div className="flex items-center gap-3 min-w-0 max-w-[40%] md:max-w-[25%]">
          <div 
            onClick={() => setIsExpanded(true)}
            className="relative shrink-0 w-12 h-12 rounded-full border border-app-border/40 bg-black/40 flex items-center justify-center overflow-hidden cursor-pointer shadow-md group"
          >
            <AudioCover
              item={currentMedia}
              className={cn(
                "w-full h-full object-cover rounded-full select-none media-disc-spin",
                !isPlaying && "media-disc-spin-paused",
              )}
              fallbackIconSize={16}
            />
            <div className="absolute w-3 h-3 bg-app-sidebar dark:bg-[#181824] rounded-full border border-app-border/60 shadow" />
          </div>

          <div 
            onClick={() => setIsExpanded(true)}
            className="flex flex-col min-w-0 cursor-pointer"
          >
            <span className="text-xs font-bold text-tx-primary truncate hover:text-accent-primary transition-colors">
              {currentMedia.title}
            </span>
            <span className="text-[10px] text-tx-tertiary truncate">
              {[currentMedia.artist || "未知歌手", currentMedia.album].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>

        {/* Center: Playback Controls & Seek bar (Hidden/Simplified on Mobile) */}
        <div className="flex-1 hidden md:flex flex-col items-center max-w-[50%] px-4">
          <div className="flex items-center gap-5 mb-1.5">
            {/* Play Mode toggle */}
            <button 
              onClick={cyclePlayMode}
              className="text-tx-secondary hover:text-tx-primary transition-colors"
              title={
                playMode === "sequence" ? "列表循环" : playMode === "random" ? "随机播放" : "单曲循环"
              }
            >
              {playMode === "random" && <Shuffle size={15} className="text-accent-primary" />}
              {playMode === "loop" && <Repeat1 size={15} className="text-accent-primary" />}
              {playMode === "sequence" && <Repeat size={15} />}
            </button>

            {/* Prev */}
            <button 
              onClick={prevMedia}
              className="text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <SkipBack size={18} />
            </button>

            {/* Play/Pause */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                isPlaying ? pauseMedia() : resumeMedia();
              }}
              className="w-8 h-8 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-md shadow-accent-primary/20 hover:scale-105 active:scale-95 transition-all"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={15} className="fill-white" />
              ) : (
                <Play size={15} className="fill-white translate-x-0.5" />
              )}
            </button>

            {/* Next */}
            <button 
              onClick={() => nextMedia(false)}
              className="text-tx-secondary hover:text-tx-primary transition-colors"
            >
              <SkipForward size={18} />
            </button>

            {/* Queue Toggle */}
            <button 
              onClick={() => setShowQueue(!showQueue)}
              className={cn("text-tx-secondary hover:text-tx-primary transition-colors", showQueue && "text-accent-primary")}
              title="播放队列"
            >
              <ListMusic size={16} />
            </button>
          </div>

          {/* Progress Slider */}
          <div className="w-full flex items-center gap-2.5 text-[10px] text-tx-tertiary">
            <span className="w-8 text-right font-medium select-none">{formatDuration(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleProgressChange}
              className="flex-1 h-1 bg-app-border dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent-primary hover:h-1.5 transition-all outline-none"
            />
            <span className="w-8 text-left font-medium select-none">{formatDuration(duration)}</span>
          </div>
        </div>

        {/* Right: Volume Controls (Desktop) / Quick control buttons (Mobile) */}
        <div className="flex items-center gap-3">
          {/* Mobile playback buttons */}
          <div className="flex md:hidden items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                isPlaying ? pauseMedia() : resumeMedia();
              }}
              className="w-9 h-9 rounded-full bg-accent-primary text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : isPlaying ? (
                <Pause size={16} className="fill-white" />
              ) : (
                <Play size={16} className="fill-white translate-x-0.5" />
              )}
            </button>
            <button 
              onClick={() => nextMedia(false)}
              className="w-9 h-9 rounded-full bg-app-sidebar border border-app-border text-tx-secondary flex items-center justify-center active:bg-app-hover transition-all"
            >
              <SkipForward size={16} />
            </button>
          </div>

          {/* Desktop volume slider */}
          <div className="hidden md:flex items-center gap-2 select-none">
            <button
              onClick={() => setMuted(!isMuted)}
              className="text-tx-secondary hover:text-tx-primary transition-colors"
            >
              {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="w-16 h-1 bg-app-border dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center ml-2">
            {/* Minimize Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsMiniMode(true);
              }}
              className="p-1.5 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0"
              title="最小化为悬浮窗"
            >
              <Minimize2 size={16} />
            </button>

            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                useMediaStore.getState().stopMedia();
              }}
              className="p-1.5 rounded-full text-tx-secondary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors shrink-0 ml-1"
              title="关闭播放器"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>,
          document.body,
        )}

      {/* Floating Queue Drawer Panel (Desktop) */}
      <AnimatePresence>
        {showQueue && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowQueue(false)} />
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="fixed bottom-24 right-6 w-80 bg-app-sidebar/95 dark:bg-[#181824]/95 backdrop-blur-xl border border-app-border/80 rounded-2xl shadow-2xl z-50 p-4 flex flex-col max-h-[350px] overflow-hidden"
            >
              <div className="flex items-center justify-between pb-2 border-b border-app-border/40 select-none gap-2">
                <span className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <ListMusic size={14} /> 播放队列 ({playlist.length})
                </span>
                <div className="flex items-center gap-2">
                  {playlist.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("确定清空播放列表？音频文件不会被删除。")) {
                          clearPlaylist();
                          setShowQueue(false);
                        }
                      }}
                      className="text-[11px] text-accent-danger hover:underline"
                      title="一键移除全部（仅播放列表）"
                    >
                      一键移除
                    </button>
                  )}
                  <button 
                    onClick={() => setShowQueue(false)} 
                    className="text-tx-tertiary hover:text-tx-primary text-xs"
                  >
                    关闭
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto mt-2 pr-1 flex flex-col gap-1.5">
                {playlist.map((item, idx) => (
                  <div
                    key={item.id + "-" + idx}
                    onClick={() => playMedia(item, playlist)}
                    className={cn(
                      "group/queue flex items-center gap-2 p-2 rounded-xl cursor-pointer transition-colors text-xs font-medium",
                      idx === currentIndex 
                        ? "bg-accent-primary/10 text-accent-primary" 
                        : "hover:bg-app-hover text-tx-secondary hover:text-tx-primary"
                    )}
                  >
                    <span className="w-4 text-center text-[10px] text-tx-tertiary">{idx + 1}</span>
                    <div className="flex-1 truncate min-w-0">
                      <p className="truncate font-semibold">{item.title}</p>
                      <p className="text-[10px] text-tx-tertiary truncate">
                        {[item.artist, item.album].filter(Boolean).join(" · ") || "未知歌手"}
                      </p>
                    </div>
                    {item.duration ? (
                      <span className="text-[10px] text-tx-tertiary shrink-0 group-hover/queue:hidden">{formatDuration(item.duration)}</span>
                    ) : null}
                    <button
                      type="button"
                      title="从播放列表移除"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromPlaylist(idx);
                      }}
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-tx-tertiary hover:text-accent-danger hover:bg-accent-danger/10 opacity-100 md:opacity-0 md:group-hover/queue:opacity-100 transition-opacity"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------------- */}
      {/* IMMERSIVE FULL-SCREEN PLAYER DRAWER */}
      {/* ----------------------------------------------------------------------- */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed inset-0 z-50 bg-[#0f0f15] text-white flex flex-col overflow-hidden select-none animate-fade-in"
          >
            {/* Blurry Colorful Cover Art Background */}
            <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none">
              {coverToUse ? (
                <div 
                  className="w-full h-full bg-cover bg-center filter blur-[80px] saturate-[180%] opacity-25 scale-125"
                  style={{ backgroundImage: `url(${coverToUse})` }}
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-accent-primary/20 via-zinc-950 to-indigo-950/20 filter blur-[80px] opacity-30" />
              )}
            </div>

            {/* Header */}
            <div className="relative z-10 flex items-center justify-between p-5 border-b border-white/5 bg-black/10 backdrop-blur-sm">
              <button 
                onClick={() => setIsExpanded(false)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all text-white/80 hover:text-white"
              >
                <ChevronDown size={22} />
              </button>
              <div className="text-center">
                <p className="text-[9px] uppercase tracking-widest text-white/50 font-bold">正在播放</p>
                <p className="text-xs font-semibold text-white/80 max-w-[200px] truncate">{currentMedia.title}</p>
              </div>
              <button 
                onClick={() => setShowQueue(!showQueue)}
                className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all text-white/80 hover:text-white"
              >
                <ListMusic size={20} />
              </button>
            </div>

            {/* Main Immersive Core */}
            <div className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center p-6 gap-8 max-w-5xl mx-auto w-full min-h-0 overflow-y-auto">
              
              {/* Left Column: Big Rotating Disc */}
              <div className="flex-1 flex flex-col items-center justify-center max-w-md w-full">
                <div className="relative w-64 h-64 sm:w-80 sm:h-80 md:w-96 md:h-96 rounded-full bg-black border-4 border-zinc-900 shadow-2xl flex items-center justify-center select-none">
                  {/* Vinyl grooves styling */}
                  <div className="absolute inset-2 rounded-full border border-white/5 opacity-40 pointer-events-none" />
                  <div className="absolute inset-6 rounded-full border border-white/5 opacity-30 pointer-events-none" />
                  <div className="absolute inset-12 rounded-full border border-white/5 opacity-35 pointer-events-none" />
                  <div className="absolute inset-20 rounded-full border border-white/5 opacity-25 pointer-events-none" />
                  <div className="absolute inset-28 rounded-full border border-white/5 opacity-20 pointer-events-none" />
                  <div className="absolute inset-36 rounded-full border border-white/5 opacity-15 pointer-events-none" />

                  {/* Album Cover Circle */}
                  <div className="relative w-40 h-40 sm:w-52 sm:h-52 md:w-60 md:h-60 rounded-full overflow-hidden border-2 border-zinc-800 shadow-lg">
                    <AudioCover 
                      item={currentMedia} 
                      className={cn(
                        "w-full h-full object-cover select-none media-disc-spin",
                        !isPlaying && "media-disc-spin-paused",
                      )}
                      fallbackIconSize={64}
                    />
                  </div>
                  
                  {/* Center pin hole */}
                  <div className="absolute w-8 h-8 bg-zinc-950 rounded-full border-2 border-zinc-800 flex items-center justify-center shadow-inner">
                    <div className="w-2.5 h-2.5 bg-zinc-800 rounded-full" />
                  </div>
                </div>
              </div>

              {/* Right Column: Song Info & Big Controls */}
              <div className="flex-1 flex flex-col justify-center w-full max-w-md gap-6 lg:gap-8">
                
                {/* Details */}
                <div className="text-center lg:text-left">
                  <h2 className="text-2xl lg:text-3xl font-extrabold text-white tracking-tight line-clamp-2">
                    {currentMedia.title}
                  </h2>
                  <p className="text-sm font-semibold text-white/60 mt-1 lg:mt-2">
                    {[currentMedia.artist || "未知歌手", currentMedia.album].filter(Boolean).join(" · ")}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="flex flex-col gap-2">
                  <input
                    type="range"
                    min="0"
                    max={duration || 0}
                    value={currentTime}
                    onChange={handleProgressChange}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent-primary hover:h-2 transition-all outline-none"
                  />
                  <div className="flex items-center justify-between text-xs text-white/50 select-none font-medium">
                    <span>{formatDuration(currentTime)}</span>
                    <span>{formatDuration(duration)}</span>
                  </div>
                </div>

                {/* Core Control Buttons */}
                <div className="flex items-center justify-between px-6">
                  {/* Shuffle/Play mode */}
                  <button 
                    onClick={cyclePlayMode}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/5 text-white/60 hover:text-white transition-all"
                  >
                    {playMode === "random" && <Shuffle size={18} className="text-accent-primary" />}
                    {playMode === "loop" && <Repeat1 size={18} className="text-accent-primary" />}
                    {playMode === "sequence" && <Repeat size={18} />}
                  </button>

                  {/* Prev */}
                  <button 
                    onClick={prevMedia}
                    className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/5 text-white/80 hover:text-white active:scale-90 transition-all"
                  >
                    <SkipBack size={24} className="fill-white/10" />
                  </button>

                  {/* Large Play/Pause */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isPlaying ? pauseMedia() : resumeMedia();
                    }}
                    className="w-18 h-18 rounded-full bg-accent-primary hover:bg-accent-primary-hover text-white flex items-center justify-center shadow-lg shadow-accent-primary/20 hover:scale-105 active:scale-95 transition-all"
                  >
                    {loading ? (
                      <Loader2 size={24} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={24} className="fill-white" />
                    ) : (
                      <Play size={24} className="fill-white translate-x-1" />
                    )}
                  </button>

                  {/* Next */}
                  <button 
                    onClick={() => nextMedia(false)}
                    className="w-12 h-12 rounded-full flex items-center justify-center hover:bg-white/5 text-white/80 hover:text-white active:scale-90 transition-all"
                  >
                    <SkipForward size={24} className="fill-white/10" />
                  </button>

                  {/* Mute Toggle */}
                  <button
                    onClick={() => setMuted(!isMuted)}
                    className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/5 text-white/60 hover:text-white transition-all"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                  </button>
                </div>

                {/* Sub-controls: Immersive Volume Slider */}
                <div className="flex items-center gap-3 px-4">
                  <VolumeX size={14} className="text-white/40" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none"
                  />
                  <Volume2 size={14} className="text-white/40" />
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}
    </>
  );
}
