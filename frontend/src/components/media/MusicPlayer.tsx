import React, { useEffect, useState } from "react";
import { useMediaStore, PlayMode } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { 
  Loader2, Music, AlertCircle, Play, Pause, SkipForward, SkipBack, 
  Shuffle, Repeat, Repeat1, Volume2, VolumeX 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioCover, useID3Cover } from "@/lib/id3";

interface MusicPlayerProps {
  mediaId: string;
}

export default function MusicPlayer({ mediaId }: MusicPlayerProps) {
  const [mediaItem, setMediaItem] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const {
    isPlaying,
    currentMedia,
    currentTime,
    duration,
    volume,
    isMuted,
    playMode,
    pauseMedia,
    resumeMedia,
    nextMedia,
    prevMedia,
    setVolume,
    setMuted,
    setPlayMode,
    playMedia,
    triggerSeek,
    playlist
  } = useMediaStore();

  // 1. Fetch song details
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.request<any>(`/media/items/${mediaId}`)
      .then(res => {
        if (active) {
          setMediaItem(res);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError(err.message || "获取音乐详情失败");
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [mediaId]);

  const isCurrentActive = currentMedia?.id === mediaId;

  const handlePlayClick = () => {
    if (isCurrentActive) {
      if (isPlaying) {
        pauseMedia();
      } else {
        resumeMedia();
      }
    } else if (mediaItem) {
      // Convert mediaItem to MediaPlayItem shape
      playMedia({
        id: mediaItem.id,
        title: mediaItem.title,
        type: "audio",
        alist_path: mediaItem.alist_path,
        artist: mediaItem.artist,
        album: mediaItem.album,
        cover_url: mediaItem.cover_url,
        duration: mediaItem.duration
      });
    }
  };

  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isCurrentActive) return;
    const time = parseFloat(e.target.value);
    triggerSeek(time);
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

  // hooks must run before any early return
  // 仅当本曲目是全局当前播放项时解析 ID3；否则只读缓存 / DB
  const { meta: id3Meta } = useID3Cover(
    mediaItem?.id,
    mediaItem?.cover_url,
    "audio",
    { parse: isCurrentActive },
  );
  const displayTitle = mediaItem?.title;
  const displayArtist = mediaItem?.artist || id3Meta?.artist || "未知歌手";
  const displayAlbum = mediaItem?.album || id3Meta?.album;

  // Local values if not playing this track, global values if active
  const activeTime = isCurrentActive ? currentTime : 0;
  const activeDuration = isCurrentActive ? duration : (mediaItem?.duration || 0);
  const activeIsPlaying = isCurrentActive && isPlaying;

  if (loading) {
    return (
      <div className="w-full py-12 flex flex-col items-center justify-center bg-app-sidebar/30 backdrop-blur border border-app-border rounded-2xl">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-3" />
        <span className="text-sm text-tx-secondary">正在读取音乐信息...</span>
      </div>
    );
  }

  if (error || !mediaItem) {
    return (
      <div className="w-full p-8 flex flex-col items-center justify-center bg-app-sidebar/30 backdrop-blur border border-app-border rounded-2xl text-center">
        <AlertCircle className="w-10 h-10 text-accent-warning mb-3" />
        <h5 className="text-sm font-semibold text-tx-primary mb-1">读取详情出错</h5>
        <p className="text-xs text-tx-tertiary mb-4">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-full bg-gradient-to-br from-app-sidebar/80 to-app-sidebar/40 backdrop-blur-xl border border-app-border/80 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center gap-6 select-none">
      
      {/* Vinyl record disc cover visualization */}
      <div className="relative shrink-0 w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-app-border shadow-inner bg-black/90 flex items-center justify-center overflow-hidden">
        {mediaItem && (
          <AudioCover 
            item={{ id: mediaItem.id, cover_url: mediaItem.cover_url, title: mediaItem.title }} 
            className={cn(
              "w-full h-full object-cover rounded-full select-none media-disc-spin",
              !activeIsPlaying && "media-disc-spin-paused",
            )}
            fallbackIconSize={24}
          />
        )}
        {/* Record center pin hole */}
        <div className="absolute w-4 h-4 bg-app-sidebar rounded-full border border-app-border shadow-md" />
      </div>

      <div className="flex-1 w-full flex flex-col">
        {/* Song Info */}
        <div className="mb-4 text-center md:text-left">
          <h4 className="text-lg font-bold text-tx-primary line-clamp-1">{displayTitle}</h4>
          <p className="text-sm text-tx-tertiary font-medium line-clamp-1">
            {[displayArtist, displayAlbum].filter(Boolean).join(" · ")}
          </p>
        </div>

        {/* Interface controls */}
        <div className="flex flex-col gap-3">
          {/* Progress Slider */}
          <div className="w-full flex items-center gap-2.5 text-[10px] text-tx-tertiary">
            <span className="w-8 text-right font-medium">{formatDuration(activeTime)}</span>
            <input
              type="range"
              min="0"
              max={activeDuration || 0}
              value={activeTime}
              disabled={!isCurrentActive}
              onChange={handleProgressChange}
              className={cn(
                "flex-1 h-1 bg-app-border dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none",
                !isCurrentActive && "opacity-50 cursor-not-allowed"
              )}
            />
            <span className="w-8 text-left font-medium">{formatDuration(activeDuration)}</span>
          </div>

          {/* Controls panel */}
          <div className="flex items-center justify-between md:justify-start md:gap-8 px-4 md:px-0">
            
            {/* Play Mode (only when active) */}
            <button 
              onClick={cyclePlayMode}
              disabled={!isCurrentActive}
              className={cn(
                "text-tx-secondary hover:text-tx-primary transition-colors",
                !isCurrentActive && "opacity-40 cursor-not-allowed"
              )}
              title={
                playMode === "sequence" ? "列表循环" : playMode === "random" ? "随机播放" : "单曲循环"
              }
            >
              {playMode === "random" && <Shuffle size={16} className="text-accent-primary" />}
              {playMode === "loop" && <Repeat1 size={16} className="text-accent-primary" />}
              {playMode === "sequence" && <Repeat size={16} />}
            </button>

            {/* Skip Back */}
            <button 
              onClick={prevMedia}
              disabled={!isCurrentActive || playlist.length <= 1}
              className={cn(
                "text-tx-secondary hover:text-tx-primary transition-colors",
                (!isCurrentActive || playlist.length <= 1) && "opacity-40 cursor-not-allowed"
              )}
            >
              <SkipBack size={20} />
            </button>

            {/* Play / Pause button */}
            <button
              onClick={handlePlayClick}
              className="w-10 h-10 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-lg shadow-accent-primary/20 hover:scale-105 active:scale-95 transition-all"
            >
              {activeIsPlaying ? (
                <Pause size={18} className="fill-white" />
              ) : (
                <Play size={18} className="fill-white translate-x-0.5" />
              )}
            </button>

            {/* Skip Forward */}
            <button 
              onClick={() => nextMedia(false)}
              disabled={!isCurrentActive || playlist.length <= 1}
              className={cn(
                "text-tx-secondary hover:text-tx-primary transition-colors",
                (!isCurrentActive || playlist.length <= 1) && "opacity-40 cursor-not-allowed"
              )}
            >
              <SkipForward size={20} />
            </button>

            {/* Volume (linked globally) */}
            <div className="hidden md:flex items-center gap-2">
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
                className="w-20 h-1 bg-app-border dark:bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none"
              />
            </div>

          </div>
        </div>
      </div>

    </div>
  );
}
