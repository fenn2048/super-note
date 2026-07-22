import { create } from "zustand";

export interface MediaPlayItem {
  id: string;
  title: string;
  type: "video" | "audio";
  alist_path: string;
  artist?: string;
  album?: string;
  cover_url?: string;
  duration?: number;
  /**
   * 视频以「仅音频」模式走全局播放器（耳机模式）。
   * type 仍为 video，便于 UI 区分；GlobalMusicPlayer 据此放行。
   */
  audioOnly?: boolean;
}

export type PlayMode = "sequence" | "random" | "loop";

/** 是否应由全局底部播放器接管（纯音频，或视频仅听） */
export function isGlobalPlayerItem(m: MediaPlayItem | null | undefined): boolean {
  if (!m) return false;
  return m.type === "audio" || (m.type === "video" && !!m.audioOnly);
}

export interface MediaState {
  isPlaying: boolean;
  currentMedia: MediaPlayItem | null;
  currentTime: number; // in seconds
  duration: number; // in seconds
  seekTime: number | null; // in seconds, set to trigger player to seek, player should reset it to null after processing
  volume: number; // 0 to 1
  isMuted: boolean;
  playlist: MediaPlayItem[];
  currentIndex: number;
  playMode: PlayMode;

  // Actions
  playMedia: (media: MediaPlayItem, list?: MediaPlayItem[]) => void;
  /**
   * 视频耳机模式：以 audioOnly 写入 store，并可选从 startAt 秒起播。
   * 默认播放列表仅含当前条目（不自动连播其它视频）。
   */
  playAsAudioOnly: (
    media: MediaPlayItem,
    opts?: { startAt?: number; list?: MediaPlayItem[] },
  ) => void;
  pauseMedia: () => void;
  resumeMedia: () => void;
  stopMedia: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  triggerSeek: (time: number) => void;
  resetSeek: () => void;
  setVolume: (volume: number) => void;
  setMuted: (isMuted: boolean) => void;
  setPlaylist: (list: MediaPlayItem[]) => void;
  setPlayMode: (mode: PlayMode) => void;
  nextMedia: (auto?: boolean) => void;
  prevMedia: () => void;
  /** 仅从播放队列移除，不删除媒体文件 */
  removeFromPlaylist: (index: number) => void;
  /** 清空播放队列（不删文件）；停止当前播放 */
  clearPlaylist: () => void;
  /** 合并更新当前曲目的元数据（歌手/专辑/时长等） */
  patchCurrentMedia: (patch: Partial<MediaPlayItem>) => void;
}

function withAudioOnlyFlag(item: MediaPlayItem, audioOnly: boolean): MediaPlayItem {
  if (!audioOnly) {
    if (!item.audioOnly) return item;
    const { audioOnly: _drop, ...rest } = item;
    return rest as MediaPlayItem;
  }
  return { ...item, audioOnly: true };
}

