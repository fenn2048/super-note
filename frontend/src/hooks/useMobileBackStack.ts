/**
 * 移动端统一返回栈（PR2）
 *
 * 任意浮层 / 子页在挂载（或 active）时 register，Android 返回键 / Escape 按
 * priority 从高到低 dismiss 一层。未处理时由 useMobileBackButton 做「再按退出」。
 *
 * 约定 priority（建议，非强制）：
 *   1000  全屏屏保 / 强打断
 *    900  设置、命令面板
 *    800  撰写/相机/任务创建等业务 modal
 *    700  其它临时浮层
 *    600  侧栏抽屉
 *    500  笔记编辑器
 *    400  书籍阅读 / 媒体全屏
 *    350  项目详情
 *    200  从「更多」进入的子页
 */
import { useEffect, useRef } from "react";

export type BackLayer = {
  id: string;
  priority: number;
  dismiss: () => void;
};

const layers = new Map<string, BackLayer>();

/** 注册一层；返回 unregister。同 id 重复注册会覆盖。 */
export function registerBackLayer(
  id: string,
  dismiss: () => void,
  priority = 100
): () => void {
  layers.set(id, { id, priority, dismiss });
  return () => {
    // 仅卸载「本次」注册，避免 effect 重跑时旧 cleanup 误删新层
    const cur = layers.get(id);
    if (cur?.dismiss === dismiss) {
      layers.delete(id);
    }
  };
}

/** dismiss 当前最顶层；有层则 true */
export function tryDismissTopBackLayer(): boolean {
  if (layers.size === 0) return false;
  let top: BackLayer | null = null;
  for (const layer of layers.values()) {
    if (!top || layer.priority > top.priority) top = layer;
  }
  if (!top) return false;
  try {
    top.dismiss();
  } catch (err) {
    console.error("[mobileBackStack] dismiss failed:", top.id, err);
  }
  return true;
}

/** 调试 / 测试用 */
export function getBackLayerIds(): string[] {
  return [...layers.values()]
    .sort((a, b) => b.priority - a.priority)
    .map((l) => l.id);
}

/**
 * 组件声明式注册返回层。
 * active=false 时不注册；dismiss 经 ref 保持最新，无需放进 effect deps。
 */
export function useRegisterBackLayer(
  id: string,
  active: boolean,
  dismiss: () => void,
  priority = 100
): void {
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  useEffect(() => {
    if (!active) return;
    const stableDismiss = () => {
      dismissRef.current();
    };
    return registerBackLayer(id, stableDismiss, priority);
  }, [id, active, priority]);
}
