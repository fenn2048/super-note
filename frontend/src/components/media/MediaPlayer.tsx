import React, { useCallback, useEffect, useRef, useState } from "react";
import type ArtplayerType from "artplayer";
import {
  useMediaStore,
  isGlobalPlayerItem,
  cacheMediaPlayUrl,
  type MediaPlayItem,
} from "@/store/mediaStore";
import { api } from "@/lib/api";
import { Loader2, AlertTriangle, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  stopNativeMediaSession,
  updateNativeMediaSession,
} from "@/lib/nativeMedia";
import { isNativePlatform } from "@/hooks/useCapacitor";

export interface MediaPlayerMediaMeta {
  title: string;
  type: "video" | "audio";
  alist_path?: string;
  cover_url?: string;
  duration?: number;
  artist?: string;
  album?: string;
}

interface MediaPlayerProps {
  mediaId: string;
  /** 用于耳机模式交给全局播放器的元数据 */
  media?: MediaPlayerMediaMeta;
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

/** 耳机图标 SVG（与其它控件视觉一致：细线） */
const HEADPHONE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>';

const LIGHTS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.9 1.2 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';

export default function MediaPlayer({
  mediaId,
  media,
  onDuration,
  onProgress,
  onExitFullscreen,
}: MediaPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ArtplayerType | null>(null);
  const isFullscreenRef = useRef(false);
  /** 已交给全局仅听：忽略本播放器 pause→store，避免误停全局 */
  const audioOnlyHandoffRef = useRef(false);
  const mediaMetaRef = useRef(media);
  mediaMetaRef.current = media;
  /** 本片预取到的直链（与 store cache 双写） */
  const playUrlRef = useRef<string>("");

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
    stopMedia,
    currentMedia,
    isPlaying: storeIsPlaying,
    backgroundAudioArmed,
    armBackgroundAudio,
    disarmBackgroundAudio,
    currentTime: storeCurrentTime,
  } = useMediaStore();

  const lastReportedTime = useRef<number>(0);
  const isArmedForThis =
    !!backgroundAudioArmed && backgroundAudioArmed.id === mediaId;
  const isAudioOnlyActive =
    !!currentMedia &&
    currentMedia.id === mediaId &&
    !!currentMedia.audioOnly &&
    isGlobalPlayerItem(currentMedia);

  const reportProgress = async (progressSeconds: number) => {
    try {
      await api.request(`/media/items/${mediaId}/play`, {
        method: "POST",
        body: JSON.stringify({ progress: Math.floor(progressSeconds) }),
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
    } catch {
      /* ignore */
    }
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      }
    } catch {
      /* ignore */
    }
    void unlockOrientation();
    setIsFullscreen(false);
    isFullscreenRef.current = false;
    onExitFullscreen?.();
  };

  const buildMediaItem = useCallback(
    (audioOnly: boolean): MediaPlayItem => {
      const player = playerRef.current;
      const meta = mediaMetaRef.current;
      const dur =
        (player?.duration && !Number.isNaN(player.duration) ? player.duration : 0) ||
        meta?.duration ||
        0;
      return {
        id: mediaId,
        title: meta?.title || "视频",
        type: "video",
        alist_path: meta?.alist_path || "",
        cover_url: meta?.cover_url,
        duration: dur > 0 ? Math.floor(dur) : meta?.duration,
        artist: meta?.artist,
        album: meta?.album,
        ...(audioOnly ? { audioOnly: true as const } : {}),
      };
    },
    [mediaId],
  );

  /** 维持 Android FGS：武装后即拉起，退后台时 WebView 不会被 Capacitor onPause 挂死 */
  const ensureNativeSessionAlive = useCallback(
    (playing: boolean) => {
      const meta = mediaMetaRef.current;
      const player = playerRef.current;
      const pos = player?.currentTime ?? storeCurrentTime ?? 0;
      const dur =
        (player?.duration && !Number.isNaN(player.duration) ? player.duration : 0) ||
        meta?.duration ||
        0;
      void updateNativeMediaSession({
        title: meta?.title || "视频",
        artist: "后台仅听已开启",
        isPlaying: playing,
        position: pos > 0 ? pos : undefined,
        duration: dur > 0 ? dur : undefined,
      });
    },
    [storeCurrentTime],
  );

