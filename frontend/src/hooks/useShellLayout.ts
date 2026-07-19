/**
 * 壳层布局探测（Phase D）
 * - 分屏 / 矮屏 / 折叠：data-shell-compact
 * - 系统大字体：data-text-scale（WebView 根字号相对 16 的倍率）
 */
import { useEffect } from "react";
import { isNativePlatform } from "@/hooks/useCapacitor";

const COMPACT_MAX_HEIGHT = 520;
const COMPACT_MAX_WIDTH = 420;

function measureTextScale(): number {
  try {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;visibility:hidden;font-size:1rem;width:1rem;height:1rem;padding:0;margin:0;border:0;";
    document.body.appendChild(el);
    const px = el.getBoundingClientRect().height || 16;
    document.body.removeChild(el);
    return Math.round((px / 16) * 100) / 100;
  } catch {
    return 1;
  }
}

function applyShellAttrs() {
  const root = document.documentElement;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const compact =
    h <= COMPACT_MAX_HEIGHT || (w <= COMPACT_MAX_WIDTH && h <= 640);
  if (compact) {
    root.setAttribute("data-shell-compact", "1");
  } else {
    root.removeAttribute("data-shell-compact");
  }

  const scale = measureTextScale();
  root.style.setProperty("--text-scale", String(scale));
  if (scale >= 1.15) {
    root.setAttribute("data-text-scale", scale >= 1.35 ? "xl" : "lg");
  } else {
    root.removeAttribute("data-text-scale");
  }

  // 分屏：宽高比异常或高度明显小于屏幕
  try {
    const sh = window.screen?.height || h;
    if (h < sh * 0.72 && h < 700) {
      root.setAttribute("data-shell-split", "1");
    } else {
      root.removeAttribute("data-shell-split");
    }
  } catch {
    /* ignore */
  }
}

/** 挂在 AppLayout：resize / orientation 更新壳层 data-* */
export function useShellLayout() {
  useEffect(() => {
    applyShellAttrs();
    const onResize = () => applyShellAttrs();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    // 原生：系统字体设置变更后 WebView 可能不立刻 resize，定时轻量校准
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isNativePlatform()) {
      timer = setInterval(applyShellAttrs, 8000);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
      if (timer) clearInterval(timer);
    };
  }, []);
}