export const useMediaStore = create<MediaState>()((set, get) => ({
  isPlaying: false,
  currentMedia: null,
  currentTime: 0,
  duration: 0,
  seekTime: null,
  volume: 0.8,
  isMuted: false,
  playlist: [],
  currentIndex: -1,
  playMode: "sequence",

  playMedia: (media, list = []) => {
    // 普通 play 清掉 audioOnly，避免「点列表播视频」误进全局仅听
    const clean = withAudioOnlyFlag(media, false);
    const rawList = list.length > 0 ? list : [clean];
    const playlist = rawList.map((it) => withAudioOnlyFlag(it, false));
    const index = playlist.findIndex((item) => item.id === clean.id);
    set({
      currentMedia: clean,
      playlist,
      currentIndex: index >= 0 ? index : 0,
      isPlaying: true,
      currentTime: 0,
      duration: clean.duration || 0,
      seekTime: null,
    });
  },

  playAsAudioOnly: (media, opts) => {
    const startAt = opts?.startAt != null && opts.startAt > 0 ? opts.startAt : 0;
    const item = withAudioOnlyFlag(
      {
        ...media,
        type: media.type === "video" ? "video" : media.type,
      },
      true,
    );
    // MVP：仅听模式默认单曲列表，避免 next 切到未标记 audioOnly 的视频
    const rawList =
      opts?.list && opts.list.length > 0
        ? opts.list.map((it) => withAudioOnlyFlag(it, true))
        : [item];
    const index = rawList.findIndex((x) => x.id === item.id);
    set({
      currentMedia: item,
      playlist: rawList,
      currentIndex: index >= 0 ? index : 0,
      isPlaying: true,
      currentTime: startAt,
      duration: item.duration || 0,
      // 交给 GlobalMusicPlayer 的 seek effect 落地到 <audio>
      seekTime: startAt > 0 ? startAt : null,
    });
  },

  pauseMedia: () => set({ isPlaying: false }),
  resumeMedia: () => set({ isPlaying: true }),
  stopMedia: () =>
    set({
      isPlaying: false,
      currentMedia: null,
      currentTime: 0,
      duration: 0,
      playlist: [],
      currentIndex: -1,
      seekTime: null,
    }),

  setCurrentTime: (time) => set({ currentTime: time }),
  setDuration: (duration) => set({ duration }),
  triggerSeek: (time) => set({ seekTime: time }),
  resetSeek: () => set({ seekTime: null }),
  setVolume: (volume) => set({ volume }),
  setMuted: (isMuted) => set({ isMuted }),
  setPlaylist: (playlist) => set({ playlist }),
  setPlayMode: (playMode) => set({ playMode }),

  removeFromPlaylist: (index) => {
    const { playlist, currentIndex, currentMedia } = get();
    if (index < 0 || index >= playlist.length) return;

    const nextList = playlist.filter((_, i) => i !== index);
    if (nextList.length === 0) {
      set({
        playlist: [],
        currentIndex: -1,
        currentMedia: null,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
      });
      return;
    }

    // 删的是当前曲：切到同 index（原下一首）或末尾
    if (index === currentIndex) {
      const newIndex = Math.min(index, nextList.length - 1);
      const nextItem = nextList[newIndex];
      set({
        playlist: nextList,
        currentIndex: newIndex,
        currentMedia: nextItem,
        isPlaying: true,
        currentTime: 0,
        duration: nextItem.duration || 0,
        seekTime: null,
      });
      return;
    }

    // 删的是当前之前的曲，currentIndex 需前移
    const newCurrentIndex = index < currentIndex ? currentIndex - 1 : currentIndex;
    set({
      playlist: nextList,
      currentIndex: newCurrentIndex,
      currentMedia:
        currentMedia && nextList.some((p) => p.id === currentMedia.id)
          ? currentMedia
          : nextList[newCurrentIndex] || null,
    });
  },

  clearPlaylist: () => {
    set({
      playlist: [],
      currentIndex: -1,
      currentMedia: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      seekTime: null,
    });
  },

  patchCurrentMedia: (patch) => {
    const { currentMedia, playlist, currentIndex } = get();
    if (!currentMedia) return;
    const updated = { ...currentMedia, ...patch };
    const nextPlaylist = playlist.map((item, i) =>
      i === currentIndex || item.id === currentMedia.id ? { ...item, ...patch } : item,
    );
    set({
      currentMedia: updated,
      playlist: nextPlaylist,
      ...(patch.duration != null ? { duration: patch.duration } : {}),
    });
  },

  nextMedia: (auto = false) => {
    const { playlist, currentIndex, playMode } = get();
    if (playlist.length === 0 || currentIndex === -1) return;

    let nextIndex = currentIndex;

    // Handle auto end vs manual skip
    if (auto && playMode === "loop") {
      // Replay current song
      set({
        currentTime: 0,
        seekTime: 0,
        isPlaying: true,
      });
      return;
    }

    if (playMode === "random") {
      if (playlist.length > 1) {
        while (nextIndex === currentIndex) {
          nextIndex = Math.floor(Math.random() * playlist.length);
        }
      } else {
        nextIndex = 0;
      }
    } else {
      nextIndex = (currentIndex + 1) % playlist.length;
    }

    const nextMediaItem = playlist[nextIndex];
    // 若当前队列是仅听视频，保持 audioOnly 标记
    const cur = get().currentMedia;
    const keepAudioOnly = !!(cur?.audioOnly && nextMediaItem.type === "video");
    const item = withAudioOnlyFlag(nextMediaItem, keepAudioOnly || !!nextMediaItem.audioOnly);

    set({
      currentMedia: item,
      currentIndex: nextIndex,
      isPlaying: true,
      currentTime: 0,
      duration: item.duration || 0,
      seekTime: null,
    });
  },

  prevMedia: () => {
    const { playlist, currentIndex, playMode, currentMedia } = get();
    if (playlist.length === 0 || currentIndex === -1) return;

    let prevIndex = currentIndex;

    if (playMode === "random") {
      if (playlist.length > 1) {
        while (prevIndex === currentIndex) {
          prevIndex = Math.floor(Math.random() * playlist.length);
        }
      } else {
        prevIndex = 0;
      }
    } else {
      prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
    }

    const prevMediaItem = playlist[prevIndex];
    const keepAudioOnly = !!(currentMedia?.audioOnly && prevMediaItem.type === "video");
    const item = withAudioOnlyFlag(prevMediaItem, keepAudioOnly || !!prevMediaItem.audioOnly);

    set({
      currentMedia: item,
      currentIndex: prevIndex,
      isPlaying: true,
      currentTime: 0,
      duration: item.duration || 0,
      seekTime: null,
    });
  },
}));
