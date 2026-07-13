import { create } from "zustand";

export interface MediaPlayItem {
  id: string;
  title: string;
  type: "video" | "audio";
  alist_path: string;
  artist?: string;
  cover_url?: string;
  duration?: number;
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
  nextMedia: () => void;
  prevMedia: () => void;
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

  nextMedia: () => {
    const { playlist, currentIndex } = get();
    if (playlist.length === 0 || currentIndex === -1) return;
    const nextIndex = (currentIndex + 1) % playlist.length;
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
    const { playlist, currentIndex } = get();
    if (playlist.length === 0 || currentIndex === -1) return;
    const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
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
