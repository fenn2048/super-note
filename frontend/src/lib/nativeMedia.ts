/**
 * Android 音频前台服务（MediaPlayback 插件）
 * 与 GlobalMusicPlayer 的 HTMLAudio + mediaSession 互补：
 *   - Web mediaSession：部分机型锁屏可用
 *   - 本插件：FGS mediaPlayback + 通知栏按钮，后台不易被杀
 */
import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform } from "@/hooks/useCapacitor";

export type MediaAction = "play" | "pause" | "next" | "prev" | "stop";

interface MediaPlaybackPlugin {
  update(opts: {
    title: string;
    artist?: string;
    isPlaying: boolean;
  }): Promise<{ ok: boolean }>;
  stop(): Promise<{ ok: boolean }>;
  addListener(
    eventName: "mediaAction",
    listener: (ev: { action: MediaAction }) => void,
  ): Promise<PluginListenerHandle>;
}

function getPlugin(): MediaPlaybackPlugin | null {
  if (!isNativePlatform()) return null;
  try {
    if ((window as any).Capacitor?.getPlatform?.() !== "android") return null;
    return registerPlugin<MediaPlaybackPlugin>("MediaPlayback");
  } catch {
    return null;
  }
}

export async function updateNativeMediaSession(opts: {
  title: string;
  artist?: string;
  isPlaying: boolean;
}): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.update({
      title: opts.title || "未知曲目",
      artist: opts.artist || "",
      isPlaying: opts.isPlaying,
    });
  } catch (e) {
    console.warn("[nativeMedia] update failed", e);
  }
}

export async function stopNativeMediaSession(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.stop();
  } catch (e) {
    console.warn("[nativeMedia] stop failed", e);
  }
}

export function subscribeNativeMediaActions(
  onAction: (action: MediaAction) => void,
): () => void {
  const p = getPlugin();
  if (!p) return () => {};
  let handle: PluginListenerHandle | null = null;
  void p
    .addListener("mediaAction", (ev) => {
      if (ev?.action) onAction(ev.action);
    })
    .then((h) => {
      handle = h;
    })
    .catch(() => {});
  return () => {
    void handle?.remove();
  };
}
