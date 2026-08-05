/**
 * 任务统计聚合（个人 / 家庭复盘）
 */
import type Database from "better-sqlite3";
import {
  findRootInMap,
  listTaskCategories,
  mapCategoriesById,
  type TaskCategoryRow,
} from "./task-taxonomy.js";
import { computeActiveMinutes, firstInProgressAt } from "./task-status-events.js";

export type AnalyticsScope = "self" | "workspace";

export interface AnalyticsQuery {
  workspaceId: string | null;
  userId: string;
  scope: AnalyticsScope;
  /** 限定成员（家庭视图下筛选某人） */
  memberId?: string | null;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD inclusive
  prevFrom: string;
  prevTo: string;
}

export interface PeriodKpis {
  created: number;
  completed: number;
  openCreatedInPeriod: number;
  completionRate: number | null;
  onTimeCompleted: number;
  withDueCompleted: number;
  onTimeRate: number | null;
  overdueOpen: number;
  unscheduledOpen: number;
  uncategorized: number;
  totalTouched: number;
  categorized: number;
  categorizeRate: number | null;
  medianCycleMinutes: number | null;
  totalActiveMinutes: number;
  urgentCompleted: number;
  urgentShare: number | null;
}

export interface CategoryBucket {
  categoryId: string | null;
  code: string | null;
  name: string;
  parentCode: string | null;
  kind: string | null;
  completed: number;
  created: number;
  activeMinutes: number;
  share: number | null;
}

export interface MemberBucket {
  userId: string | null;
  displayName: string;
  completed: number;
  created: number;
  activeMinutes: number;
  share: number | null;
}

export interface InsightItem {
  id: string;
  severity: "info" | "warn" | "good";
  title: string;
  detail: string;
  actionHint?: string;
  filter?: Record<string, string>;
}

type TaskRow = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeId: string | null;
  creatorId: string;
  isCompleted: number;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  assigneeName: string | null;
};

function dayStart(d: string) {
  return `${d} 00:00:00`;
}
function dayEnd(d: string) {
  return `${d} 23:59:59`;
}

function parseTs(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(String(s).replace(" ", "T"));
  return Number.isNaN(t) ? null : t;
}

