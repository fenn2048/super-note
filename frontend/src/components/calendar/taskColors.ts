import { TASK_COLOR_MAP } from "@/components/ProjectKanban";
import type { CSSProperties } from "react";

export const CAL_COLOR_KEYS = Object.keys(TASK_COLOR_MAP);

/** Default chip color when creating from calendar */
export const DEFAULT_CAL_COLOR = "blue";

/** Stable palette pick from a string seed. */
export function hashPickColorKey(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return CAL_COLOR_KEYS[h % CAL_COLOR_KEYS.length] || "blue";
}

/**
 * Prefer explicit task titleColor; otherwise derive a stable color from id/project
 * so chips don't all look identical in the calendar.
 */
export function resolveTaskColorKey(task: {
  id?: string;
  titleColor?: string | null;
  projectId?: string;
  title?: string;
}): string {
  if (task.titleColor && TASK_COLOR_MAP[task.titleColor]) {
    return task.titleColor;
  }
  return hashPickColorKey(task.id || `${task.projectId || ""}:${task.title || ""}` || "task");
}

/** Rotate through palette for newly created calendar tasks. */
let createColorCursor = 0;
export function nextCreateColorKey(): string {
  const key = CAL_COLOR_KEYS[createColorCursor % CAL_COLOR_KEYS.length] || "blue";
  createColorCursor += 1;
  return key;
}

function withAlpha(hex: string, alphaHex: string): string {
  // #rrggbb + aa
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return `${hex}${alphaHex}`;
  return hex;
}

export type TaskBlockVisual = {
  style?: CSSProperties;
  className?: string;
};

/**
 * Visual style for calendar task chips / timed blocks.
 * Completed tasks use a muted green; others use distinct color blocks.
 */
export function taskBlockVisual(
  task: {
    id?: string;
    titleColor?: string | null;
    projectId?: string;
    title?: string;
    isCompleted?: number;
  },
  opts?: { dense?: boolean },
): TaskBlockVisual {
  if (task.isCompleted === 1) {
    return {
      className:
        "bg-green-500/10 border-green-500/25 text-green-600 dark:text-green-400 line-through decoration-green-600/50",
    };
  }

  const key = resolveTaskColorKey(task);
  const c = TASK_COLOR_MAP[key] || TASK_COLOR_MAP.blue;
  const font = c.font;

  return {
    style: {
      backgroundColor: withAlpha(font, opts?.dense ? "28" : "33"),
      borderColor: withAlpha(font, "66"),
      color: font,
      // Left accent bar (macOS-like event chip)
      boxShadow: `inset 3px 0 0 0 ${font}`,
    },
  };
}