  /** 回前台：仅听 → 视频画面（仍保持武装，下次退后台再转音频） */
  const reverseHandoffToVideo = useCallback(() => {
    const st = useMediaStore.getState();
    if (!(st.currentMedia?.id === mediaId && st.currentMedia.audioOnly)) {
      return;
    }
    const t = st.currentTime > 0 ? st.currentTime : 0;
    const wasPlaying = st.isPlaying;
    const armed =
      st.backgroundAudioArmed?.id === mediaId
        ? st.backgroundAudioArmed
        : buildMediaItem(false);

    // 停掉全局仅听，但保留 armed，避免中间态把 FGS 拆掉
    useMediaStore.setState({
      isPlaying: false,
      currentMedia: null,
      currentTime: t,
      duration: armed.duration || 0,
      playlist: [],
      currentIndex: -1,
      seekTime: null,
      backgroundAudioArmed: armed,
    });

    audioOnlyHandoffRef.current = false;
    const player = playerRef.current;
    if (player) {
      try {
        player.muted = false;
        if ((player as any).video) (player as any).video.muted = false;
      } catch {
        /* ignore */
      }
      try {
        if (t > 0.25) player.currentTime = t;
      } catch {
        /* ignore */
      }
      if (wasPlaying) {
        try {
          void player.play();
        } catch {
          /* ignore */
        }
        resumeMedia();
      }
    }
    // 前台视频播放时仍维持 FGS，保证再次退后台 keep-alive
    ensureNativeSessionAlive(wasPlaying);
  }, [mediaId, buildMediaItem, resumeMedia, ensureNativeSessionAlive]);

  /** 耳机按钮：仅武装/解除；前台不立刻切仅听 */
  const toggleBackgroundAudioArm = useCallback(() => {
    const st = useMediaStore.getState();
    if (st.backgroundAudioArmed?.id === mediaId) {
      // 解除
      if (st.currentMedia?.id === mediaId && st.currentMedia.audioOnly) {
        reverseHandoffToVideo();
      }
      disarmBackgroundAudio(mediaId);
      // 若没有其它全局音频在播，停 FGS
      const after = useMediaStore.getState();
      if (!isGlobalPlayerItem(after.currentMedia)) {
        void stopNativeMediaSession();
      }
      toast.success("已关闭后台仅听");
      return;
    }

    const item = buildMediaItem(false);
    armBackgroundAudio(item);
    // 预取直链 + 拉起 FGS（关键：必须在退后台前完成）
    ensureNativeSessionAlive(true);
    const warmUrl = async () => {
      try {
        if (playUrlRef.current) {
          cacheMediaPlayUrl(mediaId, playUrlRef.current);
          return;
        }
        const res = await api.request<{ url?: string }>(`/media/items/${mediaId}/play-url`);
        if (res?.url) {
          playUrlRef.current = res.url;
          cacheMediaPlayUrl(mediaId, res.url);
        }
      } catch (e) {
        console.warn("preload play-url for background audio failed:", e);
      }
    };
    void warmUrl();
    toast.success("已开启后台仅听：退到后台将继续播放音频");
  }, [
    mediaId,
    buildMediaItem,
    armBackgroundAudio,
    disarmBackgroundAudio,
    reverseHandoffToVideo,
    ensureNativeSessionAlive,
  ]);