function dateOnly(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function inRange(ts: string | null | undefined, from: string, to: string): boolean {
  const d = dateOnly(ts);
  if (!d) return false;
  return d >= from && d <= to;
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

function projectScopeSql(ws: string | null, userId: string, scope: AnalyticsScope): { sql: string; params: any[] } {
  if (ws) {
    if (scope === "self") {
      return {
        sql: `p.isDeleted = 0 AND COALESCE(p.isArchived, 0) = 0 AND p.workspaceId = ?
              AND (pt.assigneeId = ? OR (pt.assigneeId IS NULL AND pt.creatorId = ?))`,
        params: [ws, userId, userId],
      };
    }
    return {
      sql: `p.isDeleted = 0 AND COALESCE(p.isArchived, 0) = 0 AND p.workspaceId = ?
            AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?
                 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?)
                 OR EXISTS(SELECT 1 FROM project_task_members ptm WHERE ptm.taskId = pt.id AND ptm.userId = ?))`,
      // For workspace scope we still need viewer to be member of workspace; tasks from all members in visible projects
      params: [ws, userId, userId, userId, userId, userId],
    };
  }
  // personal
  return {
    sql: `p.isDeleted = 0 AND COALESCE(p.isArchived, 0) = 0
          AND (p.workspaceId IS NULL OR p.workspaceId = '')
          AND (pt.assigneeId = ? OR pt.creatorId = ? OR p.ownerId = ?)`,
    params: [userId, userId, userId],
  };
}

/**
 * 家庭视图：放宽为工作区内用户可见项目的全部任务（成员关系）
 * 上面 workspace+self 已收窄到自己；workspace 全家用更宽 SQL
 */
function projectScopeSqlWorkspaceAll(ws: string, userId: string): { sql: string; params: any[] } {
  return {
    sql: `p.isDeleted = 0 AND COALESCE(p.isArchived, 0) = 0 AND p.workspaceId = ?
          AND (p.ownerId = ?
               OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.projectId = p.id AND pm.userId = ?)
               OR EXISTS(SELECT 1 FROM project_task_members ptm WHERE ptm.taskId = pt.id AND ptm.userId = ?)
               OR pt.assigneeId = ? OR pt.creatorId = ?)`,
    params: [ws, userId, userId, userId, userId, userId],
  };
}

function loadTasks(db: Database.Database, q: AnalyticsQuery): TaskRow[] {
  const ws = q.workspaceId;
  let scope =
    ws && q.scope === "workspace"
      ? projectScopeSqlWorkspaceAll(ws, q.userId)
      : projectScopeSql(ws, q.userId, q.scope);

  let memberFilter = "";
  const params = [...scope.params];
  if (q.memberId) {
    memberFilter = " AND (pt.assigneeId = ? OR (pt.assigneeId IS NULL AND pt.creatorId = ?)) ";
    params.push(q.memberId, q.memberId);
  }

  const rows = db
    .prepare(
      `
      SELECT pt.id, pt.title, pt.projectId, p.name AS projectName,
             pt.assigneeId, pt.creatorId, pt.isCompleted, pt.status,
             pt.startDate, pt.endDate, pt.categoryId,
             pt.createdAt, pt.updatedAt, pt.completedAt,
             COALESCE(u.displayName, u.username) AS assigneeName
      FROM project_tasks pt
      JOIN projects p ON p.id = pt.projectId
      LEFT JOIN users u ON u.id = pt.assigneeId
      WHERE ${scope.sql} ${memberFilter}
    `,
    )
    .all(...params) as TaskRow[];

  return rows;
}

function responsibleId(t: TaskRow): string | null {
  return t.assigneeId || t.creatorId || null;
}

function cycleMinutes(db: Database.Database, t: TaskRow): { minutes: number; estimated: boolean } | null {
  if (!t.completedAt && Number(t.isCompleted) !== 1) return null;
  const completedTs = parseTs(t.completedAt || t.updatedAt);
  if (completedTs == null) return null;
  const firstIp = firstInProgressAt(db, t.id);
  const startTs = parseTs(firstIp) ?? parseTs(t.createdAt);
  if (startTs == null || completedTs < startTs) return null;
  return {
    minutes: Math.round((completedTs - startTs) / 60000),
    estimated: !firstIp,
  };
}

function computeKpis(
  db: Database.Database,
  tasks: TaskRow[],
  from: string,
  to: string,
  catMap: Map<string, TaskCategoryRow>,
): PeriodKpis {
  let created = 0;
  let completed = 0;
  let openCreatedInPeriod = 0;
  let onTimeCompleted = 0;
  let withDueCompleted = 0;
  let overdueOpen = 0;
  let unscheduledOpen = 0;
  let uncategorized = 0;
  let categorized = 0;
  let totalActiveMinutes = 0;
  let urgentCompleted = 0;
  const cycles: number[] = [];

  for (const t of tasks) {
    const isDone = Number(t.isCompleted) === 1;
    if (inRange(t.createdAt, from, to)) {
      created++;
      if (!isDone) openCreatedInPeriod++;
    }
    if (isDone && inRange(t.completedAt || t.updatedAt, from, to)) {
      completed++;
      const cyc = cycleMinutes(db, t);
      if (cyc) cycles.push(cyc.minutes);
      totalActiveMinutes += computeActiveMinutes(db, t.id, dayStart(from), dayEnd(to));
      if (t.endDate) {
        withDueCompleted++;
        const due = dateOnly(t.endDate)!;
        const doneDay = dateOnly(t.completedAt || t.updatedAt)!;
        if (doneDay <= due) onTimeCompleted++;
      }
      const root = findRootInMap(catMap, t.categoryId);
      const leaf = t.categoryId ? catMap.get(t.categoryId) : null;
      if (leaf?.kind === "urgent" || (root?.code === "6" && leaf?.kind === "urgent")) {
        urgentCompleted++;
      } else if (leaf?.kind === "urgent") {
        urgentCompleted++;
      }
    }
    if (!isDone) {
      if (t.endDate) {
        const due = dateOnly(t.endDate)!;
        if (due < to || due < from || (due >= from && due <= to && due < new Date().toISOString().slice(0, 10))) {
          // open and past due relative to today
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          if (due < todayStr) overdueOpen++;
        }
      }
      if (!t.startDate && !t.endDate) unscheduledOpen++;
    }
    // categorize rate over tasks created or completed in period
    const touched =
      inRange(t.createdAt, from, to) ||
      (isDone && inRange(t.completedAt || t.updatedAt, from, to));
    if (touched) {
      if (t.categoryId) categorized++;
      else uncategorized++;
    }
  }

  const totalTouched = categorized + uncategorized;
  const completionDenom = completed + openCreatedInPeriod;
  return {
    created,
    completed,
    openCreatedInPeriod,
    completionRate: completionDenom > 0 ? completed / completionDenom : null,
    onTimeCompleted,
    withDueCompleted,
    onTimeRate: withDueCompleted > 0 ? onTimeCompleted / withDueCompleted : null,
    overdueOpen,
    unscheduledOpen,
    uncategorized,
    totalTouched,
    categorized,
    categorizeRate: totalTouched > 0 ? categorized / totalTouched : null,
    medianCycleMinutes: median(cycles),
    totalActiveMinutes,
    urgentCompleted,
    urgentShare: completed > 0 ? urgentCompleted / completed : null,
  };
}

function byCategory(
  db: Database.Database,
  tasks: TaskRow[],
  from: string,
  to: string,
  catMap: Map<string, TaskCategoryRow>,
  level: "root" | "leaf",
): CategoryBucket[] {
  const buckets = new Map<string, CategoryBucket>();

  const ensure = (key: string, meta: Omit<CategoryBucket, "completed" | "created" | "activeMinutes" | "share">) => {
    if (!buckets.has(key)) {
      buckets.set(key, { ...meta, completed: 0, created: 0, activeMinutes: 0, share: null });
    }
    return buckets.get(key)!;
  };

  for (const t of tasks) {
    const leaf = t.categoryId ? catMap.get(t.categoryId) : null;
    const root = findRootInMap(catMap, t.categoryId);
    const target = level === "root" ? root : leaf;
    const key = target?.id || "__none__";
    const b = ensure(key, {
      categoryId: target?.id || null,
      code: target?.code || null,
      name: target?.name || "未归类",
      parentCode: level === "leaf" ? root?.code || null : null,
      kind: leaf?.kind || null,
    });

    if (inRange(t.createdAt, from, to)) b.created++;
    if (Number(t.isCompleted) === 1 && inRange(t.completedAt || t.updatedAt, from, to)) {
      b.completed++;
      b.activeMinutes += computeActiveMinutes(db, t.id, dayStart(from), dayEnd(to));
    }
  }

  const list = [...buckets.values()].sort((a, b) => b.completed - a.completed || b.created - a.created);
  const totalCompleted = list.reduce((s, x) => s + x.completed, 0);
  for (const b of list) {
    b.share = totalCompleted > 0 ? b.completed / totalCompleted : null;
  }
  return list;
}

function byMember(
  db: Database.Database,
  tasks: TaskRow[],
  from: string,
  to: string,
): MemberBucket[] {
  const buckets = new Map<string, MemberBucket>();
  for (const t of tasks) {
    const uid = responsibleId(t) || "__none__";
    if (!buckets.has(uid)) {
      buckets.set(uid, {
        userId: uid === "__none__" ? null : uid,
        displayName: t.assigneeName || (uid === "__none__" ? "未指派" : "成员"),
        completed: 0,
        created: 0,
        activeMinutes: 0,
        share: null,
      });
    }
    const b = buckets.get(uid)!;
    if (!t.assigneeName && t.assigneeId) {
      // keep
    } else if (t.assigneeName) {
      b.displayName = t.assigneeName;
    }
    if (inRange(t.createdAt, from, to)) b.created++;
    if (Number(t.isCompleted) === 1 && inRange(t.completedAt || t.updatedAt, from, to)) {
      b.completed++;
      b.activeMinutes += computeActiveMinutes(db, t.id, dayStart(from), dayEnd(to));
    }
  }
  const list = [...buckets.values()].sort((a, b) => b.completed - a.completed);
  const total = list.reduce((s, x) => s + x.completed, 0);
  for (const b of list) b.share = total > 0 ? b.completed / total : null;
  return list;
}

function weekdayDistribution(
  tasks: TaskRow[],
  from: string,
  to: string,
): Array<{ weekday: number; label: string; completed: number }> {
  const labels = ["日", "一", "二", "三", "四", "五", "六"];
  const counts = Array.from({ length: 7 }, (_, i) => ({
    weekday: i,
    label: labels[i],
    completed: 0,
  }));
  for (const t of tasks) {
    if (Number(t.isCompleted) !== 1) continue;
    const d = dateOnly(t.completedAt || t.updatedAt);
    if (!d || d < from || d > to) continue;
    const [y, m, day] = d.split("-").map(Number);
    const wd = new Date(y, m - 1, day).getDay();
    counts[wd].completed++;
  }
  return counts;
}

function buildInsights(
  current: PeriodKpis,
  previous: PeriodKpis,
  rootCats: CategoryBucket[],
  members: MemberBucket[],
  scope: AnalyticsScope,
): InsightItem[] {
  const items: InsightItem[] = [];

  if (current.categorizeRate != null && current.categorizeRate < 0.8 && current.totalTouched >= 3) {
    items.push({
      id: "low-categorize",
      severity: "warn",
      title: "归类率偏低",
      detail: `本期仅 ${Math.round(current.categorizeRate * 100)}% 的任务打了事务分类，结构统计可信度会打折。`,
      actionHint: "给未归类任务补上主分类后再看复盘结论更准。",
      filter: { uncategorized: "1" },
    });
  }

  if (current.unscheduledOpen >= 5) {
    const delta = current.unscheduledOpen - previous.unscheduledOpen;
    items.push({
      id: "unscheduled-backlog",
      severity: delta > 0 ? "warn" : "info",
      title: "未安排任务积压",
      detail: `当前有 ${current.unscheduledOpen} 件未设时间的待办${delta > 0 ? `（比上期多 ${delta}）` : ""}。`,
      actionHint: "本周留 30 分钟规划槽，先给最重要的 5 件设时间。",
      filter: { unscheduled: "1" },
    });
  }

  if (current.urgentShare != null && (current.urgentShare >= 0.25 || (previous.urgentShare != null && current.urgentShare - previous.urgentShare >= 0.1))) {
    items.push({
      id: "urgent-high",
      severity: "warn",
      title: "突发事务占比偏高",
      detail: `本期完成任务中约 ${Math.round((current.urgentShare || 0) * 100)}% 属于突发类（急症/故障/人情/长辈就医）。`,
      actionHint: "检查是否可预置药箱、车辆维保、礼金预算，减少救火。",
      filter: { kind: "urgent" },
    });
  }

  if (current.overdueOpen >= 3) {
    items.push({
      id: "overdue",
      severity: "warn",
      title: "逾期任务待处理",
      detail: `仍有 ${current.overdueOpen} 件已过截止日的未完成任务。`,
      actionHint: "逾期清单里能砍的砍、能改期的改期，避免假截止。",
      filter: { overdue: "1" },
    });
  }

  if (
    current.medianCycleMinutes != null &&
    previous.medianCycleMinutes != null &&
    previous.medianCycleMinutes > 0 &&
    current.medianCycleMinutes > previous.medianCycleMinutes * 1.4 &&
    current.completed >= 3
  ) {
    items.push({
      id: "cycle-slower",
      severity: "info",
      title: "完成耗时变长",
      detail: `中位完成耗时从 ${formatDuration(previous.medianCycleMinutes)} 增至 ${formatDuration(current.medianCycleMinutes)}。`,
      actionHint: "看看是否任务颗粒度过大，可拆成清单逐步完成。",
    });
  }

  if (scope === "workspace" && members.length >= 2) {
    const sorted = [...members].filter((m) => m.userId).sort((a, b) => b.completed - a.completed);
    const top = sorted[0];
    const total = sorted.reduce((s, m) => s + m.completed, 0);
    if (top && total >= 4 && top.completed / total >= 0.7) {
      items.push({
        id: "load-imbalance",
        severity: "info",
        title: "家庭任务负载较集中",
        detail: `「${top.displayName}」完成了约 ${Math.round((top.completed / total) * 100)}% 的本期任务。`,
        actionHint: "若主要集中在育儿/家务，可商量分工或合并接送时段。",
      });
    }
  }

  const parenting = rootCats.find((c) => c.code === "3");
  if (parenting && parenting.share != null && parenting.share >= 0.4 && current.completed >= 5) {
    items.push({
      id: "parenting-heavy",
      severity: "info",
      title: "育儿事项占比高",
      detail: `育儿完成量约占本期 ${Math.round(parenting.share * 100)}%，属于家庭刚性支出时间。`,
      actionHint: "复盘时不要用「完成个数」苛责自己；可优化的是重复接送与耗材补货节奏。",
    });
  }

  if (current.completionRate != null && current.completionRate >= 0.85 && current.completed >= 5) {
    items.push({
      id: "good-throughput",
      severity: "good",
      title: "吞吐表现不错",
      detail: `本期完成率约 ${Math.round(current.completionRate * 100)}%（完成 ${current.completed} / 相关 ${current.completed + current.openCreatedInPeriod}）。`,
      actionHint: "保持节奏即可；把省下的精力留给未安排清单的规划。",
    });
  }

  if (items.length === 0) {
    items.push({
      id: "neutral",
      severity: "info",
      title: "数据还在积累",
      detail: "多打分类、对进行中任务点「开始/完成」，复盘会越来越准。",
    });
  }

  return items.slice(0, 7);
}

function formatDuration(mins: number): string {
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h < 48) return m ? `${h} 小时 ${m} 分` : `${h} 小时`;
  const d = Math.floor(h / 24);
  return `${d} 天`;
}

function deltaPct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / Math.abs(prev);
}

