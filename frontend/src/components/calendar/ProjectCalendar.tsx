import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Plus,
  Trash2,
  Scissors,
  Copy,
  ClipboardPaste,
  ExternalLink,
  Palette,
} from "lucide-react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { confirm } from "@/components/ui/confirm";
import ContextMenu, { type ContextMenuItem } from "@/components/ContextMenu";
import { useContextMenu } from "@/hooks/useContextMenu";
import type { ProjectTask } from "@/types";

import type { CalendarTask, CalendarViewMode, ProjectCalendarProps, TaskClipboard } from "./types";
import { CALENDAR_VIEW_STORAGE_KEY, CAL_TASK_DRAG_MIME } from "./types";
import {
  combineDateTime,
  daysBetweenYmd,
  defaultSlotForYmd,
  extractTimeHm,
  shiftFieldByDays,
  shiftWallClock,
  toLocalYmd,
  ymdToDate,
} from "./dateUtils";
import { filterTasksByProjectStatus, flattenStageTasks } from "./taskUtils";
import { useTaskClipboard } from "./clipboard";
import CreateTaskModal from "./CreateTaskModal";
import ColorSwatchPicker from "./ColorSwatchPicker";
import MonthView from "./views/MonthView";
import DayView from "./views/DayView";
import WeekView from "./views/WeekView";
import YearView from "./views/YearView";
import { DEFAULT_CAL_COLOR, nextCreateColorKey, resolveTaskColorKey } from "./taskColors";

