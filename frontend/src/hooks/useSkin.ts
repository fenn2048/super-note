/**
 * Skin system removed (v2.5+): only light/dark theme remains (next-themes).
 * This module stays as a no-op shim so old imports don't crash.
 * Prefer ThemeToggle / useTheme from next-themes.
 */

import { useCallback, useEffect } from "react";

/** @deprecated skins removed — only light/dark */
export type Skin = "default";

export const SKIN_STORAGE_KEY = "super-note-skin";

function clearSkinDom() {
  try {
    document.documentElement.removeAttribute("data-skin");
    localStorage.removeItem(SKIN_STORAGE_KEY);
    // legacy values
    localStorage.removeItem("super-note-skin");
  } catch {
    /* ignore */
  }
}

/**
 * @deprecated No-op. Skins removed; use next-themes light/dark only.
 */
export function useSkin(): {
  skin: Skin;
  setSkin: (next: Skin) => void;
  skins: readonly Skin[];
} {
  useEffect(() => {
    clearSkinDom();
  }, []);

  const setSkin = useCallback((_next: Skin) => {
    clearSkinDom();
  }, []);

  return { skin: "default", setSkin, skins: ["default"] as const };
}