export function computeTaskAnalytics(db: Database.Database, q: AnalyticsQuery) {
  const ownerForTaxonomy = q.userId;
  const categories = listTaskCategories(db, q.workspaceId, ownerForTaxonomy, { includeInactive: true });
  // 家庭空间：分类可能由任一成员导入，尝试 workspace 维度全部
  let catRows = categories;
  if (q.workspaceId && catRows.length === 0) {
    catRows = db
      .prepare(`SELECT * FROM task_categories WHERE workspaceId = ? AND isActive = 1 ORDER BY sortOrder`)
      .all(q.workspaceId) as TaskCategoryRow[];
  } else if (q.workspaceId) {
    catRows = db
      .prepare(`SELECT * FROM task_categories WHERE workspaceId = ? ORDER BY sortOrder`)
      .all(q.workspaceId) as TaskCategoryRow[];
  }
  const catMap = mapCategoriesById(catRows);
  const tasks = loadTasks(db, q);

  const current = computeKpis(db, tasks, q.from, q.to, catMap);
  const previous = computeKpis(db, tasks, q.prevFrom, q.prevTo, catMap);
  const rootCategories = byCategory(db, tasks, q.from, q.to, catMap, "root");
  const leafCategories = byCategory(db, tasks, q.from, q.to, catMap, "leaf");
  const members = byMember(db, tasks, q.from, q.to);
  const weekdays = weekdayDistribution(tasks, q.from, q.to);
  const insights = buildInsights(current, previous, rootCategories, members, q.scope);

  // 打开态列表摘要
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const openLists = {
    overdue: tasks
      .filter((t) => Number(t.isCompleted) !== 1 && t.endDate && dateOnly(t.endDate)! < todayStr)
      .slice(0, 20)
      .map(summarizeTask),
    unscheduled: tasks
      .filter((t) => Number(t.isCompleted) !== 1 && !t.startDate && !t.endDate)
      .slice(0, 20)
      .map(summarizeTask),
    uncategorized: tasks
      .filter(
        (t) =>
          !t.categoryId &&
          (inRange(t.createdAt, q.from, q.to) ||
            (Number(t.isCompleted) === 1 && inRange(t.completedAt || t.updatedAt, q.from, q.to))),
      )
      .slice(0, 20)
      .map(summarizeTask),
  };

  return {
    range: { from: q.from, to: q.to, prevFrom: q.prevFrom, prevTo: q.prevTo },
    scope: q.scope,
    memberId: q.memberId || null,
    taxonomyCount: catRows.length,
    hasActiveTime: current.totalActiveMinutes > 0,
    kpis: {
      current,
      previous,
      deltas: {
        completed: deltaPct(current.completed, previous.completed),
        created: deltaPct(current.created, previous.created),
        completionRate: deltaPct(current.completionRate, previous.completionRate),
        onTimeRate: deltaPct(current.onTimeRate, previous.onTimeRate),
        unscheduledOpen: deltaPct(current.unscheduledOpen, previous.unscheduledOpen),
        medianCycleMinutes: deltaPct(current.medianCycleMinutes, previous.medianCycleMinutes),
        urgentShare: deltaPct(current.urgentShare, previous.urgentShare),
      },
    },
    categories: { root: rootCategories, leaf: leafCategories },
    members,
    weekdays,
    insights,
    openLists,
  };
}

