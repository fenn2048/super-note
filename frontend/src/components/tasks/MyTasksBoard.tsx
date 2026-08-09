/**
 * 我的任务看板（列表 / 矩阵整理 / 今日主模块 / 筛选）
 * 路由级懒加载入口：import("@/components/tasks/MyTasksBoard")
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, X, ListTodo,
} from "lucide-react";
import { format, isToday, isPast } from "date-fns";
import type { Project, ProjectTask, Tag } from "@/types";
import { api } from "@/lib/api";
import { cn, detectSuMention } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
} from "@/components/common/FeedbackStates";
import { type RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import { matrixBucketToFlags, type MatrixBucket } from "@/components/TaskMatrixView";
import TaskCreateForm, { type TaskCreateFormValues } from "@/components/TaskCreateForm";
import MyTasksFilterSheet from "@/components/MyTasksFilterSheet";
import { toLocalDate } from "@/components/tasks/TaskListRow";
import MyTasksHeader from "@/components/tasks/MyTasksHeader";
import MyTasksListView from "@/components/tasks/MyTasksListView";
import MyTasksMatrixPanel from "@/components/tasks/MyTasksMatrixPanel";
import MyTasksQuickAdd, { type MyTasksQuickAddValues } from "@/components/tasks/MyTasksQuickAdd";
import MyTasksSidebar from "@/components/tasks/MyTasksSidebar";
import {
  compareByQuadrant,
  matchesQuadrantFilter,
  type QuadrantFilter,
} from "@/lib/taskQuadrant";
import {
  resolveCompletedStageId,
  resolveInProgressStageId,
  resolveNotStartedStageId,
} from "@/lib/taskEntry";
import { getTaskLifeState, LIFE_COPY } from "@/lib/taskLifecycle";
import { useScrollHideBars } from "@/hooks/useScrollHideBars";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { BottomSheet } from "@/components/common/BottomSheet";
import { syncTaskNotification } from "@/hooks/useCapacitor";
export type MyTasksBoardProps = {
  projects: Project[];
  currentUserId: string;
  workspaceId: string;
  wsMembers: any[];
  favorites: string[];
  /** 打开任务详情（父级持有 TaskDetailModal） */
  onOpenTask?: (task: ProjectTask) => void;
  /** 父级刷新信号（可选） */
  refreshToken?: number;
};

const ScrollContainer = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className }, ref) => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return (
        <div ref={ref} className={cn("overflow-y-auto min-h-0", className)}>
          {children}
        </div>
      );
    }
    return (
      <ScrollArea ref={ref} className={className}>
        {children}
      </ScrollArea>
    );
  },
);
ScrollContainer.displayName = "MyTasksScrollContainer";

