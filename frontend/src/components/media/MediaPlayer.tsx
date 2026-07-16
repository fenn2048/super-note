import React, { useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import Hls from "hls.js";
import { useMediaStore } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { Loader2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaPlayerProps {
  mediaId: string;
  onDuration?: (duration: number) => void;
  onProgress?: (progress: number) => void;
}

export default function MediaPlayer({ mediaId, onDuration, onProgress }: MediaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Artplayer | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);

  const { 
    seekTime, 
    resetSeek,
    pauseMedia,
    resumeMedia,
    setCurrentTime,
    setDuration,
  } = useMediaStore();

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

  const fetchAndInitPlayer = async (active: { current: boolean }) => {
    try {
      setLoading(true);
      setError("");

      const res = await api.request<any>(`/media/items/${mediaId}/play-url`, {
        method: "GET"
      });
      
      if (!active.current) return;
      
      let rawUrl = "";
      if (res && res.url) {
        rawUrl = res.url;
      } else if (res && res.data && res.data.raw_url) {
        rawUrl = res.data.raw_url;
      } else {
        throw new Error("未能从服务器获取到播放直链");
      }

      if (!containerRef.current) return;

      const player = new Artplayer({
        container: containerRef.current,
        url: rawUrl,
        volume: 1.0,
        autoplay: true,
        autoSize: true,
        loop: false,
        flip: true,
        playbackRate: true,
        aspectRatio: true,
        setting: true,
        hotkey: true,
        pip: true,
        mutex: true,
        fullscreen: true,
        fullscreenWeb: true,
        playsInline: true,
        theme: "#23ade5", // Accent Primary color from app theme
        type: rawUrl.includes(".m3u8") ? "m3u8" : "auto",
        customType: {
          m3u8: function (video: HTMLMediaElement, url: string) {
            if (Hls.isSupported()) {
              const hls = new Hls();
              hls.loadSource(url);
              hls.attachMedia(video);
              
              player.on("destroy", () => {
                hls.destroy();
              });
            } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
              video.src = url;
            }
          },
        },
      });

      playerRef.current = player;

      player.on("ready", () => {
        if (active.current) {
          setLoading(false);
        }
      });

      player.on("fullscreenWeb", (state: boolean) => {
        setIsTheaterMode(state);
      });

      player.on("video:timeupdate", () => {
        const currentTime = player.currentTime;
        setCurrentTime(currentTime);
        if (onProgress) onProgress(currentTime);

        if (Math.abs(currentTime - lastReportedTime.current) >= 10) {
          lastReportedTime.current = currentTime;
          reportProgress(currentTime);
        }
      });

      player.on("video:durationchange", () => {
        const duration = player.duration;
        setDuration(duration);
        if (onDuration) onDuration(duration);
      });

      player.on("play", () => resumeMedia());
      player.on("pause", () => pauseMedia());
      player.on("video:ended", () => {
        pauseMedia();
        reportProgress(0);
      });
      player.on("error", (err: any) => {
         console.error("Artplayer error:", err);
         if (active.current) setError("视频流载入失败，请检查跨域限制或防盗链设置。");
      });

    } catch (err: any) {
      if (!active.current) return;
      setError(err.message || "获取播放链接失败，请检查 /fs/get 接口是否正常。");
      setLoading(false);
    }
  };

  useEffect(() => {
    const active = { current: true };
    fetchAndInitPlayer(active);

    return () => {
      active.current = false;
      if (playerRef.current) {
        const time = playerRef.current.currentTime;
        if (time > 0) {
          reportProgress(time);
        }
        playerRef.current.destroy(false);
        playerRef.current = null;
      }
    };
  }, [mediaId]);

  // Handle seek commands from Store
  useEffect(() => {
    if (seekTime !== null && playerRef.current) {
      playerRef.current.currentTime = seekTime;
      resetSeek();
    }
  }, [seekTime, resetSeek]);

  return (
    <div className={cn(
      "relative overflow-hidden bg-black select-none transition-all duration-300",
      isTheaterMode 
        ? "fixed inset-0 z-50 flex flex-col justify-center items-center" 
        : "w-full aspect-video rounded-xl border border-app-border"
    )}>
      {isTheaterMode && (
        <button
          onClick={() => {
            if (playerRef.current) {
              playerRef.current.fullscreenWeb = false;
            }
          }}
          className="absolute top-5 right-5 z-20 bg-black/60 hover:bg-black/80 text-white/80 hover:text-white px-3.5 py-2 rounded-xl border border-white/10 text-xs font-bold flex items-center gap-2 transition-all backdrop-blur shadow-lg active:scale-95"
        >
          <X size={14} />
          退出影院模式
        </button>
      )}

      {loading && !error && (
        <div className="absolute inset-0 z-10 bg-black/95 flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
          <span className="text-sm text-tx-secondary">解析网盘直链与视频流...</span>
        </div>
      )}
      
      {error && (
        <div className="absolute inset-0 z-10 bg-black/95 flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-accent-warning mb-3 animate-pulse" />
          <h4 className="text-md font-bold text-tx-primary mb-1">播放器出错</h4>
          <p className="text-xs text-tx-tertiary max-w-md mb-4">{error}</p>
          <button 
            onClick={() => {
              if (playerRef.current) {
                playerRef.current.destroy(false);
                playerRef.current = null;
              }
              fetchAndInitPlayer({ current: true });
            }}
            className="px-3 py-1.5 bg-accent-primary/20 text-accent-primary text-xs font-semibold rounded-lg hover:bg-accent-primary/30 transition-colors cursor-pointer"
          >
            重试连接
          </button>
        </div>
      )}
      
      <div 
        ref={containerRef} 
        className="w-full h-full"
        style={{ opacity: loading || error ? 0 : 1, transition: "opacity 0.3s" }}
      />
    </div>
  );
}
