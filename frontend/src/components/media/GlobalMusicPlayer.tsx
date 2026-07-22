import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useMediaStore,
  PlayMode,
  MediaPlayItem,
  isGlobalPlayerItem,
  getCachedMediaPlayUrl,
  cacheMediaPlayUrl,
} from "@/store/mediaStore";
import { api } from "@/lib/api";
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, 
  Volume2, VolumeX, ListMusic, ChevronDown, Music, Loader2, X, Minimize2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AudioCover, useID3Cover } from "@/lib/id3";
import {
  stopNativeMediaSession,
  subscribeNativeMediaActions,
  subscribeNativeMediaSeek,
  updateNativeMediaPosition,
  updateNativeMediaSession,
} from "@/lib/nativeMedia";
import { isNativePlatform } from "@/hooks/useCapacitor";

export default function GlobalMusicPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastReportedTime = useRef<number>(0);
  /** 节流：锁屏进度约 1s 推一次，避免刷爆原生侧 */
  const lastNativePosPush = useRef<number>(0);
  const lastNativePosValue = useRef<number>(0);
  /** 退后台 handoff 防抖 */
  const bgHandoffLockRef = useRef(false);
  
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
    backgroundAudioArmed,
    playAsAudioOnly,
  } = useMediaStore();

  const [playUrl, setPlayUrl] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showQueue, setShowQueue] = useState<boolean>(false);
  const [isMiniMode, setIsMiniMode] = useState<boolean>(false);
  const [currentHash, setCurrentHash] = useState<string>(window.location.hash);
  /** 拖动进度时本地预览时间，避免与 timeupdate 打架 */
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const isScrubbingRef = useRef(false);

  useEffect(() => {
    const handleHash = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  const globalPlayable = isGlobalPlayerItem(currentMedia);
  const isVideoAudioOnly = !!(currentMedia?.type === "video" && currentMedia?.audioOnly);

  // 仅在「纯音频」时解析 ID3；视频仅听只用 DB cover
  const { coverUrl: id3Cover, meta: id3Meta } = useID3Cover(
    currentMedia?.id,
    currentMedia?.cover_url,
    currentMedia?.type,
    { parse: currentMedia?.type === "audio" },
  );
  const coverToUse = id3Cover || currentMedia?.cover_url;

  // ID3 歌手/专辑/封面回填 store（useID3Cover 已保证切歌时 meta 不会串曲）
  // 本曲文件内 ID3 优先：可纠正「切歌时被上一首串写」的错误 artist/album
  useEffect(() => {
    if (!currentMedia || currentMedia.type !== "audio" || !id3Meta) return;
    const patch: { artist?: string; album?: string; cover_url?: string } = {};
    if (id3Meta.artist && id3Meta.artist !== currentMedia.artist) {
      patch.artist = id3Meta.artist;
    }
    if (id3Meta.album && id3Meta.album !== currentMedia.album) {
      patch.album = id3Meta.album;
    }
    const cover = id3Cover || id3Meta.coverUrl;
    if (cover && !currentMedia.cover_url) patch.cover_url = cover;
    if (Object.keys(patch).length > 0) {
      patchCurrentMedia(patch);
    }
  }, [
    currentMedia?.id,
    currentMedia?.type,
    currentMedia?.artist,
    currentMedia?.album,
    currentMedia?.cover_url,
    id3Meta?.artist,
    id3Meta?.album,
    id3Meta?.coverUrl,
    id3Cover,
    patchCurrentMedia,
  ]);

  // 展示：本曲 ID3 > store；视频仅听固定副标题
  const displayArtist = isVideoAudioOnly
    ? "仅音频 · 视频"
    : id3Meta?.artist || currentMedia?.artist || "";
  const displayAlbum = isVideoAudioOnly
    ? ""
    : id3Meta?.album || currentMedia?.album || "";

  // 1. Fetch play URL when currentMedia is global-playable (audio | video audioOnly)
  //    或耳机已武装（仅预热直链，不展示 UI / 不起播）
  useEffect(() => {
    const targetId =
      currentMedia && isGlobalPlayerItem(currentMedia)
        ? currentMedia.id
        : backgroundAudioArmed?.id || null;

    if (!targetId) {
      // 无全局可播且未武装：清空 URL（避免脏状态）
      if (!backgroundAudioArmed) setPlayUrl("");
      return;
    }

    // 武装预热：若当前不是全局可播，只写 cache / 可选预载，不强制 setPlayUrl 起播
    const isActiveGlobal =
      !!currentMedia && isGlobalPlayerItem(currentMedia) && currentMedia.id === targetId;

    const mediaId = targetId;
    let active = true;
    if (isActiveGlobal) {
      setLoading(true);
      setError("");
    }

    async function fetchPlayUrl() {
      try {
        const cached = getCachedMediaPlayUrl(mediaId);
        if (cached) {
          if (!active) return;
          cacheMediaPlayUrl(mediaId, cached);
          if (isActiveGlobal) {
            setPlayUrl(cached);
            setLoading(false);
          } else {
            // 预热：把 src 挂到 hidden audio 上 load，退后台 handoff 时更快
            const audio = audioRef.current;
            if (audio && audio.src !== cached) {
              try {
                audio.preload = "auto";
                audio.src = cached;
                audio.load();
              } catch {
                /* ignore */
              }
            }
          }
          // cache 命中仍可后台刷新直链
        }

        const res = await api.request<{ url: string }>(`/media/items/${mediaId}/play-url`);
        if (!active) return;

        if (res && res.url) {
          cacheMediaPlayUrl(mediaId, res.url);
          if (isActiveGlobal) {
            setPlayUrl(res.url);
          } else {
            const audio = audioRef.current;
            if (audio) {
              try {
                audio.preload = "auto";
                if (audio.src !== res.url) {
                  audio.src = res.url;
                  audio.load();
                }
              } catch {
                /* ignore */
              }
            }
          }
        } else if (isActiveGlobal && !cached) {
          setError("无法获取播放直链");
        }
      } catch (err: any) {
        if (!active) return;
        if (isActiveGlobal) {
          const cached = getCachedMediaPlayUrl(mediaId);
          if (cached) {
            setPlayUrl(cached);
          } else {
            setError(err.message || "获取播放链接失败，请检查 Alist 配置");
          }
        }
      } finally {
        if (active && isActiveGlobal) setLoading(false);
      }
    }

    fetchPlayUrl();
    
    // Reset reporting tracker when switching active global item
    if (isActiveGlobal) {
      lastReportedTime.current = 0;
    }

    return () => {
      active = false;
    };
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, backgroundAudioArmed?.id]);

  // 1b. m3u8：给 <audio> 挂 hls.js（视频仅听 HLS 场景）
  const hlsRef = useRef<{ destroy: () => void } | null>(null);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playUrl) return;

    let cancelled = false;
    hlsRef.current?.destroy();
    hlsRef.current = null;

    const isHls = /\.m3u8(\?|$)/i.test(playUrl);
    if (!isHls) {
      // 普通 progressive：由 src 属性驱动即可
      return;
    }

    (async () => {
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled || !audioRef.current) return;
        if (Hls.isSupported()) {
          const hls = new Hls({ enableWorker: true });
          hls.loadSource(playUrl);
          hls.attachMedia(audioRef.current);
          hlsRef.current = hls;
        } else if (audioRef.current.canPlayType("application/vnd.apple.mpegurl")) {
          audioRef.current.src = playUrl;
        } else {
          setError("当前环境不支持 HLS 仅音频播放");
        }
      } catch (e) {
        console.warn("HLS attach for audio-only failed:", e);
        if (!cancelled) setError("HLS 音频加载失败");
      }
    })();

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [playUrl]);

  // 2. Play / Pause syncing（store → element，单向）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playUrl) return;
    if (!isGlobalPlayerItem(currentMedia)) {
      if (!audio.paused) audio.pause();
      return;
    }

    if (isPlaying) {
      if (audio.paused) {
        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.catch((err) => {
            console.warn("Global audio playback failed:", err);
            // 元数据未就绪时，等 canplay 再试
            const onReady = () => {
              audio.removeEventListener("canplay", onReady);
              if (useMediaStore.getState().isPlaying) {
                void audio.play().catch(() => {});
              }
            };
            audio.addEventListener("canplay", onReady);
            window.setTimeout(() => audio.removeEventListener("canplay", onReady), 8000);
          });
        }
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  }, [isPlaying, playUrl, currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly]);

  /** 武装视频退后台：切到仅听；已仅听则强制续播 */
  const handoffArmedVideoIfNeeded = () => {
    const st = useMediaStore.getState();
    const armed = st.backgroundAudioArmed;
    if (!armed) return;

    if (st.currentMedia?.id === armed.id && st.currentMedia.audioOnly) {
      // 已在仅听：确保 audio 在播
      const audio = audioRef.current;
      if (st.isPlaying && audio?.paused) {
        void audio.play().catch(() => {});
      }
      return;
    }

    if (bgHandoffLockRef.current) return;
    bgHandoffLockRef.current = true;

    const t = st.currentTime > 0 ? st.currentTime : 0;
    const item: MediaPlayItem = {
      ...armed,
      type: "video",
      audioOnly: true,
    };

    // 先维持 FGS，再切 store，降低 WebView 被挂起窗口
    void updateNativeMediaSession({
      title: item.title || "视频",
      artist: "仅音频 · 视频",
      isPlaying: true,
      position: t > 0 ? t : undefined,
      duration: item.duration,
    });

    // 若已预热 URL，立刻写入 playUrl，缩短起播延迟
    const cached = getCachedMediaPlayUrl(armed.id);
    if (cached) {
      setPlayUrl(cached);
    }

    playAsAudioOnly(item, { startAt: t > 0 ? t : 0 });

    window.setTimeout(() => {
      bgHandoffLockRef.current = false;
    }, 500);

    // 多次尝试 play（WebView onPause/resume 竞态）
    const tryPlay = () => {
      const audio = audioRef.current;
      const s2 = useMediaStore.getState();
      if (!s2.isPlaying || !isGlobalPlayerItem(s2.currentMedia)) return;
      if (audio && audio.paused) {
        void audio.play().catch(() => {});
      }
    };
    window.setTimeout(tryPlay, 80);
    window.setTimeout(tryPlay, 250);
    window.setTimeout(tryPlay, 600);
    window.setTimeout(tryPlay, 1200);
  };

  // 前台恢复 / WebView 误暂停：store 仍为 playing 时强制续播
  // 另：武装后退后台 → 视频转仅听
  useEffect(() => {
    const tryResume = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const st = useMediaStore.getState();
      if (!st.isPlaying || !isGlobalPlayerItem(st.currentMedia)) return;
      // playUrl 可能稍后才到；有 src 也试
      if (audio.paused && (playUrl || audio.src)) {
        void audio.play().catch(() => {});
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        handoffArmedVideoIfNeeded();
      }
      // 切后台也可能被 WebView 暂停；始终尝试按 store 意图纠正
      tryResume();
    };
    const onAudioPause = () => {
      // 用户主动 pause：isPlaying 已 false，不重开
      // 系统/WebView 强制 pause：isPlaying 仍 true → 延迟续播
      window.setTimeout(tryResume, 120);
      window.setTimeout(tryResume, 400);
    };
    const audio = audioRef.current;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tryResume);
    window.addEventListener("pageshow", tryResume);
    audio?.addEventListener("pause", onAudioPause);
    audio?.addEventListener("canplay", tryResume);
    // Capacitor App 生命周期
    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        const p = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            tryResume();
          } else {
            handoffArmedVideoIfNeeded();
            // 退后台：WebView 可能刚 pause，延迟再 play 多次
            window.setTimeout(tryResume, 200);
            window.setTimeout(tryResume, 600);
            window.setTimeout(tryResume, 1500);
          }
        });
        void p.then((h) => {
          removeApp = () => void h.remove();
        });
      });
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", tryResume);
      window.removeEventListener("pageshow", tryResume);
      audio?.removeEventListener("pause", onAudioPause);
      audio?.removeEventListener("canplay", tryResume);
      removeApp?.();
    };
  }, [playUrl, currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, backgroundAudioArmed?.id, playAsAudioOnly]);

  // 武装期间维持 FGS（即使尚未 audioOnly），保证 MainActivity keepWebView
  useEffect(() => {
    if (!backgroundAudioArmed) return;
    if (currentMedia && isGlobalPlayerItem(currentMedia)) return; // 由 mediaSession effect 接管
    void updateNativeMediaSession({
      title: backgroundAudioArmed.title || "视频",
      artist: "后台仅听已开启",
      isPlaying: true,
      position: currentTime > 0 ? currentTime : undefined,
      duration: backgroundAudioArmed.duration,
    });
  }, [backgroundAudioArmed?.id, backgroundAudioArmed?.title, backgroundAudioArmed?.duration, currentMedia?.id, currentMedia?.audioOnly, currentTime]);

  // 3. Sync volume and mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = isMuted;
  }, [volume, isMuted]);

  // 4. Sync Seek commands（playUrl 就绪后再 seek，避免仅听交接时 audio 尚未 load）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !playUrl) return;
    if (seekTime !== null) {
      try {
        audio.currentTime = seekTime;
        setCurrentTime(seekTime);
      } catch {
        /* metadata 未就绪时由 onLoadedMetadata 再试 */
        return;
      }
      resetSeek();
    }
  }, [seekTime, playUrl, resetSeek, setCurrentTime]);

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
    // 拖动进度条时不覆盖预览值
    if (!isScrubbingRef.current) {
      setCurrentTime(audio.currentTime);
    }

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
    // 仅听交接：metadata 就绪后补 seek
    const st = useMediaStore.getState();
    const target =
      st.seekTime != null ? st.seekTime : st.currentTime > 0.5 ? st.currentTime : null;
    if (target != null && Math.abs(audio.currentTime - target) > 0.5) {
      try {
        audio.currentTime = target;
        setCurrentTime(target);
      } catch {
        /* ignore */
      }
    }
    if (st.seekTime != null) st.resetSeek();
  };

  // Media Session（Web）+ Android 原生 FGS 通知栏控件
  useEffect(() => {
    if (!currentMedia || !isGlobalPlayerItem(currentMedia)) {
      // 耳机已武装时由下方 armed effect 维持 FGS，切勿 stop
      if (!backgroundAudioArmed) {
        void stopNativeMediaSession();
      }
      return;
    }

    // 原生前台服务（Android）
    const artistLabel = isVideoAudioOnly
      ? "仅音频 · 视频"
      : id3Meta?.artist || currentMedia.artist || id3Meta?.album || currentMedia.album || "";
    const albumLabel = isVideoAudioOnly ? "" : id3Meta?.album || currentMedia.album || "";

    const pos = Math.max(0, currentTime || 0);
    const dur = Math.max(0, duration || currentMedia.duration || 0);
    void updateNativeMediaSession({
      title: currentMedia.title || "未知曲目",
      artist: artistLabel,
      isPlaying,
      position: pos,
      duration: dur > 0 ? dur : undefined,
    });
    lastNativePosPush.current = Date.now();

    if (!("mediaSession" in navigator)) {
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
        artist: artistLabel || "未知歌手",
        album: albumLabel,
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
  }, [currentMedia?.id, currentMedia?.title, currentMedia?.artist, currentMedia?.album, currentMedia?.audioOnly, currentMedia?.duration, isVideoAudioOnly, id3Meta?.artist, id3Meta?.album, coverToUse, isPlaying, duration, resumeMedia, pauseMedia, prevMedia, nextMedia, setCurrentTime, backgroundAudioArmed]);
  // 注意：currentTime 不进 deps，避免每帧 startForeground；进度用下面节流 effect

  // 无全局可播且未武装时停止 FGS
  useEffect(() => {
    if (!isGlobalPlayerItem(currentMedia) && !backgroundAudioArmed) {
      void stopNativeMediaSession();
    }
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, backgroundAudioArmed?.id]);

  // 通知栏按钮 → store 动作
  useEffect(() => {
    return subscribeNativeMediaActions((action) => {
      if (action === "play") resumeMedia();
      else if (action === "pause") pauseMedia();
      else if (action === "next") nextMedia(false);
      else if (action === "prev") prevMedia();
      else if (action === "stop") {
        pauseMedia();
        void stopNativeMediaSession();
      }
    });
  }, [resumeMedia, pauseMedia, nextMedia, prevMedia]);

  // 锁屏拖动进度
  useEffect(() => {
    return subscribeNativeMediaSeek((positionSec) => {
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(positionSec)) return;
      try {
        audio.currentTime = Math.max(0, positionSec);
        setCurrentTime(positionSec);
      } catch {
        /* ignore */
      }
    });
  }, [setCurrentTime]);

  // 同步 Web mediaSession + Android 锁屏进度（约 1s 节流）
  useEffect(() => {
    if (!isGlobalPlayerItem(currentMedia)) return;
    const pos = Math.min(Math.max(0, currentTime || 0), duration > 0 ? duration : Number.MAX_SAFE_INTEGER);
    const dur = duration > 0 ? duration : 0;

    if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession && dur > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: dur,
          playbackRate: isPlaying ? 1 : 0,
          position: Math.min(pos, dur),
        });
      } catch { /* ignore */ }
    }

    const now = Date.now();
    const jumped = Math.abs(pos - lastNativePosValue.current) > 1.5;
    // 播放中约 1s 推一次；大跳（seek）或暂停态立即同步
    const minInterval = isPlaying && !jumped ? 900 : 0;
    if (now - lastNativePosPush.current < minInterval) return;
    lastNativePosPush.current = now;
    lastNativePosValue.current = pos;
    void updateNativeMediaPosition({
      position: pos,
      duration: dur > 0 ? dur : undefined,
      isPlaying,
    });
  }, [currentTime, duration, isPlaying, currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly]);

  const handleEnded = () => {
    if (currentMedia) {
      reportProgress(currentMedia.id, 0); // Reset progress on end
    }
    nextMedia(true); // Trigger auto next
  };

  const progressValue = scrubTime ?? currentTime;
  const progressMax = duration > 0 ? duration : 0;
  const progressPct =
    progressMax > 0 ? Math.min(100, Math.max(0, (progressValue / progressMax) * 100)) : 0;

  const handleProgressInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (Number.isNaN(time)) return;
    isScrubbingRef.current = true;
    setScrubTime(time);
  };

  const handleProgressCommit = (e: React.ChangeEvent<HTMLInputElement> | React.SyntheticEvent<HTMLInputElement>) => {
    const raw = (e.target as HTMLInputElement).value;
    const time = parseFloat(raw);
    const audio = audioRef.current;
    if (audio && !Number.isNaN(time)) {
      audio.currentTime = time;
      setCurrentTime(time);
    }
    isScrubbingRef.current = false;
    setScrubTime(null);
  };

  /** 兼容旧调用名（桌面中部滑条） */
  const handleProgressChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleProgressInput(e);
    handleProgressCommit(e);
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
      isGlobalPlayerItem(currentMedia) &&
      !isExpanded &&
      !isMiniMode;
    // 迷你条（含顶部进度条）约 64 + 间距 ≈ 72
    root.style.setProperty("--mobile-extra-bottom", active ? "72px" : "0px");
    return () => {
      root.style.setProperty("--mobile-extra-bottom", "0px");
    };
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, isExpanded, isMiniMode]);

  // 武装预热：即使尚未 audioOnly，也挂载 hidden <audio> 以便预载直链
  const keepAudioNode = globalPlayable || !!backgroundAudioArmed;

  // 非全局可播且未武装：不渲染
  if (!keepAudioNode || (!currentMedia && !backgroundAudioArmed)) {
    return null;
  }

  const isOnCurrentAudioDetailsPage =
    !!currentMedia && currentHash === `#/media/items/${currentMedia.id}`;

  // 仅武装、尚未仅听：只保留 audio 节点，不展示迷你条
  const showPlayerUi = !!currentMedia && globalPlayable;

  return (
    <>
      {/* Hidden Audio Node
          注意：不要用 onPause/onPlay 回写 store。
          系统锁屏、WebView 暂停、生物识别弹窗等会触发 pause 事件，
          若写回 store 会把「正在播放」误判为暂停。store 才是意图来源。 */}
      <audio
        ref={audioRef}
        // progressive 用 src；m3u8 由 hls.js attach，避免双绑
        src={playUrl && !/\.m3u8(\?|$)/i.test(playUrl) ? playUrl : undefined}
        {...{ referrerPolicy: "no-referrer" }}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
      />

      {/* Hide UI if we are viewing the details page of the currently playing audio */}
      {showPlayerUi && !isOnCurrentAudioDetailsPage && currentMedia && (
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
          "z-40 bg-app-elevated dark:bg-[#181824] border border-app-border/60 shadow-xl select-none transition-all duration-300 overflow-hidden",
          // 移动：贴左右；桌面：约 1/3 宽并水平居中
          "fixed left-3 right-3 mobile-music-mini rounded-2xl",
          "md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-6 md:w-[min(36vw,420px)] md:min-w-[300px] md:max-w-[440px]",
          // 移动：列布局（顶进度 + 内容）；桌面：横向内容区
          "flex flex-col md:block",
          isExpanded && "max-md:opacity-0 max-md:pointer-events-none"
        )}
      >
        {/* 移动端顶部横向进度条（可拖动 seek） */}
        <div
          className="md:hidden relative w-full h-3 shrink-0 group/seek touch-none"
          onClick={(e) => e.stopPropagation()}
        >
          {/* 视觉轨道 */}
          <div className="absolute left-0 right-0 top-0 h-[3px] bg-app-border/70 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full bg-accent-primary transition-[width] duration-75 ease-linear"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          {/* 拖动手柄指示（拖动时更明显） */}
          <div
            className={cn(
              "pointer-events-none absolute top-0 z-[1] -translate-x-1/2 -translate-y-[3px]",
              "w-2.5 h-2.5 rounded-full bg-accent-primary shadow-sm shadow-accent-primary/40",
              "opacity-0 group-active/seek:opacity-100 transition-opacity",
              scrubTime != null && "opacity-100",
            )}
            style={{ left: `${progressPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={progressMax || 1}
            step={0.1}
            value={progressMax > 0 ? progressValue : 0}
            disabled={!progressMax}
            onChange={handleProgressInput}
            onInput={handleProgressInput}
            onMouseUp={handleProgressCommit}
            onTouchEnd={handleProgressCommit}
            onPointerUp={handleProgressCommit}
            onKeyUp={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                handleProgressCommit(e);
              }
            }}
            aria-label="播放进度"
            className="mobile-music-seek absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-default z-[2]"
          />
        </div>

        <div className="flex items-center justify-between px-3 py-2.5 md:py-3.5 md:px-4 gap-2">
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
                {[displayArtist || "未知歌手", displayAlbum].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>

          {/* Center: Playback Controls & Seek bar (Desktop) */}
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
              <span className="w-8 text-right font-medium select-none">{formatDuration(progressValue)}</span>
              <input
                type="range"
                min="0"
                max={progressMax || 0}
                step={0.1}
                value={progressMax > 0 ? progressValue : 0}
                onChange={handleProgressInput}
                onMouseUp={handleProgressCommit}
                onTouchEnd={handleProgressCommit}
                onPointerUp={handleProgressCommit}
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
        </div>
      </div>,
          document.body,
        )}

      {/* Floating Queue Drawer — Portal 到 body，避免被全屏播放器（z-50）盖住 */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showQueue && (
              <>
                <div
                  className={cn(
                    "fixed inset-0",
                    isExpanded ? "z-[125] bg-black/50" : "z-40",
                  )}
                  onClick={() => setShowQueue(false)}
                />
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  className={cn(
                    "fixed flex flex-col overflow-hidden shadow-2xl",
                    isExpanded
                      ? "z-[130] left-0 right-0 bottom-0 max-h-[70vh] rounded-t-3xl bg-[#12121a] border-t border-white/10 p-4 text-white"
                      : "z-[60] bottom-24 right-6 w-80 max-h-[350px] rounded-2xl bg-app-elevated dark:bg-[#181824] border border-app-border/80 p-4",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center justify-between pb-2 border-b select-none gap-2",
                      isExpanded ? "border-white/10" : "border-app-border/40",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-bold uppercase tracking-wider flex items-center gap-1.5",
                        isExpanded ? "text-white/70" : "text-tx-secondary",
                      )}
                    >
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
                        className={cn(
                          "text-xs",
                          isExpanded
                            ? "text-white/50 hover:text-white"
                            : "text-tx-tertiary hover:text-tx-primary",
                        )}
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
                            ? isExpanded
                              ? "bg-accent-primary/20 text-accent-primary"
                              : "bg-accent-primary/10 text-accent-primary"
                            : isExpanded
                              ? "hover:bg-white/10 text-white/70 hover:text-white"
                              : "hover:bg-app-hover text-tx-secondary hover:text-tx-primary",
                        )}
                      >
                        <span
                          className={cn(
                            "w-4 text-center text-[10px]",
                            isExpanded ? "text-white/40" : "text-tx-tertiary",
                          )}
                        >
                          {idx + 1}
                        </span>
                        <div className="flex-1 truncate min-w-0">
                          <p className="truncate font-semibold">{item.title}</p>
                          <p
                            className={cn(
                              "text-[10px] truncate",
                              isExpanded ? "text-white/40" : "text-tx-tertiary",
                            )}
                          >
                            {[item.artist, item.album].filter(Boolean).join(" · ") || "未知歌手"}
                          </p>
                        </div>
                        {item.duration ? (
                          <span
                            className={cn(
                              "text-[10px] shrink-0 group-hover/queue:hidden",
                              isExpanded ? "text-white/40" : "text-tx-tertiary",
                            )}
                          >
                            {formatDuration(item.duration)}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          title="从播放列表移除"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromPlaylist(idx);
                          }}
                          className={cn(
                            "shrink-0 w-6 h-6 rounded-full flex items-center justify-center hover:text-accent-danger hover:bg-accent-danger/10 opacity-100 md:opacity-0 md:group-hover/queue:opacity-100 transition-opacity",
                            isExpanded ? "text-white/40" : "text-tx-tertiary",
                          )}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* ----------------------------------------------------------------------- */}
      {/* IMMERSIVE FULL-SCREEN PLAYER DRAWER — Portal 到 body，z 高于媒体页 + 号 */}
      {/* ----------------------------------------------------------------------- */}
      {typeof document !== "undefined" &&
        createPortal(
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="fixed inset-0 z-[120] bg-[#0f0f15] text-white flex flex-col overflow-hidden select-none"
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

            {/* Header：与状态栏留足间距，避免贴电量/时间 */}
            <div
              className="relative z-10 flex items-center justify-between px-5 pb-3 border-b border-white/5 bg-black/10 backdrop-blur-sm"
              style={{
                paddingTop: "calc(var(--safe-area-top, 0px) + 14px)",
              }}
            >
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
                    {[displayArtist || "未知歌手", displayAlbum].filter(Boolean).join(" · ")}
                  </p>
                </div>

                {/* Progress bar */}
                <div className="flex flex-col gap-2">
                  <input
                    type="range"
                    min="0"
                    max={progressMax || 0}
                    step={0.1}
                    value={progressMax > 0 ? progressValue : 0}
                    onChange={handleProgressInput}
                    onMouseUp={handleProgressCommit}
                    onTouchEnd={handleProgressCommit}
                    onPointerUp={handleProgressCommit}
                    className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-accent-primary hover:h-2 transition-all outline-none"
                  />
                  <div className="flex items-center justify-between text-xs text-white/50 select-none font-medium">
                    <span>{formatDuration(progressValue)}</span>
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
      </AnimatePresence>,
          document.body,
        )}
        </>
      )}
    </>
  );
}
