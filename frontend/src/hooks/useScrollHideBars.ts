/**
 * PR5：统一滚动隐栏
 * 向下滚 → super:scroll-hide-bars（藏 Tab / FAB / TopBar）
 * 向上滚或到顶 → super:scroll-show-bars
 *
 * 兼容原生 overflow 容器与 Radix ScrollArea viewport。
 */
import { useEffect, type RefObject } from "react";

export function dispatchShowBars() {
  try {
    window.dispatchEvent(new CustomEvent("super:scroll-show-bars"));
  } catch { /* ignore */ }
}

export function dispatchHideBars() {
  try {
    window.dispatchEvent(new CustomEvent("super:scroll-hide-bars"));
  } catch { /* ignore */ }
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

  const threshold = options?.threshold ?? 8;
  let lastScrollTop = viewport.scrollTop;
  let ticking = false;

  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const st = viewport.scrollTop;
      if (st <= 2) {
        dispatchShowBars();
      } else if (st > lastScrollTop + threshold) {
        dispatchHideBars();
      } else if (st < lastScrollTop - threshold) {
        dispatchShowBars();
      }
      lastScrollTop = st;
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
