/**
 * 任务四象限（艾森豪威尔：重要 × 紧急）
 * isImportant / isUrgent：1 | 0 | null（null = 未归类）
 */

export type TriBool = 0 | 1 | null;
export type QuadrantId = "q1" | "q2" | "q3" | "q4";
export type QuadrantFilter = QuadrantId | "uncategorized" | "all";

export type QuadrantFlags = {
  isImportant: TriBool;
  isUrgent: TriBool;
};

export const QUADRANT_META: Record<
  QuadrantId,
  {
    id: QuadrantId;
    shortLabel: string;
    label: string;
    hint: string;
    /** 列表徽章 / chip 样式 */
    badgeClass: string;
    /** 矩阵格子样式 */
    cellClass: string;
    cellActiveClass: string;
  }
> = {
  q1: {
    id: "q1",
    shortLabel: "马上做",
    label: "重要且紧急",
    hint: "立刻处理",
    badgeClass: "bg-red-500/12 text-red-500 border-red-500/25",
    cellClass: "border-red-500/20 text-red-500/90 hover:bg-red-500/8",
    cellActiveClass: "bg-red-500/15 border-red-500/45 text-red-500 ring-1 ring-red-500/25",
  },
  q2: {
    id: "q2",
    shortLabel: "计划做",
    label: "重要不紧急",
    hint: "排期推进",
    badgeClass: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    cellClass: "border-emerald-500/20 text-emerald-600/90 dark:text-emerald-400/90 hover:bg-emerald-500/8",
    cellActiveClass:
      "bg-emerald-500/15 border-emerald-500/45 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/25",
  },
  q3: {
    id: "q3",
    shortLabel: "能转就转",
    label: "紧急不重要",
    hint: "压缩或转交",
    badgeClass: "bg-amber-500/12 text-amber-600 dark:text-amber-400 border-amber-500/25",
    cellClass: "border-amber-500/20 text-amber-600/90 dark:text-amber-400/90 hover:bg-amber-500/8",
    cellActiveClass:
      "bg-amber-500/15 border-amber-500/45 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/25",
  },
  q4: {
    id: "q4",
    shortLabel: "少做",
    label: "不紧急不重要",
    hint: "延后或删除",
    badgeClass: "bg-app-hover text-tx-tertiary border-app-border/60",
    cellClass: "border-app-border/50 text-tx-tertiary hover:bg-app-hover/60",
    cellActiveClass: "bg-app-hover border-app-border text-tx-secondary ring-1 ring-app-border",
  },
};

export const QUADRANT_ORDER: QuadrantId[] = ["q1", "q2", "q3", "q4"];

/** 排序权重：Q1 > Q2 > 未归类 > Q3 > Q4 */
export function quadrantSortRank(q: QuadrantId | null): number {
  if (q === "q1") return 0;
  if (q === "q2") return 1;
  if (q === null) return 2;
  if (q === "q3") return 3;
  return 4;
}

export function toTriBool(v: unknown): TriBool {
  if (v === null || v === undefined || v === "") return null;
  if (v === true || v === 1 || v === "1") return 1;
  if (v === false || v === 0 || v === "0") return 0;
  return null;
}

export function getQuadrant(
  isImportant: unknown,
  isUrgent: unknown,
): QuadrantId | null {
  const imp = toTriBool(isImportant);
  const urg = toTriBool(isUrgent);
  if (imp === null || urg === null) return null;
  if (imp === 1 && urg === 1) return "q1";
  if (imp === 1 && urg === 0) return "q2";
  if (imp === 0 && urg === 1) return "q3";
  return "q4";
}

export function getQuadrantFromTask(task: {
  isImportant?: unknown;
  isUrgent?: unknown;
}): QuadrantId | null {
  return getQuadrant(task.isImportant, task.isUrgent);
}

export function quadrantToFlags(q: QuadrantId | null): QuadrantFlags {
  if (q === null) return { isImportant: null, isUrgent: null };
  if (q === "q1") return { isImportant: 1, isUrgent: 1 };
  if (q === "q2") return { isImportant: 1, isUrgent: 0 };
  if (q === "q3") return { isImportant: 0, isUrgent: 1 };
  return { isImportant: 0, isUrgent: 0 };
}

export function matchesQuadrantFilter(
  task: { isImportant?: unknown; isUrgent?: unknown },
  filter: QuadrantFilter,
): boolean {
  if (filter === "all") return true;
  const q = getQuadrantFromTask(task);
  if (filter === "uncategorized") return q === null;
  return q === filter;
}

export function compareByQuadrant(
  a: { isImportant?: unknown; isUrgent?: unknown; priority?: number; endDate?: string | null; createdAt?: string },
  b: { isImportant?: unknown; isUrgent?: unknown; priority?: number; endDate?: string | null; createdAt?: string },
): number {
  const ra = quadrantSortRank(getQuadrantFromTask(a));
  const rb = quadrantSortRank(getQuadrantFromTask(b));
  if (ra !== rb) return ra - rb;
  const pa = a.priority ?? 2;
  const pb = b.priority ?? 2;
  if (pa !== pb) return pb - pa; // 高优先级在前
  const ea = a.endDate || "";
  const eb = b.endDate || "";
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  if (ea && !eb) return -1;
  if (!ea && eb) return 1;
  const ca = a.createdAt || "";
  const cb = b.createdAt || "";
  return cb.localeCompare(ca);
}
