import type { CalendarTask } from "./types";
import { extractTimeHm, taskDateOnly, toLocalYmd } from "./dateUtils";

export function flattenStageTasks(stages: { name?: string; tasks?: CalendarTask[] }[]): CalendarTask[] {
  return stages.reduce<CalendarTask[]>((acc, stage) => {
    const stageTasks = (stage.tasks || []).map((task) => ({
      ...task,
      stageName: (task as CalendarTask).stageName || stage.name,
    }));
    return [...acc, ...stageTasks];
  }, []);
}

export function filterTasksByProjectStatus(
  tasks: CalendarTask[],
  selectedProjectId: string,
  selectedStatus: string,
): CalendarTask[] {
  return tasks.filter((task) => {
    if (selectedProjectId !== "all" && task.projectId !== selectedProjectId) return false;
    if (selectedStatus === "all") return true;

    const isCompleted = task.isCompleted === 1 || task.stageName === "已完成";
    const isPaused = task.status === "paused";
    const isNotStarted =
      task.isCompleted !== 1 &&
      !isPaused &&
      (task.stageName === "待启动" || task.stageName === "待规划");
    const isInProgress = task.isCompleted !== 1 && !isPaused && !isNotStarted;

    if (selectedStatus === "pending" && !isNotStarted) return false;
    if (selectedStatus === "in_progress" && !isInProgress) return false;
    if (selectedStatus === "paused" && !isPaused) return false;
    if (selectedStatus === "completed" && !isCompleted) return false;
    return true;
  });
}

export function taskOccursOnYmd(task: CalendarTask, dStr: string): boolean {
  if (!task.startDate && !task.endDate) return false;
  const start = taskDateOnly(task.startDate) || dStr;
  const end = taskDateOnly(task.endDate) || dStr;
  return dStr >= start && dStr <= end;
}

export function tasksForDate(tasks: CalendarTask[], date: Date): CalendarTask[] {
  const dStr = toLocalYmd(date);
  return tasks.filter((t) => taskOccursOnYmd(t, dStr));
}

export function isTimedTask(task: CalendarTask): boolean {
  return !!(extractTimeHm(task.startDate) || extractTimeHm(task.endDate));
}

export function splitTimedAndAllDay(tasks: CalendarTask[]): {
  timed: CalendarTask[];
  allDay: CalendarTask[];
} {
  const timed: CalendarTask[] = [];
  const allDay: CalendarTask[] = [];
  for (const t of tasks) {
    if (isTimedTask(t)) timed.push(t);
    else allDay.push(t);
  }
  return { timed, allDay };
}

/** Layout concurrent timed events: assign columns 0..n-1 */
export function layoutTimedEvents(
  tasks: CalendarTask[],
  ymd: string,
): Array<{ task: CalendarTask; col: number; colCount: number; startMin: number; endMin: number }> {
  const items = tasks
    .map((task) => {
      const startHm = extractTimeHm(task.startDate) || extractTimeHm(task.endDate) || "09:00";
      const endHm = extractTimeHm(task.endDate) || extractTimeHm(task.startDate) || "10:00";
      let startMin = (Number(startHm.split(":")[0]) || 0) * 60 + (Number(startHm.split(":")[1]) || 0);
      let endMin = (Number(endHm.split(":")[0]) || 0) * 60 + (Number(endHm.split(":")[1]) || 0);
      if (endMin <= startMin) endMin = startMin + 60;
      return { task, startMin, endMin, col: 0, colCount: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Greedy column assignment
  const colEnds: number[] = [];
  for (const item of items) {
    let placed = false;
    for (let c = 0; c < colEnds.length; c++) {
      if (colEnds[c] <= item.startMin) {
        item.col = c;
        colEnds[c] = item.endMin;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item.col = colEnds.length;
      colEnds.push(item.endMin);
    }
  }
  const colCount = Math.max(1, colEnds.length);
  return items.map((it) => ({ ...it, colCount }));
}

export function ymdsWithTasks(tasks: CalendarTask[], year: number): Set<string> {
  const set = new Set<string>();
  for (const task of tasks) {
    const start = taskDateOnly(task.startDate);
    const end = taskDateOnly(task.endDate) || start;
    if (!start) continue;
    // expand range clamped roughly to year
    let cur = start;
    const endYmd = end || start;
    let guard = 0;
    while (cur <= endYmd && guard < 400) {
      if (cur.startsWith(String(year))) set.add(cur);
      const [y, m, d] = cur.split("-").map(Number);
      const dt = new Date(y, m - 1, d + 1);
      cur = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      guard++;
    }
  }
  return set;
}
