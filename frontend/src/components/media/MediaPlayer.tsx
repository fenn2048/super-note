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
  subscribeNativeMediaActions,
  subscribeNativeMediaSeek,
  updateNativeMediaPosition,
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
  /** 用于后台仅听元数据（通知栏标题等） */
  media?: MediaPlayerMediaMeta;
  onDuration?: (duration: number) => void;
  onProgress?: (progress: number) => void;
  /** 全屏左上角返回：退出全屏并回到媒体列表 */
  onExitFullscreen?: () => void;
}

async function lockLandscape() {
  try {
    const { ScreenOrientation } = await import("@capacitor/screen-orientation");
    await ScreenOrientation.lock({ orientation: "landscape" });
    return;
  } catch {
    /* 插件未安装或非原生：继续 fallback */
  }
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

/**
 * 视频后台仅听策略（Android）：
 * - 耳机按钮只切换「允许后台继续播」开关，前台不暂停、不交给全局播放器。
 * - 退后台后继续用同一个 <video> 解码（不切换到 <audio>），靠 FGS 保活 WebView。
 * - 进度条走原生 MediaSession，由视频 timeupdate 推送 position/duration。
 */
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
  const mediaMetaRef = useRef(media);
  mediaMetaRef.current = media;
  const playUrlRef = useRef<string>("");
  /** 节流推送锁屏进度 */
  const lastNativePosPush = useRef(0);
  const armedRef = useRef(false);
  /**
   * 用户意图是否在播：前台点暂停 / 锁屏暂停 → false；
   * 退后台仅当 true 时才续播，避免「前台已暂停后台还出声」。
   */
  const intentPlayingRef = useRef(true);
  /** 锁屏/通知栏操作中：忽略 video pause 的「系统误停」逻辑 */
  const remoteActionRef = useRef(false);

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
    backgroundAudioArmed,
    armBackgroundAudio,
    disarmBackgroundAudio,
  } = useMediaStore();

  const lastReportedTime = useRef<number>(0);
  const isArmedForThis =
    !!backgroundAudioArmed && backgroundAudioArmed.id === mediaId;
  armedRef.current = isArmedForThis;

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

  const buildArmedMeta = useCallback((): MediaPlayItem => {
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
    };
  }, [mediaId]);

  const getVideoEl = useCallback((): HTMLVideoElement | null => {
    const p = playerRef.current as any;
    return (p?.video as HTMLVideoElement | undefined) || null;
  }, []);

  /** 推送原生 FGS / 锁屏：标题 + 播放态 + 进度（秒） */
  const pushNativeSession = useCallback(
    (opts?: { playing?: boolean; forceMeta?: boolean }) => {
      if (!armedRef.current) return;
      const player = playerRef.current;
      const meta = mediaMetaRef.current;
      const video = getVideoEl();
      const pos = video?.currentTime ?? player?.currentTime ?? 0;
      const durRaw =
        (video?.duration && !Number.isNaN(video.duration) ? video.duration : 0) ||
        (player?.duration && !Number.isNaN(player.duration) ? player.duration : 0) ||
        meta?.duration ||
        0;
      const dur = durRaw > 0 ? durRaw : 0;
      const playing =
        opts?.playing ??
        (video ? !video.paused && !video.ended : true);

      void updateNativeMediaSession({
        title: meta?.title || "视频",
        artist: "后台仅听",
        isPlaying: playing,
        position: Math.max(0, pos),
        duration: dur > 0 ? dur : undefined,
      });
      lastNativePosPush.current = Date.now();
    },
    [getVideoEl],
  );

  /** 高频进度（节流 ~1s） */
  const pushNativePosition = useCallback(
    (force = false) => {
      if (!armedRef.current) return;
      const video = getVideoEl();
      const player = playerRef.current;
      const meta = mediaMetaRef.current;
      const pos = video?.currentTime ?? player?.currentTime ?? 0;
      const durRaw =
        (video?.duration && !Number.isNaN(video.duration) ? video.duration : 0) ||
        (player?.duration && !Number.isNaN(player.duration) ? player.duration : 0) ||
        meta?.duration ||
        0;
      const playing = video ? !video.paused && !video.ended : false;
      const now = Date.now();
      if (!force && now - lastNativePosPush.current < 900) return;
      lastNativePosPush.current = now;
      void updateNativeMediaPosition({
        position: Math.max(0, pos),
        duration: durRaw > 0 ? durRaw : undefined,
        isPlaying: playing,
      });
    },
    [getVideoEl],
  );

  const pauseVideoLocal = useCallback(() => {
    const player = playerRef.current;
    const video = getVideoEl();
    try {
      player?.pause();
    } catch {
      /* ignore */
    }
    try {
      video?.pause();
    } catch {
      /* ignore */
    }
  }, [getVideoEl]);

  const playVideoLocal = useCallback(() => {
    const player = playerRef.current;
    const video = getVideoEl();
    try {
      if (player && typeof (player as any).play === "function") {
        void (player as any).play();
      }
    } catch {
      /* ignore */
    }
    if (video) {
      try {
        video.muted = false;
        void video.play().catch(() => {});
      } catch {
        /* ignore */
      }
    }
  }, [getVideoEl]);

  /**
   * 退后台：仅当用户意图为「播放中」时续播同一 video；
   * 前台已暂停则保持暂停并同步锁屏态。
   */
  const keepVideoAliveInBackground = useCallback(() => {
    if (!armedRef.current) return;
    if (!intentPlayingRef.current) {
      pauseVideoLocal();
      pushNativeSession({ playing: false });
      pushNativePosition(true);
      return;
    }
    pushNativeSession({ playing: true });
    const tryPlay = () => {
      if (!armedRef.current || !intentPlayingRef.current) return;
      playVideoLocal();
      pushNativePosition(true);
    };
    tryPlay();
    window.setTimeout(tryPlay, 120);
    window.setTimeout(tryPlay, 400);
    window.setTimeout(tryPlay, 900);
    window.setTimeout(tryPlay, 1600);
  }, [playVideoLocal, pauseVideoLocal, pushNativeSession, pushNativePosition]);

  /** 耳机按钮：仅切换「本视频允许后台继续播」，前台不暂停、不显示全局播放器 */
  const toggleBackgroundAudioArm = useCallback(() => {
    const st = useMediaStore.getState();
    if (st.backgroundAudioArmed?.id === mediaId) {
      disarmBackgroundAudio(mediaId);
      armedRef.current = false;
      // 没有其它全局音频时停 FGS
      if (!isGlobalPlayerItem(useMediaStore.getState().currentMedia)) {
        void stopNativeMediaSession();
      }
      toast.success("已关闭后台仅听");
      return;
    }

    // 若全局正在播别的音频，先停掉，避免抢焦点；本视频继续播
    if (
      st.currentMedia &&
      isGlobalPlayerItem(st.currentMedia) &&
      st.currentMedia.id !== mediaId
    ) {
      stopMedia();
    }
    // 若误把本片标成 audioOnly（旧逻辑残留），清掉，避免弹出全局迷你条
    if (st.currentMedia?.id === mediaId && st.currentMedia.audioOnly) {
      useMediaStore.setState({
        currentMedia: null,
        isPlaying: false,
        playlist: [],
        currentIndex: -1,
        seekTime: null,
        // 保留/随后写入 armed，勿被清掉
      });
    }

    const item = buildArmedMeta();
    armBackgroundAudio(item);
    armedRef.current = true;

    if (playUrlRef.current) {
      cacheMediaPlayUrl(mediaId, playUrlRef.current);
    }

    // 以当前真实播放态武装：暂停中开启不会在退后台强制起播
    const video = getVideoEl();
    const actuallyPlaying = video ? !video.paused && !video.ended : true;
    intentPlayingRef.current = actuallyPlaying;
    // 立刻拉起 FGS（带真实 duration/position），保证锁屏进度条有总长
    pushNativeSession({ playing: actuallyPlaying, forceMeta: true });
    window.setTimeout(
      () => pushNativeSession({ playing: intentPlayingRef.current, forceMeta: true }),
      300,
    );
    toast.success(
      actuallyPlaying
        ? "已开启后台仅听：退到后台将继续播放"
        : "已开启后台仅听：播放后可在后台继续",
    );
  }, [
    mediaId,
    buildArmedMeta,
    armBackgroundAudio,
    disarmBackgroundAudio,
    stopMedia,
    pushNativeSession,
    getVideoEl,
  ]);

  const toggleArmRef = useRef(toggleBackgroundAudioArm);
  toggleArmRef.current = toggleBackgroundAudioArm;

  // 武装期间：生命周期 + 原生 resume 事件
  useEffect(() => {
    if (!isArmedForThis) return;

    const onBackground = () => {
      keepVideoAliveInBackground();
    };
    const onForeground = () => {
      pushNativeSession({ playing: intentPlayingRef.current });
      pushNativePosition(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onBackground();
      else onForeground();
    };
    const onWebViewResume = () => {
      // 仅续播「意图播放」的视频，不把已暂停的强行打开
      keepVideoAliveInBackground();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("super:webview-media-resume", onWebViewResume);

    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        const p = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) onForeground();
          else onBackground();
        });
        void p.then((h) => {
          removeApp = () => void h.remove();
        });
      });
    }

    pushNativeSession({
      playing: intentPlayingRef.current,
      forceMeta: true,
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("super:webview-media-resume", onWebViewResume);
      removeApp?.();
    };
  }, [
    isArmedForThis,
    keepVideoAliveInBackground,
    pushNativeSession,
    pushNativePosition,
  ]);

  // 武装期间：锁屏 / 通知栏 play·pause·seek 直接控 video
  useEffect(() => {
    if (!isArmedForThis) return;

    const unsubAction = subscribeNativeMediaActions((action) => {
      if (!armedRef.current) return;
      if (action === "pause" || action === "stop") {
        remoteActionRef.current = true;
        intentPlayingRef.current = false;
        pauseVideoLocal();
        pauseMedia();
        pushNativeSession({ playing: false });
        pushNativePosition(true);
        window.setTimeout(() => {
          remoteActionRef.current = false;
        }, 500);
      } else if (action === "play") {
        remoteActionRef.current = true;
        intentPlayingRef.current = true;
        playVideoLocal();
        resumeMedia();
        pushNativeSession({ playing: true });
        pushNativePosition(true);
        window.setTimeout(() => {
          remoteActionRef.current = false;
        }, 500);
      }
    });

    const unsubSeek = subscribeNativeMediaSeek((positionSec) => {
      if (!armedRef.current) return;
      const player = playerRef.current;
      const video = getVideoEl();
      try {
        if (player) player.currentTime = positionSec;
        if (video) video.currentTime = positionSec;
        setCurrentTime(positionSec);
      } catch {
        /* ignore */
      }
      pushNativePosition(true);
    });

    return () => {
      unsubAction();
      unsubSeek();
    };
  }, [
    isArmedForThis,
    pauseVideoLocal,
    playVideoLocal,
    pauseMedia,
    resumeMedia,
    pushNativeSession,
    pushNativePosition,
    getVideoEl,
    setCurrentTime,
  ]);

  // 武装期间定时刷新 FGS（防止进度条停住）
  useEffect(() => {
    if (!isArmedForThis) return;
    const id = window.setInterval(() => {
      pushNativePosition(true);
    }, 2000);
    return () => window.clearInterval(id);
  }, [isArmedForThis, pushNativePosition]);

  // 离开本片 / 卸武装：若无全局音频，停 FGS
  useEffect(() => {
    return () => {
      if (!armedRef.current) return;
      // 组件卸载时解除本片武装（避免详情页销毁后 FGS 空转）
      const st = useMediaStore.getState();
      if (st.backgroundAudioArmed?.id === mediaId) {
        st.disarmBackgroundAudio(mediaId);
      }
      if (!isGlobalPlayerItem(useMediaStore.getState().currentMedia)) {
        void stopNativeMediaSession();
      }
    };
  }, [mediaId]);

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
              toggleArmRef.current();
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
        try {
          for (const name of ["lightsOut", "audioOnly"] as const) {
            const btn = player.controls?.[name] as HTMLElement | undefined;
            if (btn) btn.style.display = fs ? "none" : "";
          }
        } catch {
          /* ignore */
        }
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
          // 就绪后若已武装，补推带真实 duration 的 session
          if (armedRef.current) {
            pushNativeSession({ forceMeta: true });
          }
        }
      });

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

        // 武装时同步锁屏/通知进度条
        if (armedRef.current) {
          pushNativePosition(false);
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
          if (armedRef.current) {
            // duration 就绪后重推 metadata，锁屏进度条才有总长
            pushNativeSession({ forceMeta: true });
          }
        }
      });

      player.on("play", () => {
        // 避免与全局音乐双开：先停掉全局其它条目
        const st = useMediaStore.getState();
        if (st.currentMedia && isGlobalPlayerItem(st.currentMedia) && st.isPlaying) {
          if (st.currentMedia.id !== mediaId || st.currentMedia.audioOnly) {
            stopMedia();
          }
        }
        // 用户/远程意图播放
        if (!remoteActionRef.current) {
          intentPlayingRef.current = true;
        }
        resumeMedia();
        if (armedRef.current) {
          pushNativeSession({ playing: true });
          pushNativePosition(true);
        }
      });
      player.on("pause", () => {
        // 远程已处理
        if (remoteActionRef.current) return;
        // 武装 + 页面隐藏 + 仍意图播放：系统误停，不改意图，稍后 keepAlive 续播
        if (
          armedRef.current &&
          intentPlayingRef.current &&
          document.visibilityState === "hidden"
        ) {
          return;
        }
        // 前台用户暂停：记录意图，退后台不得续播
        intentPlayingRef.current = false;
        pauseMedia();
        if (armedRef.current) {
          pushNativeSession({ playing: false });
          pushNativePosition(true);
        }
      });
      player.on("video:ended", () => {
        intentPlayingRef.current = false;
        pauseMedia();
        reportProgress(0);
        if (armedRef.current) {
          pushNativeSession({ playing: false });
        }
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
    // mediaId 变化时重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaId]);

  // Handle seek commands from Store
  useEffect(() => {
    if (seekTime !== null && playerRef.current) {
      playerRef.current.currentTime = seekTime;
      resetSeek();
    }
  }, [seekTime, resetSeek]);

  // Handle theater mode button UI toggle + 通知全局壳（隐藏桌面 FAB 等）
  useEffect(() => {
    if (playerRef.current && playerRef.current.controls.lightsOut) {
      const btn = playerRef.current.controls.lightsOut;
      btn.setAttribute("data-balloon", isTheaterMode ? "开灯模式" : "关灯模式");
      const svg = btn.querySelector("svg");
      if (svg) {
        svg.style.color = isTheaterMode ? "#ffeb3b" : "currentColor";
      }
    }
    window.dispatchEvent(
      new CustomEvent("super:media-theater-mode", {
        detail: { open: isTheaterMode },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("super:media-theater-mode", {
          detail: { open: false },
        }),
      );
    };
  }, [isTheaterMode]);

  // 耳机武装高亮
  useEffect(() => {
    const player = playerRef.current;
    if (!player?.controls?.audioOnly) return;
    const btn = player.controls.audioOnly as HTMLElement;
    try {
      btn.style.color = isArmedForThis ? "#23ade5" : "";
      btn.setAttribute(
        "data-balloon",
        isArmedForThis
          ? "已开启后台仅听（再点关闭）"
          : "后台仅听（退后台继续播）",
      );
    } catch {
      /* ignore */
    }
  }, [isArmedForThis]);

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