export default function MyTasksBoard({
  projects,
  currentUserId,
  workspaceId,
  wsMembers,
  favorites,
  onOpenTask,
  refreshToken = 0,
}: MyTasksBoardProps) {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const myTasksScrollRef = useRef<HTMLDivElement>(null);

  const [myTasks, setMyTasks] = useState<ProjectTask[]>([]);
  const [loadingMyTasks, setLoadingMyTasks] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"favorites" | "assigned" | "created" | "participating">("assigned");
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchMode, setProjectSearchMode] = useState<"AND" | "OR">("AND");
  const [selectedProjectTagId, setSelectedProjectTagId] = useState<string | null>(null);
  const [myTasksProjectFilter, setMyTasksProjectFilter] = useState<string>("all");
  const [myTasksQuadrantFilter, setMyTasksQuadrantFilter] = useState<QuadrantFilter>("all");
  const [myTasksViewMode, setMyTasksViewMode] = useState<"flow" | "matrix">(() => {
    try {
      const v = localStorage.getItem("super-my-tasks-view");
      if (v === "matrix" || v === "flow") return v;
    } catch { /* ignore */ }
    return "flow";
  });
  const [showMobileMyTasksSearch, setShowMobileMyTasksSearch] = useState(false);
  const [showProjectFilterSheet, setShowProjectFilterSheet] = useState(false);
  const [availableProjectTags, setAvailableProjectTags] = useState<Tag[]>([]);

  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddProjId, setQuickAddProjId] = useState("");
  const [quickAddAssigneeId, setQuickAddAssigneeId] = useState("");
  const [quickAddDueDate, setQuickAddDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quickAddCategoryId, setQuickAddCategoryId] = useState<string | null>(null);
  const [quickAddIsImportant, setQuickAddIsImportant] = useState<number | null>(null);
  const [quickAddIsUrgent, setQuickAddIsUrgent] = useState<number | null>(null);
  const [quickAddIsPersonal, setQuickAddIsPersonal] = useState(true);
  const [quickAddTags, setQuickAddTags] = useState<Tag[]>([]);
  const [quickAddIsRecurring, setQuickAddIsRecurring] = useState(false);
  const [quickAddRecurrenceRule, setQuickAddRecurrenceRule] = useState<RecurrenceRule>({ type: "weekday" });
  const [quickAddCursorPos, setQuickAddCursorPos] = useState(0);

  const quickAddValues: MyTasksQuickAddValues = useMemo(
    () => ({
      title: quickAddTitle,
      projId: quickAddProjId,
      assigneeId: quickAddAssigneeId,
      dueDate: quickAddDueDate,
      categoryId: quickAddCategoryId,
      isImportant: quickAddIsImportant,
      isUrgent: quickAddIsUrgent,
      isPersonal: quickAddIsPersonal,
      tags: quickAddTags,
      isRecurring: quickAddIsRecurring,
      recurrenceRule: quickAddRecurrenceRule,
      cursorPos: quickAddCursorPos,
    }),
    [
      quickAddTitle, quickAddProjId, quickAddAssigneeId, quickAddDueDate, quickAddCategoryId,
      quickAddIsImportant, quickAddIsUrgent, quickAddIsPersonal, quickAddTags,
      quickAddIsRecurring, quickAddRecurrenceRule, quickAddCursorPos,
    ],
  );

  const patchQuickAdd = useCallback((patch: Partial<MyTasksQuickAddValues>) => {
    if (patch.title !== undefined) setQuickAddTitle(patch.title);
    if (patch.projId !== undefined) setQuickAddProjId(patch.projId);
    if (patch.assigneeId !== undefined) setQuickAddAssigneeId(patch.assigneeId);
    if (patch.dueDate !== undefined) setQuickAddDueDate(patch.dueDate);
    if (patch.categoryId !== undefined) setQuickAddCategoryId(patch.categoryId);
    if (patch.isImportant !== undefined) setQuickAddIsImportant(patch.isImportant);
    if (patch.isUrgent !== undefined) setQuickAddIsUrgent(patch.isUrgent);
    if (patch.isPersonal !== undefined) setQuickAddIsPersonal(patch.isPersonal);
    if (patch.tags !== undefined) setQuickAddTags(patch.tags);
    if (patch.isRecurring !== undefined) setQuickAddIsRecurring(patch.isRecurring);
    if (patch.recurrenceRule !== undefined) setQuickAddRecurrenceRule(patch.recurrenceRule);
    if (patch.cursorPos !== undefined) setQuickAddCursorPos(patch.cursorPos);
  }, []);

  const [showTaskCreateModal, setShowTaskCreateModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjId, setTaskProjId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState(2);
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskRemindAt, setTaskRemindAt] = useState("");
  const [taskReminderOffsetValue, setTaskReminderOffsetValue] = useState(1);
  const [taskReminderOffsetUnit, setTaskReminderOffsetUnit] = useState<"minute"|"hour"|"day"|"month"|"year">("day");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskTags, setTaskTags] = useState<Tag[]>([]);
  const [taskCategoryId, setTaskCategoryId] = useState<string | null>(null);
  const [taskIsImportant, setTaskIsImportant] = useState<number | null>(null);
  const [taskIsUrgent, setTaskIsUrgent] = useState<number | null>(null);
  const [taskIsRecurring, setTaskIsRecurring] = useState(false);
  const [taskRecurrenceRule, setTaskRecurrenceRule] = useState<RecurrenceRule>({ type: "weekday" });
  const [taskIsBackfilled, setTaskIsBackfilled] = useState(false);
  const [taskCompletedAt, setTaskCompletedAt] = useState("");

  const [expandedSections, setExpandedSections] = useState({ focusToday: true, todo: true, completed: false });
  const [visibleCounts, setVisibleCounts] = useState({ focusToday: 15, todo: 15, completed: 15 });
  const [todayDrafts, setTodayDrafts] = useState(["", "", ""]);
  const [todayDraftBusy, setTodayDraftBusy] = useState(false);

  const personalTodoProject = useMemo(
    () => projects.find((p) => p.name === "个人TODO" && (!p.workspaceId || p.workspaceId === "")),
    [projects],
  );

  useScrollHideBars(myTasksScrollRef, true, [myTasks.length]);

  const triggerStatsRefresh = () => {
    try {
      window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
    } catch { /* ignore */ }
  };

  const calculateDefaultReminderDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const hasTime = dateStr.includes(" ");
      const datePart = hasTime ? dateStr.split(" ")[0] : dateStr;
      const timePart = hasTime ? dateStr.split(" ")[1] : "";
      const [year, month, day] = datePart.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      date.setDate(date.getDate() - 1);
      return hasTime ? `${format(date, "yyyy-MM-dd")} ${timePart}` : format(date, "yyyy-MM-dd");
    } catch {
      return "";
    }
  };

  const fetchMyTasks = useCallback(async () => {
    if (!currentUserId) return;
    setLoadingMyTasks(true);
    try {
      const filter =
        roleFilter === "created"
          ? "created"
          : roleFilter === "participating"
            ? "participating"
            : roleFilter === "favorites"
              ? "assigned"
              : "assigned";
      const tasks = await api.getMyTasks(workspaceId || undefined, filter as any);
      setMyTasks(tasks || []);
      triggerStatsRefresh();
    } catch (e) {
      console.error(e);
      toast.error("加载任务失败");
    } finally {
      setLoadingMyTasks(false);
    }
  }, [currentUserId, workspaceId, roleFilter]);

  useEffect(() => {
    fetchMyTasks();
  }, [fetchMyTasks, refreshToken]);

  useEffect(() => {
    api.getTags(workspaceId || undefined).then(setAvailableProjectTags).catch(() => setAvailableProjectTags([]));
  }, [workspaceId]);

  useEffect(() => {
    if (projects.length > 0) {
      if (quickAddIsPersonal && personalTodoProject) {
        setQuickAddProjId(personalTodoProject.id);
      } else {
        const exists = projects.some((p) => p.id === quickAddProjId);
        if (!exists || !quickAddProjId) {
          const nonPersonal = projects.filter((p) => p.id !== personalTodoProject?.id);
          setQuickAddProjId(nonPersonal[0]?.id || "");
        }
      }
    }
  }, [projects, quickAddIsPersonal, personalTodoProject]);

  useEffect(() => {
    if (currentUserId) setQuickAddAssigneeId(currentUserId);
  }, [currentUserId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const q = (e as CustomEvent<{ query?: string }>).detail?.query;
      if (q !== undefined) setProjectSearchQuery(q);
    };
    window.addEventListener("super:project-search-changed", handler);
    return () => window.removeEventListener("super:project-search-changed", handler);
  }, []);

  const taskMatchesProjectFilters = useCallback(
    (task: ProjectTask) => {
      if (selectedProjectTagId) {
        const tags = task.tags || [];
        if (!tags.some((tg) => tg.id === selectedProjectTagId)) return false;
      }
      const query = projectSearchQuery.trim();
      if (!query) return true;
      const terms = query.split(/\s+/).filter(Boolean);
      const hay = `${task.title || ""} ${(task as any).projectName || ""}`.toLowerCase();
      return projectSearchMode === "AND"
        ? terms.every((t) => hay.includes(t.toLowerCase()))
        : terms.some((t) => hay.includes(t.toLowerCase()));
    },
    [selectedProjectTagId, projectSearchQuery, projectSearchMode],
  );

  const filteredMyTasks = useMemo(() => {
    let list = myTasks;
    if (roleFilter === "favorites") {
      list = list.filter((task) => favorites.includes(task.projectId));
    }
    if (myTasksProjectFilter !== "all") {
      list = list.filter((task) => task.projectId === myTasksProjectFilter);
    }
    list = list.filter(taskMatchesProjectFilters);
    if (myTasksViewMode === "flow" && myTasksQuadrantFilter !== "all") {
      list = list.filter((task) => matchesQuadrantFilter(task, myTasksQuadrantFilter));
    }
    return list;
  }, [
    myTasks,
    roleFilter,
    favorites,
    myTasksProjectFilter,
    taskMatchesProjectFilters,
    myTasksViewMode,
    myTasksQuadrantFilter,
  ]);

  const myTasksCategorized = useMemo(() => {
    const focusToday: ProjectTask[] = [];
    const todo: ProjectTask[] = [];
    const completed: ProjectTask[] = [];
    const isRemindDue = (remindAtStr: string | null) => {
      if (!remindAtStr) return false;
      try {
        const cleanStr = remindAtStr.trim().replace(" ", "T");
        if (/^\d{4}-\d{2}-\d{2}$/.test(remindAtStr.trim())) {
          const [y, m, d] = remindAtStr.trim().split("-").map(Number);
          return new Date(y, m - 1, d, 23, 59, 59).getTime() <= Date.now();
        }
        return new Date(cleanStr).getTime() <= Date.now();
      } catch {
        return false;
      }
    };
    const isTaskOverdue = (dateStr: string | null) => {
      if (!dateStr) return false;
      const date = toLocalDate(dateStr);
      return isPast(date) && !isToday(date);
    };
    const isDueToday = (dateStr: string | null) => {
      if (!dateStr) return false;
      try {
        return isToday(toLocalDate(dateStr));
      } catch {
        return false;
      }
    };
    const inFocus = (t: ProjectTask) =>
      isTaskOverdue(t.endDate) || isDueToday(t.endDate) || isRemindDue(t.remindAt);

    filteredMyTasks.forEach((t) => {
      if (t.isCompleted === 1 || (t as any).stageName === "已完成") {
        completed.push(t);
        return;
      }
      if (inFocus(t)) focusToday.push(t);
      else todo.push(t);
    });
    const sortQ = (arr: ProjectTask[]) => [...arr].sort(compareByQuadrant);
    const focus = sortQ(focusToday);
    const rest = sortQ(todo);
    const done = sortQ(completed);
    return {
      focusToday: focus,
      todo: rest,
      completed: done,
      notStartedCount: [...focus, ...rest].filter((t) => getTaskLifeState(t) === "not_started").length,
      inProgressCount: [...focus, ...rest].filter((t) => getTaskLifeState(t) === "in_progress").length,
    };
  }, [filteredMyTasks]);

  const setMyTasksView = (mode: "flow" | "matrix") => {
    setMyTasksViewMode(mode);
    try {
      localStorage.setItem("super-my-tasks-view", mode);
    } catch { /* ignore */ }
  };

  const handleToggleTaskComplete = async (taskId: string, currentCompleted: number) => {
    try {
      const isCompleted = currentCompleted === 1 ? 0 : 1;
      const progress = isCompleted === 1 ? 100 : 0;
      const payload: any = { isCompleted, progress };
      const taskObj = myTasks.find((t) => t.id === taskId);
      const taskProjId = taskObj?.projectId;
      if (taskProjId) {
        const stages = await api.getProjectStages(taskProjId);
        if (isCompleted === 1) {
          let completedStage = stages.find((s) => s.name === "已完成");
          if (!completedStage) completedStage = await api.createProjectStage(taskProjId, { name: "已完成" });
          payload.stageId = completedStage.id;
          payload.status = "completed";
        } else {
          let notStarted = stages.find((s) => s.name === "待启动") || stages.find((s) => s.name === "待规划");
          if (!notStarted) notStarted = await api.createProjectStage(taskProjId, { name: "待启动" });
          payload.stageId = notStarted.id;
          payload.status = "pending";
        }
      }
      const updated = await api.updateProjectTask(taskId, payload);
      if (updated?.remindAt) void syncTaskNotification(updated as any);
      triggerStatsRefresh();
      await fetchMyTasks();
    } catch (e: any) {
      toast.error(e?.message || "操作失败");
    }
  };

  const handleStartTask = async (task: ProjectTask) => {
    try {
      const stageId = await resolveInProgressStageId(task.projectId);
      await api.updateProjectTask(task.id, { stageId, status: "in_progress" });
      toast.success(task.status === "paused" ? `${LIFE_COPY.resume}成功` : `已${LIFE_COPY.start}`);
      triggerStatsRefresh();
      await fetchMyTasks();
    } catch (e: any) {
      toast.error(e?.message || "启动任务失败");
    }
  };

  const handlePauseTask = async (task: ProjectTask) => {
    try {
      await api.updateProjectTask(task.id, { status: "paused" });
      toast.success(`已${LIFE_COPY.pause}`);
      triggerStatsRefresh();
      await fetchMyTasks();
    } catch (e: any) {
      toast.error(e?.message || "暂停失败");
    }
  };

  const handleDeleteProjectTask = async (taskId: string) => {
    if (!confirm("确定删除此任务？")) return;
    try {
      await api.deleteProjectTask(taskId);
      toast.success("已删除");
      triggerStatsRefresh();
      await fetchMyTasks();
    } catch (e: any) {
      toast.error(e?.message || "删除失败");
    }
  };

  const handleSetTaskQuadrant = async (taskIds: string[], target: MatrixBucket) => {
    if (taskIds.length === 0) return;
    const flags = matrixBucketToFlags(target);
    setMyTasks((prev) =>
      prev.map((t) =>
        taskIds.includes(t.id) ? { ...t, isImportant: flags.isImportant, isUrgent: flags.isUrgent } : t,
      ),
    );
    try {
      await Promise.all(
        taskIds.map((id) =>
          api.updateProjectTask(id, { isImportant: flags.isImportant, isUrgent: flags.isUrgent }),
        ),
      );
      if (taskIds.length > 1) toast.success(`已归类 ${taskIds.length} 条任务`);
      triggerStatsRefresh();
    } catch (e: any) {
      toast.error(e?.message || "更新四象限失败");
      fetchMyTasks();
    }
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddTitle.trim()) return;
    const targetProjectId =
      quickAddIsPersonal && personalTodoProject ? personalTodoProject.id : quickAddProjId;
    if (!targetProjectId) {
      toast.error("请选择一个项目");
      return;
    }
    try {
      const stageId = await resolveNotStartedStageId(targetProjectId);
      const rawTitle = quickAddTitle.trim();
      const suQuick = detectSuMention(rawTitle);
      const finalTitle = suQuick.hasSu ? suQuick.cleanText.slice(0, 50) : rawTitle;
      const finalDesc = suQuick.hasSu ? suQuick.cleanText : "";
      const assigneeId = quickAddAssigneeId || currentUserId || null;
      const defaultRemindAt = quickAddDueDate ? calculateDefaultReminderDate(quickAddDueDate) : null;
      const newTask = await api.createProjectTask(targetProjectId, {
        stageId,
        title: finalTitle,
        description: finalDesc,
        assigneeId,
        endDate: quickAddDueDate ? new Date(quickAddDueDate).toISOString() : null,
        priority: 2,
        status: "pending" as const,
        remindAt: defaultRemindAt,
        isRecurring: quickAddIsRecurring ? 1 : 0,
        recurrenceRule: quickAddIsRecurring ? JSON.stringify(quickAddRecurrenceRule) : null,
        tags: quickAddTags.map((tg) => tg.id),
        categoryId: quickAddCategoryId,
        isImportant: quickAddIsImportant,
        isUrgent: quickAddIsUrgent,
      });
      if (suQuick.hasSu) {
        api
          .aiChat("title", suQuick.cleanText.slice(0, 2000))
          .then(async (raw) => {
            const cleaned = raw.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
            if (cleaned) await api.updateProjectTask(newTask.id, { title: cleaned }).catch(() => {});
          })
          .catch(() => {});
      }
      toast.success("创建任务成功");
      setQuickAddTitle("");
      setQuickAddIsRecurring(false);
      setQuickAddRecurrenceRule({ type: "weekday" });
      setQuickAddTags([]);
      if (newTask) {
        setMyTasks((prev) => (prev.some((t) => t.id === newTask.id) ? prev : [newTask, ...prev]));
      }
      await fetchMyTasks();
      if (newTask.remindAt) syncTaskNotification(newTask as any);
    } catch (err: any) {
      toast.error(err?.message || "快速创建任务失败");
    }
  };

  const handleOpenTaskCreateModal = () => {
    setTaskTitle(quickAddTitle);
    const targetProjectId =
      quickAddIsPersonal && personalTodoProject
        ? personalTodoProject.id
        : quickAddProjId || projects[0]?.id || "";
    setTaskProjId(targetProjectId);
    setTaskAssigneeId(quickAddAssigneeId || currentUserId);
    setTaskPriority(2);
    setTaskDueDate(quickAddDueDate);
    setTaskRemindAt(quickAddDueDate ? calculateDefaultReminderDate(quickAddDueDate) : "");
    setTaskDescription("");
    setTaskIsRecurring(quickAddIsRecurring);
    setTaskRecurrenceRule(quickAddRecurrenceRule);
    setTaskTags(quickAddTags);
    setTaskCategoryId(quickAddCategoryId);
    setTaskIsImportant(quickAddIsImportant);
    setTaskIsUrgent(quickAddIsUrgent);
    setTaskIsBackfilled(false);
    setTaskCompletedAt("");
    setShowTaskCreateModal(true);
  };

  const patchTaskCreateForm = useCallback((patch: Partial<TaskCreateFormValues>) => {
    if (patch.title !== undefined) setTaskTitle(patch.title);
    if (patch.projectId !== undefined) setTaskProjId(patch.projectId);
    if (patch.assigneeId !== undefined) setTaskAssigneeId(patch.assigneeId);
    if (patch.priority !== undefined) setTaskPriority(patch.priority);
    if (patch.dueDate !== undefined) setTaskDueDate(patch.dueDate);
    if (patch.remindAt !== undefined) setTaskRemindAt(patch.remindAt);
    if (patch.reminderOffsetValue !== undefined) setTaskReminderOffsetValue(patch.reminderOffsetValue);
    if (patch.reminderOffsetUnit !== undefined) setTaskReminderOffsetUnit(patch.reminderOffsetUnit);
    if (patch.description !== undefined) setTaskDescription(patch.description);
    if (patch.tags !== undefined) setTaskTags(patch.tags);
    if (patch.categoryId !== undefined) setTaskCategoryId(patch.categoryId);
    if (patch.isImportant !== undefined) setTaskIsImportant(patch.isImportant);
    if (patch.isUrgent !== undefined) setTaskIsUrgent(patch.isUrgent);
    if (patch.isRecurring !== undefined) setTaskIsRecurring(patch.isRecurring);
    if (patch.recurrenceRule !== undefined) setTaskRecurrenceRule(patch.recurrenceRule);
    if (patch.isBackfilled !== undefined) setTaskIsBackfilled(patch.isBackfilled);
    if (patch.completedAt !== undefined) setTaskCompletedAt(patch.completedAt);
  }, []);

  const taskCreateFormValues: TaskCreateFormValues = useMemo(
    () => ({
      title: taskTitle,
      projectId: taskProjId,
      assigneeId: taskAssigneeId,
      priority: taskPriority,
      dueDate: taskDueDate,
      remindAt: taskRemindAt,
      reminderOffsetValue: taskReminderOffsetValue,
      reminderOffsetUnit: taskReminderOffsetUnit,
      description: taskDescription,
      tags: taskTags,
      categoryId: taskCategoryId,
      isImportant: taskIsImportant,
      isUrgent: taskIsUrgent,
      isRecurring: taskIsRecurring,
      recurrenceRule: taskRecurrenceRule,
      isBackfilled: taskIsBackfilled,
      completedAt: taskCompletedAt,
    }),
    [
      taskTitle, taskProjId, taskAssigneeId, taskPriority, taskDueDate, taskRemindAt,
      taskReminderOffsetValue, taskReminderOffsetUnit, taskDescription, taskTags,
      taskCategoryId, taskIsImportant, taskIsUrgent, taskIsRecurring, taskRecurrenceRule,
      taskIsBackfilled, taskCompletedAt,
    ],
  );

  const handleDetailedCreateTask = async (createAnother = false) => {
    if (!taskTitle.trim() || !taskProjId) {
      toast.error("请填写标题并选择项目");
      return;
    }
    if (taskIsBackfilled && !taskCompletedAt.trim()) {
      toast.error("补录请填写实际完成日");
      return;
    }
    try {
      const stageId = taskIsBackfilled
        ? await resolveCompletedStageId(taskProjId)
        : await resolveNotStartedStageId(taskProjId);
      const combined = taskTitle.trim() + " " + taskDescription.trim();
      const su = detectSuMention(combined);
      let finalTitle = taskTitle.trim();
      let finalDesc = taskDescription.trim();
      let cleanCombined = combined;
      if (su.hasSu) {
        cleanCombined = combined.replace(/@su\s*/g, "").trim();
        finalDesc = cleanCombined;
        finalTitle = cleanCombined.slice(0, 50);
      }
      const due = taskDueDate || (taskIsBackfilled ? taskCompletedAt : "");
      const newTask = await api.createProjectTask(taskProjId, {
        stageId,
        title: finalTitle,
        description: finalDesc,
        assigneeId: taskAssigneeId || currentUserId || null,
        endDate: due ? new Date(due.includes("T") || due.includes(" ") ? due : `${due}T23:59:59`).toISOString() : null,
        priority: taskPriority,
        status: taskIsBackfilled ? ("completed" as const) : ("pending" as const),
        isCompleted: taskIsBackfilled ? 1 : 0,
        isBackfilled: taskIsBackfilled ? 1 : 0,
        completedAt: taskIsBackfilled ? taskCompletedAt : null,
        progress: taskIsBackfilled ? 100 : 0,
        remindAt: taskIsBackfilled ? null : taskRemindAt || null,
        reminderOffsetValue: taskReminderOffsetValue,
        reminderOffsetUnit: taskReminderOffsetUnit,
        isRecurring: taskIsBackfilled ? 0 : taskIsRecurring ? 1 : 0,
        recurrenceRule:
          !taskIsBackfilled && taskIsRecurring ? JSON.stringify(taskRecurrenceRule) : null,
        tags: taskTags.map((tg) => tg.id),
        categoryId: taskCategoryId,
        isImportant: taskIsImportant,
        isUrgent: taskIsUrgent,
      });
      triggerStatsRefresh();
      toast.success(taskIsBackfilled ? "补录完成" : "创建任务成功");
      if (newTask) setMyTasks((prev) => (prev.some((t) => t.id === newTask.id) ? prev : [newTask, ...prev]));
      await fetchMyTasks();
      if (newTask.remindAt) syncTaskNotification(newTask as any);
      if (su.hasSu) {
        api.aiChat("title", cleanCombined.slice(0, 2000)).then(async (raw) => {
          const cleaned = raw.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
          if (cleaned) await api.updateProjectTask(newTask.id, { title: cleaned }).catch(() => {});
        }).catch(() => {});
      }
      if (createAnother) {
        setTaskTitle("");
        setTaskDescription("");
        setTaskDueDate("");
        setTaskRemindAt("");
        setTaskIsRecurring(false);
        setTaskRecurrenceRule({ type: "weekday" });
        setTaskTags([]);
        setTaskIsBackfilled(false);
        setTaskCompletedAt("");
      } else {
        setShowTaskCreateModal(false);
        setQuickAddTitle("");
        setQuickAddIsRecurring(false);
        setQuickAddRecurrenceRule({ type: "weekday" });
        setTaskIsBackfilled(false);
        setTaskCompletedAt("");
      }
    } catch (err: any) {
      toast.error(err?.message || "创建任务失败");
    }
  };

  const submitTodayDraft = async (index: number) => {
    const title = todayDrafts[index]?.trim();
    if (!title || todayDraftBusy) return;
    const targetProjectId =
      quickAddIsPersonal && personalTodoProject
        ? personalTodoProject.id
        : quickAddProjId || personalTodoProject?.id || projects[0]?.id;
    if (!targetProjectId) {
      toast.error("请先选择项目");
      return;
    }
    setTodayDraftBusy(true);
    try {
      const stageId = await resolveNotStartedStageId(targetProjectId);
      const due = format(new Date(), "yyyy-MM-dd");
      await api.createProjectTask(targetProjectId, {
        stageId,
        title,
        status: "pending",
        priority: 2,
        endDate: new Date(`${due}T23:59:59`).toISOString(),
        assigneeId: quickAddAssigneeId || currentUserId || null,
        isImportant: null,
        isUrgent: null,
      });
      setTodayDrafts((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      toast.success("已加入今日关注");
      await fetchMyTasks();
      triggerStatsRefresh();
    } catch (err: any) {
      toast.error(err?.message || "创建失败");
    } finally {
      setTodayDraftBusy(false);
    }
  };

  const selectProject = (id: string) => {
    const filter = { type: "detail", projectId: id };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };


  return (
    <>
      <div className="flex-1 flex h-full min-h-0 overflow-hidden bg-app-bg justify-center">
        <div className="w-full max-w-5xl flex h-full min-h-0 overflow-hidden">
          {/* 主内容区 */}
          <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
            <MyTasksHeader
              showMobileSearch={showMobileMyTasksSearch}
              onShowMobileSearch={setShowMobileMyTasksSearch}
              searchQuery={projectSearchQuery}
              onSearchQuery={setProjectSearchQuery}
              viewMode={myTasksViewMode}
              onViewMode={setMyTasksView}
              onOpenFilter={() => setShowProjectFilterSheet(true)}
              hasActiveFilters={
                myTasksProjectFilter !== "all" ||
                roleFilter !== "assigned" ||
                (myTasksViewMode === "flow" && myTasksQuadrantFilter !== "all") ||
                myTasksViewMode === "matrix"
              }
            />

            {/* Scrollable Container */}
            <PullToRefresh onRefresh={fetchMyTasks} className="flex-1 min-h-0 bg-app-bg">
              <ScrollContainer className="h-full" ref={myTasksScrollRef}>
                <div className="flex-1 p-4 pt-2 md:pt-0 md:p-6 space-y-4 md:space-y-6">
                  {/* 快速创建固定在列表上方（桌面完整表单 / 移动简条） */}
                  {myTasksViewMode === "flow" && (
                    <>
                      <MyTasksQuickAdd
                        variant="desktop"
                        values={quickAddValues}
                        onChange={patchQuickAdd}
                        projects={projects}
                        personalTodoProject={personalTodoProject}
                        currentUserId={currentUserId}
                        wsMembers={wsMembers}
                        onSubmit={handleQuickAddTask}
                        onOpenDetailed={handleOpenTaskCreateModal}
                      />
                      <MyTasksQuickAdd
                        variant="mobile"
                        values={quickAddValues}
                        onChange={patchQuickAdd}
                        projects={projects}
                        personalTodoProject={personalTodoProject}
                        currentUserId={currentUserId}
                        wsMembers={wsMembers}
                        onSubmit={handleQuickAddTask}
                        onOpenDetailed={handleOpenTaskCreateModal}
                      />
                    </>
                  )}

                  {/* Tasks Lists Sections：底边距交给 mobile-content-pad，隐栏后可铺满 Tab 区 */}
                  <div
                    className={cn(
                      "space-y-4 w-full mx-auto pb-6 md:pb-12 md:pt-2",
                      myTasksViewMode === "matrix" ? "max-w-5xl" : "max-w-[640px]",
                    )}
                  >
                    {/* 搜索/标签激活时的 chip 条（筛选入口仅顶栏，避免双按钮） */}
                    {(selectedProjectTagId || (projectSearchQuery && projectSearchQuery.trim() !== "")) && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-tx-secondary py-1 mb-1 select-none animate-in fade-in duration-200">
                        <span className="text-tx-tertiary">Filter:</span>
                        {projectSearchQuery && projectSearchQuery.trim() !== "" && (
                          <button
                            type="button"
                            onClick={() => setProjectSearchMode(projectSearchMode === "AND" ? "OR" : "AND")}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[10px] font-semibold hover:bg-accent-primary/20 active:scale-95 transition-transform duration-press ease-out cursor-pointer"
                          >
                            <span>关系: {projectSearchMode === "AND" ? "并且 (AND)" : "或者 (OR)"}</span>
                          </button>
                        )}
                        {selectedProjectTagId && (
                          <div className="flex items-center gap-1 bg-app-hover border border-app-border/40 text-tx-secondary text-[11px] font-medium px-2 py-0.5 rounded">
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: availableProjectTags.find(t => t.id === selectedProjectTagId)?.color || "#ccc" }}
                            />
                            <span>{availableProjectTags.find(t => t.id === selectedProjectTagId)?.name || "标签"}</span>
                            <button
                              type="button"
                              onClick={() => setSelectedProjectTagId(null)}
                              className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                              title="清除过滤"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        )}
                        {projectSearchQuery && projectSearchQuery.trim() !== "" && projectSearchQuery.trim().split(/\s+/).filter(Boolean).map((term, index, arr) => (
                          <div key={index} className="flex items-center gap-1 px-2 py-0.5 rounded bg-app-hover border border-app-border/40 text-tx-secondary text-[11px] font-medium animate-in zoom-in-95 duration-100">
                            <span>{term}</span>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = arr.filter((_, i) => i !== index).join(" ");
                                setProjectSearchQuery(updated);
                              }}
                              className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                              title="清除"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 列表视图：今日主模块（空列表时仍展示草稿） */}
                    {myTasksViewMode === "flow" && !loadingMyTasks && (
                      <MyTasksListView
                        categorized={myTasksCategorized}
                        expandedSections={expandedSections}
                        onToggleSection={(key) =>
                          setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        visibleCounts={visibleCounts}
                        onLoadMore={(key) =>
                          setVisibleCounts((prev) => ({ ...prev, [key]: prev[key] + 15 }))
                        }
                        todayDrafts={todayDrafts}
                        onTodayDraftChange={(index, value) => {
                          setTodayDrafts((prev) => {
                            const next = [...prev];
                            next[index] = value;
                            return next;
                          });
                        }}
                        onSubmitTodayDraft={submitTodayDraft}
                        todayDraftBusy={todayDraftBusy}
                        showProjectName={myTasksProjectFilter === "all"}
                        onToggleComplete={handleToggleTaskComplete}
                        onDelete={handleDeleteProjectTask}
                        onSelectProject={selectProject}
                        onStartTask={handleStartTask}
                        onPauseTask={handlePauseTask}
                        showSections={filteredMyTasks.length > 0}
                      />
                    )}

                    {loadingMyTasks ? (
                      <LoadingBlock label="加载任务…" className="py-12" />
                    ) : filteredMyTasks.length === 0 && projectSearchQuery ? (
                      /* 有搜索无结果；无任务时空态由「今日关注」草稿承接，避免双空态 */
                      <EmptyState
                        icon={ListTodo}
                        title="没有匹配的任务"
                        description="试试其他关键词，或清除搜索"
                        className="w-full max-w-[640px] mx-auto"
                      />
                    ) : filteredMyTasks.length === 0 && myTasksViewMode === "matrix" ? (
                      <EmptyState
                        icon={ListTodo}
                        title="还没有任务"
                        description="记下今天要办的事，从这里开始"
                        action={
                          <EmptyActionButton onClick={handleOpenTaskCreateModal}>
                            <Plus size={16} />
                            创建任务
                          </EmptyActionButton>
                        }
                        className="w-full max-w-[640px] mx-auto"
                      />
                    ) : myTasksViewMode === "matrix" && filteredMyTasks.length > 0 ? (
                      <MyTasksMatrixPanel
                        tasks={filteredMyTasks}
                        loading={loadingMyTasks}
                        onToggleComplete={handleToggleTaskComplete}
                        onStartTask={handleStartTask}
                        onPauseTask={handlePauseTask}
                        onSetQuadrant={handleSetTaskQuadrant}
                      />
                    ) : null}
                  </div>
                </div>
              </ScrollContainer>
            </PullToRefresh>
          </div>

          <MyTasksSidebar
            searchQuery={projectSearchQuery}
            onSearchQuery={setProjectSearchQuery}
            searchMode={projectSearchMode}
            onSearchMode={setProjectSearchMode}
            roleFilter={roleFilter}
            onRoleFilter={setRoleFilter}
            selectedTagId={selectedProjectTagId}
            onSelectedTagId={setSelectedProjectTagId}
            tags={availableProjectTags}
          />
        </div>
      </div>

      {showTaskCreateModal && !isDesktop && (
        <BottomSheet
          open={showTaskCreateModal}
          onClose={() => setShowTaskCreateModal(false)}
          title="新建任务"
          maxHeight="min(92dvh, 100%)"
          zClassName="z-modal"
          bodyClassName="flex flex-col min-h-0"
        >
          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4"
            style={{ WebkitOverflowScrolling: "touch", minHeight: "min(40vh, 280px)" }}
          >
            <TaskCreateForm
              values={taskCreateFormValues}
              onChange={patchTaskCreateForm}
              projects={projects}
              currentUserId={currentUserId}
              wsMembers={wsMembers}
              calculateDefaultReminderDate={calculateDefaultReminderDate}
            />
          </div>
          <div className="px-4 py-3 border-t border-app-border flex items-center justify-end gap-2 shrink-0 bg-app-elevated">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowTaskCreateModal(false)} className="text-xs">
              取消
            </Button>
            <Button
              type="button"
              onClick={() => handleDetailedCreateTask(false)}
              disabled={!taskTitle.trim()}
              size="sm"
              className="text-xs bg-accent-primary hover:bg-accent-primary/95 text-white"
            >
              完成
            </Button>
          </div>
        </BottomSheet>
      )}
      {showTaskCreateModal && isDesktop && (
        <div className="fixed inset-0 z-modal flex items-center justify-center p-4 select-text">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTaskCreateModal(false)} />
          <div className="relative bg-app-elevated w-full max-w-xl max-h-[85vh] rounded-window border border-app-border shadow-xl overflow-hidden flex flex-col text-sm text-tx-primary z-10">
            <div className="px-8 py-5 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">新建任务</h3>
              <button type="button" onClick={() => setShowTaskCreateModal(false)} className="p-1.5 hover:bg-app-hover rounded-lg text-tx-tertiary">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-8 py-6">
              <TaskCreateForm
                values={taskCreateFormValues}
                onChange={patchTaskCreateForm}
                projects={projects}
                currentUserId={currentUserId}
                wsMembers={wsMembers}
                calculateDefaultReminderDate={calculateDefaultReminderDate}
              />
            </div>
            <div className="px-8 py-4 border-t border-app-border flex items-center justify-end gap-2 shrink-0 bg-app-sidebar/20">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowTaskCreateModal(false)} className="text-xs">取消</Button>
              <Button type="button" onClick={() => handleDetailedCreateTask(true)} disabled={!taskTitle.trim()} size="sm" variant="outline" className="text-xs">创建并继续</Button>
              <Button type="button" onClick={() => handleDetailedCreateTask(false)} disabled={!taskTitle.trim()} size="sm" className="text-xs bg-accent-primary hover:bg-accent-primary/95 text-white">完成</Button>
            </div>
          </div>
        </div>
      )}

      <MyTasksFilterSheet
        open={showProjectFilterSheet}
        onClose={() => setShowProjectFilterSheet(false)}
        projects={projects}
        projectFilter={myTasksProjectFilter}
        onProjectFilter={setMyTasksProjectFilter}
        quadrantFilter={myTasksQuadrantFilter}
        onQuadrantFilter={setMyTasksQuadrantFilter}
        viewMode={myTasksViewMode}
        onViewMode={setMyTasksView}
        showQuadrantFilters
        roleFilter={roleFilter}
        onRoleFilter={setRoleFilter}
      />
    </>
  );
}
