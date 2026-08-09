/**
 * 任务生命周期（用户可见三态）
 * ---------------------------------------------------------------------------
 * 底层仍可能同时有 stageName（看板列）与 status（pending/in_progress/paused），
 * 对用户只暴露：
 *   未开始 · 进行中（含暂停角标）· 已完成
 */
import type { ProjectTask } from "@/types";

export type TaskLifeState = "not_started" | "in_progress" | "completed";

const NOT_STARTED_STAGES = new Set(["待启动", "待规划"]);

export function getStageName(task: ProjectTask | { stageName?: string | null }): string {
  return String((task as { stageName?: string | null }).stageName || "");
}

/** 用户可见三态 */
export function getTaskLifeState(task: ProjectTask): TaskLifeState {
  if (Number(task.isCompleted) === 1 || getStageName(task) === "已完成") {
    return "completed";
  }
  const stage = getStageName(task);
  if (NOT_STARTED_STAGES.has(stage)) {
    return "not_started";
  }
  // 含 paused：仍算「进行中」，UI 用徽章区分
  return "in_progress";
}

export function isTaskNotStarted(task: ProjectTask): boolean {
  return getTaskLifeState(task) === "not_started";
}

export function isTaskPaused(task: ProjectTask): boolean {
  return getTaskLifeState(task) === "in_progress" && task.status === "paused";
}

export function isTaskInProgressActive(task: ProjectTask): boolean {
  return getTaskLifeState(task) === "in_progress" && task.status !== "paused";
}

export function lifeStateLabel(state: TaskLifeState): string {
  if (state === "not_started") return "未开始";
  if (state === "completed") return "已完成";
  return "进行中";
}

/** 列表/按钮文案 */
export const LIFE_COPY = {
  notStarted: "未开始",
  inProgress: "进行中",
  completed: "已完成",
  paused: "已暂停",
  start: "开始",
  resume: "恢复",
  pause: "暂停",
  complete: "完成",
  reopen: "标为未完成",
} as const;