  // 全局仍在播本片仅听时：强制视频保持暂停/静音（避免与 <audio> 双开）
  useEffect(() => {
    if (!isAudioOnlyActive) return;
    audioOnlyHandoffRef.current = true;
    const player = playerRef.current;
    if (!player) return;
    try {
      if (player.fullscreen) player.fullscreen = false;
    } catch {
      /* ignore */
    }
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
    } catch {
      /* ignore */
    }
    void unlockOrientation();
    setIsFullscreen(false);
    isFullscreenRef.current = false;
    try {
      player.pause();
    } catch {
      /* ignore */
    }
    try {
      player.muted = true;
      if ((player as any).video) (player as any).video.muted = true;
    } catch {
      /* ignore */
    }
  }, [storeIsPlaying, isAudioOnlyActive]);

  // 回前台且本片仍在仅听：还原视频画面（退后台 handoff 由 GlobalMusicPlayer 全局处理）
  useEffect(() => {
    if (!isArmedForThis) return;

    const onForeground = () => {
      reverseHandoffToVideo();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") onForeground();
    };

    document.addEventListener("visibilitychange", onVisibility);

    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        const p = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onForeground();
        });
        void p.then((h) => {
          removeApp = () => void h.remove();
        });
      });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      removeApp?.();
    };
  }, [isArmedForThis, reverseHandoffToVideo]);

  // 武装期间周期性刷新 FGS 进度，并保持服务存活
  useEffect(() => {
    if (!isArmedForThis || isAudioOnlyActive) return;
    ensureNativeSessionAlive(true);
    const id = window.setInterval(() => {
      const p = playerRef.current;
      const videoEl = p ? ((p as any).video as HTMLVideoElement | undefined) : undefined;
      const playing = videoEl ? !videoEl.paused : true;
      ensureNativeSessionAlive(playing);
    }, 5000);
    return () => window.clearInterval(id);
  }, [isArmedForThis, isAudioOnlyActive, ensureNativeSessionAlive]);

  const fetchAndInitPlayer = async (active: { current: boolean }) => {
    try {
      setLoading(true);
      setError("");

      const res = await api.request<any>(`/media/items/${mediaId}/play-url`, {
        method: "GET",
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

      playUrlRef.current = rawUrl;
      cacheMediaPlayUrl(mediaId, rawUrl);

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
        // 关闭画中画：与全屏按钮视觉重复，且 Android WebView 上 PiP 体验差
        pip: false,
        fullscreen: true,
        // 关闭网页全屏：与原生 fullscreen 图标几乎一样，造成「按钮重复」
        fullscreenWeb: false,
        playsInline: true,
        theme: "#23ade5",
        type: rawUrl.includes(".m3u8") ? "m3u8" : "auto",
        controls: [
          {
            name: "audioOnly",
            position: "right",
            html: HEADPHONE_SVG,
            tooltip: "后台仅听（退后台继续播）",
            click: function () {
              toggleBackgroundAudioArm();
            },
          },
          {
            name: "lightsOut",
            position: "right",
            html: LIGHTS_SVG,
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
        // 全屏时隐藏关灯 / 耳机按钮（仍可通过迷你条控制仅听）
        try {
          for (const name of ["lightsOut", "audioOnly"] as const) {
            const btn = player.controls?.[name] as HTMLElement | undefined;
            if (btn) btn.style.display = fs ? "none" : "";
          }
        } catch {
          /* ignore */
        }
        // 全屏时显示左上角返回
        try {
          const layer = (player as any).layers?.fsBack as HTMLElement | undefined;
          const backBtn = layer?.querySelector?.("button") as HTMLButtonElement | null;
          if (backBtn) {
            backBtn.style.display = fs ? "inline-flex" : "none";
          }
        } catch {
          /* ignore */
        }
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
        // 仅听交给全局后，不再用视频进度刷 store
        if (audioOnlyHandoffRef.current) return;
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
          api
            .request(`/media/items/${mediaId}/metadata`, {
              method: "PATCH",
              body: JSON.stringify({ duration: Math.floor(duration) }),
            })
            .catch(() => {});
        }
      });

      player.on("play", () => {
        // 用户主动点视频播放：若正处于本片仅听，还原画面声道
        if (audioOnlyHandoffRef.current) {
          const st = useMediaStore.getState();
          if (st.currentMedia?.id === mediaId && st.currentMedia.audioOnly) {
            reverseHandoffToVideo();
            return;
          }
          audioOnlyHandoffRef.current = false;
          try {
            player.muted = false;
            if ((player as any).video) (player as any).video.muted = false;
          } catch {
            /* ignore */
          }
          return;
        }
        // 避免与全局音乐双开：先停掉全局其它条目
        const st = useMediaStore.getState();
        if (st.currentMedia && isGlobalPlayerItem(st.currentMedia) && st.isPlaying) {
          if (st.currentMedia.id !== mediaId || st.currentMedia.audioOnly) {
            stopMedia();
          }
        }
        resumeMedia();
      });
      player.on("pause", () => {
        // 耳机交接导致的 pause 不写 store
        if (audioOnlyHandoffRef.current) return;
        pauseMedia();
      });
      player.on("video:ended", () => {
        if (audioOnlyHandoffRef.current) return;
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
      // 离开详情页：写入进度供退后台 handoff 使用；前台不立刻转仅听
      const st = useMediaStore.getState();
      if (playerRef.current) {
        const time = playerRef.current.currentTime;
        if (time > 0) {
          if (st.backgroundAudioArmed?.id === mediaId) {
            st.setCurrentTime(time);
          }
          if (!audioOnlyHandoffRef.current) {
            reportProgress(time);
          }
        }
        playerRef.current.destroy(false);
        playerRef.current = null;
      }
    };
    // mediaId 变化时重建；handoff 用 ref，不必进 deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId]);

  // Handle seek commands from Store（仅听时由全局 <audio> 处理，视频忽略）
  useEffect(() => {
    if (seekTime !== null && playerRef.current && !audioOnlyHandoffRef.current) {
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

  // 耳机武装 / 仅听中高亮耳机按钮
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.controls?.audioOnly) return;
    const btn = player.controls.audioOnly as HTMLElement;
    const active = isArmedForThis || isAudioOnlyActive;
    try {
      btn.style.color = active ? "#23ade5" : "";
      btn.setAttribute(
        "data-balloon",
        isAudioOnlyActive
          ? "后台仅听中（回前台自动恢复视频）"
          : isArmedForThis
            ? "已开启后台仅听（再点关闭）"
            : "后台仅听（退后台继续播）",
      );
    } catch {
      /* ignore */
    }
  }, [isArmedForThis, isAudioOnlyActive]);

  return (
    <>
      {isTheaterMode && !isFullscreen && (
        <div
          className="fixed inset-0 z-40 bg-black/95 transition-opacity"
          onClick={() => setIsTheaterMode(false)}
        />
      )}
      <div
        className={cn(
          "relative overflow-hidden bg-black select-none transition-all duration-300 w-full aspect-video md:rounded-xl md:border md:border-app-border",
          isTheaterMode && !isFullscreen ? "z-50 ring-2 ring-white/10 shadow-2xl" : "z-10",
        )}
      >
        {/* 全屏时左上角返回 → 退出全屏并暂停，留在视频详情 */}
        {isFullscreen && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              exitFullscreenAndPause();
            }}
            onPointerUp={(e) => {
              e.preventDefault();
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
