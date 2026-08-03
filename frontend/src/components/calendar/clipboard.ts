import { useCallback, useEffect, useState } from "react";
import type { TaskClipboard } from "./types";

/**
 * Module-level clipboard survives ProjectCalendar remounts
 * (parent soft-refresh used to wipe React state mid-cut).
 */
let taskClipboardStore: TaskClipboard | null = null;
const clipboardListeners = new Set<() => void>();

export function getTaskClipboard() {
  return taskClipboardStore;
}

export function setTaskClipboardStore(next: TaskClipboard | null) {
  taskClipboardStore = next;
  clipboardListeners.forEach((fn) => fn());
}

export function useTaskClipboard() {
  const [clip, setClip] = useState<TaskClipboard | null>(() => getTaskClipboard());
  useEffect(() => {
    const sync = () => setClip(getTaskClipboard());
    clipboardListeners.add(sync);
    sync();
    return () => {
      clipboardListeners.delete(sync);
    };
  }, []);
  const setClipboard = useCallback((next: TaskClipboard | null) => {
    setTaskClipboardStore(next);
  }, []);
  return [clip, setClipboard] as const;
}
