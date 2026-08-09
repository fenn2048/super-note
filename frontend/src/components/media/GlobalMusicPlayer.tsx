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
import { api, resolveAttachmentUrl } from "@/lib/api";
import {
  acquireLocalPlayUrl,
  releaseLocalPlayUrl,
} from "@/lib/mediaFileCache";
import { 
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, 
  Volume2, VolumeX, ListMusic, ChevronDown, Music, Loader2, X, Minimize2 
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import { AudioCover, useID3Cover } from "@/lib/id3";
import CoverBlurBackdrop from "@/components/media/CoverBlurBackdrop";
import MediaLyrics from "@/components/media/MediaLyrics";
import {
  stopNativeMediaSession,
  subscribeNativeMediaActions,
  subscribeNativeMediaBrowsePlay,
  subscribeNativeMediaSeek,
  pushNativeMediaQueue,
  updateNativeMediaPosition,
  updateNativeMediaSession,
  type NativeMediaTrack,
} from "@/lib/nativeMedia";
import { isNativePlatform } from "@/hooks/useCapacitor";
import { useApp } from "@/store/AppContext";
import { getLibraryTab, type LibraryTab } from "@/lib/navigation.config";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import {
  defaultAccentFromSeed,
  defaultCoverGradient,
  extractCoverAccent,
  type CoverAccent,
} from "@/lib/coverAccent";
import { springs } from "@/lib/motion";
import { BottomSheet } from "@/components/common/BottomSheet";

/** 环形进度：viewBox 64，半径 29，描边 3 */
function MiniProgressRing({ progressPct }: { progressPct: number }) {
  const r = 29;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, progressPct));
  const offset = c * (1 - pct / 100);
  return (
    <svg
      className="absolute inset-0 w-full h-full -rotate-90 pointer-events-none"
      viewBox="0 0 64 64"
      aria-hidden
    >
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        className="stroke-app-border dark:stroke-white/15"
        strokeWidth="3"
      />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        className="stroke-accent-primary transition-[stroke-dashoffset] duration-150 ease-linear"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
      />
    </svg>
  );
}