/** 生成可导出的 Markdown 周报 / 周期报告 */
export function buildTaskAnalyticsMarkdown(
  data: ReturnType<typeof computeTaskAnalytics>,
  opts?: { aiText?: string | null; title?: string },
): string {
  const k = data.kpis.current;
  const p = data.kpis.previous;
  const d = data.kpis.deltas;
  const pct = (n: number | null | undefined) =>
    n == null || Number.isNaN(n) ? "—" : `${Math.round(n * 100)}%`;
  const dlt = (n: number | null | undefined) => {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : "";
    return `${sign}${Math.round(n * 100)}%`;
  };
  const lines: string[] = [];
  const title =
    opts?.title ||
    `任务复盘报告（${data.range.from} ~ ${data.range.to}）`;
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`- **范围**：${data.scope === "workspace" ? "全家" : "个人"}`);
  lines.push(`- **对比周期**：${data.range.prevFrom} ~ ${data.range.prevTo}`);
  lines.push(`- **生成时间**：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  lines.push("");
  lines.push("## 总览 KPI");
  lines.push("");
  lines.push("| 指标 | 本期 | 上期 | 环比 |");
  lines.push("| --- | ---: | ---: | ---: |");
  lines.push(`| 完成 | ${k.completed} | ${p.completed} | ${dlt(d.completed)} |`);
  lines.push(`| 新创建 | ${k.created} | ${p.created} | ${dlt(d.created)} |`);
  lines.push(`| 完成率 | ${pct(k.completionRate)} | ${pct(p.completionRate)} | ${dlt(d.completionRate)} |`);
  lines.push(`| 按时完成率 | ${pct(k.onTimeRate)} | ${pct(p.onTimeRate)} | ${dlt(d.onTimeRate)} |`);
  lines.push(
    `| 中位耗时 | ${k.medianCycleMinutes != null ? formatDuration(k.medianCycleMinutes) : "—"} | ${p.medianCycleMinutes != null ? formatDuration(p.medianCycleMinutes) : "—"} | ${dlt(d.medianCycleMinutes)} |`,
  );
  lines.push(`| 未安排积压 | ${k.unscheduledOpen} | ${p.unscheduledOpen} | ${dlt(d.unscheduledOpen)} |`);
  lines.push(`| 归类率 | ${pct(k.categorizeRate)} | ${pct(p.categorizeRate)} | — |`);
  lines.push(`| 突发类占比 | ${pct(k.urgentShare)} | ${pct(p.urgentShare)} | ${dlt(d.urgentShare)} |`);
  lines.push("");

  lines.push("## 完成结构（大类）");
  lines.push("");
  if (!data.categories.root.length) {
    lines.push("_本期无完成任务_");
  } else {
    lines.push("| 大类 | 完成 | 占比 | 新创建 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const c of data.categories.root) {
      lines.push(
        `| ${c.name} | ${c.completed} | ${pct(c.share)} | ${c.created} |`,
      );
    }
  }
  lines.push("");

  if (data.scope === "workspace" && data.members.length) {
    lines.push("## 成员完成量");
    lines.push("");
    lines.push("| 成员 | 完成 | 占比 | 新创建 |");
    lines.push("| --- | ---: | ---: | ---: |");
    for (const m of data.members) {
      lines.push(
        `| ${m.displayName} | ${m.completed} | ${pct(m.share)} | ${m.created} |`,
      );
    }
    lines.push("");
  }

  lines.push("## 星期分布");
  lines.push("");
  lines.push(
    data.weekdays.map((w) => `周${w.label} ${w.completed}`).join(" · ") || "—",
  );
  lines.push("");

  lines.push("## 规则洞察");
  lines.push("");
  for (const ins of data.insights) {
    const tag =
      ins.severity === "warn" ? "⚠️" : ins.severity === "good" ? "✅" : "ℹ️";
    lines.push(`### ${tag} ${ins.title}`);
    lines.push("");
    lines.push(ins.detail);
    if (ins.actionHint) lines.push("");
    if (ins.actionHint) lines.push(`> 建议：${ins.actionHint}`);
    lines.push("");
  }

  if (opts?.aiText) {
    lines.push("## AI 润色建议");
    lines.push("");
    lines.push(opts.aiText.trim());
    lines.push("");
  }

  const ol = data.openLists;
  lines.push("## 待处理清单");
  lines.push("");
  lines.push(`### 未安排（${ol.unscheduled.length}）`);
  if (!ol.unscheduled.length) lines.push("_无_");
  else
    for (const t of ol.unscheduled) {
      lines.push(`- ${t.title}${t.projectName ? `（${t.projectName}）` : ""}`);
    }
  lines.push("");
  lines.push(`### 逾期（${ol.overdue.length}）`);
  if (!ol.overdue.length) lines.push("_无_");
  else
    for (const t of ol.overdue) {
      lines.push(
        `- ${t.title}${t.endDate ? ` · 截止 ${String(t.endDate).slice(0, 10)}` : ""}`,
      );
    }
  lines.push("");
  lines.push(`### 未归类（${ol.uncategorized.length}）`);
  if (!ol.uncategorized.length) lines.push("_无_");
  else
    for (const t of ol.uncategorized) {
      lines.push(`- ${t.title}`);
    }
  lines.push("");
  lines.push("---");
  lines.push("_由 Super Note 任务复盘生成 · 数据基于已完成/创建任务与规则引擎_");
  lines.push("");
  return lines.join("\n");
}

