/**
 * 工作区功能开关单例（避免 NavRail / TabBar / More 各自 fetch）
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { WorkspaceFeatures } from "@/types";
import { api, getCurrentWorkspace } from "@/lib/api";

interface WorkspaceFeaturesState {
  features: WorkspaceFeatures | null;
  packTick: number;
  loading: boolean;
  load: () => Promise<void>;
  bumpPack: () => void;
  /** 挂载全局事件订阅；返回卸载函数 */
  subscribeGlobal: () => () => void;
}

export const useWorkspaceFeaturesStore = create<WorkspaceFeaturesState>((set, get) => ({
  features: null,
  packTick: 0,
  loading: false,

  load: async () => {
    const ws = getCurrentWorkspace();
    if (!ws || ws === "personal") {
      set({ features: null, loading: false });
      return;
    }
    set({ loading: true });
    try {
      const features = await api.getWorkspaceFeatures(ws);
      set({ features, loading: false });
    } catch {
      set({ features: null, loading: false });
    }
  },

  bumpPack: () => set((s) => ({ packTick: s.packTick + 1 })),

  subscribeGlobal: () => {
    const reload = () => {
      void get().load();
    };
    const onPack = () => get().bumpPack();
    window.addEventListener("super:workspace-changed", reload);
    window.addEventListener("super:workspace-features-changed", reload);
    window.addEventListener("super:module-pack-changed", onPack);
    void get().load();
    return () => {
      window.removeEventListener("super:workspace-changed", reload);
      window.removeEventListener("super:workspace-features-changed", reload);
      window.removeEventListener("super:module-pack-changed", onPack);
    };
  },
}));

/** 在 App 壳挂一次即可；子组件只读 features / packTick */
export function useWorkspaceFeaturesBootstrap() {
  const subscribeGlobal = useWorkspaceFeaturesStore((s) => s.subscribeGlobal);
  const features = useWorkspaceFeaturesStore((s) => s.features);
  const packTick = useWorkspaceFeaturesStore((s) => s.packTick);

  useEffect(() => subscribeGlobal(), [subscribeGlobal]);

  return { features, packTick };
}

/** 只读订阅（假定壳已 bootstrap） */
export function useWorkspaceFeatures() {
  const features = useWorkspaceFeaturesStore((s) => s.features);
  const packTick = useWorkspaceFeaturesStore((s) => s.packTick);
  return { features, packTick };
}