export default function GlobalMusicPlayer() {
  const { state: appState } = useApp();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastReportedTime = useRef<number>(0);
  /** 节流：锁屏进度约 1s 推一次，避免刷爆原生侧 */
  const lastNativePosPush = useRef<number>(0);
  const lastNativePosValue = useRef<number>(0);
  const lastNativeMediaId = useRef<string | null>(null);
  
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
    triggerSeek,
    playMedia,
    removeFromPlaylist,
    clearPlaylist,
    patchCurrentMedia,
  } = useMediaStore();

  const [playUrl, setPlayUrl] = useState<string>("");
  /** 当前占用的本地 blob 对应 mediaId */
  const localPlayHeldIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [showQueue, setShowQueue] = useState<boolean>(false);
  const [isMiniMode, setIsMiniMode] = useState<boolean>(false);
  /** 用户在媒体 tab 内手动最小化；离开媒体 tab 后清除 */
  const [userForcedMini, setUserForcedMini] = useState(false);
  const [libraryTab, setLibraryTabState] = useState<LibraryTab>(() => getLibraryTab());
  const [currentHash, setCurrentHash] = useState<string>(window.location.hash);
  /** 拖动进度时本地预览时间，避免与 timeupdate 打架 */
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const isScrubbingRef = useRef(false);

  useEffect(() => {
    const handleHash = () => setCurrentHash(window.location.hash);
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    const onTab = (e: Event) => {
      const d = (e as CustomEvent).detail as LibraryTab;
      if (d === "files" || d === "books" || d === "media") setLibraryTabState(d);
    };
    window.addEventListener("super:library-tab-changed", onTab);
    return () => window.removeEventListener("super:library-tab-changed", onTab);
  }, []);

  /** 资料库 · 媒体 tab（含 legacy viewMode=media） */
  const isOnMediaTab =
    appState.viewMode === "media" ||
    (appState.viewMode === "library" && libraryTab === "media");

  // 桌面：不在媒体 tab → 自动 mini；进入媒体 tab → 恢复全宽底栏（除非用户本页手动最小化）
  useEffect(() => {
    if (!isDesktop) return;
    if (!isOnMediaTab) {
      setIsMiniMode(true);
      setUserForcedMini(false);
    } else if (!userForcedMini) {
      setIsMiniMode(false);
    }
  }, [isOnMediaTab, isDesktop, userForcedMini]);

  const globalPlayable = isGlobalPlayerItem(currentMedia);
  const isVideoAudioOnly = !!(currentMedia?.type === "video" && currentMedia?.audioOnly);

  // 仅在「纯音频」时解析 ID3；视频仅听只用 DB cover
  const { coverUrl: id3Cover, meta: id3Meta } = useID3Cover(
    currentMedia?.id,
    currentMedia?.cover_url,
    currentMedia?.type,
    { parse: currentMedia?.type === "audio" },
  );
  // 本曲 ID3 封面（meta / cache）优先，再回落 DB cover
  const coverToUse =
    id3Meta?.coverUrl || id3Cover || currentMedia?.cover_url || null;
  /**
   * 氛围底 / 主碟 / 主色采样用 URL（与全屏封面同源）：
   * - blob: / data: 原样
   * - 相对 /api 或带 token 的附件走 resolveAttachmentUrl
   * - 纯相对路径（如 /media/...）保留，避免二次加工丢鉴权
   */
  const blurCoverSrc = React.useMemo(() => {
    const raw = coverToUse;
    if (!raw) return "";
    if (raw.startsWith("blob:") || raw.startsWith("data:")) return raw;
    if (raw.startsWith("/") && !raw.startsWith("/api")) return raw;
    return resolveAttachmentUrl(raw) || raw;
  }, [coverToUse]);

  /** 封面主色 → 进度拇指 / 播放钮 / 音量拇指；无封面或采样失败用标题派生色 */
  const [coverAccent, setCoverAccent] = useState<CoverAccent>(() =>
    defaultAccentFromSeed(currentMedia?.title || currentMedia?.id || "music"),
  );
  useEffect(() => {
    const seed = currentMedia?.title || currentMedia?.id || "music";
    const fallback = defaultAccentFromSeed(seed);
    if (!blurCoverSrc) {
      setCoverAccent(fallback);
      return;
    }
    let cancelled = false;
    setCoverAccent(fallback);
    void extractCoverAccent(blurCoverSrc).then((accent) => {
      if (!cancelled && accent) setCoverAccent(accent);
    });
    return () => {
      cancelled = true;
    };
  }, [blurCoverSrc, currentMedia?.id, currentMedia?.title]);

  const playerAccentStyle = React.useMemo(
    () =>
      ({
        "--player-accent": coverAccent.solid,
        "--player-accent-shadow": coverAccent.shadow,
      }) as React.CSSProperties,
    [coverAccent.solid, coverAccent.shadow],
  );

  const noCoverGradient = React.useMemo(() => {
    // 有采样主色时用主色氛围；否则标题派生渐变
    if (coverAccent?.solid) {
      const c = coverAccent.solid;
      return `linear-gradient(165deg, ${c}ee 0%, ${c}99 42%, #0a0a12 100%)`;
    }
    return defaultCoverGradient(currentMedia?.title || currentMedia?.id || "music");
  }, [coverAccent?.solid, currentMedia?.title, currentMedia?.id]);

  const expandPlayer = React.useCallback(() => {
    setIsExpanded(true);
  }, []);

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
    const cover = id3Meta.coverUrl || id3Cover;
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

  // 1. Fetch play URL when currentMedia is global-playable（纯音频；视频后台仅听走 MediaPlayer 自身 video）
  //    优先本地文件缓存 → 会话直链缓存 → 在线 play-url
  useEffect(() => {
    // 释放上一首的本地 blob
    const releasePrevLocal = () => {
      if (localPlayHeldIdRef.current) {
        releaseLocalPlayUrl(localPlayHeldIdRef.current);
        localPlayHeldIdRef.current = null;
      }
    };

    if (!currentMedia || !isGlobalPlayerItem(currentMedia)) {
      releasePrevLocal();
      setPlayUrl("");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute("src");
        audioRef.current.load();
      }
      return;
    }

    const mediaId = currentMedia.id;
    let active = true;
    setLoading(true);
    setError("");

    // 切歌：先卸旧 blob，再尝试同步会话缓存
    if (localPlayHeldIdRef.current && localPlayHeldIdRef.current !== mediaId) {
      releasePrevLocal();
    }
    const sessionCached = getCachedMediaPlayUrl(mediaId);
    setPlayUrl(sessionCached || "");
    if (!sessionCached && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }

    async function fetchPlayUrl() {
      try {
        // 1) 本地离线缓存
        const localUrl = await acquireLocalPlayUrl(mediaId);
        if (!active) {
          if (localUrl) releaseLocalPlayUrl(mediaId);
          return;
        }
        if (localUrl) {
          if (localPlayHeldIdRef.current && localPlayHeldIdRef.current !== mediaId) {
            releaseLocalPlayUrl(localPlayHeldIdRef.current);
          }
          localPlayHeldIdRef.current = mediaId;
          setPlayUrl(localUrl);
          setLoading(false);
          return;
        }

        if (sessionCached) {
          setLoading(false);
        }

        const res = await api.request<{ url: string }>(`/media/items/${mediaId}/play-url`);
        if (!active) return;

        if (res && res.url) {
          cacheMediaPlayUrl(mediaId, res.url);
          setPlayUrl(res.url);
        } else if (!sessionCached) {
          setError("无法获取播放直链");
        }
      } catch (err: any) {
        if (!active) return;
        // 在线失败时再试一次本地（竞态：刚缓存完）
        const localRetry = await acquireLocalPlayUrl(mediaId);
        if (localRetry) {
          localPlayHeldIdRef.current = mediaId;
          setPlayUrl(localRetry);
          setError("");
          return;
        }
        const hit = getCachedMediaPlayUrl(mediaId);
        if (hit) {
          setPlayUrl(hit);
        } else {
          setError(err.message || "获取播放链接失败，请检查 Alist 配置");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchPlayUrl();
    lastReportedTime.current = 0;

    return () => {
      active = false;
    };
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly]);

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
      // 同步锁屏：暂停瞬间推一次精确进度，避免外推错位后被写成 0
      void updateNativeMediaPosition({
        position: audio.currentTime || currentTime || 0,
        duration:
          (audio.duration && !Number.isNaN(audio.duration) ? audio.duration : 0) ||
          duration ||
          undefined,
        isPlaying: false,
      });
    }
  }, [isPlaying, playUrl, currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, currentTime, duration]);

  // 前台恢复 / WebView 误暂停：store 仍为 playing 时强制续播（仅真实全局音频）
  // 用户/锁屏主动 pause 时 isPlaying=false，绝不可在此抢播
  useEffect(() => {
    const tryResume = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const st = useMediaStore.getState();
      if (!st.isPlaying || !isGlobalPlayerItem(st.currentMedia)) return;
      if (audio.paused && (playUrl || audio.src)) {
        void audio.play().catch(() => {});
      }
    };
    const tryPauseIfNeeded = () => {
      const audio = audioRef.current;
      if (!audio) return;
      const st = useMediaStore.getState();
      if (st.isPlaying) return;
      if (!audio.paused) audio.pause();
    };
    const onVisibility = () => {
      tryResume();
      tryPauseIfNeeded();
    };
    const onAudioPause = () => {
      // 仅在仍应播放时续播；用户暂停后 isPlaying=false，不再拉起
      window.setTimeout(tryResume, 120);
      window.setTimeout(tryResume, 400);
    };
    const onWebViewResume = () => {
      tryResume();
      tryPauseIfNeeded();
    };
    const audio = audioRef.current;
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", tryResume);
    window.addEventListener("pageshow", tryResume);
    window.addEventListener("super:webview-media-resume", onWebViewResume);
    audio?.addEventListener("pause", onAudioPause);
    audio?.addEventListener("canplay", tryResume);
    let removeApp: (() => void) | undefined;
    if (isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => {
        const p = App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            tryResume();
            tryPauseIfNeeded();
          } else {
            window.setTimeout(tryResume, 200);
            window.setTimeout(tryResume, 600);
            window.setTimeout(tryResume, 1500);
            window.setTimeout(tryPauseIfNeeded, 250);
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
      window.removeEventListener("super:webview-media-resume", onWebViewResume);
      audio?.removeEventListener("pause", onAudioPause);
      audio?.removeEventListener("canplay", tryResume);
      removeApp?.();
    };
  }, [playUrl, currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly]);

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
  // 注意：视频后台仅听由 MediaPlayer 自己推 FGS；此处不要在 armed 时 stop
  useEffect(() => {
    if (!currentMedia || !isGlobalPlayerItem(currentMedia)) {
      const armed = useMediaStore.getState().backgroundAudioArmed;
      if (!armed) {
        void stopNativeMediaSession();
      }
      return;
    }

    // 原生前台服务（Android）
    const artistLabel = isVideoAudioOnly
      ? "仅音频 · 视频"
      : id3Meta?.artist || currentMedia.artist || id3Meta?.album || currentMedia.album || "";
    const albumLabel = isVideoAudioOnly ? "" : id3Meta?.album || currentMedia.album || "";

    // 优先读 audio 元素真实进度，避免 store 过期把锁屏条打回 0
    const audioPos = audioRef.current?.currentTime;
    const pos = Math.max(
      0,
      audioPos != null && Number.isFinite(audioPos) ? audioPos : currentTime || 0,
    );
    const audioDur = audioRef.current?.duration;
    const dur = Math.max(
      0,
      audioDur != null && Number.isFinite(audioDur) && audioDur > 0
        ? audioDur
        : duration || currentMedia.duration || 0,
    );
    // 切歌时重置原生位置缓存
    if (currentMedia.id !== lastNativeMediaId.current) {
      lastNativeMediaId.current = currentMedia.id;
      lastNativePosValue.current = 0;
    }

    // 若算出的 pos 为 0，但上一次已有进度 (>3s)，说明音频刚起播/续播尚未加载出 currentTime，避免传 0 冲掉原生已有进度
    const pushPos =
      pos > 0 ? pos : lastNativePosValue.current > 3 ? undefined : pos;

    // 尝试解析封面（支持 ID3 解析封面与 DB 封面）
    const rawCover = id3Cover || id3Meta?.coverUrl || currentMedia.cover_url;
    const resolvedCover = rawCover
      ? (rawCover.startsWith("/") && !rawCover.startsWith("/api")
          ? `${window.location.origin}${rawCover}`
          : resolveAttachmentUrl(rawCover))
      : undefined;

    void updateNativeMediaSession({
      title: currentMedia.title || "未知曲目",
      artist: artistLabel,
      isPlaying,
      position: pushPos,
      duration: dur > 0 ? dur : undefined,
      playMode,
      coverUrl: resolvedCover,
    });
    lastNativePosPush.current = Date.now();
    if (pos > 0) {
      lastNativePosValue.current = pos;
    }

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
  }, [currentMedia?.id, currentMedia?.title, currentMedia?.artist, currentMedia?.album, currentMedia?.audioOnly, currentMedia?.duration, isVideoAudioOnly, id3Meta?.artist, id3Meta?.album, coverToUse, isPlaying, duration, playMode, resumeMedia, pauseMedia, prevMedia, nextMedia, setCurrentTime]);
  // 注意：currentTime 不进 deps，避免每帧 startForeground；进度用下面节流 effect

  // 无全局可播且未武装视频后台仅听时停止 FGS
  useEffect(() => {
    if (isGlobalPlayerItem(currentMedia)) return;
    if (useMediaStore.getState().backgroundAudioArmed) return;
    void stopNativeMediaSession();
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly]);

  // 通知栏 / 锁屏按钮 → 立刻控 <audio> + store（视频武装时由 MediaPlayer 另接）
  useEffect(() => {
    return subscribeNativeMediaActions((action) => {
      const st = useMediaStore.getState();
      // 视频后台仅听：交给 MediaPlayer 处理，避免误控全局 audio
      if (st.backgroundAudioArmed && !isGlobalPlayerItem(st.currentMedia)) {
        return;
      }
      const audio = audioRef.current;
      if (action === "play") {
        resumeMedia();
        if (audio) {
          void audio.play().catch(() => {});
        }
      } else if (action === "pause") {
        pauseMedia();
        if (audio && !audio.paused) {
          audio.pause();
        }
        // 立即把暂停态 + 当前进度推给锁屏，避免条乱跳
        if (audio) {
          void updateNativeMediaPosition({
            position: audio.currentTime || st.currentTime || 0,
            duration: audio.duration > 0 ? audio.duration : st.duration || undefined,
            isPlaying: false,
          });
        }
      } else if (action === "next") {
        nextMedia(false);
      } else if (action === "prev") {
        prevMedia();
      } else if (action === "mode") {
        const nextModeMap: Record<PlayMode, PlayMode> = {
          sequence: "random",
          random: "loop",
          loop: "sequence",
        };
        const currentMode = useMediaStore.getState().playMode;
        setPlayMode(nextModeMap[currentMode] || "sequence");
      } else if (action === "stop") {
        pauseMedia();
        if (audio && !audio.paused) audio.pause();
        void stopNativeMediaSession();
      }
    });
  }, [resumeMedia, pauseMedia, nextMedia, prevMedia, setPlayMode]);

  // 锁屏拖动进度
  useEffect(() => {
    return subscribeNativeMediaSeek((positionSec) => {
      const st = useMediaStore.getState();
      if (st.backgroundAudioArmed && !isGlobalPlayerItem(st.currentMedia)) {
        return;
      }
      const audio = audioRef.current;
      if (!audio || !Number.isFinite(positionSec)) return;
      try {
        audio.currentTime = Math.max(0, positionSec);
        setCurrentTime(positionSec);
        void updateNativeMediaPosition({
          position: positionSec,
          duration: audio.duration > 0 ? audio.duration : st.duration || undefined,
          isPlaying: st.isPlaying,
        });
      } catch {
        /* ignore */
      }
    });
  }, [setCurrentTime]);

  // 车载 / MediaSession 队列：playlist 变更时推送
  useEffect(() => {
    if (!isNativePlatform()) return;
    const audioItems = playlist.filter(
      (it) => it.type === "audio" || !!it.audioOnly,
    );
    if (audioItems.length === 0) {
      void pushNativeMediaQueue([], 0);
      return;
    }
    const tracks: NativeMediaTrack[] = audioItems.map((it) => {
      const cover = it.cover_url
        ? it.cover_url.startsWith("/") && !it.cover_url.startsWith("/api")
          ? `${window.location.origin}${it.cover_url}`
          : resolveAttachmentUrl(it.cover_url)
        : undefined;
      return {
        id: it.id,
        title: it.title || "未知曲目",
        artist: it.artist || "",
        album: it.album || "",
        duration: it.duration || 0,
        coverUrl: cover,
      };
    });
    const idx = Math.max(
      0,
      audioItems.findIndex((it) => it.id === currentMedia?.id),
    );
    void pushNativeMediaQueue(tracks, idx >= 0 ? idx : 0);
  }, [playlist, currentMedia?.id]);

  // 车机 MediaBrowser 点播（原生侧已先起 FGS；此处立刻刷新 Session 并起播）
  useEffect(() => {
    if (!isNativePlatform()) return;
    return subscribeNativeMediaBrowsePlay((ev) => {
      // 先占住 FGS，避免拉详情期间服务被系统回收
      void updateNativeMediaSession({
        title: ev.title || "正在连接…",
        artist: ev.artist || "车载点播",
        isPlaying: true,
        position: 0,
      });

      const st = useMediaStore.getState();
      const fromPlaylist = st.playlist.find((x) => x.id === ev.id);
      if (fromPlaylist) {
        playMedia(fromPlaylist, st.playlist);
        return;
      }
      // 合集树点播：拉详情后播放
      void (async () => {
        try {
          const item = await api.request<MediaPlayItem>(`/media/items/${ev.id}`);
          if (!item) return;
          const playItem: MediaPlayItem = {
            id: item.id,
            title: item.title || ev.title || "未知曲目",
            type: (item as any).type === "video" ? "video" : "audio",
            artist: (item as any).artist || ev.artist,
            album: (item as any).album,
            cover_url: (item as any).cover_url,
            duration: (item as any).duration,
            alist_path: (item as any).alist_path || "",
          };
          if (playItem.type === "video") {
            // 车载默认仅听视频音轨
            useMediaStore.getState().playAsAudioOnly(playItem);
          } else {
            playMedia(playItem, [playItem, ...st.playlist.filter((x) => x.id !== playItem.id)]);
          }
        } catch (e) {
          console.warn("[car] browse play failed", e);
        }
      })();
    });
  }, [playMedia]);

  // 同步 Web mediaSession + Android 锁屏进度（约 1s 节流）
  useEffect(() => {
    if (!isGlobalPlayerItem(currentMedia)) return;
    const audio = audioRef.current;
    const rawPos =
      audio && Number.isFinite(audio.currentTime) ? audio.currentTime : currentTime || 0;
    const rawDur =
      audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : duration > 0
          ? duration
          : 0;
    const pos = Math.min(Math.max(0, rawPos), rawDur > 0 ? rawDur : Number.MAX_SAFE_INTEGER);
    const dur = rawDur > 0 ? rawDur : 0;

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
    if (pos > 0) {
      lastNativePosValue.current = pos;
    }
    const pushPos =
      pos > 0 ? pos : lastNativePosValue.current > 3 ? undefined : pos;
    void updateNativeMediaPosition({
      position: pushPos,
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

  // 底栏占用高度：移动抬升 FAB/内容；桌面悬浮圆角条同步让出主区
  useEffect(() => {
    const root = document.documentElement;
    const active =
      isGlobalPlayerItem(currentMedia) &&
      !isExpanded &&
      !isMiniMode;
    // 移动迷你条 ≈ 72；桌面悬浮条（顶进度 + 单行控件）≈ 80（含底边距）
    root.style.setProperty("--mobile-extra-bottom", active ? "72px" : "0px");
    root.style.setProperty("--global-music-bar-height", active ? "80px" : "0px");
    return () => {
      root.style.setProperty("--mobile-extra-bottom", "0px");
      root.style.setProperty("--global-music-bar-height", "0px");
    };
  }, [currentMedia?.id, currentMedia?.type, currentMedia?.audioOnly, isExpanded, isMiniMode]);

  // 全屏态标记：媒体页 titlebar portal chrome 据此隐藏
  useEffect(() => {
    const root = document.documentElement;
    if (isExpanded) root.setAttribute("data-global-player-expanded", "true");
    else root.removeAttribute("data-global-player-expanded");
    return () => root.removeAttribute("data-global-player-expanded");
  }, [isExpanded]);

  // 非全局可播项（含普通视频、仅武装未 handoff 的视频）不渲染播放器 UI
  if (!currentMedia || !globalPlayable) return null;

  const isOnCurrentAudioDetailsPage = currentHash === `#/media/items/${currentMedia.id}`;

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
      {!isOnCurrentAudioDetailsPage && (
        <>
          {/* ----------------------------------------------------------------------- */}
          {/* MINI MODE DRAGGABLE CD PLAYER */}
          {/* ----------------------------------------------------------------------- */}
          <AnimatePresence>
        {/* 全屏展开时不渲染 mini，避免透到全屏层上造成「左上小方块/叠字」 */}
        {isMiniMode && !isExpanded && (
          <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            data-global-music-ui
            className={cn(
              "fixed z-[100] top-24 right-6 w-[4.25rem] h-[4.25rem] rounded-full cursor-move group",
              "bg-app-elevated border border-app-border shadow-xl",
              "dark:bg-app-elevated dark:border-app-border",
            )}
            title={currentMedia.title}
          >
            {/* 外圈环形进度 + 内圈旋转封面 */}
            <div className="absolute inset-0 p-1">
              <MiniProgressRing progressPct={progressPct} />
              <div className="absolute inset-[5px] rounded-full overflow-hidden border border-app-border/60 bg-app-bg">
                <AudioCover
                  item={currentMedia}
                  src={blurCoverSrc || coverToUse || null}
                  className={cn(
                    "w-full h-full object-cover rounded-full pointer-events-none select-none media-disc-spin",
                    !isPlaying && "media-disc-spin-paused",
                  )}
                  fallbackIconSize={22}
                />
                <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-app-elevated border border-app-border shadow-sm" />
              </div>
            </div>
            {/* Hover：播放/暂停 + 恢复全栏（仅媒体 tab 可恢复全栏） */}
            <div
              className={cn(
                "absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity",
                "bg-app-bg/75 dark:bg-black/65 backdrop-blur-[2px]",
                "flex items-center justify-center",
              )}
            >
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  isPlaying ? pauseMedia() : resumeMedia();
                }}
                className="text-tx-primary dark:text-white [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 active:scale-95 transition-transform"
              >
                {isPlaying ? (
                  <Pause size={20} className="fill-current" />
                ) : (
                  <Play size={20} className="fill-current translate-x-0.5" />
                )}
              </button>
              {isOnMediaTab && (
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    setUserForcedMini(false);
                    setIsMiniMode(false);
                  }}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-accent-primary hover:opacity-90 rounded-full text-white flex items-center justify-center shadow-md z-10"
                  title="恢复完整播放器"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ----------------------------------------------------------------------- */}
      {/* PERSISTENT BOTTOM BAR — Portal 到 body，相对视口贴底（抬过 Tab） */}
      {/* ----------------------------------------------------------------------- */}
      {/* 全屏展开时隐藏底栏，避免与全屏层叠字/透出封面+曲名 */}
      {!isMiniMode &&
        !isExpanded &&
        typeof document !== "undefined" &&
        createPortal(
        <>
        <div
        data-global-music-ui
        style={playerAccentStyle}
        className={cn(
          "z-40 select-none transition-[transform,opacity,background-color,box-shadow,border-color] duration-panel overflow-hidden flex flex-col",
          // 移动 / 桌面统一：悬浮圆角 glass 条
          "fixed left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] mobile-music-mini rounded-2xl",
          "bg-app-elevated/92 backdrop-blur-md border border-app-border/50 shadow-xl",
          "supports-[backdrop-filter]:bg-app-elevated/78",
          "md:left-[calc(var(--nav-rail-width,0px)+var(--media-sidebar-width,0px)+1rem)] md:right-4 md:bottom-3",
          "md:rounded-2xl md:border md:border-app-border/60",
          "md:bg-[var(--color-elevated-solid,var(--color-elevated))] md:backdrop-blur-md",
          "md:shadow-[0_8px_32px_rgba(0,0,0,0.12)]",
        )}
      >
        {/* 顶进度：accent 来自封面主色 */}
        <div
          className="relative w-full h-3 shrink-0 group/seek touch-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute left-0 right-0 top-0 h-[3px] bg-app-border/70 dark:bg-white/10 overflow-hidden">
            <div
              className="h-full transition-[width] duration-75 ease-linear"
              style={{
                width: `${progressPct}%`,
                backgroundColor: coverAccent.solid,
              }}
            />
          </div>
          <div
            className={cn(
              "pointer-events-none absolute top-0 z-[1] -translate-x-1/2 -translate-y-[3px]",
              "w-2.5 h-2.5 rounded-full shadow-sm",
              "opacity-0 group-active/seek:opacity-100 md:group-hover/seek:opacity-100 transition-opacity",
              scrubTime != null && "opacity-100",
            )}
            style={{
              left: `${progressPct}%`,
              backgroundColor: coverAccent.solid,
              boxShadow: `0 0 0 2px ${coverAccent.shadow}`,
            }}
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

        {/* 单行：封面 | 控件 | 音量 — 主区域点击展开全屏（控件 stopPropagation） */}
        <div
          role="button"
          tabIndex={0}
          onClick={expandPlayer}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              expandPlayer();
            }
          }}
          className="flex items-center justify-between px-3 py-2.5 md:h-[64px] md:py-0 md:px-4 lg:px-5 gap-2 md:gap-3 min-w-0 cursor-pointer"
          aria-label="展开正在播放"
        >
          {/* Left: 圆角方封面（移动更清晰）+ 曲目信息 */}
          <div className="flex items-center gap-3 min-w-0 flex-1 md:max-w-[30%] lg:max-w-[32%] md:min-w-[180px] md:flex-none md:shrink-0">
            <div
              className={cn(
                "relative shrink-0 w-11 h-11 md:w-12 md:h-12 overflow-hidden shadow-md pointer-events-none",
                "rounded-xl md:rounded-full border border-app-border/50 bg-app-elevated",
              )}
            >
              <AudioCover
                item={currentMedia}
                src={blurCoverSrc || coverToUse || null}
                className={cn(
                  "w-full h-full object-cover select-none",
                  "md:rounded-full md:media-disc-spin",
                  !isPlaying && "md:media-disc-spin-paused",
                )}
                fallbackIconSize={16}
              />
              <div className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-app-elevated border border-app-border/60 shadow" />
            </div>

            <div className="flex flex-col min-w-0 gap-0.5 justify-center text-left flex-1 pointer-events-none">
              <span className="text-xs md:text-sm font-semibold text-tx-primary truncate">
                {currentMedia.title}
              </span>
              <span className="text-[10px] md:text-xs text-tx-tertiary truncate">
                {[displayArtist || "未知歌手", displayAlbum].filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>

          {/* Center: 仅播放控件，与封面垂直居中对齐 */}
          <div
            className="hidden md:flex flex-1 min-w-0 items-center justify-center gap-3 lg:gap-5 px-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={cyclePlayMode}
              className="p-1.5 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
              title={
                playMode === "sequence" ? "列表循环" : playMode === "random" ? "随机播放" : "单曲循环"
              }
            >
              {playMode === "random" && <Shuffle size={16} className="text-accent-primary" />}
              {playMode === "loop" && <Repeat1 size={16} className="text-accent-primary" />}
              {playMode === "sequence" && <Repeat size={16} />}
            </button>

            <button 
              onClick={prevMedia}
              className="p-1.5 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
              title="上一曲"
            >
              <SkipBack size={20} />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                isPlaying ? pauseMedia() : resumeMedia();
              }}
              className="w-10 h-10 rounded-full bg-accent-primary text-white flex items-center justify-center shadow-md shadow-accent-primary/25 [@media(hover:hover)_and_(pointer:fine)]:hover:scale-105 active:scale-95 transition-transform duration-press ease-out"
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
              className="p-1.5 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors"
              title="下一曲"
            >
              <SkipForward size={20} />
            </button>
          </div>

          {/* Right: 音量 | 播放列表 | 最小化 | 关闭 — 与封面垂直居中 */}
          <div
            className="flex items-center gap-1 sm:gap-1.5 md:gap-1.5 shrink-0 md:min-w-0 justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex md:hidden items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  isPlaying ? pauseMedia() : resumeMedia();
                }}
                className="w-11 h-11 min-w-11 min-h-11 rounded-full text-white flex items-center justify-center active:scale-[0.97] transition-transform duration-press ease-out shadow-md"
                style={{
                  backgroundColor: coverAccent.solid,
                  boxShadow: `0 6px 16px ${coverAccent.shadow}`,
                }}
                aria-label={isPlaying ? "暂停" : "播放"}
              >
                {loading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : isPlaying ? (
                  <Pause size={18} className="fill-white" />
                ) : (
                  <Play size={18} className="fill-white translate-x-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => nextMedia(false)}
                className="w-11 h-11 min-w-11 min-h-11 rounded-full bg-app-sidebar/80 border border-app-border text-tx-secondary flex items-center justify-center active:scale-[0.97] active:bg-app-hover transition-[transform,background-color] duration-press ease-out"
                aria-label="下一曲"
              >
                <SkipForward size={18} />
              </button>
            </div>

            <div className="hidden md:flex items-center gap-1.5 select-none pr-1.5 mr-0.5 border-r border-app-border/60">
              <button
                onClick={() => setMuted(!isMuted)}
                className="p-2 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0"
                title={isMuted || volume === 0 ? "取消静音" : "静音"}
              >
                {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="音量"
                className="w-20 lg:w-24 h-1.5 bg-app-border dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary outline-none"
              />
            </div>

            <button 
              onClick={() => setShowQueue(!showQueue)}
              className={cn(
                "hidden md:inline-flex p-2 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0",
                showQueue && "text-accent-primary bg-accent-primary/10",
              )}
              title="播放列表"
            >
              <ListMusic size={18} />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setUserForcedMini(true);
                setIsMiniMode(true);
              }}
              className="p-2 rounded-full text-tx-secondary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0"
              title="最小化为悬浮窗"
            >
              <Minimize2 size={16} />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                useMediaStore.getState().stopMedia();
              }}
              className="p-2 rounded-full text-tx-secondary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors shrink-0"
              title="关闭播放器"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      </div>
        </>,
          document.body,
        )}

      {/* Floating Queue Drawer — 底部 sheet，主题适配 */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {showQueue && (
              <>
                <div
                  data-global-music-ui
                  className={cn(
                    "fixed inset-0 z-[165]",
                    isExpanded ? "bg-black/40 dark:bg-black/55" : "bg-black/30 dark:bg-black/40 md:bg-transparent",
                  )}
                  onClick={() => setShowQueue(false)}
                />
                <motion.div
                  data-global-music-ui
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 40 }}
                  transition={springs.ui}
                  className={cn(
                    "fixed z-[170] flex flex-col overflow-hidden shadow-2xl",
                    "bg-[var(--color-elevated-solid,var(--color-elevated))] text-tx-primary border border-app-border",
                    isExpanded
                      ? "left-0 right-0 bottom-0 max-h-[min(72vh,560px)] w-full md:left-[var(--nav-rail-width,0px)] rounded-t-3xl"
                      : "bottom-[calc(var(--global-music-bar-height,76px)+8px)] right-3 md:right-4 left-3 md:left-auto w-auto md:w-[380px] max-h-[min(55vh,480px)] rounded-2xl",
                  )}
                  style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
                >
                  {/* 拖条 */}
                  <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                    <div className="w-10 h-1 rounded-full bg-app-border" />
                  </div>
                  <div className="flex items-center justify-between px-4 pb-2.5 border-b border-app-border select-none gap-2 shrink-0">
                    <span className="text-sm font-bold text-tx-primary flex items-center gap-2">
                      <ListMusic size={16} className="text-accent-primary" />
                      播放列表
                      <span className="text-xs font-medium text-tx-tertiary tabular-nums">
                        {playlist.length}
                      </span>
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
                          className="text-[11px] text-accent-danger hover:underline px-1"
                          title="一键移除全部（仅播放列表）"
                        >
                          清空
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowQueue(false)}
                        className="w-9 h-9 rounded-full flex items-center justify-center text-tx-tertiary hover:text-tx-primary hover:bg-app-hover"
                        aria-label="关闭"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-2 flex flex-col gap-0.5 min-h-0">
                    {playlist.length === 0 ? (
                      <p className="text-center text-sm text-tx-tertiary py-10">播放列表为空</p>
                    ) : (
                      playlist.map((item, idx) => {
                        const active = idx === currentIndex;
                        return (
                          <div
                            key={item.id + "-" + idx}
                            onClick={() => {
                              playMedia(item, playlist);
                            }}
                            className={cn(
                              "group/queue flex items-center gap-3 px-2.5 py-2.5 rounded-xl cursor-pointer transition-colors",
                              active
                                ? "bg-accent-primary/12"
                                : "hover:bg-app-hover active:bg-app-active",
                            )}
                          >
                            {/* 小封面 or 序号 */}
                            <div
                              className={cn(
                                "relative shrink-0 w-11 h-11 rounded-lg overflow-hidden border border-app-border bg-app-bg",
                                active && "ring-2 ring-accent-primary/50 border-transparent",
                              )}
                            >
                              {item.cover_url ? (
                                <img
                                  src={resolveAttachmentUrl(item.cover_url) || item.cover_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-tx-tertiary">
                                  <Music size={18} />
                                </div>
                              )}
                              {active && isPlaying && (
                                <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                                  <span className="flex gap-0.5 items-end h-3">
                                    <span className="w-0.5 h-2 bg-white rounded-full animate-pulse" />
                                    <span className="w-0.5 h-3 bg-white rounded-full animate-pulse [animation-delay:150ms]" />
                                    <span className="w-0.5 h-1.5 bg-white rounded-full animate-pulse [animation-delay:300ms]" />
                                  </span>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={cn(
                                  "truncate text-sm font-semibold",
                                  active ? "text-accent-primary" : "text-tx-primary",
                                )}
                              >
                                {item.title}
                              </p>
                              <p className="text-[11px] truncate text-tx-tertiary mt-0.5">
                                {[item.artist, item.album].filter(Boolean).join(" · ") || "未知歌手"}
                              </p>
                            </div>
                            {item.duration ? (
                              <span className="text-[11px] shrink-0 tabular-nums text-tx-tertiary group-hover/queue:hidden">
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
                              className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-tx-tertiary hover:text-accent-danger hover:bg-accent-danger/10 opacity-100 md:opacity-0 md:group-hover/queue:opacity-100 transition-opacity"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* ----------------------------------------------------------------------- */}
      {/* 全屏播放器：氛围底 portal 在 sheet 外（避免 transform 毁掉 CSS blur） */}
      {/* ----------------------------------------------------------------------- */}
      {/* 氛围底：body portal（sheet 下方）+ 下面 panel 内再叠一层，双保险 */}
      <CoverBlurBackdrop
        portal
        active={isExpanded}
        coverSrc={blurCoverSrc || coverToUse || null}
        fallbackGradient={noCoverGradient}
        zClassName="z-[159]"
      />

      <BottomSheet
            key={isExpanded ? "gmp-expanded" : "gmp-collapsed"}
            open={isExpanded}
            onClose={() => setIsExpanded(false)}
            hideClose
            hideHandle
            // 全屏：贴 visualViewport，避免 Android 100dvh 重开不满屏 / 手势弹回
            fullscreen
            zClassName="z-[160]"
            // 全屏播放器：内容区可下拉跟手关闭（DESIGN §13 流体手势）
            dragFromContent
            dismissFraction={0.2}
            dismissVelocity={720}
            className={cn(
              "rounded-none border-0 !bg-transparent",
              "md:max-w-[520px] md:mx-auto md:rounded-t-window md:border-x md:border-white/10",
            )}
            bodyClassName="flex flex-col min-h-0 h-full p-0 overflow-hidden !bg-transparent"
            // 移动端不要 scrim（会糊死氛围底）；桌面保留轻遮罩
            scrimClassName="!hidden md:!block md:bg-black/40"
          >
            <div
              data-global-music-ui
              data-global-player-panel
              className="relative flex flex-col flex-1 min-h-0 overflow-hidden text-white select-none !bg-transparent"
              style={playerAccentStyle}
            >
            {/* 面板内氛围底：不依赖 portal 透出（Android 实色 sheet 时仍可见） */}
            <CoverBlurBackdrop
              portal={false}
              active={isExpanded}
              coverSrc={blurCoverSrc || coverToUse || null}
              fallbackGradient={noCoverGradient}
              className="z-0"
            />

            {/* Header：安全区下沉 + 圆形返回遮罩；无顶部拖条 */}
            <div
              className="relative z-10 grid grid-cols-[44px_1fr_44px] items-center gap-2 px-3 sm:px-5 pb-2 min-h-[44px] bg-transparent"
              style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 12px)" }}
            >
              <button
                type="button"
                data-no-drag
                onClick={() => setIsExpanded(false)}
                className={cn(
                  "w-11 h-11 min-w-11 min-h-11 rounded-full flex items-center justify-center",
                  "text-white/95 bg-white/15 backdrop-blur-md border border-white/10",
                  "hover:bg-white/20 active:scale-[0.97] transition-[transform,background-color] duration-press ease-out",
                )}
                aria-label="收起"
              >
                <ChevronDown size={22} />
              </button>
              <div className="text-center min-w-0 px-1 flex items-center justify-center">
                <p className="text-[12px] sm:text-[13px] tracking-[0.12em] text-white/75 font-semibold truncate">
                  正在播放
                </p>
              </div>
              <button
                type="button"
                data-no-drag
                onClick={() => setShowQueue(true)}
                className={cn(
                  "hidden md:inline-flex w-11 h-11 min-w-11 min-h-11 justify-self-end rounded-full items-center justify-center",
                  "border border-white/10 transition-[transform,background-color,color] duration-fast ease-out",
                  showQueue
                    ? "text-white bg-white/20 backdrop-blur-md"
                    : "text-white/90 bg-white/15 backdrop-blur-md hover:bg-white/20",
                )}
                aria-label="播放列表"
              >
                <ListMusic size={20} />
              </button>
              <div className="md:hidden w-11 h-11" aria-hidden />
            </div>

            {/* Main column */}
            <div className="relative z-10 flex-1 flex flex-col min-h-0 w-full max-w-lg mx-auto px-6 sm:px-10">
              {/* 大圆形封面（与氛围底同源：ID3 / DB） */}
              <div className="shrink-0 flex flex-col items-center w-full pt-4 sm:pt-8">
                <div
                  className={cn(
                    "relative rounded-full flex items-center justify-center select-none overflow-hidden",
                    "w-[min(72vw,300px)] h-[min(72vw,300px)]",
                    "shadow-[0_24px_64px_rgba(0,0,0,0.45)]",
                    "ring-1 ring-white/12",
                  )}
                >
                  <AudioCover
                    item={currentMedia}
                    src={blurCoverSrc || coverToUse || null}
                    className={cn(
                      "w-full h-full object-cover select-none media-disc-spin",
                      !isPlaying && "media-disc-spin-paused",
                    )}
                    fallbackIconSize={56}
                  />
                </div>

                <div className="mt-8 text-center w-full px-1">
                  <h2 className="text-[1.4rem] sm:text-[1.65rem] font-bold text-white tracking-tight leading-tight line-clamp-2 drop-shadow-sm">
                    {currentMedia.title}
                  </h2>
                  <p className="text-[13px] sm:text-sm text-white/65 mt-2.5 truncate font-medium tracking-wide">
                    {[displayArtist || "未知歌手", displayAlbum].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              {/* 歌词限高 */}
              <div className="flex-1 min-h-0 max-h-[14vh] sm:max-h-[16vh] mt-3 mb-1">
                <MediaLyrics
                  lines={currentMedia.type === "audio" ? id3Meta?.lyrics : undefined}
                  plain={currentMedia.type === "audio" ? id3Meta?.lyricsPlain : undefined}
                  currentTime={progressValue}
                  className="h-full"
                  onSeek={(t) => {
                    triggerSeek(t);
                    resumeMedia();
                  }}
                />
              </div>

              {/* 控件区贴底（无音量条） */}
              <div
                className="shrink-0 flex flex-col gap-5 mt-auto pt-3"
                style={{ paddingBottom: "max(22px, var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)))" }}
                data-no-sheet-drag
              >
                <div className="flex flex-col gap-2.5" data-no-drag>
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
                    className="player-accent-range w-full h-4 outline-none cursor-pointer"
                    style={{ accentColor: coverAccent.solid }}
                    aria-label="播放进度"
                    data-no-drag
                  />
                  <div className="flex items-center justify-between text-[11px] text-white/55 select-none font-medium tabular-nums tracking-wide">
                    <span>{formatDuration(progressValue)}</span>
                    <span>{formatDuration(duration)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between px-0 sm:px-1">
                  <button
                    type="button"
                    onClick={cyclePlayMode}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 active:scale-[0.97] transition-[transform,background-color,color] duration-press ease-out"
                    title="播放模式"
                  >
                    {playMode === "random" && (
                      <Shuffle size={20} style={{ color: coverAccent.solid }} />
                    )}
                    {playMode === "loop" && (
                      <Repeat1 size={20} style={{ color: coverAccent.solid }} />
                    )}
                    {playMode === "sequence" && <Repeat size={20} />}
                  </button>

                  <button
                    type="button"
                    onClick={prevMedia}
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-[0.97] transition-transform duration-press ease-out"
                    aria-label="上一曲"
                  >
                    <SkipBack size={28} />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      isPlaying ? pauseMedia() : resumeMedia();
                    }}
                    className="w-[4.75rem] h-[4.75rem] rounded-full text-white flex items-center justify-center hover:opacity-95 active:scale-[0.97] transition-transform duration-press ease-out"
                    style={{
                      backgroundColor: coverAccent.solid,
                      boxShadow: `0 14px 36px ${coverAccent.shadow}`,
                    }}
                    aria-label={isPlaying ? "暂停" : "播放"}
                  >
                    {loading ? (
                      <Loader2 size={30} className="animate-spin" />
                    ) : isPlaying ? (
                      <Pause size={30} className="fill-white" />
                    ) : (
                      <Play size={30} className="fill-white translate-x-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => nextMedia(false)}
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white hover:bg-white/10 active:scale-90 transition-transform duration-press ease-out"
                  >
                    <SkipForward size={28} />
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowQueue(true)}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out md:hidden"
                    title="播放列表"
                  >
                    <ListMusic size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMuted(!isMuted)}
                    className="w-11 h-11 rounded-full flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out hidden md:flex"
                  >
                    {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                  </button>
                </div>
              </div>
            </div>

            </div>
          </BottomSheet>

        </>
      )}
    </>
  );
}
