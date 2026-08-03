// 轻量级 Toast 系统：事件总线 + 单例 Toaster 组件消费
// 不依赖第三方库，支持 success / error / info / warning 四种类型
// plans/004: interruptible enter/exit via CSS transition (exiting flag)

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  duration: number;
  /** set true before remove so Toaster can play exit transition */
  exiting?: boolean;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let seq = 1;
const listeners = new Set<Listener>();

/** exit animation duration — match --duration-normal (220ms) */
const EXIT_MS = 220;

function emit() {
  const snapshot = items.slice();
  listeners.forEach((l) => l(snapshot));
}

function removeNow(id: number) {
  items = items.filter((it) => it.id !== id);
  emit();
}

function remove(id: number) {
  const target = items.find((it) => it.id === id);
  if (!target || target.exiting) return;
  items = items.map((it) => (it.id === id ? { ...it, exiting: true } : it));
  emit();
  window.setTimeout(() => removeNow(id), EXIT_MS);
}

function push(type: ToastType, message: string, duration = 2800): number {
  const id = seq++;
  items = [...items, { id, type, message, duration, exiting: false }];
  emit();
  if (duration > 0) {
    window.setTimeout(() => remove(id), duration);
  }
  return id;
}

export const toast = {
  success: (message: string, duration?: number) => push("success", message, duration),
  error: (message: string, duration?: number) => push("error", message, duration),
  info: (message: string, duration?: number) => push("info", message, duration),
  warning: (message: string, duration?: number) => push("warning", message, duration),
  dismiss: (id: number) => remove(id),
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(items.slice());
  return () => {
    listeners.delete(listener);
  };
}
