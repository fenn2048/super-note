import React, { useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import { useMediaStore } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { Loader2, Play, Pause, AlertTriangle } from "lucide-react";

interface MediaPlayerProps {
  mediaId: string;
  onDuration?: (duration: number) => void;
  onProgress?: (progress: number) => void;
}

export default function MediaPlayer({ mediaId, onDuration, onProgress }: MediaPlayerProps) {
  const playerRef = useRef<ReactPlayer>(null);
  const [playUrl, setPlayUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  
  const { 
    isPlaying, 
    volume, 
    isMuted, 
    seekTime, 
    setCurrentTime, 
    setDuration, 
    resetSeek,
    pauseMedia,
    resumeMedia
  } = useMediaStore();

  // 1. Fetch play URL when mediaId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPlayUrl("");

    async function fetchPlayUrl() {
      try {
        // Fetch raw direct url from backend (which handles Redis caching and Alist resolution)
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

  // 2. Handle seek commands from Store (e.g. when user clicks on a TipTap timestamp)
  useEffect(() => {
    if (seekTime !== null && playerRef.current) {
      playerRef.current.seekTo(seekTime, "seconds");
      resetSeek();
    }
  }, [seekTime, resetSeek]);

  // 3. Keep backend updated on play progress (throttled every 10s)
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

  const handleProgress = (state: { playedSeconds: number }) => {
    setCurrentTime(state.playedSeconds);
    if (onProgress) onProgress(state.playedSeconds);

    // Report to server every 10 seconds of playback
    if (Math.abs(state.playedSeconds - lastReportedTime.current) >= 10) {
      lastReportedTime.current = state.playedSeconds;
      reportProgress(state.playedSeconds);
    }
  };

  const handleDuration = (dur: number) => {
    setDuration(dur);
    if (onDuration) onDuration(dur);
  };

  const handleEnded = () => {
    pauseMedia();
    reportProgress(0); // reset progress on end
  };

  // Report final progress when component unmounts or media changes
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        const currentTime = playerRef.current.getCurrentTime();
        if (currentTime > 0) {
          reportProgress(currentTime);
        }
      }
    };
  }, [mediaId]);

  if (loading) {
    return (
      <div className="w-full aspect-video bg-black/90 flex flex-col items-center justify-center rounded-xl border border-app-border">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
        <span className="text-sm text-tx-secondary">解析网盘直链中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full aspect-video bg-black/90 flex flex-col items-center justify-center p-6 rounded-xl border border-app-border text-center">
        <AlertTriangle className="w-12 h-12 text-accent-warning mb-3 animate-pulse" />
        <h4 className="text-md font-bold text-tx-primary mb-1">播放器出错</h4>
        <p className="text-xs text-tx-tertiary max-w-md mb-4">{error}</p>
        <button 
          onClick={() => { setError(""); setLoading(true); }}
          className="px-3 py-1.5 bg-accent-primary/20 text-accent-primary text-xs font-semibold rounded-lg hover:bg-accent-primary/30 transition-colors"
        >
          重试连接
        </button>
      </div>
    );
  }

  return (
    <div className="w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl relative group border border-app-border">
      <ReactPlayer
        ref={playerRef}
        url={playUrl}
        playing={isPlaying}
        controls={true}
        volume={volume}
        muted={isMuted}
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0 }}
        onProgress={handleProgress}
        onDuration={handleDuration}
        onEnded={handleEnded}
        onPlay={resumeMedia}
        onPause={pauseMedia}
        onError={(err) => {
          console.error("ReactPlayer error:", err);
          setError("视频流载入失败。这通常是因为网盘（如夸克/阿里）设置了防盗链或跨域(CORS)阻挡。请前往 AList 后台管理 -> 存储 -> 编辑对应网盘 -> 开启「Web代理」或「本地代理」中转选项，然后重试。");
        }}
        config={{
          file: {
            attributes: {
              controlsList: "nodownload",
              disablePictureInPicture: true,
            }
          }
        }}
      />
    </div>
  );
}
