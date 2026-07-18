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
}

export type PlayMode = "sequence" | "random" | "loop";

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
    const playlist = list.length > 0 ? list : [media];
    const index = playlist.findIndex((item) => item.id === media.id);
    set({
      currentMedia: media,
      playlist,
      currentIndex: index >= 0 ? index : 0,
      isPlaying: true,
      currentTime: 0,
      duration: media.duration || 0,
      seekTime: null,
    });
  },

  pauseMedia: () => set({ isPlaying: false }),
  resumeMedia: () => set({ isPlaying: true }),
  stopMedia: () => set({ isPlaying: false, currentMedia: null, currentTime: 0, duration: 0, playlist: [], currentIndex: -1 }),

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
      currentMedia: currentMedia && nextList.some((p) => p.id === currentMedia.id)
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
      i === currentIndex || item.id === currentMedia.id ? { ...item, ...patch } : item
    );
    set({
      currentMedia: updated,
      playlist: nextPlaylist,
      ...(patch.duration != null ? { duration: patch.duration } : {}),
    });
  },

  nextMedia: (auto = false) => {
    const { playlist, currentIndex, playMode, currentMedia } = get();
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
    set({
      currentMedia: nextMediaItem,
      currentIndex: nextIndex,
      isPlaying: true,
      currentTime: 0,
      duration: nextMediaItem.duration || 0,
      seekTime: null,
    });
  },

  prevMedia: () => {
    const { playlist, currentIndex, playMode } = get();
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
    set({
      currentMedia: prevMediaItem,
      currentIndex: prevIndex,
      isPlaying: true,
      currentTime: 0,
      duration: prevMediaItem.duration || 0,
      seekTime: null,
    });
  },
}));
