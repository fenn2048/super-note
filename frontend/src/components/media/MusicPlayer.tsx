import React, { useEffect, useRef, useState } from "react";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
import { useMediaStore, MediaPlayItem } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { Loader2, Music, AlertCircle, SkipForward, SkipBack } from "lucide-react";
import { cn } from "@/lib/utils";

interface MusicPlayerProps {
  mediaId: string;
}

export default function MusicPlayer({ mediaId }: MusicPlayerProps) {
  const playerRef = useRef<AudioPlayer>(null);
  const [playUrl, setPlayUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const {
    isPlaying,
    volume,
    isMuted,
    seekTime,
    currentMedia,
    setCurrentTime,
    setDuration,
    resetSeek,
    pauseMedia,
    resumeMedia,
    nextMedia,
    prevMedia,
    playlist
  } = useMediaStore();

  // 1. Fetch play URL when mediaId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPlayUrl("");

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
    return () => {
      active = false;
    };
  }, [mediaId]);

  // 2. Handle seek commands
  useEffect(() => {
    if (seekTime !== null && playerRef.current?.audio.current) {
      playerRef.current.audio.current.currentTime = seekTime;
      resetSeek();
    }
  }, [seekTime, resetSeek]);

  // 3. Keep backend updated on play progress
  const lastReportedTime = useRef<number>(0);
  const reportProgress = async (progressSeconds: number) => {
    try {
      await api.request(`/media/items/${mediaId}/play`, {
        method: "POST",
        body: JSON.stringify({ progress: Math.floor(progressSeconds) })
      });
    } catch (err) {
      console.warn("Failed to report play progress:", err);
    }
  };

  const handleListen = (e: Event) => {
    const audioEl = e.target as HTMLAudioElement;
    const time = audioEl.currentTime;
    setCurrentTime(time);

    if (Math.abs(time - lastReportedTime.current) >= 10) {
      lastReportedTime.current = time;
      reportProgress(time);
    }
  };

  const handleLoadedMetadata = (e: Event) => {
    const audioEl = e.target as HTMLAudioElement;
    setDuration(audioEl.duration);
  };

  const handleEnded = () => {
    reportProgress(0);
    if (playlist.length > 1) {
      nextMedia();
    } else {
      pauseMedia();
    }
  };

  // Report final progress
  useEffect(() => {
    return () => {
      if (playerRef.current?.audio.current) {
        const currentTime = playerRef.current.audio.current.currentTime;
        if (currentTime > 0) {
          reportProgress(currentTime);
        }
      }
    };
  }, [mediaId]);

  if (loading) {
    return (
      <div className="w-full py-12 flex flex-col items-center justify-center bg-app-sidebar/30 backdrop-blur border border-app-border rounded-2xl">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-3" />
        <span className="text-sm text-tx-secondary">解析音乐直链中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full p-8 flex flex-col items-center justify-center bg-app-sidebar/30 backdrop-blur border border-app-border rounded-2xl text-center">
        <AlertCircle className="w-10 h-10 text-accent-warning mb-3" />
        <h5 className="text-sm font-semibold text-tx-primary mb-1">音乐播放错误</h5>
        <p className="text-xs text-tx-tertiary mb-4">{error}</p>
        <button
          onClick={() => { setError(""); setLoading(true); }}
          className="px-3 py-1 bg-accent-primary/20 hover:bg-accent-primary/30 text-accent-primary text-xs rounded-lg transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="w-full bg-gradient-to-br from-app-sidebar/80 to-app-sidebar/40 backdrop-blur-xl border border-app-border/80 rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center gap-6">
      {/* Vinyl record disc cover visualization */}
      <div className="relative shrink-0 w-24 h-24 md:w-28 md:h-28 rounded-full border-2 border-app-border shadow-inner bg-black/90 flex items-center justify-center overflow-hidden">
        {currentMedia?.cover_url ? (
          <img
            src={currentMedia.cover_url}
            alt={currentMedia.title}
            className={cn(
              "w-full h-full object-cover rounded-full select-none",
              isPlaying ? "animate-spin-slow" : ""
            )}
            style={{ animationDuration: "12s" }}
          />
        ) : (
          <div className={cn(
            "w-12 h-12 rounded-full bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary",
            isPlaying ? "animate-bounce" : ""
          )}>
            <Music className="w-6 h-6" />
          </div>
        )}
        {/* Record center pin hole */}
        <div className="absolute w-4 h-4 bg-app-sidebar rounded-full border border-app-border shadow-md" />
      </div>

      <div className="flex-1 w-full flex flex-col">
        {/* Song Info */}
        <div className="mb-4 text-center md:text-left">
          <h4 className="text-lg font-bold text-tx-primary line-clamp-1">{currentMedia?.title || "未知曲目"}</h4>
          <p className="text-sm text-tx-tertiary font-medium line-clamp-1">{currentMedia?.artist || "未知歌手"}</p>
        </div>

        {/* Customized react-h5-audio-player */}
        <div className="music-player-theme">
          <AudioPlayer
            ref={playerRef}
            src={playUrl}
            autoPlay={isPlaying}
            showSkipControls={playlist.length > 1}
            showJumpControls={false}
            volume={volume}
            muted={isMuted}
            onPlay={resumeMedia}
            onPause={pauseMedia}
            onListen={handleListen}
            onLoadedMetaData={handleLoadedMetadata}
            onEnded={handleEnded}
            onClickNext={nextMedia}
            onClickPrevious={prevMedia}
            customIcons={{
              next: <SkipForward size={20} className="text-tx-secondary hover:text-tx-primary transition-colors" />,
              previous: <SkipBack size={20} className="text-tx-secondary hover:text-tx-primary transition-colors" />
            }}
          />
        </div>
      </div>
    </div>
  );
}