function summarizeTask(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    projectId: t.projectId,
    projectName: t.projectName,
    assigneeId: t.assigneeId,
    assigneeName: t.assigneeName,
    endDate: t.endDate,
    categoryId: t.categoryId,
    status: t.status,
    isCompleted: t.isCompleted,
  };
}

/** 解析周期预设 */
export function resolvePeriod(
  preset: string,
  customFrom?: string | null,
  customTo?: string | null,
  weekStartsOn: 0 | 1 = 1,
): { from: string; to: string; prevFrom: string; prevTo: string } {
  const today = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (preset === "custom" && customFrom && customTo) {
    const from = customFrom;
    const to = customTo;
    const fromD = new Date(from + "T00:00:00");
    const toD = new Date(to + "T00:00:00");
    const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    const prevToD = new Date(fromD);
    prevToD.setDate(prevToD.getDate() - 1);
    const prevFromD = new Date(prevToD);
    prevFromD.setDate(prevFromD.getDate() - (days - 1));
    return { from, to, prevFrom: ymd(prevFromD), prevTo: ymd(prevToD) };
  }

  if (preset === "today") {
    const t = ymd(today);
    const yest = new Date(today);
    yest.setDate(yest.getDate() - 1);
    const y = ymd(yest);
    return { from: t, to: t, prevFrom: y, prevTo: y };
  }

  if (preset === "month") {
    const fromD = new Date(today.getFullYear(), today.getMonth(), 1);
    const toD = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    const prevFromD = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevToD = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: ymd(fromD), to: ymd(toD), prevFrom: ymd(prevFromD), prevTo: ymd(prevToD) };
  }

  // week default
  const day = today.getDay(); // 0 Sun
  const diff = weekStartsOn === 1 ? (day === 0 ? -6 : 1 - day) : -day;
  const fromD = new Date(today);
  fromD.setDate(today.getDate() + diff);
  const toD = new Date(fromD);
  toD.setDate(fromD.getDate() + 6);
  const prevFromD = new Date(fromD);
  prevFromD.setDate(fromD.getDate() - 7);
  const prevToD = new Date(toD);
  prevToD.setDate(toD.getDate() - 7);
  return { from: ymd(fromD), to: ymd(toD), prevFrom: ymd(prevFromD), prevTo: ymd(prevToD) };
}
