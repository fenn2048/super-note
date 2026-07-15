import React, { useEffect, useRef, useState } from "react";
import ReactPlayer from "react-player";
import { useMediaStore } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { 
  Loader2, Play, Pause, AlertTriangle, Volume2, VolumeX, 
  Maximize, Minimize, Tv, X 
} from "lucide-react";
import { cn } from "@/lib/utils";

const PlayerComponent = ReactPlayer as any;

interface MediaPlayerProps {
  mediaId: string;
  onDuration?: (duration: number) => void;
  onProgress?: (progress: number) => void;
}

export default function MediaPlayer({ mediaId, onDuration, onProgress }: MediaPlayerProps) {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // States
  const [playUrl, setPlayUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isPlayerReady, setIsPlayerReady] = useState<boolean>(false);

  // Video controller states
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [quality, setQuality] = useState<string>("Original");
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [toast, setToast] = useState<string>("");
  const [showControls, setShowControls] = useState<boolean>(true);
  const [speedMenuOpen, setSpeedMenuOpen] = useState<boolean>(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState<boolean>(false);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { 
    isPlaying, 
    volume, 
    isMuted, 
    seekTime, 
    currentTime,
    duration,
    setCurrentTime, 
    setDuration, 
    resetSeek,
    pauseMedia,
    resumeMedia,
    setVolume,
    setMuted
  } = useMediaStore();

  // 1. Fetch play URL when mediaId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setPlayUrl("");
    setIsPlayerReady(false);

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

  // 2. Handle seek commands from Store
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

    if (playerRef.current) {
      const dur = playerRef.current.getDuration();
      if (dur && dur !== duration) {
        handleDuration(dur);
      }
    }

    if (Math.abs(state.playedSeconds - lastReportedTime.current) >= 10) {
      lastReportedTime.current = state.playedSeconds;
      reportProgress(state.playedSeconds);
    }
  };

  const handleDuration = (dur: number) => {
    setDuration(dur);
    if (onDuration) onDuration(dur);
  };

  const handleReady = () => {
    setIsPlayerReady(true);
    if (playerRef.current) {
      const dur = playerRef.current.getDuration();
      if (dur) {
        handleDuration(dur);
      }
    }
  };

  const handleEnded = () => {
    pauseMedia();
    reportProgress(0);
  };

  // Report final progress on unmount
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        const time = playerRef.current.getCurrentTime();
        if (time > 0) {
          reportProgress(time);
        }
      }
    };
  }, [mediaId]);

  // Escape key listener to exit Theater Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTheaterMode) {
        setIsTheaterMode(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTheaterMode]);

  // Fullscreen listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Controls auto-hide timer
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setSpeedMenuOpen(false);
        setQualityMenuOpen(false);
      }
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, []);

  // Toast notification system
  const showToastMsg = (msg: string) => {
    setToast(msg);
  };

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
      }).catch(err => {
        console.warn("Fullscreen request failed:", err);
      });
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
      }).catch(err => {
        console.warn("Exit fullscreen failed:", err);
      });
    }
  };

  const handleVolumeSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (vol > 0 && isMuted) {
      setMuted(false);
    }
  };

  const formatDuration = (sec: number) => {
    if (isNaN(sec) || !sec) return "00:00";
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="w-full aspect-video bg-black/95 flex flex-col items-center justify-center rounded-xl border border-app-border select-none">
        <Loader2 className="w-8 h-8 text-accent-primary animate-spin mb-2" />
        <span className="text-sm text-tx-secondary">解析网盘直链中...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full aspect-video bg-black/95 flex flex-col items-center justify-center p-6 rounded-xl border border-app-border text-center select-none">
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
    <div 
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
      className={cn(
        "bg-black overflow-hidden shadow-2xl relative group transition-all duration-300 select-none",
        isTheaterMode 
          ? "fixed inset-0 z-50 flex flex-col justify-center items-center" 
          : "w-full aspect-video rounded-xl border border-app-border"
      )}
    >
      {/* 1. Main ReactPlayer Element */}
      <div 
        onClick={() => isPlaying ? pauseMedia() : resumeMedia()}
        onDoubleClick={toggleFullscreen}
        className="w-full h-full cursor-pointer relative z-0"
      >
        <PlayerComponent
          ref={playerRef}
          url={playUrl}
          playing={isPlayerReady && isPlaying}
          playbackRate={playbackSpeed}
          volume={volume}
          muted={isMuted}
          width="100%"
          height="100%"
          style={{ position: "absolute", top: 0, left: 0 }}
          onProgress={handleProgress}
          onReady={handleReady}
          onEnded={handleEnded}
          onPlay={resumeMedia}
          onPause={pauseMedia}
          onError={(err: any) => {
            console.error("ReactPlayer error:", err);
            setError("视频流载入失败。这通常是因为网盘（如夸克/阿里）设置了防盗链或跨域(CORS)阻挡。请确保 AList 中开启了「Web代理」中转选项。");
          }}
          config={{
            file: {
              attributes: {
                referrerPolicy: "no-referrer",
                controlsList: "nodownload",
                disablePictureInPicture: true
              }
            }
          }}
        />
      </div>

      {/* 2. Toast Notifications */}
      {toast && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur text-white text-xs font-semibold px-4 py-2.5 rounded-xl z-30 shadow-2xl border border-white/10 animate-fade-in pointer-events-none">
          {toast}
        </div>
      )}

      {/* 3. Theater Mode Top Exit Bar */}
      {isTheaterMode && !isFullscreen && (
        <button
          onClick={() => setIsTheaterMode(false)}
          className={cn(
            "absolute top-5 right-5 z-20 bg-black/60 hover:bg-black/80 text-white/80 hover:text-white px-3.5 py-2 rounded-xl border border-white/10 text-xs font-bold flex items-center gap-2 transition-all backdrop-blur shadow-lg active:scale-95",
            !showControls && "opacity-0 pointer-events-none"
          )}
        >
          <X size={14} />
          退出影院模式
        </button>
      )}

      {/* 4. Sleek Custom Controls Overlay */}
      <div 
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "absolute bottom-0 left-0 right-0 p-4 pt-10 bg-gradient-to-t from-black/90 via-black/40 to-transparent text-white flex flex-col gap-3 z-10 transition-opacity duration-300",
          !showControls && "opacity-0 pointer-events-none"
        )}
      >
        {/* Playback Progress Seek Slider */}
        <div className="w-full flex items-center gap-3 text-[10px] text-zinc-300 font-semibold">
          <span>{formatDuration(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              playerRef.current?.seekTo(val, "seconds");
              setCurrentTime(val);
            }}
            className="flex-1 h-1.5 bg-white/20 hover:bg-white/30 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none transition-colors"
          />
          <span>{formatDuration(duration)}</span>
        </div>

        {/* Lower Control Bar Actions */}
        <div className="flex items-center justify-between text-zinc-200">
          {/* Left Side: Playback and volume controls */}
          <div className="flex items-center gap-4">
            {/* Play/Pause toggle */}
            <button
              onClick={() => isPlaying ? pauseMedia() : resumeMedia()}
              className="text-white hover:text-accent-primary active:scale-95 transition-all"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <Pause size={18} className="fill-white" /> : <Play size={18} className="fill-white translate-x-0.5" />}
            </button>

            {/* Volume controls */}
            <div className="flex items-center gap-2 select-none">
              <button
                onClick={() => setMuted(!isMuted)}
                className="text-zinc-300 hover:text-white transition-colors"
              >
                {isMuted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeSliderChange}
                className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-accent-primary outline-none"
              />
            </div>
          </div>

          {/* Right Side: Options (Speed, Quality, Theater, Fullscreen) */}
          <div className="flex items-center gap-4 relative">
            {/* Playback Speed selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setSpeedMenuOpen(!speedMenuOpen);
                  setQualityMenuOpen(false);
                }}
                className="text-xs font-bold hover:text-white px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
              >
                {playbackSpeed === 1.0 ? "倍速" : `${playbackSpeed}x`}
              </button>

              {speedMenuOpen && (
                <div className="absolute bottom-8 right-0 bg-zinc-950 border border-white/10 rounded-xl p-1.5 shadow-2xl flex flex-col min-w-[70px] z-20 animate-fade-in text-[11px] font-semibold">
                  {[0.5, 1.0, 1.25, 1.5, 2.0].map(sp => (
                    <button
                      key={sp}
                      onClick={() => {
                        setPlaybackSpeed(sp);
                        setSpeedMenuOpen(false);
                        showToastMsg(`当前播放速度: ${sp}x`);
                      }}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/15",
                        playbackSpeed === sp ? "text-accent-primary" : "text-zinc-300"
                      )}
                    >
                      {sp}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quality selector */}
            <div className="relative">
              <button
                onClick={() => {
                  setQualityMenuOpen(!qualityMenuOpen);
                  setSpeedMenuOpen(false);
                }}
                className="text-xs font-bold hover:text-white px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
              >
                {quality === "Original" ? "画质" : quality}
              </button>

              {qualityMenuOpen && (
                <div className="absolute bottom-8 right-0 bg-zinc-950 border border-white/10 rounded-xl p-1.5 shadow-2xl flex flex-col min-w-[85px] z-20 animate-fade-in text-[11px] font-semibold">
                  {[
                    { key: "Original", label: "原画" },
                    { key: "1080P", label: "1080P" },
                    { key: "720P", label: "720P" },
                    { key: "480P", label: "480P" }
                  ].map(q => (
                    <button
                      key={q.key}
                      onClick={() => {
                        setQuality(q.key);
                        setQualityMenuOpen(false);
                        if (q.key === "Original") {
                          showToastMsg("已切换至 原画画质");
                        } else {
                          showToastMsg(`已切换至 ${q.key} (转码由 Alist 代理接管)`);
                        }
                      }}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-lg transition-colors hover:bg-white/15",
                        quality === q.key ? "text-accent-primary" : "text-zinc-300"
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theater Mode toggle */}
            <button
              onClick={() => {
                setIsTheaterMode(!isTheaterMode);
                showToastMsg(!isTheaterMode ? "开启影院模式" : "退出影院模式");
              }}
              className={cn(
                "hover:text-white transition-colors",
                isTheaterMode ? "text-accent-primary" : "text-zinc-300"
              )}
              title={isTheaterMode ? "常规模式" : "影院模式"}
            >
              <Tv size={16} />
            </button>

            {/* Fullscreen toggle */}
            <button
              onClick={toggleFullscreen}
              className="text-zinc-300 hover:text-white transition-colors"
              title={isFullscreen ? "退出全屏" : "全屏"}
            >
              {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
