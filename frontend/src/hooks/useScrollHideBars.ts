/**
 * PR5：统一滚动隐栏
 * 向下滚 → super:scroll-hide-bars（藏 Tab / FAB / TopBar，并收起内容底避让）
 * 向上滚或到顶 → super:scroll-show-bars
 *
 * 兼容原生 overflow 容器与 Radix ScrollArea viewport。
 *
 * 防闪烁：
 *  - 方向阈值 + 冷却，避免微抖 / 布局回流来回切换
 *  - 同一状态不重复派发事件
 *  - 内容区 --mobile-tab-h 随隐栏联动（App.tsx），隐栏后列表可占满原 Tab 区；
 *    冷却期内忽略反向滚动，减轻 padding 变化引发的误触发
 */
import { useEffect, type RefObject } from "react";

/** 当前已对外宣称的栏显隐（模块级，跨 hook 实例共享） */
let barsAnnouncedVisible = true;
/** 冷却截止时间戳，期间忽略方向翻转 */
let cooldownUntil = 0;

const DEFAULT_THRESHOLD = 16;
/** 状态切换后最短锁定 ms，防止橡皮筋/回流抖动 */
const COOLDOWN_MS = 280;

export function dispatchShowBars(force = false) {
  if (!force && barsAnnouncedVisible) return;
  barsAnnouncedVisible = true;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  try {
    window.dispatchEvent(new CustomEvent("super:scroll-show-bars"));
  } catch { /* ignore */ }
}

export function dispatchHideBars() {
  if (!barsAnnouncedVisible) return;
  barsAnnouncedVisible = false;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  try {
    window.dispatchEvent(new CustomEvent("super:scroll-hide-bars"));
  } catch { /* ignore */ }
}

/** 切页 / 打开设置时强制恢复底栏并重置内部状态 */
export function resetScrollHideBars() {
  dispatchShowBars(true);
}

function resolveScrollEl(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  if (root.hasAttribute("data-radix-scroll-area-viewport")) return root;
  const vp = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
  return vp || root;
}

/**
 * 在元素上挂滚动隐栏；返回清理函数。
 * element 可为 ScrollArea root 或任意 overflow 容器。
 */
export function attachScrollHideBars(
  element: HTMLElement | null,
  options?: { threshold?: number }
): () => void {
  const viewport = resolveScrollEl(element);
  if (!viewport) return () => {};

  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  let lastScrollTop = viewport.scrollTop;
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const st = viewport.scrollTop;
      const delta = st - lastScrollTop;
      lastScrollTop = st;

      // 到顶强制显示（不受冷却限制，体验更稳）
      if (st <= 4) {
        dispatchShowBars();
        ticking = false;
        return;
      }

      // 冷却期内忽略方向翻转，避免往上/往下微抖闪烁
      if (Date.now() < cooldownUntil) {
        ticking = false;
        return;
      }

      if (delta > threshold) {
        // 内容向下滚（手指上滑）→ 藏栏
        dispatchHideBars();
      } else if (delta < -threshold) {
        // 内容向上滚（手指下滑）→ 显栏
        dispatchShowBars();
      }
      ticking = false;
    });
  };

  viewport.addEventListener("scroll", onScroll, { passive: true });
  return () => viewport.removeEventListener("scroll", onScroll);
}

/**
 * React 声明式：ref 指向滚动容器（或 ScrollArea root）。
 * deps 用于列表切换后重新绑定（viewport 可能重建）。
 */
export function useScrollHideBars(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  deps: readonly unknown[] = []
) {
  useEffect(() => {
    if (!enabled) {
      dispatchShowBars();
      return;
    }
    // 等一帧，确保 Radix viewport 已挂载
    let detach: (() => void) | undefined;
    const id = window.requestAnimationFrame(() => {
      detach = attachScrollHideBars(ref.current);
    });
    return () => {
      window.cancelAnimationFrame(id);
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ref, ...deps]);
}
