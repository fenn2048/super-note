import React, { useEffect, useRef, useState } from "react";
import type ArtplayerType from "artplayer";
import { useMediaStore } from "@/store/mediaStore";
import { api } from "@/lib/api";
import { Loader2, AlertTriangle, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface MediaPlayerProps {
  mediaId: string;
  onDuration?: (duration: number) => void;
  onProgress?: (progress: number) => void;
  /** 全屏左上角返回：退出全屏并回到媒体列表 */
  onExitFullscreen?: () => void;
}

async function lockLandscape() {
  // 1) Capacitor 原生插件（即使系统关闭自动旋转也可锁横屏）
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.lock({ orientation: "landscape" });
    return;
  } catch {
    /* 插件未安装或非原生：继续 fallback */
  }
  // 2) 标准 Screen Orientation API（需全屏上下文）
  try {
    const orient = (screen as any).orientation;
    if (orient?.lock) {
      await orient.lock("landscape");
    }
  } catch {
    /* 部分浏览器仅允许全屏上下文，失败则忽略 */
  }
}

async function unlockOrientation() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.unlock();
    return;
  } catch {
    /* ignore */
  }
  try {
    const orient = (screen as any).orientation;
    if (orient?.unlock) {
      orient.unlock();
    }
  } catch {
    /* ignore */
  }
}

export default function MediaPlayer({ mediaId, onDuration, onProgress, onExitFullscreen }: MediaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ArtplayerType | null>(null);
  const isFullscreenRef = useRef(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTheaterMode, setIsTheaterMode] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

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

  /** 退出全屏：暂停视频，留在详情页（不再退回媒体列表） */
  const exitFullscreenAndPause = () => {
    const player = playerRef.current;
    try {
      if (player) {
        player.pause();
        if (player.fullscreen) player.fullscreen = false;
      }
    } catch { /* ignore */ }
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
    } catch { /* ignore */ }
    void unlockOrientation();
    setIsFullscreen(false);
    isFullscreenRef.current = false;
    // 可选回调：仅通知 UI 层更新，不应卸载详情
    onExitFullscreen?.();
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
      let initialProgress = 0;
      if (res && res.url) {
        rawUrl = res.url;
        initialProgress = res.progress || 0;
      } else if (res && res.data && res.data.raw_url) {
        rawUrl = res.data.raw_url;
      } else {
        throw new Error("未能从服务器获取到播放直链");
      }

      if (!containerRef.current) return;

      // 动态加载播放器内核，避免进主包
      const [{ default: Artplayer }, hlsMod] = await Promise.all([
        import("artplayer"),
        import("hls.js"),
      ]);
      const Hls = hlsMod.default;

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
        fullscreen: true,
        fullscreenWeb: true,
        playsInline: true,
        theme: "#23ade5",
        type: rawUrl.includes(".m3u8") ? "m3u8" : "auto",
        controls: [
          {
            name: "lightsOut",
            position: "right",
            html: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
            tooltip: "关灯模式",
            click: function () {
              setIsTheaterMode((prev) => !prev);
            },
          },
        ],
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

      const applyFullscreenUi = (fs: boolean) => {
        isFullscreenRef.current = fs;
        setIsFullscreen(fs);
        // 全屏时隐藏关灯按钮
        try {
          const btn = player.controls?.lightsOut as HTMLElement | undefined;
          if (btn) {
            btn.style.display = fs ? "none" : "";
          }
        } catch { /* ignore */ }
        // 全屏时显示左上角返回
        try {
          const layer = (player as any).layers?.fsBack as HTMLElement | undefined;
          const backBtn = layer?.querySelector?.("button") as HTMLButtonElement | null;
          if (backBtn) {
            backBtn.style.display = fs ? "inline-flex" : "none";
          }
        } catch { /* ignore */ }
        if (fs) {
          void lockLandscape();
        } else {
          void unlockOrientation();
        }
      };

      player.on("ready", () => {
        if (active.current) {
          setLoading(false);
          if (initialProgress > 0) {
            player.currentTime = initialProgress;
          }
        }
      });

      // 全屏返回按钮（挂在播放器 layer 内，保证 true fullscreen 可见）
      try {
        const backHtml =
          '<button type="button" aria-label="返回" style="display:none;width:40px;height:40px;border-radius:9999px;background:rgba(0,0,0,.55);color:#fff;border:1px solid rgba(255,255,255,.15);align-items:center;justify-content:center;cursor:pointer">' +
          '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>' +
          "</button>";
        (player as any).layers?.add?.({
          name: "fsBack",
          html: backHtml,
          style: {
            position: "absolute",
            top: "max(12px, env(safe-area-inset-top))",
            left: "12px",
            zIndex: "100",
            pointerEvents: "auto",
          },
          mounted: (el: HTMLElement) => {
            const btn = el.querySelector("button") as HTMLButtonElement | null;
            if (!btn) return;
            btn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              exitFullscreenAndPause();
            });
          },
        });
      } catch (err) {
        console.warn("Failed to add fullscreen back layer:", err);
      }

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
        if (duration && duration > 0) {
          api.request(`/media/items/${mediaId}/metadata`, {
            method: "PATCH",
            body: JSON.stringify({ duration: Math.floor(duration) }),
          }).catch(() => {});
        }
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

      player.on("fullscreen", (state: boolean) => {
        applyFullscreenUi(!!state);
      });
      player.on("fullscreenWeb", (state: boolean) => {
        applyFullscreenUi(!!state);
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
      void unlockOrientation();
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

  // Handle theater mode button UI toggle
  useEffect(() => {
    if (playerRef.current && playerRef.current.controls.lightsOut) {
      const btn = playerRef.current.controls.lightsOut;
      btn.setAttribute("data-balloon", isTheaterMode ? "开灯模式" : "关灯模式");
      const svg = btn.querySelector("svg");
      if (svg) {
        svg.style.color = isTheaterMode ? "#ffeb3b" : "currentColor";
      }
    }
  }, [isTheaterMode]);

  return (
    <>
      {isTheaterMode && !isFullscreen && (
        <div 
          className="fixed inset-0 z-40 bg-black/95 transition-opacity" 
          onClick={() => setIsTheaterMode(false)}
        />
      )}
      <div className={cn(
        "relative overflow-hidden bg-black select-none transition-all duration-300 w-full aspect-video md:rounded-xl md:border md:border-app-border",
        isTheaterMode && !isFullscreen ? "z-50 ring-2 ring-white/10 shadow-2xl" : "z-10"
      )}>

      {/* 全屏时左上角返回 → 退出全屏并暂停，留在视频详情 */}
      {isFullscreen && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            exitFullscreenAndPause();
          }}
          className="fixed top-[max(12px,env(safe-area-inset-top))] left-3 z-[10000] w-10 h-10 rounded-full bg-black/55 text-white flex items-center justify-center backdrop-blur border border-white/15 active:scale-95"
          title="退出全屏"
          aria-label="退出全屏"
        >
          <ChevronLeft size={22} />
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
    </>
  );
}