function loadViewMode(): CalendarViewMode {
  try {
    const v = localStorage.getItem(CALENDAR_VIEW_STORAGE_KEY);
    if (v === "day" || v === "week" || v === "month" || v === "year") return v;
  } catch {
    /* ignore */
  }
  return "month";
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
  const [viewMode, setViewMode] = useState<CalendarViewMode>(() => loadViewMode());
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const [clipboard, setClipboard] = useTaskClipboard();
  const [createOpen, setCreateOpen] = useState(false);
  const [createDate, setCreateDate] = useState(() => toLocalYmd(new Date()));
  const [createStartTime, setCreateStartTime] = useState("09:00");
  const [createEndTime, setCreateEndTime] = useState("10:00");
  const [createTitle, setCreateTitle] = useState("");
  const [createProjectId, setCreateProjectId] = useState("");
  const [createColor, setCreateColor] = useState(DEFAULT_CAL_COLOR);
  const [creating, setCreating] = useState(false);

  const { menu, menuRef, openMenu, closeMenu } = useContextMenu();
  const [ctxTask, setCtxTask] = useState<CalendarTask | null>(null);
  const [ctxDayYmd, setCtxDayYmd] = useState<string | null>(null);
  /** Color picker popover for context-menu "更改颜色" */
  const [colorPicker, setColorPicker] = useState<{
    task: CalendarTask;
    x: number;
    y: number;
  } | null>(null);

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverYmd, setDragOverYmd] = useState<string | null>(null);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const suppressDayClickRef = useRef(false);

  useEffect(() => {
    try {
      localStorage.setItem(CALENDAR_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const tasks = useMemo(() => flattenStageTasks(stages) as CalendarTask[], [stages]);

  const filteredTasks = useMemo(
    () => filterTasksByProjectStatus(tasks, selectedProjectId, selectedStatus),
    [tasks, selectedProjectId, selectedStatus],
  );

  const uniqueProjects = useMemo(() => {
    const projMap = new Map<string, string>();
    if (projectsProp?.length) {
      for (const p of projectsProp) projMap.set(p.id, p.name);
    }
    tasks.forEach((task) => {
      if (task.projectId && !projMap.has(task.projectId)) {
        projMap.set(task.projectId, task.projectName || task.projectId);
      }
    });
    return Array.from(projMap.entries()).map(([id, name]) => ({ id, name }));
  }, [tasks, projectsProp]);

  const resolveCreateProjectId = useCallback(() => {
    if (selectedProjectId !== "all") return selectedProjectId;
    if (defaultProjectId) return defaultProjectId;
    return uniqueProjects[0]?.id || "";
  }, [selectedProjectId, defaultProjectId, uniqueProjects]);

  useEffect(() => {
    if (createOpen && !createProjectId) {
      setCreateProjectId(resolveCreateProjectId());
    }
  }, [createOpen, createProjectId, resolveCreateProjectId]);

  const openCreateForDate = (date: Date, startHm?: string, endHm?: string) => {
    const ymd = toLocalYmd(date);
    setCreateDate(ymd);
    if (startHm && endHm) {
      setCreateStartTime(startHm);
      setCreateEndTime(endHm);
    } else {
      const slot = defaultSlotForYmd(ymd);
      setCreateStartTime(slot.start);
      setCreateEndTime(slot.end);
    }
    setCreateTitle("");
    setCreateProjectId(resolveCreateProjectId());
    setCreateColor(DEFAULT_CAL_COLOR);
    setSelectedDate(date);
    setAnchorDate(date);
    setCreateOpen(true);
  };

  const handleChangeTaskColor = async (task: CalendarTask, colorKey: string) => {
    try {
      await api.updateProjectTask(task.id, { titleColor: colorKey || null });
      toast.success("已更新颜色");
      setColorPicker(null);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "更新颜色失败");
    }
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

  const handleCutTask = async (task: ProjectTask) => {
    const snap = snapshotTask(task, "cut");
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

  const moveTaskToDate = async (task: ProjectTask, sourceYmd: string, targetYmd: string) => {
    if (!targetYmd || sourceYmd === targetYmd) return;
    const dayDelta = daysBetweenYmd(sourceYmd, targetYmd);
    if (dayDelta === 0) return;

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

    let nextRemind = shiftFieldByDays(task.remindAt, dayDelta);
    if (!nextRemind && nextStart) {
      nextRemind = shiftWallClock(nextStart, -5);
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

  const onTaskDragStart = (e: React.DragEvent, task: CalendarTask, sourceYmd: string) => {
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
    window.setTimeout(() => {
      suppressDayClickRef.current = false;
    }, 50);
  };

  const onDayDragOver = (e: React.DragEvent, ymd: string) => {
    if (!draggingTaskId) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragOverYmd !== ymd) setDragOverYmd(ymd);
  };

  const onDayDragLeave = (e: React.DragEvent, ymd: string) => {
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
      const task = tasks.find((t) => t.id === taskId);
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
    const startHm = clipboard.startTime || "09:00";
    let endHm = clipboard.endTime || "10:00";
    if (!clipboard.endTime && clipboard.startTime) {
      const [sh, sm] = startHm.split(":").map(Number);
      const endTotal = sh * 60 + sm + 60;
      endHm = `${String(Math.floor(endTotal / 60) % 24).padStart(2, "0")}:${String(endTotal % 60).padStart(2, "0")}`;
    }
    if (endHm < startHm) endHm = startHm;
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
        titleColor: clipboard.titleColor || nextCreateColorKey(),
        tags: clipboard.tags,
        participants: clipboard.participants,
      });
      if (clipboard.mode === "cut") setClipboard(null);
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
    const remindAt = shiftWallClock(startAt, -5);
    const titleColor = createColor || DEFAULT_CAL_COLOR;
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
        titleColor,
      });
      toast.success("创建任务成功");
      setCreateOpen(false);
      setCreateTitle("");
      setCreateColor(DEFAULT_CAL_COLOR);
      onRefresh?.();
    } catch (err: any) {
      toast.error(err?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const openTaskContextMenu = (e: React.MouseEvent, task: CalendarTask) => {
    e.preventDefault();
    setCtxTask(task);
    setCtxDayYmd(null);
    openMenu(e, task.id, "task");
  };

  const openDayContextMenu = (e: React.MouseEvent, date: Date) => {
    e.preventDefault();
    setCtxTask(null);
    setCtxDayYmd(toLocalYmd(date));
    openMenu(e, toLocalYmd(date), "day");
  };

  const openDayContextMenuYmd = (e: React.MouseEvent, ymd: string) => {
    e.preventDefault();
    setCtxTask(null);
    setCtxDayYmd(ymd);
    openMenu(e, ymd, "day");
  };

  const contextItems: ContextMenuItem[] = (() => {
    if (menu.targetType === "task" && ctxTask) {
      return [
        { id: "open", label: "打开详情", icon: <ExternalLink size={14} /> },
        { id: "color", label: "更改颜色", icon: <Palette size={14} /> },
        { id: "sep1", label: "", separator: true },
        { id: "copy", label: "复制", icon: <Copy size={14} /> },
        { id: "cut", label: "剪切", icon: <Scissors size={14} /> },
        { id: "sep2", label: "", separator: true },
        { id: "delete", label: "删除", icon: <Trash2 size={14} />, danger: true },
      ];
    }
    if (menu.targetType === "day") {
      const items: ContextMenuItem[] = [
        { id: "create", label: "新建任务", icon: <Plus size={14} /> },
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
    const menuX = menu.x;
    const menuY = menu.y;
    closeMenu();

    if (targetType === "task" && task) {
      if (actionId === "open") {
        onTaskClick?.(task);
        return;
      }
      if (actionId === "color") {
        setColorPicker({ task, x: menuX, y: menuY });
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
        openCreateForDate(ymdToDate(dayYmd));
        return;
      }
      if (actionId === "paste") {
        await pasteToDate(dayYmd);
        return;
      }
    }
  };

  const goPrev = () => {
    const d = new Date(anchorDate);
    if (viewMode === "day") d.setDate(d.getDate() - 1);
    else if (viewMode === "week") d.setDate(d.getDate() - 7);
    else if (viewMode === "month") d.setMonth(d.getMonth() - 1);
    else d.setFullYear(d.getFullYear() - 1);
    setAnchorDate(d);
    setSelectedDate(d);
  };

  const goNext = () => {
    const d = new Date(anchorDate);
    if (viewMode === "day") d.setDate(d.getDate() + 1);
    else if (viewMode === "week") d.setDate(d.getDate() + 7);
    else if (viewMode === "month") d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    setAnchorDate(d);
    setSelectedDate(d);
  };

  const goToday = () => {
    const d = new Date();
    setAnchorDate(d);
    setSelectedDate(d);
  };

  const titleText = (() => {
    const y = anchorDate.getFullYear();
    const m = anchorDate.getMonth() + 1;
    if (viewMode === "year") return `${y}年`;
    if (viewMode === "month") return `${y}年 ${m}月`;
    if (viewMode === "week") {
      return `${y}年${m}月`;
    }
    return `${y}年${m}月${anchorDate.getDate()}日`;
  })();

  const weekDayLabels = [
    t("calendar.sunday") || "日",
    t("calendar.monday") || "一",
    t("calendar.tuesday") || "二",
    t("calendar.wednesday") || "三",
    t("calendar.thursday") || "四",
    t("calendar.friday") || "五",
    t("calendar.saturday") || "六",
  ];

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  const viewModes: { id: CalendarViewMode; label: string }[] = [
    { id: "day", label: "日" },
    { id: "week", label: "周" },
    { id: "month", label: "月" },
    { id: "year", label: "年" },
  ];

  const sharedTimeHandlers = {
    onTaskClick,
    onTaskContextMenu: openTaskContextMenu,
    onEmptyClick: (ymd: string, startHm: string, endHm: string) => {
      openCreateForDate(ymdToDate(ymd), startHm, endHm);
    },
    onEmptyContextMenu: openDayContextMenuYmd,
    onDayDrop,
    onTaskDragStart,
    onTaskDragEnd,
    draggingTaskId,
    dragOverYmd,
    onDayDragOver,
    onDayDragLeave,
  };

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 select-none">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-3 md:p-4 border-b border-app-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <CalendarIcon size={18} className="text-accent-primary shrink-0" />
          <h2 className="text-base font-bold text-tx-primary truncate">{titleText}</h2>
          {clipboard && (
            <span className="hidden sm:inline text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-accent-primary/10 text-accent-primary truncate max-w-[160px]">
              剪贴板：{clipboard.mode === "cut" ? "剪切" : "复制"}「{clipboard.title}」
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* View switcher */}
          <div className="inline-flex rounded-button border border-app-border bg-app-sidebar p-0.5">
            {viewModes.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewMode(v.id)}
                className={cn(
                  "px-2.5 h-7 text-xs font-semibold rounded-[calc(var(--radius-button)-2px)] min-w-[32px]",
                  "transition-[background-color,color] duration-fast ease-out",
                  viewMode === v.id
                    ? "bg-app-elevated text-tx-primary shadow-xs"
                    : "text-tx-tertiary hover:text-tx-secondary",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>

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

          <Button variant="outline" size="sm" onClick={goToday} className="text-xs">
            {t("calendar.today") || "今天"}
          </Button>
          <Button variant="ghost" size="icon" onClick={goPrev} className="h-8 w-8">
            <ChevronLeft size={16} />
          </Button>
          <Button variant="ghost" size="icon" onClick={goNext} className="h-8 w-8">
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>

      {/* Views */}
      {viewMode === "month" && (
        <MonthView
          anchorDate={anchorDate}
          selectedDate={selectedDate}
          tasks={filteredTasks}
          weekDayLabels={weekDayLabels}
          isMobile={isMobile}
          clipboardTitle={clipboard?.title}
          draggingTaskId={draggingTaskId}
          dragOverYmd={dragOverYmd}
          movingTaskId={movingTaskId}
          suppressDayClickRef={suppressDayClickRef}
          onSelectDate={setSelectedDate}
          onOpenCreate={openCreateForDate}
          onTaskClick={onTaskClick}
          onTaskContextMenu={openTaskContextMenu}
          onDayContextMenu={openDayContextMenu}
          onTaskDragStart={onTaskDragStart}
          onTaskDragEnd={onTaskDragEnd}
          onDayDragOver={onDayDragOver}
          onDayDragLeave={onDayDragLeave}
          onDayDrop={onDayDrop}
          onPaste={pasteToDate}
          onDrillDay={(d) => {
            setAnchorDate(d);
            setSelectedDate(d);
            setViewMode("day");
          }}
        />
      )}

      {viewMode === "day" && (
        <DayView anchorDate={anchorDate} tasks={filteredTasks} {...sharedTimeHandlers} />
      )}

      {viewMode === "week" && (
        <WeekView anchorDate={anchorDate} tasks={filteredTasks} {...sharedTimeHandlers} />
      )}

      {viewMode === "year" && (
        <YearView
          year={anchorDate.getFullYear()}
          tasks={filteredTasks}
          onDayClick={(d) => {
            setAnchorDate(d);
            setSelectedDate(d);
            setViewMode("day");
          }}
          onMonthClick={(y, m) => {
            setAnchorDate(new Date(y, m, 1));
            setSelectedDate(new Date(y, m, 1));
            setViewMode("month");
          }}
        />
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

      <CreateTaskModal
        open={createOpen}
        creating={creating}
        createDate={createDate}
        createTitle={createTitle}
        createStartTime={createStartTime}
        createEndTime={createEndTime}
        createProjectId={createProjectId}
        createColor={createColor}
        showProjectFilter={showProjectFilter}
        uniqueProjects={uniqueProjects}
        defaultProjectId={defaultProjectId}
        onClose={() => setCreateOpen(false)}
        onSubmit={() => void handleCreateSubmit()}
        onTitleChange={setCreateTitle}
        onStartTimeChange={setCreateStartTime}
        onEndTimeChange={setCreateEndTime}
        onProjectChange={setCreateProjectId}
        onColorChange={setCreateColor}
      />

      {colorPicker &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-popover"
              onClick={() => setColorPicker(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                setColorPicker(null);
              }}
            />
            <div
              className={cn(
                "fixed z-popover w-52 p-3 rounded-card shadow-lg",
                "bg-app-elevated border border-app-border",
              )}
              style={{
                top: Math.min(colorPicker.y, window.innerHeight - 160),
                left: Math.min(colorPicker.x, window.innerWidth - 220),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-[11px] font-semibold text-tx-tertiary mb-2 truncate">
                更改颜色 · {colorPicker.task.title}
              </div>
              <ColorSwatchPicker
                value={resolveTaskColorKey(colorPicker.task)}
                onChange={(key) => void handleChangeTaskColor(colorPicker.task, key)}
                size="sm"
              />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
