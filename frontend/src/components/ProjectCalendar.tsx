import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ProjectStage, ProjectTask } from "@/types";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  CheckCircle2,
  Circle,
  Star,
  Plus,
  Trash2,
  Scissors,
  Copy,
  ClipboardPaste,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lunar, Solar, HolidayUtil } from "lunar-javascript";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { confirm } from "@/components/ui/confirm";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import { AppModal } from "@/components/common/AppModal";

/** Local calendar day string YYYY-MM-DD (avoid UTC shift from toISOString). */
function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function taskDateOnly(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return toLocalYmd(d);
}

type TaskClipboard = {
  mode: "copy" | "cut";
  title: string;
  description: string;
  projectId: string;
  priority: number;
  /** Original wall-clock HH:mm; used when pasting onto a new day */
  startTime?: string | null;
  endTime?: string | null;
  isRecurring?: number;
  recurrenceRule?: string | null;
  reminderOffsetValue?: number;
  reminderOffsetUnit?: ProjectTask["reminderOffsetUnit"];
  titleColor?: string | null;
  tags?: string[];
  participants?: string[];
};

/** Extract HH:mm from stored task datetime, if present. */
function extractTimeHm(s: string | null | undefined): string | null {
  if (!s || typeof s !== "string") return null;
  const m = s.trim().match(/(?:T| )(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toLocalYmd(dt);
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const a = new Date(fy, fm - 1, fd).getTime();
  const b = new Date(ty, tm - 1, td).getTime();
  return Math.round((b - a) / 86400000);
}

/** Shift a stored date/datetime field by N calendar days, keeping time. */
function shiftFieldByDays(field: string | null | undefined, dayDelta: number): string | null {
  if (!field || dayDelta === 0) return field ?? null;
  const datePart = taskDateOnly(field);
  if (!datePart) return field;
  const newDate = addDaysToYmd(datePart, dayDelta);
  const timePart = extractTimeHm(field);
  return timePart ? `${newDate} ${timePart}` : newDate;
}

const CAL_TASK_DRAG_MIME = "application/x-supernote-cal-task";

/**
 * Module-level clipboard survives ProjectCalendar remounts.
 * Parent refresh (calendar loading spinner) used to wipe React state mid-cut.
 */
let taskClipboardStore: TaskClipboard | null = null;
const clipboardListeners = new Set<() => void>();

function getTaskClipboard() {
  return taskClipboardStore;
}

function setTaskClipboardStore(next: TaskClipboard | null) {
  taskClipboardStore = next;
  clipboardListeners.forEach((fn) => fn());
}

function useTaskClipboard() {
  const [clip, setClip] = useState<TaskClipboard | null>(() => getTaskClipboard());
  useEffect(() => {
    const sync = () => setClip(getTaskClipboard());
    clipboardListeners.add(sync);
    // re-sync in case another instance wrote while we were unmounted
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

interface ProjectCalendarProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
  showProjectFilter?: boolean;
  /** Called after create / delete / paste so parent can reload stages */
  onRefresh?: () => void;
  /** Preferred project when creating (e.g. personal TODO or current project) */
  defaultProjectId?: string;
  projects?: Array<{ id: string; name: string }>;
}

export default function ProjectCalendar({
  stages,
  onTaskClick,
  showProjectFilter,
  onRefresh,
  defaultProjectId,
  projects: projectsProp,
}: ProjectCalendarProps) {
  const { t } = useTranslation();
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [clipboard, setClipboard] = useTaskClipboard();
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState(() => toLocalYmd(new Date()));
  // Same-day short block by default (1 hour); user can adjust in the dialog
  const [createStartTime, setCreateStartTime] = useState("09:00");
  const [createEndTime, setCreateEndTime] = useState("10:00");
  const [createTitle, setCreateTitle] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [creating, setCreating] = useState(false);

  const { menu, menuRef, openMenu, closeMenu } = useContextMenu();
  const [ctxTask, setCtxTask] = useState<ProjectTask | null>(null);
  const [ctxDayYmd, setCtxDayYmd] = useState<string | null>(null);

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverYmd, setDragOverYmd] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  /** Suppress day-click "create" right after a drag */
  const suppressDayClickRef = useRef(false);

  // Extract all tasks with stageName decoration
  const tasks = useMemo(() => {
    return stages.reduce<any[]>((acc, stage) => {
      const stageTasks = (stage.tasks || []).map((task) => ({
        ...task,
        stageName: (task as any).stageName || stage.name,
      }));
      return [...acc, ...stageTasks];
    }, []);
  }, [stages]);

  const uniqueProjects = useMemo(() => {
    const projMap = new Map<string, string>();
    if (projectsProp?.length) {
      for (const p of projectsProp) {
        projMap.set(p.id, p.name);
      }
    }
    tasks.forEach((task) => {
      if (task.projectId && !projMap.has(task.projectId)) {
        projMap.set(task.projectId, (task as any).projectName || task.projectId);
      }
    });
    return Array.from(projMap.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks, projectsProp]);

  const resolveCreateProjectId = useCallback(() => {
    if (selectedProjectId !== "all") return selectedProjectId;
    if (defaultProjectId && uniqueProjects.some((p) => p.id === defaultProjectId)) {
      return defaultProjectId;
    }
    if (defaultProjectId) return defaultProjectId;
    return uniqueProjects[0]?.id || "";
  }, [selectedProjectId, defaultProjectId, uniqueProjects]);

  useEffect(() => {
    if (createOpen && !createProjectId) {
      setCreateProjectId(resolveCreateProjectId());
    }
  }, [createOpen, createProjectId, resolveCreateProjectId]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const getDaysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
  const getFirstDayOfMonth = (y: number, m: number) => new Date(y, m, 1).getDay();

  const daysInMonth = getDaysInMonth(year, month);
  const firstDayIndex = getFirstDayOfMonth(year, month);

  const prevMonthDays = getDaysInMonth(year, month - 1);
  const calendarCells: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = firstDayIndex - 1; i >= 0; i--) {
    calendarCells.push({
      date: new Date(year, month - 1, prevMonthDays - i),
      isCurrentMonth: false,
    });
  }

  for (let i = 1; i <= daysInMonth; i++) {
    calendarCells.push({
      date: new Date(year, month, i),
      isCurrentMonth: true,
    });
  }

  const remaining = 42 - calendarCells.length;
  for (let i = 1; i <= remaining; i++) {
    calendarCells.push({
      date: new Date(year, month + 1, i),
      isCurrentMonth: false,
    });
  }

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const today = () => setCurrentDate(new Date());

  const getTasksForDate = (date: Date) => {
    const dStr = toLocalYmd(date);
    return tasks.filter((task) => {
      if (selectedProjectId !== "all" && task.projectId !== selectedProjectId) {
        return false;
      }

      if (selectedStatus !== "all") {
        const isCompleted = task.isCompleted === 1 || (task as any).stageName === "已完成";
        const isPaused = task.status === "paused";
        const isNotStarted =
          task.isCompleted !== 1 &&
          !isPaused &&
          ((task as any).stageName === "待启动" || (task as any).stageName === "待规划");
        const isInProgress = task.isCompleted !== 1 && !isPaused && !isNotStarted;

        if (selectedStatus === "pending" && !isNotStarted) return false;
        if (selectedStatus === "in_progress" && !isInProgress) return false;
        if (selectedStatus === "paused" && !isPaused) return false;
        if (selectedStatus === "completed" && !isCompleted) return false;
      }

      if (!task.startDate && !task.endDate) return false;
      const start = taskDateOnly(task.startDate) || dStr;
      const end = taskDateOnly(task.endDate) || dStr;
      return dStr >= start && dStr <= end;
    });
  };

  const openCreateForDate = (date: Date) => {
    const ymd = toLocalYmd(date);
    setCreateDate(ymd);
    // Same-day short block (1h): snap to next half-hour if today, else 09:00–10:00
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    if (toLocalYmd(now) === ymd) {
      const totalMins = now.getHours() * 60 + now.getMinutes();
      const snapped = Math.ceil(totalMins / 30) * 30;
      const startH = Math.floor(snapped / 60) % 24;
      const startM = snapped % 60;
      const endTotal = snapped + 60;
      setCreateStartTime(`${pad(startH)}:${pad(startM)}`);
      setCreateEndTime(`${pad(Math.floor(endTotal / 60) % 24)}:${pad(endTotal % 60)}`);
    } else {
      setCreateStartTime("09:00");
      setCreateEndTime("10:00");
    }
    setCreateTitle("");
    setCreateProjectId(resolveCreateProjectId());
    setSelectedDate(date);
    setCreateOpen(true);
  };

  /** Combine local date + HH:mm into wall-clock storage form used by backend. */
  const combineDateTime = (ymd: string, hm: string): string => {
    const time = /^\d{1,2}:\d{2}$/.test(hm.trim()) ? hm.trim() : "09:00";
    const [h, m] = time.split(":");
    return `${ymd} ${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  };

  /** Shift wall-clock "YYYY-MM-DD HH:mm" by minutes (local). */
  const shiftWallClock = (ymdHm: string, deltaMinutes: number): string => {
    const m = ymdHm.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
    if (!m) return ymdHm;
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      0,
      0,
    );
    d.setMinutes(d.getMinutes() + deltaMinutes);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const ensureStageId = async (projectId: string): Promise<string> => {
    const stagesList = await api.getProjectStages(projectId);
    const prefer =
      stagesList.find((s) => s.name === "进行中") ||
      stagesList.find((s) => s.name === "待启动") ||
      stagesList.find((s) => s.name !== "已完成") ||
      stagesList[0];
    if (prefer) return prefer.id;
    const created = await api.createProjectStage(projectId, { name: "进行中" });
    return created.id;
  };

  const snapshotTask = (task: ProjectTask, mode: "copy" | "cut"): TaskClipboard => ({
    mode,
    title: task.title,
    description: task.description || "",
    projectId: task.projectId,
    priority: task.priority ?? 2,
    startTime: extractTimeHm(task.startDate),
    endTime: extractTimeHm(task.endDate),
    isRecurring: task.isRecurring,
    recurrenceRule: task.recurrenceRule ?? null,
    reminderOffsetValue: task.reminderOffsetValue,
    reminderOffsetUnit: task.reminderOffsetUnit,
    titleColor: task.titleColor ?? null,
    tags: (task.tags || []).map((tg) => tg.id),
    participants: (task.participants || [])
      .map((p) => p.userId || (p as { id?: string }).id)
      .filter((id): id is string => !!id),
  });

  const handleDeleteTask = async (task: ProjectTask) => {
    const ok = await confirm({
      title: "删除任务",
      description: `确定删除「${task.title}」？此操作不可撤销。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteProjectTask(task.id);
      toast.success("任务已删除");
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "删除失败");
    }
  };

  const handleCopyTask = (task: ProjectTask) => {
    setClipboard(snapshotTask(task, "copy"));
    toast.success("已复制任务，右键日期可粘贴");
  };

  const moveTaskToDate = async (task: ProjectTask, sourceYmd: string, targetYmd: string) => {
    if (!targetYmd || sourceYmd === targetYmd) return;
    const dayDelta = daysBetweenYmd(sourceYmd, targetYmd);
    if (dayDelta === 0) return;

    // Prefer shifting existing dates; if task had no dates, pin a same-day short block
    let nextStart = shiftFieldByDays(task.startDate, dayDelta);
    let nextEnd = shiftFieldByDays(task.endDate, dayDelta);
    if (!nextStart && !nextEnd) {
      nextStart = `${targetYmd} 09:00`;
      nextEnd = `${targetYmd} 10:00`;
    } else if (!nextEnd && nextStart) {
      nextEnd = nextStart;
    } else if (!nextStart && nextEnd) {
      nextStart = nextEnd;
    }

    // Keep remindAt aligned with the same day shift when possible
    let nextRemind = shiftFieldByDays(task.remindAt, dayDelta);
    if (!nextRemind && nextStart) {
      const m = nextStart.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
        d.setMinutes(d.getMinutes() - 5);
        const pad = (n: number) => String(n).padStart(2, "0");
        nextRemind = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }

    setMovingTaskId(task.id);
    try {
      await api.updateProjectTask(task.id, {
        startDate: nextStart,
        endDate: nextEnd,
        remindAt: nextRemind,
      });
      toast.success(`已移至 ${targetYmd}`);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "移动任务失败");
    } finally {
      setMovingTaskId(null);
    }
  };

  const onTaskDragStart = (e: React.DragEvent, task: ProjectTask, sourceYmd: string) => {
    e.stopPropagation();
    const payload = JSON.stringify({ taskId: task.id, sourceYmd });
    e.dataTransfer.setData(CAL_TASK_DRAG_MIME, payload);
    e.dataTransfer.setData("text/plain", payload);
    e.dataTransfer.effectAllowed = "move";
    setDraggingTaskId(task.id);
    suppressDayClickRef.current = true;
  };

  const onTaskDragEnd = () => {
    setDraggingTaskId(null);
    setDragOverYmd(null);
    // Keep suppress until after the synthetic click that follows drop
    window.setTimeout(() => {
      suppressDayClickRef.current = false;
    }, 50);
  };

  const onDayDragOver = (e: React.DragEvent, ymd: string) => {
    // Custom MIME types are unreliable in dragover.types; use drag session state.
    if (!draggingTaskId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragOverYmd !== ymd) setDragOverYmd(ymd);
  };

  const onDayDragLeave = (e: React.DragEvent, ymd: string) => {
    // Only clear when leaving the cell itself (not entering a child)
    const related = e.relatedTarget as Node | null;
    if (related && e.currentTarget.contains(related)) return;
    if (dragOverYmd === ymd) setDragOverYmd(null);
  };

  const onDayDrop = async (e: React.DragEvent, targetYmd: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverYmd(null);
    suppressDayClickRef.current = true;

    let raw = e.dataTransfer.getData(CAL_TASK_DRAG_MIME);
    if (!raw) raw = e.dataTransfer.getData("text/plain");
    if (!raw) return;

    try {
      const { taskId, sourceYmd } = JSON.parse(raw) as { taskId: string; sourceYmd: string };
      if (!taskId || !sourceYmd || sourceYmd === targetYmd) return;
      const task = tasks.find((t) => t.id === taskId) as ProjectTask | undefined;
      if (!task) {
        toast.error("找不到要移动的任务");
        return;
      }
      await moveTaskToDate(task, sourceYmd, targetYmd);
    } catch {
      toast.error("拖拽数据无效");
    } finally {
      setDraggingTaskId(null);
    }
  };

  const handleCutTask = async (task: ProjectTask) => {
    const snap = snapshotTask(task, "cut");
    // Persist clipboard before refresh/remount so paste option still appears
    setClipboard(snap);
    try {
      await api.deleteProjectTask(task.id);
      toast.success("已剪切任务，右键日期可粘贴");
      onRefresh?.();
    } catch (err: any) {
      setClipboard(null);
      toast.error(err?.message || "剪切失败");
    }
  };

  const pasteToDate = async (ymd: string) => {
    if (!clipboard) {
      toast.error("剪贴板为空");
      return;
    }
    const projectId =
      selectedProjectId !== "all" ? selectedProjectId : clipboard.projectId || resolveCreateProjectId();
    if (!projectId) {
      toast.error("无法确定目标项目，请先选择项目");
      return;
    }
    // Paste as a same-day task on the target date (short block by default)
    const startHm = clipboard.startTime || "09:00";
    let endHm = clipboard.endTime || "10:00";
    // If source only had end time / end before start, keep a 1h same-day window
    if (!clipboard.endTime && clipboard.startTime) {
      const [sh, sm] = startHm.split(":").map(Number);
      const endTotal = sh * 60 + sm + 60;
      endHm = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
    }
    if (endHm < startHm) {
      endHm = startHm;
    }
    const startAt = combineDateTime(ymd, startHm);
    const endAt = combineDateTime(ymd, endHm);
    try {
      const stageId = await ensureStageId(projectId);
      await api.createProjectTask(projectId, {
        stageId,
        title: clipboard.title,
        description: clipboard.description,
        startDate: startAt,
        endDate: endAt,
        priority: clipboard.priority,
        isRecurring: clipboard.isRecurring ? 1 : 0,
        recurrenceRule: clipboard.isRecurring ? clipboard.recurrenceRule : null,
        reminderOffsetValue: clipboard.reminderOffsetValue,
        reminderOffsetUnit: clipboard.reminderOffsetUnit,
        titleColor: clipboard.titleColor,
        tags: clipboard.tags,
        participants: clipboard.participants,
      });
      if (clipboard.mode === "cut") {
        setClipboard(null);
      }
      toast.success(clipboard.mode === "cut" ? "已粘贴（移动）" : "已粘贴（复制）");
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "粘贴失败");
    }
  };

  const handleCreateSubmit = async () => {
    const title = createTitle.trim();
    if (!title) {
      toast.error("请输入任务标题");
      return;
    }
    const projectId = createProjectId || resolveCreateProjectId();
    if (!projectId) {
      toast.error("请选择项目");
      return;
    }
    const startAt = combineDateTime(createDate, createStartTime);
    const endAt = combineDateTime(createDate, createEndTime);
    if (endAt < startAt) {
      toast.error("截止时间不能早于开始时间");
      return;
    }
    // Default: remind 5 minutes before task start
    const remindAt = shiftWallClock(startAt, -5);
    setCreating(true);
    try {
      const stageId = await ensureStageId(projectId);
      await api.createProjectTask(projectId, {
        stageId,
        title,
        startDate: startAt,
        endDate: endAt,
        priority: 2,
        remindAt,
        reminderOffsetValue: 5,
        reminderOffsetUnit: "minute",
      });
      toast.success("创建任务成功");
      setCreateOpen(false);
      setCreateTitle("");
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const openTaskContextMenu = (e: React.MouseEvent, task: ProjectTask) => {
    setCtxTask(task);
    setCtxDayYmd(null);
    openMenu(e, task.id, "task");
  };

  const openDayContextMenu = (e: React.MouseEvent, date: Date) => {
    setCtxTask(null);
    setCtxDayYmd(toLocalYmd(date));
    openMenu(e, toLocalYmd(date), "day");
  };

  const contextItems: ContextMenuItem[] = (() => {
    if (menu.targetType === "task" && ctxTask) {
      return [
        {
          id: "open",
          label: "打开详情",
          icon: <ExternalLink size={14} />,
        },
        { id: "sep1", label: "", separator: true },
        {
          id: "copy",
          label: "复制",
          icon: <Copy size={14} />,
        },
        {
          id: "cut",
          label: "剪切",
          icon: <Scissors size={14} />,
        },
        { id: "sep2", label: "", separator: true },
        {
          id: "delete",
          label: "删除",
          icon: <Trash2 size={14} />,
          danger: true,
        },
      ];
    }
    if (menu.targetType === "day") {
      const items: ContextMenuItem[] = [
        {
          id: "create",
          label: "新建任务",
          icon: <Plus size={14} />,
        },
      ];
      if (clipboard) {
        items.push({
          id: "paste",
          label: clipboard.mode === "cut" ? "粘贴（移动）" : "粘贴（复制）",
          icon: <ClipboardPaste size={14} />,
        });
      }
      return items;
    }
    return [];
  })();

  const handleContextAction = async (actionId: string) => {
    const task = ctxTask;
    const dayYmd = ctxDayYmd;
    const targetType = menu.targetType;
    closeMenu();

    if (targetType === "task" && task) {
      if (actionId === "open") {
        onTaskClick?.(task);
        return;
      }
      if (actionId === "copy") {
        handleCopyTask(task);
        return;
      }
      if (actionId === "cut") {
        await handleCutTask(task);
        return;
      }
      if (actionId === "delete") {
        await handleDeleteTask(task);
        return;
      }
    }

    if (targetType === "day" && dayYmd) {
      if (actionId === "create") {
        const [y, m, d] = dayYmd.split("-").map(Number);
        openCreateForDate(new Date(y, m - 1, d));
        return;
      }
      if (actionId === "paste") {
        await pasteToDate(dayYmd);
        return;
      }
    }
  };

  const weekDays = [
    t("calendar.sunday") || "日",
    t("calendar.monday") || "一",
    t("calendar.tuesday") || "二",
    t("calendar.wednesday") || "三",
    t("calendar.thursday") || "四",
    t("calendar.friday") || "五",
    t("calendar.saturday") || "六",
  ];

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 select-none">
      {/* Calendar Header */}
      <div className="flex items-center justify-between p-4 border-b border-app-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarIcon size={18} className="text-accent-primary shrink-0" />
          <h2 className="text-base font-bold text-tx-primary">
            {year}年 {month + 1}月
          </h2>
          {clipboard && (
            <span className="hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-accent-primary/10 text-accent-primary truncate">
              剪贴板：{clipboard.mode === "cut" ? "剪切" : "复制"}「{clipboard.title}」
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {showProjectFilter && (
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="sleek-select h-8 px-2 text-xs text-tx-secondary rounded-lg border border-app-border bg-app-sidebar focus:outline-none focus:ring-1 focus:ring-accent-primary max-w-[120px] md:max-w-[150px] truncate"
            >
              <option value="all">{t("projects.allProjects") || "全部项目"}</option>
              {uniqueProjects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="sleek-select h-8 px-2 text-xs text-tx-secondary rounded-lg border border-app-border bg-app-sidebar focus:outline-none focus:ring-1 focus:ring-accent-primary min-w-[85px] max-w-[120px] truncate"
          >
            <option value="all">{t("calendar.allStatus") || "所有状态"}</option>
            <option value="pending">{t("calendar.statusPending") || "待启动"}</option>
            <option value="in_progress">{t("calendar.statusInProgress") || "进行中"}</option>
            <option value="paused">{t("calendar.statusPaused") || "已暂停"}</option>
            <option value="completed">{t("calendar.statusCompleted") || "已完成"}</option>
          </select>

          <Button variant="outline" size="sm" onClick={today} className="text-xs">
            {t("calendar.today") || "今天"}
          </Button>
          <Button variant="ghost" size="icon" onClick={prevMonth} className="h-8 w-8">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={nextMonth} className="h-8 w-8">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Week Header */}
      <div className="grid grid-cols-7 border-b border-app-border bg-app-sidebar shrink-0 text-center py-2 text-xs font-semibold text-tx-tertiary">
        {weekDays.map((day, idx) => (
          <div key={idx} className={idx === 0 || idx === 6 ? "text-accent-danger/75" : ""}>
            {day}
          </div>
        ))}
      </div>

      {/* Grid Days */}
      <div
        className={cn(
          "grid grid-cols-7 grid-rows-6 divide-x divide-y divide-app-border border-b border-app-border shrink-0",
          isMobile ? "h-64" : "flex-1 min-h-0",
        )}
      >
        {calendarCells.map((cell, idx) => {
          const dayTasks = getTasksForDate(cell.date);
          const isToday = cell.date.toDateString() === new Date().toDateString();

          const lunar = Lunar.fromDate(cell.date);
          const lunarDateStr =
            lunar.getDay() === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese();

          const isFirstDayOfMonth = cell.date.getDate() === 1;
          const solarDateStr = isFirstDayOfMonth
            ? `${cell.date.getMonth() + 1}月1日`
            : `${cell.date.getDate()}日`;

          const labels: { text: string; isHoliday: boolean; isWork?: boolean }[] = [];
          const h = HolidayUtil.getHoliday(
            cell.date.getFullYear(),
            cell.date.getMonth() + 1,
            cell.date.getDate(),
          );
          let holidayName = "";
          if (h) {
            holidayName = h.getName();
            labels.push({
              text: `${holidayName} (${h.isWork() ? "班" : "休"})`,
              isHoliday: true,
              isWork: h.isWork(),
            });
          }

          const jieQi = lunar.getJieQi();
          if (jieQi) {
            labels.push({ text: jieQi, isHoliday: false });
          }

          const solar = Solar.fromDate(cell.date);
          solar.getFestivals().forEach((f: string) => {
            if (!holidayName || (!holidayName.includes(f) && !f.includes(holidayName))) {
              labels.push({ text: f, isHoliday: false });
            }
          });

          lunar.getFestivals().forEach((f: string) => {
            if (!holidayName || (!holidayName.includes(f) && !f.includes(holidayName))) {
              labels.push({ text: f, isHoliday: false });
            }
          });

          const cellYmd = toLocalYmd(cell.date);
          const isDropTarget = dragOverYmd === cellYmd && !!draggingTaskId;

          return (
            <div
              key={idx}
              onClick={() => {
                if (suppressDayClickRef.current) return;
                if (isMobile) {
                  setSelectedDate(cell.date);
                  return;
                }
                openCreateForDate(cell.date);
              }}
              onContextMenu={(e) => openDayContextMenu(e, cell.date)}
              onDragOver={(e) => onDayDragOver(e, cellYmd)}
              onDragLeave={(e) => onDayDragLeave(e, cellYmd)}
              onDrop={(e) => void onDayDrop(e, cellYmd)}
              className={cn(
                "min-h-0 flex flex-col p-1.5 space-y-1 transition-colors cursor-pointer",
                cell.isCurrentMonth ? "bg-app-bg" : "bg-app-sidebar/45 opacity-55",
                isMobile &&
                  cell.date.toDateString() === selectedDate.toDateString() &&
                  "bg-accent-primary/10 border-accent-primary/40 border-2",
                !isMobile &&
                  "hover:bg-app-hover/40 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover/40",
                isDropTarget && "bg-accent-primary/15 ring-2 ring-inset ring-accent-primary/50",
              )}
              title={isMobile ? undefined : "点击新建 · 拖拽任务到此 · 右键更多"}
            >
              <div className="flex justify-between items-center text-xs shrink-0 select-none">
                <span className="text-tx-tertiary text-[9px] font-medium truncate max-w-[50%]">
                  {lunarDateStr}
                </span>
                <span
                  className={cn(
                    "text-xs font-semibold flex items-center gap-0.5 shrink-0",
                    cell.isCurrentMonth ? "text-tx-secondary" : "text-tx-tertiary",
                  )}
                >
                  {isToday ? (
                    <>
                      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#ff4d4f] text-white text-[10px] font-bold shrink-0">
                        {cell.date.getDate()}
                      </span>
                      <span>日</span>
                    </>
                  ) : (
                    solarDateStr
                  )}
                </span>
              </div>

              {labels.length > 0 && !isMobile && (
                <div className="flex flex-col gap-0.5 shrink-0">
                  {labels.map((lbl, lIdx) => (
                    <div
                      key={lIdx}
                      className={cn(
                        "w-full px-1 py-0.5 rounded text-[9px] leading-none font-semibold flex items-center gap-0.5 border border-transparent truncate shrink-0",
                        lbl.isHoliday
                          ? lbl.isWork
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-500 border-amber-500/20"
                            : "bg-[#e6f4ff] text-[#1677ff] border border-[#d9d9d9]/10"
                          : "bg-[#e6f4ff] text-[#1677ff]",
                      )}
                      title={lbl.text}
                    >
                      {!lbl.isHoliday && (
                        <span className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-[#1677ff] text-white shrink-0 scale-90">
                          <Star size={7} className="fill-current text-white" />
                        </span>
                      )}
                      <span className="truncate">{lbl.text}</span>
                    </div>
                  ))}
                </div>
              )}

              {!isMobile ? (
                <div className="flex-1 overflow-y-auto space-y-1 max-h-[100px] scrollbar-none">
                  {dayTasks.slice(0, 3).map((task) => {
                    const isDragging = draggingTaskId === task.id;
                    const isMoving = movingTaskId === task.id;
                    return (
                    <div
                      key={task.id}
                      draggable={!isMoving}
                      onDragStart={(e) => onTaskDragStart(e, task, cellYmd)}
                      onDragEnd={onTaskDragEnd}
                      className={cn(
                        "group/cal-task relative flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border truncate font-medium cursor-grab active:cursor-grabbing select-none",
                        "transition-[opacity,background-color,border-color,box-shadow] duration-fast ease-out",
                        task.isCompleted === 1
                          ? "bg-green-500/10 border-green-500/20 text-green-600 line-through decoration-green-600/50"
                          : "bg-accent-primary/10 border-accent-primary/20 text-accent-primary hover:bg-accent-primary/20",
                        isDragging && "opacity-40",
                        isMoving && "opacity-60 pointer-events-none",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressDayClickRef.current || isDragging) return;
                        onTaskClick?.(task);
                      }}
                      onContextMenu={(e) => {
                        e.stopPropagation();
                        openTaskContextMenu(e, task);
                      }}
                      title={`${task.title}（拖到其他日期可移动 · 右键更多）`}
                    >
                      {task.isCompleted === 1 ? (
                        <CheckCircle2 size={10} className="shrink-0 text-green-500" />
                      ) : (
                        <Circle size={10} className="shrink-0 text-accent-primary" />
                      )}
                      <span className="truncate">{task.title}</span>
                    </div>
                    );
                  })}
                  {dayTasks.length > 3 && (
                    <div className="text-[9px] text-tx-tertiary text-center font-medium">
                      +{dayTasks.length - 3} ...
                    </div>
                  )}
                </div>
              ) : (
                dayTasks.length > 0 && (
                  <div className="flex justify-center items-center mt-1 select-none pointer-events-none">
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-primary" />
                  </div>
                )
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile Task List for Selected Date */}
      {isMobile && (
        <div className="flex-1 flex flex-col min-h-0 bg-app-bg border-t border-app-border/40 select-text overflow-hidden">
          <div className="px-4 py-2.5 bg-app-sidebar/20 border-b border-app-border/30 flex items-center justify-between shrink-0 gap-2">
            <span className="text-[11px] font-bold text-tx-secondary min-w-0 truncate">
              {format(selectedDate, "yyyy年MM月dd日")} (
              {["周日", "周一", "周二", "周三", "周四", "周五", "周六"][selectedDate.getDay()]}) 的任务
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary font-mono">
                {getTasksForDate(selectedDate).length}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[11px] px-2 gap-1"
                onClick={() => openCreateForDate(selectedDate)}
              >
                <Plus size={12} />
                新建
              </Button>
              {clipboard && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-[11px] px-2"
                  onClick={() => pasteToDate(toLocalYmd(selectedDate))}
                >
                  粘贴
                </Button>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-app-border/10 p-2">
            {getTasksForDate(selectedDate).map((task) => (
              <div
                key={task.id}
                onClick={() => onTaskClick?.(task)}
                onContextMenu={(e) => openTaskContextMenu(e, task)}
                className="flex items-center justify-between p-3 active:bg-app-hover/10 rounded-xl cursor-pointer min-h-11"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span
                    className={cn(
                      "text-xs font-semibold truncate text-tx-secondary",
                      task.isCompleted === 1 && "line-through opacity-50",
                    )}
                  >
                    {task.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-tx-tertiary shrink-0">
                  <span>{(task as any).projectName || "个人TODO"}</span>
                </div>
              </div>
            ))}
            {getTasksForDate(selectedDate).length === 0 && (
              <div className="text-center py-8 text-xs text-tx-tertiary select-none">
                这一天没有安排任何任务
                <button
                  type="button"
                  className="block mx-auto mt-3 text-accent-primary font-semibold"
                  onClick={() => openCreateForDate(selectedDate)}
                >
                  点击创建
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <ContextMenu
        isOpen={menu.isOpen}
        x={menu.x}
        y={menu.y}
        items={contextItems}
        menuRef={menuRef}
        onAction={handleContextAction}
        header={
          menu.targetType === "task" && ctxTask
            ? ctxTask.title
            : menu.targetType === "day" && ctxDayYmd
              ? ctxDayYmd
              : undefined
        }
      />

      {createOpen && (
        <AppModal
          title={`新建任务 · ${createDate}`}
          onClose={() => !creating && setCreateOpen(false)}
          widthClass="max-w-sm"
        >
          <div className="space-y-4 p-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-tx-secondary">任务标题</label>
              <Input
                autoFocus
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="输入任务名称"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleCreateSubmit();
                  }
                }}
              />
            </div>
            {(showProjectFilter || uniqueProjects.length > 1) && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-tx-secondary">所属项目</label>
                <select
                  value={createProjectId}
                  onChange={(e) => setCreateProjectId(e.target.value)}
                  className="sleek-select w-full h-9 px-2 text-sm rounded-lg border border-app-border bg-app-bg text-tx-primary focus:outline-none focus:ring-1 focus:ring-accent-primary"
                >
                  {uniqueProjects.length === 0 && defaultProjectId && (
                    <option value={defaultProjectId}>当前项目</option>
                  )}
                  {uniqueProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-tx-secondary">日期</label>
              <p className="text-sm font-mono text-tx-primary">{createDate}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-tx-secondary" htmlFor="cal-create-start">
                  开始时间
                </label>
                <Input
                  id="cal-create-start"
                  type="time"
                  value={createStartTime}
                  onChange={(e) => setCreateStartTime(e.target.value || "09:00")}
                  className="h-9 font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-tx-secondary" htmlFor="cal-create-end">
                  截止时间
                </label>
                <Input
                  id="cal-create-end"
                  type="time"
                  value={createEndTime}
                  onChange={(e) => setCreateEndTime(e.target.value || "10:00")}
                  className="h-9 font-mono"
                />
              </div>
            </div>
            <p className="text-[11px] text-tx-tertiary">
              当天短时任务 ·{" "}
              <span className="font-mono text-tx-secondary">
                {createDate} {createStartTime || "09:00"}
              </span>
              {" ~ "}
              <span className="font-mono text-tx-secondary">
                {createDate} {createEndTime || "10:00"}
              </span>
              <span className="block mt-1">默认开始前 5 分钟提醒</span>
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={creating || !createTitle.trim()}
                onClick={() => void handleCreateSubmit()}
                className="bg-accent-primary text-white hover:bg-accent-primary/95"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : "创建"}
              </Button>
            </div>
          </div>
        </AppModal>
      )}
    </div>
  );
}
