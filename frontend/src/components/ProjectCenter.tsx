import { Play, Pause } from "lucide-react";
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { Plan, Project, ProjectGroup, ProjectStage, ProjectTask, Tag } from "@/types";
import { PullToRefresh } from "@/components/PullToRefresh";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn, detectSuMention, getTagColor } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useApp, useAppActions } from "@/store/AppContext";
import {
  Plus, Calendar, ListTodo, Briefcase, Star, Search, Filter, Loader2,
  ChevronRight, ChevronDown, ChevronLeft, AlertCircle, ArrowLeft, MoreVertical, Edit2, Trash2, Eye, EyeOff, FolderOpen,
  CheckCircle2, Clock, Globe, Lock, Check, Grid, List as ListIcon, MessageSquare,
  Bookmark, Award, Circle, Bell, X, User, Maximize2, Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/lib/toast";
import { format, isToday, isPast, isTomorrow, isThisWeek, parseISO, parse } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import { syncTaskNotification } from "@/hooks/useCapacitor";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import ReminderOffsetPicker from "@/components/common/ReminderOffsetPicker";
import RecurrenceConfigurator, { RecurrenceRule } from "@/components/common/RecurrenceConfigurator";
import GenericTagInput from "@/components/GenericTagInput";
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";
import { AiFormatHelper } from "@/components/AiFormatHelper";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";


// Import sub-views
import ProjectOverview from "./ProjectOverview";
import ProjectKanban from "./ProjectKanban";
import ProjectList from "./ProjectList";
import ProjectDiscussion from "./ProjectDiscussion";
import ProjectCalendar from "./ProjectCalendar";
import ProjectGantt from "./ProjectGantt";
import TaskDetailModal from "./TaskDetailModal";
import {
  EmptyState,
  EmptyActionButton,
  LoadingBlock,
} from "@/components/common/FeedbackStates";

const PlanCenter = React.lazy(() => import("./PlanCenter"));

const PRESET_COVERS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)",
  "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  "linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)",
  "linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)",
  "linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
];

type Token =
  | { kind: "text"; value: string }
  | { kind: "image"; alt: string; url: string }
  | { kind: "link"; text: string; url: string };

const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s)]+)/g;

function parseTaskTitle(title: string): Token[] {
  if (!title) return [];
  const out: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(title)) !== null) {
    if (m.index > lastIndex) {
      out.push({ kind: "text", value: title.slice(lastIndex, m.index) });
    }
    if (m[1] !== undefined && m[2] !== undefined) {
      out.push({ kind: "image", alt: m[1], url: m[2] });
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push({ kind: "link", text: m[3], url: m[4] });
    } else if (m[5]) {
      out.push({ kind: "link", text: hostnameOf(m[5]), url: m[5] });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < title.length) {
    out.push({ kind: "text", value: title.slice(lastIndex) });
  }
  return out;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.length > 24 ? url.slice(0, 24) + "…" : url;
  }
}

function TitleView({ title, isCompleted }: { title: string; isCompleted: boolean }) {
  const tokens = parseTaskTitle(title);
  if (tokens.length === 1 && tokens[0].kind === "text") {
    return <>{tokens[0].value}</>;
  }

  return (
    <span className="inline">
      {tokens.map((tok, i) => {
        if (tok.kind === "text") {
          return <React.Fragment key={i}>{tok.value}</React.Fragment>;
        }
        if (tok.kind === "image") {
          return (
            <img
              key={i}
              src={tok.url}
              alt={tok.alt}
              className="inline-block align-middle w-7 h-7 mx-0.5 rounded object-cover border border-app-border bg-app-elevated"
              loading="lazy"
              onClick={(e) => e.stopPropagation()}
            />
          );
        }
        const display = hostnameOf(tok.url);
        return (
          <a
            key={i}
            href={tok.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 align-middle mx-0.5 px-1.5 py-0.5 rounded-md text-xs bg-app-hover/60 text-accent-primary hover:bg-app-active hover:underline max-w-[120px] md:max-w-[160px] truncate ${isCompleted ? "opacity-70" : ""}`}
          >
            <span className="truncate">{display}</span>
          </a>
        );
      })}
    </span>
  );
}

function toLocalDate(dateStr: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return parse(dateStr, "yyyy-MM-dd", new Date());
  }
  return parseISO(dateStr);
}

function DateBadge({ dateStr }: { dateStr: string | null }) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;
  if (!dateStr) return null;
  const date = toLocalDate(dateStr);
  
  if (isPast(date) && !isToday(date)) {
    return (
      <span className="flex items-center text-red-500 shrink-0" title={(t('tasks.overdue') || "逾期") + " " + format(date, "MM/dd")}>
        <AlertCircle size={14} strokeWidth={2.5} />
      </span>
    );
  }

  // On mobile, hide the normal non-overdue date badge to maximize text area space
  if (window.innerWidth < 768) {
    return null;
  }

  let className = "text-tx-tertiary";
  let text = format(date, "MM/dd", { locale: dateLocale });

  if (isToday(date)) {
    className = "text-green-500";
    text = t('tasks.today') || "今天";
  } else if (isTomorrow(date)) {
    className = "text-accent-primary";
    text = t('tasks.tomorrow') || "明天";
  } else if (isThisWeek(date, { weekStartsOn: 1 })) {
    text = format(date, "EEEE", { locale: dateLocale });
  }

  return (
    <span className={`flex items-center gap-1 text-[10px] md:text-xs whitespace-nowrap ${className}`}>
      <Calendar size={12} />
      {text}
    </span>
  );
}

function TaskRow({
  task,
  onToggleComplete,
  onDelete,
  onSelectProject,
  onStartTask,
  onPauseTask,
  showProjectName = true,
}: {
  task: ProjectTask;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onDelete: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
  onStartTask?: (task: ProjectTask) => void;
  onPauseTask?: (task: ProjectTask) => void;
  showProjectName?: boolean;
}) {
  const [showActionSheet, setShowActionSheet] = React.useState(false);
  const touchTimer = React.useRef<NodeJS.Timeout | null>(null);

  const handleTouchStart = () => {
    if (window.innerWidth >= 768) return;
    touchTimer.current = setTimeout(() => {
      setShowActionSheet(true);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current);
      touchTimer.current = null;
    }
  };

  return (
    <>
    <div
      onClick={() => {
        window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
      className="group flex items-center justify-between p-3 px-3.5 pr-2.5 md:pr-3.5 hover:bg-app-hover/20 transition-all gap-2 md:gap-4 cursor-pointer select-none"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Checkbox button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task.id, task.isCompleted);
          }}
          className="text-tx-tertiary hover:text-accent-primary transition-colors focus:outline-none shrink-0"
        >
          {task.isCompleted === 1 ? (
            <CheckCircle2 size={16} className="text-green-500" />
          ) : (
            <Circle size={16} className="hover:text-green-500" />
          )}
        </button>

        {/* Title and Subtitle */}
        <div className="min-w-0 flex-1">
          <div
            className={`font-semibold text-tx-secondary text-[13px] md:text-sm truncate ${
              task.isCompleted === 1 ? "line-through opacity-50 text-tx-tertiary" : ""
            }`}
          >
            <TitleView title={task.title} isCompleted={task.isCompleted === 1} />
          </div>
          
          {showProjectName && (
            <div className="flex items-center gap-2 text-[10px] text-tx-tertiary font-bold mt-0.5 animate-in fade-in duration-200">
              <span>所在项目: {(task as any).projectName || "个人TODO"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Due Date & Assignee & Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Start / Pause / Complete / Resume Action Buttons */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          {task.isCompleted !== 1 && ((task as any).stageName === "待启动" || (task as any).stageName === "待规划") && onStartTask && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartTask(task);
              }}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary transition-all shrink-0"
              title="启动任务"
            >
              <Play size={11} fill="currentColor" />
            </button>
          )}

          {task.isCompleted !== 1 && task.status === "paused" && onStartTask && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStartTask(task);
              }}
              className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-all shrink-0"
              title="恢复任务"
            >
              <Play size={11} fill="currentColor" />
            </button>
          )}

          {task.isCompleted !== 1 && (task as any).stageName !== "待启动" && (task as any).stageName !== "待规划" && task.status !== "paused" && (
            <div className="flex items-center gap-1 shrink-0">
              {onPauseTask && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPauseTask(task);
                  }}
                  className="flex items-center justify-center w-7 h-7 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 transition-all shrink-0"
                  title="暂停任务"
                >
                  <Pause size={11} fill="currentColor" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleComplete(task.id, task.isCompleted);
                }}
                className="flex items-center justify-center w-7 h-7 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-500 transition-all shrink-0"
                title="完成任务"
              >
                <Check size={11} />
              </button>
            </div>
          )}
        </div>

        {/* Due Date Badge */}
        {task.endDate && <DateBadge dateStr={task.endDate} />}

        {/* Assignee Avatar */}
        {task.assigneeId && (task.assigneeDisplayName || task.assigneeName) ? (
          task.assigneeAvatarUrl ? (
            <img
              src={task.assigneeAvatarUrl}
              alt={task.assigneeDisplayName || task.assigneeName || "assignee"}
              className="w-6 h-6 rounded-full object-cover border border-app-border shrink-0"
              title={task.assigneeDisplayName || task.assigneeName}
            />
          ) : (
            <div
              className="w-6 h-6 rounded-full bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-[10px] font-bold text-accent-primary shrink-0 font-mono"
              title={task.assigneeDisplayName || task.assigneeName}
            >
              {(task.assigneeDisplayName || task.assigneeName || "").slice(0, 1).toUpperCase()}
            </div>
          )
        ) : null}

        {/* Trash can button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          className="hidden md:block opacity-0 group-hover:opacity-100 p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-accent-danger transition-all shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
    
    <AnimatePresence>
      {showActionSheet && (
        <div className="md:hidden">
          <div className="fixed inset-0 z-[100] bg-black/40" onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); }} />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 right-0 z-[101] bg-app-bg rounded-t-3xl border-t border-app-border/40 shadow-xl pb-[var(--safe-area-bottom)]"
          >
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-12 h-1.5 bg-app-border/60 rounded-full" />
            </div>
            <div className="px-6 py-4 space-y-2">
              <div className="text-sm font-bold text-tx-secondary text-center mb-4 truncate">{task.title}</div>
              
              {task.isCompleted !== 1 && ((task as any).stageName === "待启动" || (task as any).stageName === "待规划" || task.status === "paused") && onStartTask && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); onStartTask(task); }}
                  className="w-full py-4 bg-app-elevated rounded-xl font-bold text-accent-primary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Play size={18} />
                  启动任务
                </button>
              )}
              
              {task.isCompleted !== 1 && (task as any).stageName !== "待启动" && (task as any).stageName !== "待规划" && task.status !== "paused" && onPauseTask && (
                <button
                  onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); onPauseTask(task); }}
                  className="w-full py-4 bg-app-elevated rounded-xl font-bold text-amber-500 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                >
                  <Pause size={18} />
                  暂停任务
                </button>
              )}
              
              <button
                onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); onToggleComplete(task.id, task.isCompleted); }}
                className="w-full py-4 bg-app-elevated rounded-xl font-bold text-green-500 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <CheckCircle2 size={18} />
                {task.isCompleted === 1 ? "标记为未完成" : "完成任务"}
              </button>
              
              <button
                onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); onDelete(task.id); }}
                className="w-full py-4 bg-app-elevated rounded-xl font-bold text-accent-danger flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
              >
                <Trash2 size={18} />
                删除任务
              </button>
              
              <button
                onClick={(e) => { e.stopPropagation(); setShowActionSheet(false); }}
                className="w-full py-4 bg-app-hover rounded-xl font-bold text-tx-tertiary flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mt-2"
              >
                取消
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
    </>
  );
}

const compressImageToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 400;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.7)); // JPEG with 70% quality
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const ScrollContainer = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className }, ref) => {
    if (window.innerWidth < 768) {
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
  }
);
ScrollContainer.displayName = "ScrollContainer";

export default function ProjectCenter() {
  const { t } = useTranslation();
  const { state } = useApp();
  const actions = useAppActions();

  const projDescRef = useRef<HTMLTextAreaElement>(null);
  const taskDescRef = useRef<HTMLTextAreaElement>(null);


  const [showMobileMyTasksSearch, setShowMobileMyTasksSearch] = useState(false);
  const [showMobileRoleSelector, setShowMobileRoleSelector] = useState(false);
  const [showProjectFilterSheet, setShowProjectFilterSheet] = useState(false);

  // Make workspaceId a reactive state
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Navigation Filter State (synced with Sidebar / 底栏任务入口)
  // 默认 my-tasks：移动底栏「任务」语义是待办列表，不是项目网格
  const [activeFilter, setActiveFilter] = useState<{ type: string; groupId?: string; projectId?: string }>(() => {
    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      return val ? JSON.parse(val) : { type: "my-tasks" };
    } catch {
      return { type: "my-tasks" };
    }
  });

  // Current active project details
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);
  const [detailTab, setDetailTab] = useState<"kanban" | "list" | "discussion" | "calendar" | "gantt" | "overview">("kanban");
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Global Aggregated Views
  const [myTasks, setMyTasks] = useState<ProjectTask[]>([]);
  const [loadingMyTasks, setLoadingMyTasks] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"favorites" | "assigned" | "created" | "participating">("assigned");
  const [statusFilter, setStatusFilter] = useState<"pending" | "today" | "overdue" | "completed">("pending");
  const [wsMembers, setWsMembers] = useState<any[]>([]);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchMode, setProjectSearchMode] = useState<"AND" | "OR">("AND");
  const [selectedProjectTagId, setSelectedProjectTagId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [centerActiveTask, setCenterActiveTask] = useState<ProjectTask | null>(null);
  const [myTasksProjectFilter, setMyTasksProjectFilter] = useState<string>("all");

  // Reset myTasksProjectFilter when activeFilter changes or is not my-tasks
  useEffect(() => {
    if (activeFilter.type !== "my-tasks") {
      setMyTasksProjectFilter("all");
    }
  }, [activeFilter]);

  // 监听来自全局的任务打开事件
  useEffect(() => {
    const handleOpenTask = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const taskId = customEvent.detail;
      if (taskId) {
        if (activeFilter.type === "detail" && detailTab === "kanban") {
          setActiveTaskId(taskId);
        } else {
          try {
            const taskDetails = await api.getProjectTask(taskId);
            setCenterActiveTask(taskDetails);
          } catch (err) {
            console.error("Failed to load task details:", err);
            toast.error("加载任务详情失败");
          }
        }
      }
    };
    window.addEventListener("super:open-project-task", handleOpenTask);
    return () => window.removeEventListener("super:open-project-task", handleOpenTask);
  }, [activeFilter.type, detailTab]);

  // 监听来自 Sidebar 的任务搜索状态变化
  useEffect(() => {
    const handleProjectSearchChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ query: string }>;
      if (customEvent.detail?.query !== undefined) {
        setProjectSearchQuery(customEvent.detail.query);
      }
    };
    window.addEventListener("super:project-search-changed", handleProjectSearchChange);
    return () => window.removeEventListener("super:project-search-changed", handleProjectSearchChange);
  }, []);

  // Quick Add task state
  const [quickAddTitle, setQuickAddTitle] = useState("");
  const [quickAddProjId, setQuickAddProjId] = useState("");
  const [quickAddAssigneeId, setQuickAddAssigneeId] = useState("");
  const [quickAddDueDate, setQuickAddDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quickAddIsPersonal, setQuickAddIsPersonal] = useState(true);
  const [quickAddTags, setQuickAddTags] = useState<Tag[]>([]);

  const personalTodoProject = useMemo(
    () => projects.find((p) => p.name === "个人TODO"),
    [projects]
  );

  // Full Screen / Detailed Task Creation Modal State
  const [showTaskCreateModal, setShowTaskCreateModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskProjId, setTaskProjId] = useState("");
  const [taskAssigneeId, setTaskAssigneeId] = useState("");
  const [taskPriority, setTaskPriority] = useState<number>(2);
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskRemindAt, setTaskRemindAt] = useState("");
  const [taskReminderOffsetValue, setTaskReminderOffsetValue] = useState<number>(1);
  const [taskReminderOffsetUnit, setTaskReminderOffsetUnit] = useState<'minute'|'hour'|'day'|'month'|'year'>('day');
  const [taskDescription, setTaskDescription] = useState("");
  const [taskTags, setTaskTags] = useState<Tag[]>([]);

  const [taskIsRecurring, setTaskIsRecurring] = useState(false);
  const [taskRecurrenceRule, setTaskRecurrenceRule] = useState<RecurrenceRule>({ type: "weekday" });

  const [quickAddIsRecurring, setQuickAddIsRecurring] = useState(false);
  const [quickAddRecurrenceRule, setQuickAddRecurrenceRule] = useState<RecurrenceRule>({ type: "weekday" });

  // Autocomplete @mention cursors and states
  const [titleCursorPos, setTitleCursorPos] = useState(0);
  const [descCursorPos, setDescCursorPos] = useState(0);
  const [quickAddCursorPos, setQuickAddCursorPos] = useState(0);

  const titleMention = useMentionState(taskTitle, titleCursorPos);
  const descMention = useMentionState(taskDescription, descCursorPos);
  const quickAddMention = useMentionState(quickAddTitle, quickAddCursorPos);

  const calculateDefaultReminderDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const hasTime = dateStr.includes(" ");
      const datePart = hasTime ? dateStr.split(" ")[0] : dateStr;
      const timePart = hasTime ? dateStr.split(" ")[1] : "";
      const [year, month, day] = datePart.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      date.setDate(date.getDate() - 1);
      if (hasTime) {
        return `${format(date, "yyyy-MM-dd")} ${timePart}`;
      } else {
        return format(date, "yyyy-MM-dd");
      }
    } catch {
      return "";
    }
  };

  // Sections collapse state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overdue: true,
    notStarted: true,
    pending: true,
    paused: true,
    completed: true,
    today: true
  });

  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    overdue: 15,
    today: 15,
    notStarted: 15,
    pending: 15,
    paused: 15,
    completed: 15
  });

  const [workspaceStages, setWorkspaceStages] = useState<ProjectStage[]>([]);
  const [loadingWorkspaceStages, setLoadingWorkspaceStages] = useState(false);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isEditingProject, setIsEditingProject] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  // Create/Edit form fields
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projCover, setProjCover] = useState(PRESET_COVERS[0]);
  const [projStart, setProjStart] = useState("");
  const [projEnd, setProjEnd] = useState("");
  const [projVisibility, setProjVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [projGroupId, setProjGroupId] = useState<string | null>(null);
  const [projPlanId, setProjPlanId] = useState<string | null>(null);
  const [projMilestoneId, setProjMilestoneId] = useState<string | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);

  // Star / Favorite toggle helper
  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    let updated: string[];
    if (isFavorite(id)) {
      updated = favorites.filter((fav) => fav !== id);
    } else {
      updated = [...favorites, id];
    }
    setFavorites(updated);
    localStorage.setItem("super-fav-projects", JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent("super:project-favorite-toggled"));
  };

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const u = await api.getMe();
      setCurrentUserId(u.id);

      const favs = JSON.parse(localStorage.getItem("super-fav-projects") || "[]");
      setFavorites(favs);

      const gs = await api.getProjectGroups(workspaceId);
      setGroups(gs);
      const plans = await api.getPlans(workspaceId);
      setAvailablePlans(plans);

      let ps = await api.getProjects(workspaceId, "active");

      // Auto-provision "个人TODO" if workspace is personal and it is missing
      if (workspaceId === "personal") {
        const hasPersonalTodo = ps.some((p) => p.name === "个人TODO");
        if (!hasPersonalTodo) {
          try {
            await api.createProject({
              name: "个人TODO",
              description: "默认个人任务项目",
              workspaceId: null
            });
            ps = await api.getProjects(workspaceId, "active");
          } catch (createErr) {
            console.error("Failed to auto-create 个人TODO:", createErr);
          }
        }
      }

      setProjects(ps);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Sync state filter from Sidebar / 底栏；挂载时再读 sessionStorage，
  // 避免冷启动懒加载时错过 openTasksEntry 派发的事件。
  useEffect(() => {
    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      if (val) {
        const parsed = JSON.parse(val);
        if (parsed?.type) setActiveFilter(parsed);
      }
    } catch { /* ignore */ }

    const handler = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail) {
        setActiveFilter(customEvent.detail);
      }
    };
    window.addEventListener("super:project-filter-changed", handler);
    return () => window.removeEventListener("super:project-filter-changed", handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<{ tagId?: string | null }>;
      setSelectedProjectTagId(customEvent.detail?.tagId ?? null);
    };
    window.addEventListener("super:project-tag-filter-changed", handler);
    return () => window.removeEventListener("super:project-tag-filter-changed", handler);
  }, []);

  // Listen to workspace change events to reload data reactively
  useEffect(() => {
    const handleWorkspaceChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const wsId = customEvent.detail?.workspaceId || getCurrentWorkspace();
      setWorkspaceId(wsId);
    };
    window.addEventListener("super:workspace-changed", handleWorkspaceChange);
    return () => window.removeEventListener("super:workspace-changed", handleWorkspaceChange);
  }, []);

  // Listen to projects-refreshed events to reload dashboard dynamically
  useEffect(() => {
    const handleRefresh = () => {
      fetchDashboard();
    };
    window.addEventListener("super:projects-refreshed", handleRefresh);
    return () => window.removeEventListener("super:projects-refreshed", handleRefresh);
  }, [fetchDashboard]);

  // Fetch Project Details when activeFilter changes or selection is made
  useEffect(() => {
    if (activeFilter.type === "detail" && activeFilter.projectId) {
      setLoadingDetail(true);
      Promise.all([
        api.getProject(activeFilter.projectId),
        api.getProjectStages(activeFilter.projectId),
      ])
        .then(([proj, stages]) => {
          setSelectedProject(proj);
          setProjectStages(stages);
        })
        .catch((err) => {
          console.error(err);
          toast.error("加载项目详情失败");
          // Revert to dashboard
          sessionStorage.setItem("super-active-project-filter", JSON.stringify({ type: "all" }));
          window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: { type: "all" } }));
        })
        .finally(() => setLoadingDetail(false));
    } else {
      setSelectedProject(null);
      setProjectStages([]);
    }
  }, [activeFilter]);

  // Load workspace members
  useEffect(() => {
    if (workspaceId && workspaceId !== "personal") {
      api.getWorkspaceMembers(workspaceId)
        .then((members) => {
          setWsMembers(members);
        })
        .catch(console.error);
    } else {
      setWsMembers([]);
    }
  }, [workspaceId]);

  const triggerStatsRefresh = () => {
    try {
      window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
    } catch {}
  };

  const fetchMyTasks = useCallback(async () => {
    if (activeFilter.type === "my-tasks" && currentUserId) {
      setLoadingMyTasks(true);
      try {
        const queryFilter = roleFilter === "favorites" ? "all" : roleFilter;
        const tasks = await api.getMyTasks(workspaceId, queryFilter);
        setMyTasks(tasks);
        triggerStatsRefresh();
      } catch (e) {
        console.error(e);
        toast.error("加载任务失败");
      } finally {
        setLoadingMyTasks(false);
      }
    }
  }, [activeFilter.type, currentUserId, workspaceId, roleFilter]);

  // Aggregate Workspace-wide "My Tasks"
  useEffect(() => {
    fetchMyTasks();
  }, [fetchMyTasks]);

  const refreshCurrentView = async () => {
    if (activeFilter.type === "my-tasks") {
      fetchMyTasks();
    }
    if (activeFilter.type === "detail" && activeFilter.projectId) {
      try {
        const stages = await api.getProjectStages(activeFilter.projectId);
        setProjectStages(stages);
      } catch (err) {
        console.error(err);
      }
    }
    if (activeFilter.type === "calendar") {
      setLoadingWorkspaceStages(true);
      try {
        const allProjs = await api.getProjects(workspaceId, "active");
        const promises = allProjs.map(async (p) => {
          try {
            const stages = await api.getProjectStages(p.id);
            stages.forEach((st) => {
              st.tasks?.forEach((t) => {
                (t as any).projectName = p.name;
              });
            });
            return stages;
          } catch {
            return [];
          }
        });
        const results = await Promise.all(promises);
        setWorkspaceStages(results.flat());
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingWorkspaceStages(false);
      }
    }
  };

  // Set default project ID for quick add
  useEffect(() => {
    if (projects.length > 0) {
      if (quickAddIsPersonal && personalTodoProject) {
        setQuickAddProjId(personalTodoProject.id);
      } else {
        const exists = projects.some((p) => p.id === quickAddProjId);
        if (!exists || !quickAddProjId) {
          const nonPersonalProjects = projects.filter((p) => p.id !== personalTodoProject?.id);
          if (nonPersonalProjects.length > 0) {
            setQuickAddProjId(nonPersonalProjects[0].id);
          } else {
            setQuickAddProjId("");
          }
        }
      }
    } else {
      setQuickAddProjId("");
    }
  }, [projects, quickAddIsPersonal, personalTodoProject]);

  // Set default assignee for quick add to current user
  useEffect(() => {
    if (currentUserId) {
      setQuickAddAssigneeId(currentUserId);
    }
  }, [currentUserId]);

  // Aggregate Workspace-wide Calendar / Gantt Stages
  useEffect(() => {
    if (activeFilter.type === "calendar") {
      setLoadingWorkspaceStages(true);
      api.getProjects(workspaceId, "active")
        .then(async (allProjs) => {
          const promises = allProjs.map(async (p) => {
            try {
              const stages = await api.getProjectStages(p.id);
              // Decorate tasks with project name for visual clarity
              stages.forEach((st) => {
                st.tasks?.forEach((t) => {
                  (t as any).projectName = p.name;
                });
              });
              return stages;
            } catch {
              return [];
            }
          });
          const results = await Promise.all(promises);
          setWorkspaceStages(results.flat());
        })
        .catch(console.error)
        .finally(() => setLoadingWorkspaceStages(false));
    }
  }, [activeFilter, workspaceId]);

  const taskMatchesProjectFilters = (task: ProjectTask) => {
    const query = projectSearchQuery.trim().toLowerCase();
    if (query) {
      const terms = query.split(/\s+/).filter(Boolean);
      if (terms.length > 0) {
        const matches = terms.map((term) => {
          if (term.startsWith("#")) {
            const tagSearch = term.substring(1);
            return task.tags?.some((tag) => tag.name.toLowerCase().includes(tagSearch)) || false;
          } else {
            const title = task.title?.toLowerCase() || "";
            const description = task.description?.toLowerCase() || "";
            const projectName = ((task as any).projectName || "").toLowerCase();
            return title.includes(term) || description.includes(term) || projectName.includes(term);
          }
        });
        
        if (projectSearchMode === "AND") {
          if (!matches.every(Boolean)) return false;
        } else {
          if (!matches.some(Boolean)) return false;
        }
      }
    }
    if (selectedProjectTagId) {
      if (!task.tags?.some((tag) => tag.id === selectedProjectTagId)) {
        return false;
      }
    }
    return true;
  };

  const availableProjectTags = useMemo(() => {
    const tagsMap = new Map<string, { id: string; name: string; color: string }>();
    const sourceTasks = activeFilter.type === "calendar"
      ? workspaceStages.flatMap((stage) => stage.tasks || [])
      : myTasks;

    sourceTasks.forEach((task) => {
      task.tags?.forEach((tag) => {
        if (!tagsMap.has(tag.id)) {
          tagsMap.set(tag.id, tag);
        }
      });
    });

    return Array.from(tagsMap.values());
  }, [myTasks, workspaceStages, activeFilter.type]);

  const filteredMyTasks = useMemo(() => {
    let list = myTasks;
    if (roleFilter === "favorites") {
      list = list.filter((task) => favorites.includes(task.projectId));
    }
    if (myTasksProjectFilter !== "all") {
      list = list.filter((task) => task.projectId === myTasksProjectFilter);
    }
    return list.filter(taskMatchesProjectFilters);
  }, [myTasks, roleFilter, favorites, projectSearchQuery, selectedProjectTagId, projectSearchMode, myTasksProjectFilter]);

  const filteredWorkspaceStages = useMemo(() => {
    if (!projectSearchQuery && !selectedProjectTagId) {
      return workspaceStages;
    }
    return workspaceStages
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks?.filter(taskMatchesProjectFilters),
      }))
      .filter((stage) => (stage.tasks?.length || 0) > 0);
  }, [workspaceStages, projectSearchQuery, selectedProjectTagId, projectSearchMode]);

  const filteredProjectStages = useMemo(() => {
    if (!projectSearchQuery && !selectedProjectTagId) {
      return projectStages;
    }
    return projectStages
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks?.filter(taskMatchesProjectFilters),
      }))
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks || [],
      }));
  }, [projectStages, projectSearchQuery, selectedProjectTagId, projectSearchMode]);

  const selectProject = (id: string) => {
    const filter = { type: "detail", projectId: id };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  const closeProjectDetail = () => {
    const filter = { type: "all" };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  const handleOpenCreateModal = () => {
    setIsEditingProject(false);
    setEditingProjectId(null);
    setProjName("");
    setProjDesc("");
    setProjCover(PRESET_COVERS[0]);
    setProjStart("");
    setProjEnd("");
    setProjVisibility("PRIVATE");
    if (activeFilter.type === "group" && activeFilter.groupId) {
      setProjGroupId(activeFilter.groupId);
    } else {
      setProjGroupId(null);
    setProjPlanId(null);
    setProjMilestoneId(null);
    }
    setShowCreateModal(true);
  };

  useEffect(() => {
    const handleTrigger = () => {
      handleOpenCreateModal();
    };
    window.addEventListener("super:create-project-trigger", handleTrigger);

    if (sessionStorage.getItem("super-pending-create-project") === "1") {
      sessionStorage.removeItem("super-pending-create-project");
      handleOpenCreateModal();
    }

    return () => {
      window.removeEventListener("super:create-project-trigger", handleTrigger);
    };
  }, [workspaceId, activeFilter]);

  const handleOpenEditModal = (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingProject(true);
    setEditingProjectId(proj.id);
    setProjName(proj.name);
    setProjDesc(proj.description || "");
    setProjCover(proj.cover || PRESET_COVERS[0]);
    setProjStart(proj.startDate ? proj.startDate.split("T")[0] : "");
    setProjEnd(proj.endDate ? proj.endDate.split("T")[0] : "");
    setProjVisibility(proj.visibility);
    setProjGroupId(proj.groupId);
    setProjMilestoneId(proj.milestoneId || null);
    // Find planId from milestone
    const plan = availablePlans.find(p => p.milestones?.some(m => m.id === proj.milestoneId));
    setProjPlanId(plan ? plan.id : null);
    setShowCreateModal(true);
  };

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await compressImageToBase64(file);
      setProjCover(base64);
    } catch (err) {
      console.error(err);
      toast.error("读取封面图片失败");
    }
  };

  const handleCreateOrEditProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projName.trim()) {
      toast.error("项目名称不能为空");
      return;
    }

    const payload = {
      name: projName.trim(),
      description: projDesc.trim(),
      cover: projCover,
      startDate: projStart ? new Date(projStart).toISOString() : null,
      endDate: projEnd ? new Date(projEnd).toISOString() : null,
      visibility: projVisibility,
      groupId: projGroupId,
      milestoneId: projMilestoneId,
    };

    try {
      if (isEditingProject && editingProjectId) {
        await api.updateProject(editingProjectId, payload);
        toast.success("编辑成功");
      } else {
        await api.createProject(payload);
        toast.success("创建成功");
      }
      setShowCreateModal(false);
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "操作项目失败");
    }
  };

  const handleDeleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除此项目吗？")) return;
    try {
      await api.deleteProject(id);
      toast.success("删除成功");
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "删除项目失败");
    }
  };

  const handleToggleTaskComplete = async (taskId: string, currentCompleted: number) => {
    try {
      const isCompleted = currentCompleted === 1 ? 0 : 1;
      const progress = isCompleted === 1 ? 100 : 0;
      const payload: any = { isCompleted, progress };

      // Try to find the task to get its projectId and auto-move stages
      let taskProjId = selectedProject?.id;
      if (!taskProjId) {
        const allTasks = [
          ...myTasksCategorized.overdue,
          ...myTasksCategorized.today,
          ...myTasksCategorized.notStarted,
          ...myTasksCategorized.pending,
          ...myTasksCategorized.paused,
          ...myTasksCategorized.completed
        ];
        const taskObj = allTasks.find(t => t.id === taskId);
        if (taskObj) {
          taskProjId = taskObj.projectId;
        }
      }

      if (taskProjId) {
        const stages = await api.getProjectStages(taskProjId);
        if (isCompleted === 1) {
          let completedStage = stages.find(s => s.name === "已完成");
          if (!completedStage) {
            completedStage = await api.createProjectStage(taskProjId, { name: "已完成" });
          }
          payload.stageId = completedStage.id;
          payload.status = "completed";
        } else {
          let inProgressStage = stages.find(s => s.name === "进行中");
          if (!inProgressStage) {
            inProgressStage = await api.createProjectStage(taskProjId, { name: "进行中" });
          }
          payload.stageId = inProgressStage.id;
          payload.status = "pending";
        }
      }

      await api.updateProjectTask(taskId, payload);
      triggerStatsRefresh();
      // Re-fetch project details stages
      if (selectedProject) {
        const stages = await api.getProjectStages(selectedProject.id);
        setProjectStages(stages);
      }
      // Re-fetch aggregated views if active
      if (activeFilter.type === "my-tasks") {
        fetchMyTasks();
      }

      // We must fully refresh current view to properly get generated tasks if it's recurring.
      refreshCurrentView();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "操作失败");
    }
  };

  const handleStartTask = async (task: ProjectTask) => {
    try {
      const stages = await api.getProjectStages(task.projectId);
      let inProgressStage = stages.find(s => s.name === "进行中");
      if (!inProgressStage) {
        inProgressStage = await api.createProjectStage(task.projectId, { name: "进行中" });
      }
      await api.updateProjectTask(task.id, { stageId: inProgressStage.id, status: "pending" });
      triggerStatsRefresh();
      toast.success("任务已启动");
      fetchMyTasks();
      if (selectedProject && task.projectId === selectedProject.id) {
        const updatedStages = await api.getProjectStages(task.projectId);
        setProjectStages(updatedStages);
      }
    } catch (err: any) {
      toast.error(err?.message || "启动任务失败");
    }
  };

  const handlePauseTask = async (task: ProjectTask) => {
    try {
      await api.updateProjectTask(task.id, { status: "paused" });
      triggerStatsRefresh();
      toast.success("任务已暂停");
      fetchMyTasks();
      if (selectedProject && task.projectId === selectedProject.id) {
        const updatedStages = await api.getProjectStages(task.projectId);
        setProjectStages(updatedStages);
      }
    } catch (err: any) {
      toast.error(err?.message || "暂停任务失败");
    }
  };
  const handleTogglePauseProject = async (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    const newStatus = proj.status === "paused" ? "in_progress" : "paused";
    try {
      await api.updateProject(proj.id, { status: newStatus });
      toast.success(newStatus === "paused" ? "已暂停项目" : "已恢复项目");
      fetchDashboard();
      window.dispatchEvent(new CustomEvent("super:projects-refreshed"));
    } catch (err: any) {
      toast.error(err?.message || "操作失败");
    }
  };

  const handleDeleteProjectTask = async (taskId: string) => {
    if (!confirm("确定要删除此任务吗？")) return;
    try {
      await api.deleteProjectTask(taskId);
      triggerStatsRefresh();
      toast.success("删除任务成功");
      fetchMyTasks();
      if (selectedProject) {
        const stages = await api.getProjectStages(selectedProject.id);
        setProjectStages(stages);
      }
    } catch (err: any) {
      toast.error(err?.message || "删除任务失败");
    }
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddTitle.trim()) return;
    const targetProjectId = quickAddIsPersonal && personalTodoProject ? personalTodoProject.id : quickAddProjId;
    if (!targetProjectId) {
      toast.error(t("projects.noProjectSelected") || "请选择一个项目");
      return;
    }
    try {
      const stages = await api.getProjectStages(targetProjectId);
      let stageId: string;
      if (stages.length === 0) {
        const newStage = await api.createProjectStage(targetProjectId, { name: "待启动" });
        stageId = newStage.id;
      } else {
        stageId = stages[0].id;
      }

      const defaultRemindAt = quickAddDueDate ? calculateDefaultReminderDate(quickAddDueDate) : null;

      // 检测 @su
      const rawTitle = quickAddTitle.trim();
      const suQuick = detectSuMention(rawTitle);
      const finalTitle = suQuick.hasSu ? suQuick.cleanText.slice(0, 50) : rawTitle;
      const finalDesc = suQuick.hasSu ? suQuick.cleanText : "";

      const payload = {
        stageId,
        title: finalTitle,
        description: finalDesc,
        assigneeId: quickAddAssigneeId || null,
        endDate: quickAddDueDate ? new Date(quickAddDueDate).toISOString() : null,
        priority: 2,
        remindAt: defaultRemindAt,
        isRecurring: quickAddIsRecurring ? 1 : 0,
        recurrenceRule: quickAddIsRecurring ? JSON.stringify(quickAddRecurrenceRule) : null,
        tags: quickAddTags.map((t) => t.id),
      };

      const newTask = await api.createProjectTask(targetProjectId, payload);

      // 含 @su 时异步 AI 提炼标题
      if (suQuick.hasSu) {
        api.aiChat("title", suQuick.cleanText.slice(0, 2000)).then(async (rawTitle) => {
          const cleaned = rawTitle.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
          if (cleaned) await api.updateProjectTask(newTask.id, { title: cleaned }).catch(() => {});
        }).catch(() => {});
      }

      toast.success(t("projects.createTaskSuccess") || "创建任务成功");
      setQuickAddTitle("");
      setQuickAddIsRecurring(false);
      setQuickAddRecurrenceRule({ type: "weekday" });
      setQuickAddTags([]);
      fetchMyTasks();
      if (selectedProject && targetProjectId === selectedProject.id) {
        const updatedStages = await api.getProjectStages(targetProjectId);
        setProjectStages(updatedStages);
      }

      if (newTask.remindAt) {
        syncTaskNotification(newTask as any);
      }
    } catch (err: any) {
      toast.error(err?.message || "快速创建任务失败");
    }
  };

  const handleOpenTaskCreateModal = () => {
    setTaskTitle(quickAddTitle);
    const targetProjectId = quickAddIsPersonal && personalTodoProject ? personalTodoProject.id : quickAddProjId || (projects[0]?.id || "");
    setTaskProjId(targetProjectId);
    setTaskAssigneeId(quickAddAssigneeId || currentUserId);
    setTaskPriority(2);
    setTaskDueDate(quickAddDueDate);
    setTaskRemindAt(quickAddDueDate ? calculateDefaultReminderDate(quickAddDueDate) : "");
    setTaskDescription("");
    setTaskIsRecurring(quickAddIsRecurring);
    setTaskRecurrenceRule(quickAddRecurrenceRule);
    setTaskTags(quickAddTags);
    setShowTaskCreateModal(true);
  };

  const handleDetailedCreateTask = async (createAnother = false) => {
    if (!taskTitle.trim()) return;
    if (!taskProjId) {
      toast.error("请选择一个项目");
      return;
    }
    try {
      const stages = await api.getProjectStages(taskProjId);
      let stageId: string;
      if (stages.length === 0) {
        const newStage = await api.createProjectStage(taskProjId, { name: "待启动" });
        stageId = newStage.id;
      } else {
        stageId = stages[0].id;
      }

      // 检测 @su 标记（标题或描述中包含 @su 均触发）
      const combined = taskTitle.trim() + " " + taskDescription.trim();
      const su = detectSuMention(combined);
      let finalTitle = taskTitle.trim();
      let finalDesc = taskDescription.trim();
      let cleanCombined = combined;

      if (su.hasSu) {
        // 从标题 + 描述中去掉 @su 作为描述
        cleanCombined = combined.replace(/@su\s*/g, "").trim();
        finalDesc = cleanCombined;
        finalTitle = cleanCombined.slice(0, 50);
      }

      const payload = {
        stageId,
        title: finalTitle,
        description: finalDesc,
        assigneeId: taskAssigneeId || null,
        endDate: taskDueDate ? new Date(taskDueDate).toISOString() : null,
        priority: taskPriority,
        remindAt: taskRemindAt || null,
        reminderOffsetValue: taskReminderOffsetValue,
        reminderOffsetUnit: taskReminderOffsetUnit,
        isRecurring: taskIsRecurring ? 1 : 0,
        recurrenceRule: taskIsRecurring ? JSON.stringify(taskRecurrenceRule) : null,
        tags: taskTags.map((t) => t.id),
      };

      const newTask = await api.createProjectTask(taskProjId, payload);
      triggerStatsRefresh();
      toast.success("创建任务成功");
      fetchMyTasks();
      if (selectedProject && taskProjId === selectedProject.id) {
        const updatedStages = await api.getProjectStages(taskProjId);
        setProjectStages(updatedStages);
      }

      if (newTask.remindAt) {
        syncTaskNotification(newTask as any);
      }

      // 含 @su 时异步 AI 提炼标题
      if (su.hasSu) {
        api.aiChat("title", cleanCombined.slice(0, 2000)).then(async (rawTitle) => {
          const cleaned = rawTitle.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
          if (cleaned) {
            await api.updateProjectTask(newTask.id, { title: cleaned }).catch(() => {});
          }
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
      } else {
        setShowTaskCreateModal(false);
        setQuickAddTitle(""); // Clear quick add input too
        setQuickAddIsRecurring(false);
        setQuickAddRecurrenceRule({ type: "weekday" });
        setQuickAddTags([]);
        setTaskTags([]);
      }
    } catch (err: any) {
      toast.error(err?.message || "创建任务失败");
    }
  };

  // Categorize my tasks
  const myTasksCategorized = useMemo(() => {
    const overdue: ProjectTask[] = [];
    const today: ProjectTask[] = [];
    const notStarted: ProjectTask[] = [];
    const pending: ProjectTask[] = [];
    const paused: ProjectTask[] = [];
    const completed: ProjectTask[] = [];

    const isTaskUrgent = (remindAtStr: string | null) => {
      if (!remindAtStr) return false;
      try {
        const cleanStr = remindAtStr.trim().replace(" ", "T");
        if (/^\d{4}-\d{2}-\d{2}$/.test(remindAtStr.trim())) {
          const [y, m, d] = remindAtStr.trim().split("-").map(Number);
          const localDate = new Date(y, m - 1, d, 23, 59, 59);
          return localDate.getTime() <= Date.now();
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

    filteredMyTasks.forEach((t) => {
      // 1. Classify into status lists (all tasks go here)
      if (t.isCompleted === 1 || (t as any).stageName === "已完成") {
        completed.push(t);
      } else if (t.status === "paused") {
        paused.push(t);
      } else if ((t as any).stageName === "待启动" || (t as any).stageName === "待规划") {
        notStarted.push(t);
      } else {
        pending.push(t);
      }

      // 2. Classify into time-dimension lists (only uncompleted tasks go here)
      if (t.isCompleted !== 1) {
        if (isTaskUrgent(t.remindAt)) {
          today.push(t);
        } else if (isTaskOverdue(t.endDate)) {
          overdue.push(t);
        }
      }
    });

    return { overdue, today, notStarted, pending, paused, completed };
  }, [filteredMyTasks]);

  // Filter projects by group selected in Sidebar
  const filteredProjects = useMemo(() => {
    if (activeFilter.type === "group" && activeFilter.groupId) {
      return projects.filter((p) => p.groupId === activeFilter.groupId);
    }
    return projects;
  }, [projects, activeFilter]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-app-bg select-none">
      {/* 1. Project Detail View */}
      {selectedProject ? (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Top Nav Bar */}
          <div
            className="px-4 py-3 border-b border-app-border bg-app-bg flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-2"
            style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
          >
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={closeProjectDetail} className="h-8 w-8">
                <ArrowLeft size={16} />
              </Button>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-tx-primary truncate max-w-[200px] md:max-w-xs">
                  {selectedProject.name}
                </h1>
                <button
                  onClick={(e) => toggleFavorite(selectedProject.id, e)}
                  className="p-1 hover:bg-app-hover rounded transition-colors text-tx-tertiary hover:text-accent-primary"
                >
                  <Star
                    size={14}
                    className={isFavorite(selectedProject.id) ? "fill-accent-primary text-accent-primary" : ""}
                  />
                </button>
              </div>
            </div>

            {/* Inner Project Tabs Switcher */}
            <div className="flex items-center bg-app-hover/50 p-0.5 rounded-lg border border-app-border/40 text-[11px] font-semibold">
              <button
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  detailTab === "kanban" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                }`}
                onClick={() => setDetailTab("kanban")}
              >
                <Grid size={12} />
                <span>{t("projects.kanban") || "看板"}</span>
              </button>
              <button
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  detailTab === "list" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                }`}
                onClick={() => setDetailTab("list")}
              >
                <ListIcon size={12} />
                <span>{t("projects.list") || "列表"}</span>
              </button>
              <button
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  detailTab === "discussion" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                }`}
                onClick={() => setDetailTab("discussion")}
              >
                <MessageSquare size={12} />
                <span>{t("projects.discussion") || "讨论"}</span>
              </button>
              <button
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  detailTab === "calendar" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                }`}
                onClick={() => setDetailTab("calendar")}
              >
                <Calendar size={12} />
                <span>{t("projects.calendar") || "日历"}</span>
              </button>
              {window.innerWidth >= 768 && (
                <button
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                    detailTab === "gantt" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                  }`}
                  onClick={() => setDetailTab("gantt")}
                >
                  <Clock size={12} />
                  <span>{t("projects.gantt") || "甘特图"}</span>
                </button>
              )}
              <button
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
                  detailTab === "overview" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                }`}
                onClick={() => setDetailTab("overview")}
              >
                <Award size={12} />
                <span>{t("projects.overview") || "概况"}</span>
              </button>
            </div>
          </div>

          {/* Active Tab View Renders */}
          <div className="flex-1 overflow-hidden relative">
            {loadingDetail ? (
              <div className="absolute inset-0 flex items-center justify-center bg-app-bg/60 z-10">
                <Loader2 size={24} className="animate-spin text-accent-primary" />
              </div>
            ) : null}

            {detailTab === "overview" && (
              <ProjectOverview project={selectedProject} stages={filteredProjectStages} />
            )}
            {detailTab === "kanban" && (
              <ProjectKanban
                project={selectedProject}
                stages={filteredProjectStages}
                wsMembers={wsMembers}
                onRefresh={async () => {
                  const stages = await api.getProjectStages(selectedProject.id);
                  setProjectStages(stages);
                }}
                onToggleTaskComplete={handleToggleTaskComplete}
                initialActiveTaskId={activeTaskId}
                onClearActiveTaskId={() => setActiveTaskId(null)}
              />
            )}
            {detailTab === "list" && (
              <ProjectList
                stages={filteredProjectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
                onToggleTaskComplete={handleToggleTaskComplete}
                onRefresh={async () => {
                  const stages = await api.getProjectStages(selectedProject.id);
                  setProjectStages(stages);
                }}
              />
            )}
            {detailTab === "discussion" && (
              <ProjectDiscussion project={selectedProject} tasks={filteredProjectStages.flatMap((s) => s.tasks || [])} />
            )}
            {detailTab === "calendar" && (
              <ProjectCalendar
                stages={filteredProjectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
              />
            )}
            {detailTab === "gantt" && (
              <ProjectGantt
                stages={filteredProjectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
              />
            )}
          </div>
        </div>
      ) : activeFilter.type === "plans" ? (
        /* 2a. Plans list (P1-2：并入任务壳，不再独立 viewMode) */
        <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
          <React.Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-accent-primary" />
              </div>
            }
          >
            <PlanCenter />
          </React.Suspense>
        </div>
      ) : activeFilter.type === "my-tasks" ? (
        /* 2. Global "My Tasks" aggregated board */
        <div className="flex-1 flex h-full min-h-0 overflow-hidden bg-app-bg dark:bg-[#121214] justify-center">
          <div className="w-full max-w-5xl flex h-full min-h-0 overflow-hidden">
            {/* 主内容区 */}
            <div className="flex-1 flex flex-col overflow-hidden bg-transparent">
              {/* Header (仅移动端) */}
              {window.innerWidth < 768 && (
                <header
                  className="flex items-center justify-between px-4 py-3 border-b border-app-border bg-app-surface/50 shrink-0 z-40"
                  style={{ paddingTop: "calc(var(--safe-area-top) + 4px)", minHeight: "56px" }}
                >
                  {showMobileMyTasksSearch ? (
                    <motion.div
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: "100%", opacity: 1 }}
                      className="flex items-center gap-2 w-full"
                    >
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
                        <Input
                          autoFocus
                          placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
                          className="pl-9 pr-8 w-full rounded-full bg-app-hover border-none h-8 text-xs"
                          value={projectSearchQuery}
                          onChange={(e) => setProjectSearchQuery(e.target.value)}
                        />
                        {projectSearchQuery && (
                          <button
                            onClick={() => setProjectSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-tx-tertiary"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => {
                          setShowMobileMyTasksSearch(false);
                          setProjectSearchQuery("");
                        }}
                        className="text-xs font-medium text-accent-primary px-2 py-1 active:scale-95"
                      >
                        取消
                      </button>
                    </motion.div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <h1 className="text-base font-bold text-tx-primary shrink-0">任务</h1>
                          <button
                            onClick={() => setShowProjectFilterSheet(true)}
                            className="flex items-center gap-1 bg-app-hover hover:bg-app-hover/80 px-2.5 py-1.5 rounded-lg text-xs font-bold text-tx-secondary shrink-0 max-w-[150px] truncate transition-colors active:scale-95"
                          >
                            <span className="truncate">
                              {myTasksProjectFilter === "all"
                                ? "全部项目"
                                : projects.find((p) => p.id === myTasksProjectFilter)?.name || "全部项目"}
                            </span>
                            <ChevronDown size={12} className="opacity-60 shrink-0" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => setShowMobileMyTasksSearch(true)}
                            className="p-2 rounded-lg text-tx-secondary hover:bg-app-hover active:scale-95"
                          >
                            <Search size={18} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </header>
              )}

              {/* Scrollable Container */}
              <PullToRefresh onRefresh={fetchMyTasks} className="flex-1 min-h-0 bg-app-bg dark:bg-[#121214]">
                <ScrollContainer className="h-full">
                  <div className="flex-1 p-4 pt-0 md:p-6 space-y-6">
                    {/* 顶部标题 (仅在桌面端展示) */}
                    {window.innerWidth >= 768 && (
                      <div className="flex items-center gap-2.5 mb-4 max-w-[640px] mx-auto w-full">
                        <div className="w-9 h-9 rounded-xl bg-accent-primary flex items-center justify-center animate-in fade-in">
                          <ListTodo size={18} className="text-white" />
                        </div>
                        <div>
                          <h1 className="text-lg font-bold text-tx-primary leading-tight">{t("projects.myTasks") || "我的任务"}</h1>
                          <p className="text-[11px] text-tx-tertiary mt-0.5">
                            {t("projects.myTasksDesc") || "跨项目指派给我的任务"}
                          </p>
                        </div>
                      </div>
                    )}



                    {/* Quick Add Form Panel */}
                    {window.innerWidth >= 768 && (
                      <form
                        onSubmit={handleQuickAddTask}
                        className="bg-app-elevated border border-app-border/40 rounded-xl p-4 space-y-3 shadow-sm max-w-[640px] mx-auto"
                      >
                        <div className="flex items-center gap-3 relative">
                          <div className="w-6 h-6 rounded-full border border-app-border flex items-center justify-center shrink-0">
                            <Plus size={14} className="text-tx-tertiary" />
                          </div>
                          <Input
                            type="text"
                            value={quickAddTitle}
                            onChange={(e) => {
                              setQuickAddTitle(e.target.value);
                              setQuickAddCursorPos(e.target.selectionStart || 0);
                            }}
                            onKeyUp={(e) => setQuickAddCursorPos(e.currentTarget.selectionStart || 0)}
                            onClick={(e) => setQuickAddCursorPos(e.currentTarget.selectionStart || 0)}
                            placeholder={t("projects.quickAddTaskPlaceholder") || "快速添加任务（输入标题后按回车或点击右侧添加）..."}
                            className="flex-1 bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 px-0 text-sm placeholder:text-tx-tertiary text-tx-primary h-8 pr-8"
                          />
                          <button
                            type="button"
                            onClick={handleOpenTaskCreateModal}
                            className="p-1.5 hover:bg-app-hover rounded text-tx-tertiary hover:text-tx-primary transition-colors absolute right-1"
                            title="全屏创建任务"
                          >
                            <Maximize2 size={14} />
                          </button>
                        </div>

                        {quickAddMention && (
                          <div className="relative z-50">
                            <MentionPicker
                              search={quickAddMention.search}
                              onSelect={(user) => {
                                const newText = replaceMentionText(quickAddTitle, quickAddCursorPos, quickAddMention.startIndex, user.username);
                                setQuickAddTitle(newText);
                                setQuickAddCursorPos(quickAddMention.startIndex + user.username.length + 2);
                                quickAddMention.clear();
                              }}
                              onClose={quickAddMention.clear}
                            />
                          </div>
                        )}

                        {/* Details and Actions selectors */}
                        <div className="pt-3 border-t border-app-border/20 space-y-3">
                          {/* Row 1: Selectors (Project, Assignee, Due Date) */}
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            {/* Personal TODO Checkbox + Target Display */}
                            <div className="flex items-center gap-1.5 bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors">
                              <input
                                type="checkbox"
                                checked={quickAddIsPersonal}
                                onChange={(e) => {
                                  const isPersonal = e.target.checked;
                                  setQuickAddIsPersonal(isPersonal);
                                  if (isPersonal && personalTodoProject) {
                                    setQuickAddProjId(personalTodoProject.id);
                                  } else {
                                    const nonPersonalProjects = projects.filter((p) => p.id !== personalTodoProject?.id);
                                    if (nonPersonalProjects.length > 0) {
                                      setQuickAddProjId(nonPersonalProjects[0].id);
                                    }
                                  }
                                }}
                                className="w-3.5 h-3.5 rounded cursor-pointer accent-accent-primary"
                              />
                              {quickAddIsPersonal && personalTodoProject ? (
                                <div className="flex items-center gap-1">
                                  <Briefcase size={12} className="text-accent-primary" />
                                  <span className="font-semibold text-tx-primary">{personalTodoProject.name}</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Briefcase size={12} className="text-tx-tertiary" />
                                  <select
                                    value={quickAddProjId}
                                    onChange={(e) => {
                                      const newProjId = e.target.value;
                                      setQuickAddProjId(newProjId);
                                      if (newProjId && newProjId !== personalTodoProject?.id) {
                                        setQuickAddIsPersonal(false);
                                      }
                                    }}
                                    className="bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-semibold"
                                  >
                                    {projects.filter((p) => p.id !== personalTodoProject?.id).length > 0 ? (
                                      projects.filter((p) => p.id !== personalTodoProject?.id).map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))
                                    ) : (
                                      <option value="" disabled>
                                        {t("projects.noProjectAvailable") || "无可用项目"}
                                      </option>
                                    )}
                                  </select>
                                </div>
                              )}
                            </div>

                            {/* Assignee selector dropdown */}
                            <div className="flex items-center gap-1 bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors">
                              <User size={12} className="text-tx-tertiary" />
                              <select
                                value={quickAddAssigneeId}
                                onChange={(e) => setQuickAddAssigneeId(e.target.value)}
                                className="bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-semibold"
                              >
                                <option value={currentUserId}>{t("projects.assigneeMe") || "指派给：我自己"}</option>
                                {wsMembers.filter(m => m.userId !== currentUserId).map((m) => (
                                  <option key={m.userId} value={m.userId}>
                                    {m.displayName || m.username}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Due Date selector picker */}
                            <div className="flex items-center bg-app-sidebar border border-app-border/60 px-2.5 py-1 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors">
                              <SleekDatePicker
                                value={quickAddDueDate}
                                onChange={setQuickAddDueDate}
                                placeholder={t("projects.dueDate") || "截止日期"}
                                showTime={true}
                                variant="ghost"
                                className="w-full"
                              />
                            </div>
                          </div>

                          {/* Row 2: Tag Input & Submission */}
                          <div className="flex items-center justify-between gap-3 pt-1">
                            {/* Tag Input */}
                            <div className="flex-1 max-w-[400px]">
                              <GenericTagInput
                                selectedTags={quickAddTags}
                                onTagsChange={setQuickAddTags}
                                placeholder="添加标签..."
                                className="border-0 shadow-none bg-app-sidebar/40 py-0.5"
                              />
                            </div>

                            <Button
                              type="submit"
                              disabled={!quickAddTitle.trim() || (!quickAddIsPersonal && !quickAddProjId)}
                              className="h-8 text-xs font-semibold px-4 rounded-xl bg-accent-primary hover:bg-accent-primary/95 text-white disabled:opacity-40 disabled:pointer-events-none transition-all shadow-sm shrink-0"
                            >
                              {t("common.add") || "添加"}
                            </Button>
                          </div>
                        </div>

                        {/* Quick Add Recurrence Configurator */}
                        <div className="mt-2.5 pt-2 border-t border-app-border/20">
                          <RecurrenceConfigurator
                            isRecurring={quickAddIsRecurring}
                            onChangeRecurring={setQuickAddIsRecurring}
                            rule={quickAddRecurrenceRule}
                            onChangeRule={setQuickAddRecurrenceRule}
                            compact={true}
                          />
                        </div>
                      </form>
                    )}

                    {/* Tasks Lists Sections */}
                    <div className="space-y-4 max-w-[640px] mx-auto pb-12 md:pt-4">
                      {/* Filter indicator & Project Select Dropdown */}
                      <div className="flex items-center justify-between gap-4 mb-2 select-none min-h-[32px]">
                        {/* Filter Status Indicator (Left side) */}
                        <div className="flex-1 min-w-0">
                          {(selectedProjectTagId || (projectSearchQuery && projectSearchQuery.trim() !== "")) && (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-tx-secondary py-1 animate-in fade-in duration-200">
                              <span className="text-tx-tertiary">Filter:</span>
                              {projectSearchQuery && projectSearchQuery.trim() !== "" && (
                                <button
                                  type="button"
                                  onClick={() => setProjectSearchMode(projectSearchMode === "AND" ? "OR" : "AND")}
                                  className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[10px] font-semibold hover:bg-accent-primary/20 active:scale-95 transition-all cursor-pointer"
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
                        </div>

                        {/* Project Select Dropdown (Right side) */}
                        <div className="hidden md:flex items-center gap-1.5 bg-app-elevated border border-app-border/40 px-3 py-1.5 rounded-xl text-xs text-tx-secondary hover:bg-app-hover transition-colors shadow-sm shrink-0">
                          <select
                            value={myTasksProjectFilter}
                            onChange={(e) => setMyTasksProjectFilter(e.target.value)}
                            className="bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-semibold"
                          >
                            <option value="all">{t("projects.allProjects") || "全部项目"}</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* 移动端快速添加（与桌面 quick-add 对齐） */}
                      {typeof window !== "undefined" && window.innerWidth < 768 && (
                        <form
                          onSubmit={handleQuickAddTask}
                          className="md:hidden flex items-center gap-2 mb-4 max-w-[640px] mx-auto bg-app-elevated border border-app-border/50 rounded-xl px-3 py-2 shadow-xs"
                        >
                          <Plus size={16} className="text-accent-primary shrink-0" />
                          <Input
                            type="text"
                            value={quickAddTitle}
                            onChange={(e) => setQuickAddTitle(e.target.value)}
                            placeholder={t("projects.quickAddTaskPlaceholder") || "添加任务，回车创建"}
                            className="flex-1 bg-transparent border-0 focus-visible:ring-0 px-0 text-sm h-9"
                          />
                          <button
                            type="button"
                            onClick={handleOpenTaskCreateModal}
                            className="p-2 rounded-lg text-tx-tertiary hover:bg-app-hover shrink-0"
                            title="详细创建"
                          >
                            <Maximize2 size={16} />
                          </button>
                        </form>
                      )}

                      {loadingMyTasks ? (
                        <LoadingBlock label="加载任务…" className="py-12" />
                      ) : filteredMyTasks.length === 0 ? (
                        <EmptyState
                          icon={ListTodo}
                          title={
                            projectSearchQuery
                              ? "没有匹配的任务"
                              : "还没有任务"
                          }
                          description={
                            projectSearchQuery
                              ? "试试其他关键词，或清除搜索"
                              : "记下今天要办的事，从这里开始"
                          }
                          action={
                            !projectSearchQuery ? (
                              <EmptyActionButton onClick={handleOpenTaskCreateModal}>
                                <Plus size={16} />
                                创建任务
                              </EmptyActionButton>
                            ) : undefined
                          }
                          className="max-w-[640px] mx-auto"
                        />
                      ) : (
                        <>
                          {/* 1. OVERDUE SECTION */}
                          {myTasksCategorized.overdue.length > 0 && (
                            <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                              {/* Section Collapsible Header */}
                              <div
                                onClick={() => setExpandedSections(prev => ({ ...prev, overdue: !prev.overdue }))}
                                className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                              >
                                <div className="flex items-center gap-2">
                                  {expandedSections.overdue ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                  <span className="text-[10px] md:text-xs font-bold text-red-500 uppercase tracking-wider">{t("projects.overdueTasks") || "逾期任务"}</span>
                                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 font-mono">
                                    {myTasksCategorized.overdue.length}
                                  </span>
                                </div>
                              </div>

                              {/* Section Content */}
                              {expandedSections.overdue && (
                                <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                  {myTasksCategorized.overdue.slice(0, visibleCounts.overdue).map((task) => (
                                    <TaskRow
                                      key={task.id}
                                      task={task}
                                      onToggleComplete={handleToggleTaskComplete}
                                      onDelete={handleDeleteProjectTask}
                                      onSelectProject={selectProject}
                                      onStartTask={handleStartTask}
                                      onPauseTask={handlePauseTask}
                                      showProjectName={myTasksProjectFilter === "all"}
                                    />
                                  ))}
                                  {myTasksCategorized.overdue.length > visibleCounts.overdue && (
                                    <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                      <button
                                        onClick={() => setVisibleCounts(prev => ({ ...prev, overdue: prev.overdue + 15 }))}
                                        className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                      >
                                        <ChevronDown size={12} />
                                        <span>加载更多 ({myTasksCategorized.overdue.length - visibleCounts.overdue})</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 2. TODAY SECTION */}
                          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                            {/* Section Collapsible Header */}
                            <div
                              onClick={() => setExpandedSections(prev => ({ ...prev, today: !prev.today }))}
                              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2">
                                {expandedSections.today ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                <span className="text-[10px] md:text-xs font-bold text-red-500 uppercase tracking-wider">{t("projects.todayTasks") || "今日到期"}</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 font-mono">
                                  {myTasksCategorized.today.length}
                                </span>
                              </div>
                            </div>

                            {/* Section Content */}
                            {expandedSections.today && (
                              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                {myTasksCategorized.today.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-tx-tertiary">{t("projects.noTodayTasks") || "今日无到期任务"}</div>
                                ) : (
                                  <>
                                    {myTasksCategorized.today.slice(0, visibleCounts.today).map((task) => (
                                      <TaskRow
                                        key={task.id}
                                        task={task}
                                        onToggleComplete={handleToggleTaskComplete}
                                        onDelete={handleDeleteProjectTask}
                                        onSelectProject={selectProject}
                                        onStartTask={handleStartTask}
                                        onPauseTask={handlePauseTask}
                                        showProjectName={myTasksProjectFilter === "all"}
                                      />
                                    ))}
                                    {myTasksCategorized.today.length > visibleCounts.today && (
                                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                        <button
                                          onClick={() => setVisibleCounts(prev => ({ ...prev, today: prev.today + 15 }))}
                                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                        >
                                          <ChevronDown size={12} />
                                          <span>加载更多 ({myTasksCategorized.today.length - visibleCounts.today})</span>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 2.5. NOT STARTED SECTION */}
                          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                            {/* Section Collapsible Header */}
                            <div
                              onClick={() => setExpandedSections(prev => ({ ...prev, notStarted: !prev.notStarted }))}
                              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2">
                                {expandedSections.notStarted ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                <span className="text-[10px] md:text-xs font-bold text-sky-500 uppercase tracking-wider">待启动</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                                  {myTasksCategorized.notStarted.length}
                                </span>
                              </div>
                            </div>

                            {/* Section Content */}
                            {expandedSections.notStarted && (
                              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                {myTasksCategorized.notStarted.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-tx-tertiary">没有待启动的任务</div>
                                ) : (
                                  <>
                                    {myTasksCategorized.notStarted.slice(0, visibleCounts.notStarted).map((task) => (
                                      <TaskRow
                                        key={task.id}
                                        task={task}
                                        onToggleComplete={handleToggleTaskComplete}
                                        onDelete={handleDeleteProjectTask}
                                        onSelectProject={selectProject}
                                        onStartTask={handleStartTask}
                                        onPauseTask={handlePauseTask}
                                        showProjectName={myTasksProjectFilter === "all"}
                                      />
                                    ))}
                                    {myTasksCategorized.notStarted.length > visibleCounts.notStarted && (
                                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                        <button
                                          onClick={() => setVisibleCounts(prev => ({ ...prev, notStarted: prev.notStarted + 15 }))}
                                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                        >
                                          <ChevronDown size={12} />
                                          <span>加载更多 ({myTasksCategorized.notStarted.length - visibleCounts.notStarted})</span>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 3. OTHER PENDING SECTION */}
                          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                            {/* Section Collapsible Header */}
                            <div
                              onClick={() => setExpandedSections(prev => ({ ...prev, pending: !prev.pending }))}
                              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2">
                                {expandedSections.pending ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                <span className="text-[10px] md:text-xs font-bold text-amber-500 uppercase tracking-wider">{t("projects.pendingTasks") || "待完成"}</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                                  {myTasksCategorized.pending.length}
                                </span>
                              </div>
                            </div>

                            {/* Section Content */}
                            {expandedSections.pending && (
                              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                {myTasksCategorized.pending.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-tx-tertiary">{t("projects.noPendingTasks") || "没有其他待完成任务"}</div>
                                ) : (
                                  <>
                                    {myTasksCategorized.pending.slice(0, visibleCounts.pending).map((task) => (
                                      <TaskRow
                                        key={task.id}
                                        task={task}
                                        onToggleComplete={handleToggleTaskComplete}
                                        onDelete={handleDeleteProjectTask}
                                        onSelectProject={selectProject}
                                        onStartTask={handleStartTask}
                                        onPauseTask={handlePauseTask}
                                        showProjectName={myTasksProjectFilter === "all"}
                                      />
                                    ))}
                                    {myTasksCategorized.pending.length > visibleCounts.pending && (
                                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                        <button
                                          onClick={() => setVisibleCounts(prev => ({ ...prev, pending: prev.pending + 15 }))}
                                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                        >
                                          <ChevronDown size={12} />
                                          <span>加载更多 ({myTasksCategorized.pending.length - visibleCounts.pending})</span>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 3.5. PAUSED SECTION */}
                          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                            {/* Section Collapsible Header */}
                            <div
                              onClick={() => setExpandedSections(prev => ({ ...prev, paused: !prev.paused }))}
                              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2">
                                {expandedSections.paused ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                <span className="text-[10px] md:text-xs font-bold text-gray-400 uppercase tracking-wider">已暂停</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-gray-500/10 text-gray-400 border border-gray-500/20 font-mono">
                                  {myTasksCategorized.paused.length}
                                </span>
                              </div>
                            </div>

                            {/* Section Content */}
                            {expandedSections.paused && (
                              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                {myTasksCategorized.paused.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-tx-tertiary">没有已暂停的任务</div>
                                ) : (
                                  <>
                                    {myTasksCategorized.paused.slice(0, visibleCounts.paused).map((task) => (
                                      <TaskRow
                                        key={task.id}
                                        task={task}
                                        onToggleComplete={handleToggleTaskComplete}
                                        onDelete={handleDeleteProjectTask}
                                        onSelectProject={selectProject}
                                        onStartTask={handleStartTask}
                                        onPauseTask={handlePauseTask}
                                        showProjectName={myTasksProjectFilter === "all"}
                                      />
                                    ))}
                                    {myTasksCategorized.paused.length > visibleCounts.paused && (
                                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                        <button
                                          onClick={() => setVisibleCounts(prev => ({ ...prev, paused: prev.paused + 15 }))}
                                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                        >
                                          <ChevronDown size={12} />
                                          <span>加载更多 ({myTasksCategorized.paused.length - visibleCounts.paused})</span>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 4. COMPLETED SECTION */}
                          <div className="border border-app-border/40 rounded-xl overflow-hidden bg-app-elevated shadow-sm">
                            {/* Section Collapsible Header */}
                            <div
                              onClick={() => setExpandedSections(prev => ({ ...prev, completed: !prev.completed }))}
                              className="flex items-center justify-between p-3.5 bg-app-elevated hover:bg-app-hover/50 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                            >
                              <div className="flex items-center gap-2">
                                {expandedSections.completed ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                                <span className="text-[10px] md:text-xs font-bold text-green-500 uppercase tracking-wider">{t("projects.completedTasks") || "已完成"}</span>
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 font-mono">
                                  {myTasksCategorized.completed.length}
                                </span>
                              </div>
                            </div>

                            {/* Section Content */}
                            {expandedSections.completed && (
                              <div className="divide-y divide-app-border/20 animate-in fade-in duration-200">
                                {myTasksCategorized.completed.length === 0 ? (
                                  <div className="p-4 text-center text-xs text-tx-tertiary">{t("projects.noCompletedTasks") || "没有已完成的任务"}</div>
                                ) : (
                                  <>
                                    {myTasksCategorized.completed.slice(0, visibleCounts.completed).map((task) => (
                                      <TaskRow
                                        key={task.id}
                                        task={task}
                                        onToggleComplete={handleToggleTaskComplete}
                                        onDelete={handleDeleteProjectTask}
                                        onSelectProject={selectProject}
                                        onStartTask={handleStartTask}
                                        onPauseTask={handlePauseTask}
                                        showProjectName={myTasksProjectFilter === "all"}
                                      />
                                    ))}
                                    {myTasksCategorized.completed.length > visibleCounts.completed && (
                                      <div className="flex justify-center p-3 border-t border-app-border/10 bg-app-sidebar/5">
                                        <button
                                          onClick={() => setVisibleCounts(prev => ({ ...prev, completed: prev.completed + 15 }))}
                                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[11px] font-semibold text-tx-secondary bg-app-hover hover:bg-app-hover/80 active:scale-95 transition-all"
                                        >
                                          <ChevronDown size={12} />
                                          <span>加载更多 ({myTasksCategorized.completed.length - visibleCounts.completed})</span>
                                        </button>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </ScrollContainer>
              </PullToRefresh>
            </div>

            {/* 右侧边栏：搜索框 + 标签/分类过滤 */}
            <div className="hidden md:flex w-[260px] min-w-[260px] shrink-0 flex-col bg-app-surface border-l border-app-border/50 overflow-y-auto px-5 py-4 gap-5 animate-in fade-in duration-200 diary-project-sidebar">
              {/* 搜索框 */}
              <div className="space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary" />
                  <Input
                    placeholder={t('projects.searchTasksPlaceholder') || "搜索任务..."}
                    className="pl-8 h-8 text-xs bg-app-bg border-app-border no-focus-ring"
                    value={projectSearchQuery}
                    onChange={(e) => setProjectSearchQuery(e.target.value)}
                  />
                  {projectSearchQuery && (
                    <button
                      onClick={() => setProjectSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-tx-tertiary hover:text-tx-secondary"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {projectSearchQuery && projectSearchQuery.trim() !== "" && (
                  <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-app-hover/50 border border-app-border/40 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between text-[10px] text-tx-tertiary select-none font-medium">
                      <span>过滤条件</span>
                      <button
                        type="button"
                        onClick={() => setProjectSearchMode(projectSearchMode === "AND" ? "OR" : "AND")}
                        className="px-1.5 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary font-semibold hover:bg-accent-primary/20 active:scale-95 transition-all cursor-pointer"
                      >
                        {projectSearchMode === "AND" ? "并且 (AND)" : "或者 (OR)"}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {projectSearchQuery.trim().split(/\s+/).filter(Boolean).map((term, index, arr) => (
                        <div key={index} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-app-surface border border-app-border/50 text-tx-secondary text-[10px] font-medium animate-in zoom-in-95 duration-100">
                          <span className="truncate max-w-[120px]">{term}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const updated = arr.filter((_, i) => i !== index).join(" ");
                              setProjectSearchQuery(updated);
                            }}
                            className="text-tx-tertiary hover:text-tx-primary p-0.5 rounded transition-colors"
                            title="清除"
                          >
                            <X size={8} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 任务分类与标签筛选 */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-tx-primary px-1">
                  分类与标签
                </div>
                <div className="space-y-1">
                  {/* 我收藏的 */}
                  <button
                    onClick={() => setRoleFilter("favorites")}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                      roleFilter === "favorites"
                        ? "bg-accent-primary/10 text-accent-primary font-medium"
                        : "text-tx-secondary hover:bg-app-hover"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    <span>⭐️ 我收藏的</span>
                  </button>

                  {/* 我负责的 */}
                  <button
                    onClick={() => setRoleFilter("assigned")}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                      roleFilter === "assigned"
                        ? "bg-accent-primary/10 text-accent-primary font-medium"
                        : "text-tx-secondary hover:bg-app-hover"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                    <span>👤 我负责的</span>
                  </button>

                  {/* 我创建的 */}
                  <button
                    onClick={() => setRoleFilter("created")}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                      roleFilter === "created"
                        ? "bg-accent-primary/10 text-accent-primary font-medium"
                        : "text-tx-secondary hover:bg-app-hover"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span>➕ 我创建的</span>
                  </button>

                  {/* 我参与的 */}
                  <button
                    onClick={() => setRoleFilter("participating")}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                      roleFilter === "participating"
                        ? "bg-accent-primary/10 text-accent-primary font-medium"
                        : "text-tx-secondary hover:bg-app-hover"
                    )}
                  >
                    <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                    <span>👥 我参与的</span>
                  </button>

                  {/* 标签分割线 */}
                  {availableProjectTags.length > 0 && (
                    <div className="h-px bg-app-border/40 my-2" />
                  )}

                  {/* 自定义项目标签 */}
                  {availableProjectTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => setSelectedProjectTagId(selectedProjectTagId === tag.id ? null : tag.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2",
                        selectedProjectTagId === tag.id
                          ? "bg-accent-primary/10 text-accent-primary font-medium"
                          : "text-tx-secondary hover:bg-app-hover"
                      )}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: getTagColor(tag) }}
                      />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </div>
      ) : activeFilter.type === "calendar" ? (
        /* 3. Global "Calendar" aggregated view */
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div
            className={cn(
              "border-b border-app-border bg-app-bg shrink-0 space-y-3",
              window.innerWidth < 768 ? "px-4 py-3" : "px-6 py-4"
            )}
            style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                {window.innerWidth < 768 && (
                  <button
                    onClick={() => setActiveFilter({ type: "my" })}
                    className="p-1 -ml-1 mr-1 rounded-lg text-tx-secondary hover:bg-app-hover active:bg-app-active shrink-0"
                  >
                    <ChevronLeft size={20} />
                  </button>
                )}
                <Calendar size={18} className="text-accent-primary shrink-0" />
                <div>
                  <h1 className="text-base font-bold text-tx-primary">{t("projects.calendar") || "日历"}</h1>
                  <p className="text-xs text-tx-tertiary hidden md:block">{t("projects.calendarDesc") || "按标签与标题搜索任务"}</p>
                </div>
              </div>
              <div className="relative w-full lg:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
                <Input
                  placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
                  className="pl-9 h-10 text-sm"
                  value={projectSearchQuery}
                  onChange={(e) => setProjectSearchQuery(e.target.value)}
                />
              </div>
            </div>
            {availableProjectTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                <button
                  onClick={() => setSelectedProjectTagId(null)}
                  className={cn(
                    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition-all border",
                    !selectedProjectTagId
                      ? "bg-accent-primary text-white border-accent-primary"
                      : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover"
                  )}
                >
                  {t("projects.allTags") || "全部标签"}
                </button>
                {availableProjectTags.map((tag) => (
                  <button
                    key={tag.id}
                    onClick={() => setSelectedProjectTagId(tag.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
                      selectedProjectTagId === tag.id
                        ? "bg-accent-primary text-white border-accent-primary"
                        : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover"
                    )}
                  >
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{ width: 6, height: 6, backgroundColor: getTagColor(tag) }}
                    />
                    {tag.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {loadingWorkspaceStages ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-accent-primary" />
            </div>
          ) : (
            <ProjectCalendar
              stages={filteredWorkspaceStages}
              showProjectFilter={true}
              onTaskClick={(task) => {
                window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
              }}
            />
          )}
        </div>
      ) : (
        /* 4. Projects Dashboard Grid View */
        <div className="flex-1 flex flex-col h-full overflow-hidden select-text">
          {/* Top Toolbar */}
          <div
            className={cn(
              "border-b border-app-border bg-app-bg shrink-0 flex items-center justify-between",
              window.innerWidth < 768 ? "px-4 py-3 min-h-[56px] h-auto" : "px-6 py-4"
            )}
            style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
          >
            <div className="flex items-center gap-2">
              <Briefcase size={18} className="text-accent-primary shrink-0" />
              <h1 className="text-base font-bold text-tx-primary">
                {activeFilter.type === "group"
                  ? groups.find((g) => g.id === activeFilter.groupId)?.name
                  : t("projects.myProjects") || "我的项目"}
              </h1>
            </div>
            <Button
              onClick={handleOpenCreateModal}
              className="h-8 text-xs font-semibold px-3 rounded-lg bg-accent-primary hover:bg-accent-primary/95 text-white flex items-center gap-1.5"
            >
              <Plus size={14} />
              <span>{t("projects.createProject") || "新建项目"}</span>
            </Button>
          </div>

          {/* Project Cards Grid Scroll */}
          <ScrollContainer className="flex-1 min-h-0 p-4 md:p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={24} className="animate-spin text-accent-primary" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary h-full">
                <FolderOpen size={48} className="stroke-1 mb-2 opacity-50" />
                <p className="text-sm font-semibold">{t("projects.noProjects") || "暂无项目"}</p>
                <p className="text-xs max-w-xs">{t("projects.noProjectsDesc") || "点击右上角“新建项目”开始吧！"}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto pb-12">
                {filteredProjects.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => selectProject(p.id)}
                    className="group/card border border-app-border hover:border-app-border/80 bg-app-sidebar/35 rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col cursor-pointer h-60"
                  >
                    {/* Project Cover Banner */}
                    <div
                      className="h-24 shrink-0 relative p-3 flex justify-between items-start"
                      style={{
                        background: p.cover || PRESET_COVERS[0],
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    >
                      {/* Left Side: visibility status */}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-black/30 backdrop-blur-md text-white border border-white/10 select-none">
                        {p.visibility === "PUBLIC" ? <Globe size={10} /> : <Lock size={10} />}
                        <span>{p.visibility === "PUBLIC" ? "公开" : "私有"}</span>
                      </span>

                      {/* Right Side Card Controls */}
                      <div className="flex items-center gap-1.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => handleTogglePauseProject(p, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 transition-all"
                          title={p.status === "paused" ? "恢复" : "暂停"}
                        >
                          {p.status === "paused" ? <Play size={12} /> : <Pause size={12} />}
                        </button>
                        <button
                          onClick={(e) => toggleFavorite(p.id, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 hover:border-accent-primary/50 transition-all"
                        >
                          <Star size={12} className={isFavorite(p.id) ? "fill-accent-primary text-accent-primary" : ""} />
                        </button>
                        <button
                          onClick={(e) => handleOpenEditModal(p, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-primary border border-white/10 transition-all"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProject(p.id, e)}
                          className="p-1.5 bg-black/30 backdrop-blur-md rounded-lg text-white hover:text-accent-danger border border-white/10 transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Card Content info */}
                    <div className="p-4 flex-1 flex flex-col justify-between">
                      <div className="space-y-1">
                        <h3 className={cn("font-bold text-sm text-tx-primary truncate group-hover/card:text-accent-primary transition-colors", p.status === "paused" && "opacity-60")}>
                          {p.name}
                          {p.status === "paused" && (
                            <span className="ml-2 px-1.5 py-0.5 bg-amber-500/10 text-amber-500 text-[10px] rounded-md border border-amber-500/20">
                              已暂停
                            </span>
                          )}
                        </h3>
                        <p className="text-xs text-tx-tertiary line-clamp-2 leading-relaxed">
                          {p.description || t("projects.noDescription") || "暂无项目描述"}
                        </p>
                      </div>

                      {/* Progress bar info */}
                      <div className="space-y-2 pt-2 shrink-0">
                        <div className="flex items-center justify-between text-[10px] text-tx-tertiary font-bold font-mono">
                          <span>{t("projects.progress") || "进度"}</span>
                          <span>
                            {p.completedTasksCount || 0}/{p.totalTasksCount || 0}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-app-hover rounded-full overflow-hidden">
                          <div
                            className="h-full bg-accent-primary rounded-full transition-all duration-500"
                            style={{
                              width: `${
                                p.totalTasksCount && p.totalTasksCount > 0
                                  ? Math.round(((p.completedTasksCount || 0) / p.totalTasksCount) * 100)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollContainer>
        </div>
      )}

      {/* 5. Create / Edit Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-text">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <form
            onSubmit={handleCreateOrEditProject}
            className="relative bg-app-elevated w-full max-w-lg rounded-2xl border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in scale-in duration-200"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">
                {isEditingProject ? t("projects.editProject") || "编辑项目" : t("projects.createProject") || "新建项目"}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <ScrollArea className="flex-1 min-h-0 px-6 py-5 space-y-4">
              {/* Name */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.name") || "项目名称"}</label>
                <Input
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder={t("projects.projNamePlaceholder") || "输入项目名称…"}
                  className="h-9 text-xs border-app-border"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.description") || "任务描述"}</label>
                <TextareaFormatToolbar
                  textareaRef={projDescRef}
                  value={projDesc}
                  onChange={setProjDesc}
                />
                <Textarea
                  ref={projDescRef}
                  value={projDesc}
                  onChange={(e) => setProjDesc(e.target.value)}
                  placeholder={t("projects.projDescPlaceholder") || "输入任务描述信息…"}
                  className="text-xs leading-relaxed min-h-[80px] border-app-border rounded-xl"
                />
              </div>


              {/* Cover selector */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.cover") || "项目封面"}</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COVERS.map((cov, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setProjCover(cov)}
                      style={{ background: cov }}
                      className={`w-9 h-9 rounded-lg border transition-all ${
                        projCover === cov ? "border-accent-primary scale-110 shadow-md" : "border-white/10"
                      }`}
                    />
                  ))}
                  {/* Upload custom cover button */}
                  <label className="w-9 h-9 rounded-lg border border-dashed border-app-border hover:border-app-border/80 flex items-center justify-center cursor-pointer text-tx-tertiary hover:text-tx-primary hover:bg-app-hover transition-colors shrink-0">
                    <Plus size={16} />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadCover}
                      className="hidden"
                    />
                  </label>
                </div>
                {/* Cover Preview */}
                <div
                  className="w-full h-20 rounded-xl border border-app-border/60"
                  style={{ background: projCover, backgroundSize: "cover", backgroundPosition: "center" }}
                />
              </div>

              {/* Date fields row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.startDate") || "开始时间"}</label>
                  <SleekDatePicker
                    value={projStart}
                    onChange={setProjStart}
                    className="w-full"
                    placeholder="选择开始时间"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">{t("projects.endDate") || "结束时间"}</label>
                  <SleekDatePicker
                    value={projEnd}
                    onChange={setProjEnd}
                    className="w-full"
                    placeholder="选择结束时间"
                  />
                </div>
              </div>

              {/* Group & Visibility */}
              <div className="grid grid-cols-2 gap-4">
                {/* Group */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.group") || "项目分组"}</label>
                  <select
                    value={projGroupId || ""}
                    onChange={(e) => setProjGroupId(e.target.value || null)}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                  >
                    <option value="">{t("projects.noGroup") || "不设分组"}</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Visibility */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.visibility") || "可见范围"}</label>
                  <select
                    value={projVisibility}
                    onChange={(e) => setProjVisibility(e.target.value as any)}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                  >
                    <option value="PRIVATE">{t("projects.private") || "私有：仅项目成员可见"}</option>
                    <option value="PUBLIC">{t("projects.public") || "公开：工作区全员可见"}</option>
                  </select>
              {/* Plan & Milestone Selection */}
              <div className="grid grid-cols-2 gap-4">
                {/* Plan Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">所属规划方案</label>
                  <select
                    value={projPlanId || ""}
                    onChange={(e) => {
                        setProjPlanId(e.target.value || null);
                        setProjMilestoneId(null);
                    }}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                  >
                    <option value="">不归属任何规划</option>
                    {availablePlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Milestone Selection */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">归属里程碑</label>
                  <select
                    value={projMilestoneId || ""}
                    onChange={(e) => setProjMilestoneId(e.target.value || null)}
                    disabled={!projPlanId}
                    className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary disabled:opacity-50"
                  >
                    <option value="">不归属里程碑</option>
                    {projPlanId && availablePlans.find(p => p.id === projPlanId)?.milestones?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
                </div>
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-app-border bg-app-sidebar/30 flex justify-end gap-2 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowCreateModal(false)}
                className="text-xs"
              >
                {t("common.cancel") || "取消"}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="text-xs bg-accent-primary hover:bg-accent-primary/95 text-white"
              >
                {t("common.save") || "确认"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* 6. Detailed Task Create Modal */}
      {showTaskCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-4 select-text"
          /* 移动端：遮罩底边抬到键盘上方，sheet 不再 marginBottom + 二次减键盘高 */
          style={
            typeof window !== "undefined" && window.innerWidth < 768
              ? {
                  bottom: "var(--keyboard-height, 0px)",
                  transition: "bottom 0.15s ease-out",
                }
              : undefined
          }
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTaskCreateModal(false)} />
          <div
            className={cn(
              "relative bg-app-elevated w-full shadow-2xl overflow-hidden flex flex-col text-sm text-tx-primary z-10",
              "md:h-auto md:max-h-[85vh] md:max-w-xl",
              "rounded-t-2xl md:rounded-2xl border-t md:border border-app-border",
              "animate-in slide-in-from-bottom md:slide-in-from-bottom-0 md:scale-in duration-200",
            )}
            style={{
              // 父层移动端 bottom 已扣键盘；100% = 可用高度，85vh 限制收起时高度
              maxHeight: "min(85vh, 100%)",
            }}
          >
            {/* Header：移动端含 safe-area */}
            <div
              className="px-4 md:px-8 pb-3 md:py-5 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0"
              style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 12px)" }}
            >
              <h3 className="text-sm font-bold text-tx-primary">
                新建任务
              </h3>
              <button
                type="button"
                onClick={() => setShowTaskCreateModal(false)}
                className="p-1.5 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body：原生 overflow 滚动；min-height 防止键盘弹起时被压成一条 */}
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 md:px-8 py-4 md:py-6"
              style={{
                WebkitOverflowScrolling: "touch",
                minHeight: "min(40vh, 280px)",
              }}
            >
              <div className="space-y-5 md:space-y-6.5 pb-2">
              {/* Title */}
              <div className="space-y-2.5 relative">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">任务标题</label>
                <Input
                  value={taskTitle}
                  onChange={(e) => {
                    setTaskTitle(e.target.value);
                    setTitleCursorPos(e.target.selectionStart || 0);
                  }}
                  onKeyUp={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
                  onClick={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
                  placeholder="输入任务标题…"
                  className="h-10 text-xs border-app-border w-full rounded-xl"
                  required
                  autoFocus
                />
                <AiFormatHelper value={taskTitle} onChange={setTaskTitle} />
                {titleMention && (
                  <div className="relative z-50">
                    <MentionPicker
                      search={titleMention.search}
                      onSelect={(user) => {
                        const newText = replaceMentionText(taskTitle, titleCursorPos, titleMention.startIndex, user.username);
                        setTaskTitle(newText);
                        setTitleCursorPos(titleMention.startIndex + user.username.length + 2);
                        titleMention.clear();
                      }}
                      onClose={titleMention.clear}
                    />
                  </div>
                )}
              </div>

              {/* Project & Assignee Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                {/* Project Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">所属项目</label>
                  <select
                    value={taskProjId}
                    onChange={(e) => setTaskProjId(e.target.value)}
                    className="sleek-select w-full h-10 px-3 text-xs text-tx-secondary rounded-xl"
                    required
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Assignee Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">指派给</label>
                  <select
                    value={taskAssigneeId}
                    onChange={(e) => setTaskAssigneeId(e.target.value)}
                    className="sleek-select w-full h-10 px-3 text-xs text-tx-secondary rounded-xl"
                  >
                    <option value={currentUserId}>我自己</option>
                    {wsMembers.filter(m => m.userId !== currentUserId).map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.displayName || m.username}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Priority Selection */}
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">优先级</label>
                <div className="grid grid-cols-4 gap-2.5">
                  {[
                    { level: 3, label: "高", color: "bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20" },
                    { level: 2, label: "中", color: "bg-amber-500/10 border-amber-500/30 text-amber-500 hover:bg-amber-500/20" },
                    { level: 1, label: "低", color: "bg-blue-500/10 border-blue-500/30 text-blue-500 hover:bg-blue-500/20" },
                    { level: 0, label: "无", color: "bg-zinc-500/10 border-zinc-500/30 text-tx-secondary hover:bg-zinc-500/20" }
                  ].map((prio) => (
                    <button
                      key={prio.level}
                      type="button"
                      onClick={() => setTaskPriority(prio.level)}
                      className={`py-2 rounded-xl border text-xs font-semibold transition-all ${prio.color} ${
                        taskPriority === prio.level ? "ring-2 ring-accent-primary border-transparent" : "opacity-80"
                      }`}
                    >
                      {prio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline & Reminder Date Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-5">
                {/* Due Date */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">截止日期</label>
                  <SleekDatePicker
                    value={taskDueDate}
                    onChange={(val) => {
                      setTaskDueDate(val);
                      // Auto calculate reminder date: due date - 24 hours (1 day)
                      if (val) {
                        const defaultReminder = calculateDefaultReminderDate(val);
                        setTaskRemindAt(defaultReminder);
                      } else {
                        setTaskRemindAt("");
                      }
                    }}
                    className="w-full h-10 rounded-xl"
                    placeholder="选择截止日期"
                    showTime={true}
                  />
                </div>

                {/* Reminder Offset */}
                <div className="space-y-2 min-w-0">
                  {(taskDueDate || taskIsRecurring) ? (
                    <>
                      <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">提醒设置</label>
                      <ReminderOffsetPicker
                        value={taskReminderOffsetValue}
                        unit={taskReminderOffsetUnit}
                        onChangeValue={setTaskReminderOffsetValue}
                        onChangeUnit={setTaskReminderOffsetUnit}
                      />
                    </>
                  ) : null}
                </div>
              </div>

              {/* Recurrence Configuration */}
              <div className="border-t border-app-border/40 pt-4">
                <RecurrenceConfigurator
                  isRecurring={taskIsRecurring}
                  onChangeRecurring={setTaskIsRecurring}
                  rule={taskRecurrenceRule}
                  onChangeRule={setTaskRecurrenceRule}
                />
              </div>

              {/* Tags Selection */}
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">任务标签</label>
                <GenericTagInput
                  selectedTags={taskTags}
                  onTagsChange={setTaskTags}
                  placeholder="添加标签..."
                />
              </div>

              {/* Description */}
              <div className="space-y-2.5 relative">
                <label className="text-xs font-semibold text-tx-secondary uppercase tracking-wider block">详细描述</label>
                <TextareaFormatToolbar
                  textareaRef={taskDescRef}
                  value={taskDescription}
                  onChange={setTaskDescription}
                />
                <Textarea
                  ref={taskDescRef}
                  value={taskDescription}
                  onChange={(e) => {
                    setTaskDescription(e.target.value);
                    setDescCursorPos(e.target.selectionStart || 0);
                  }}
                  onKeyUp={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
                  onClick={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
                  placeholder="输入任务描述信息（支持Markdown及@提及）…"
                  className="text-xs leading-relaxed min-h-[120px] border-app-border rounded-xl w-full p-3"
                />
                <AiFormatHelper value={taskDescription} onChange={setTaskDescription} />

                {descMention && (
                  <div className="relative z-50">
                    <MentionPicker
                      search={descMention.search}
                      onSelect={(user) => {
                        const newText = replaceMentionText(taskDescription, descCursorPos, descMention.startIndex, user.username);
                        setTaskDescription(newText);
                        setDescCursorPos(descMention.startIndex + user.username.length + 2);
                        descMention.clear();
                      }}
                      onClose={descMention.clear}
                    />
                  </div>
                )}
              </div>
              </div>
            </div>

            {/* Footer：移动端可换行 + safe-area */}
            <div
              className="px-4 md:px-8 py-3 md:py-4 border-t border-app-border bg-app-sidebar/30 flex flex-wrap justify-end gap-2 shrink-0"
              style={{ paddingBottom: "calc(var(--safe-area-bottom, 0px) + 12px)" }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowTaskCreateModal(false)}
                className="text-xs"
              >
                取消
              </Button>
              <Button
                type="button"
                onClick={() => handleDetailedCreateTask(true)}
                disabled={!taskTitle.trim()}
                variant="outline"
                size="sm"
                className="text-xs border-app-border text-tx-primary hover:bg-app-hover"
              >
                完成并创建下一个
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
          </div>
        </div>
      )}

      {/* 移动端角色筛选器 Bottom Sheet Drawer */}
      <AnimatePresence>
        {showMobileRoleSelector && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMobileRoleSelector(false)}
              className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-xs md:hidden"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 350, damping: 30 }}
              className="fixed bottom-0 left-0 right-0 z-[101] bg-app-surface rounded-t-2xl border-t border-app-border p-4 pb-[calc(var(--safe-area-bottom)+16px)] md:hidden flex flex-col gap-2.5 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-app-border/40 shrink-0">
                <span className="text-sm font-bold text-tx-primary">切换筛选角色</span>
                <button
                  onClick={() => setShowMobileRoleSelector(false)}
                  className="p-1 rounded-lg text-tx-secondary hover:bg-app-hover"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex flex-col gap-1.5 py-2">
                {[
                  { value: "favorites", label: "我收藏的" },
                  { value: "assigned", label: "我负责的" },
                  { value: "created", label: "我创建的" },
                  { value: "participating", label: "我参与的" }
                ].map((item) => {
                  const active = roleFilter === item.value;
                  return (
                    <button
                      key={item.value}
                      onClick={() => {
                        setRoleFilter(item.value as any);
                        setShowMobileRoleSelector(false);
                      }}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3 rounded-xl text-xs font-semibold transition-all border text-left",
                        active
                          ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                          : "bg-app-sidebar/40 border-app-border/40 text-tx-secondary hover:bg-app-hover"
                      )}
                    >
                      <span>{item.label}</span>
                      {active && <Check size={14} className="text-accent-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {centerActiveTask && (
        <TaskDetailModal
          task={centerActiveTask}
          wsMembers={wsMembers}
          onClose={() => setCenterActiveTask(null)}
          onRefresh={refreshCurrentView}
          showProjectName={true}
        />
      )}

      {/* Project Filter Bottom Sheet for Mobile */}
      <AnimatePresence>
        {showProjectFilterSheet && (
          <div className="md:hidden">
            <div className="fixed inset-0 z-[100] bg-black/40" onClick={() => setShowProjectFilterSheet(false)} />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed bottom-0 left-0 right-0 z-[101] bg-app-bg rounded-t-3xl border-t border-app-border/40 shadow-xl pb-[calc(1.5rem+var(--safe-area-bottom))] select-none"
            >
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-12 h-1.5 bg-app-border/60 rounded-full" />
              </div>
              <div className="px-6 py-4 space-y-2">
                <div className="text-sm font-bold text-tx-secondary text-center mb-4">筛选项目</div>
                <div className="max-h-[60vh] overflow-y-auto space-y-1.5 pr-1">
                  <button
                    onClick={() => {
                      setMyTasksProjectFilter("all");
                      setShowProjectFilterSheet(false);
                    }}
                    className={cn(
                      "w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-between active:scale-[0.98] transition-transform text-xs",
                      myTasksProjectFilter === "all" ? "bg-accent-primary/10 text-accent-primary" : "bg-app-elevated text-tx-secondary"
                    )}
                  >
                    <span>全部项目</span>
                    {myTasksProjectFilter === "all" && <Check size={14} />}
                  </button>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setMyTasksProjectFilter(p.id);
                        setShowProjectFilterSheet(false);
                      }}
                      className={cn(
                        "w-full py-3.5 px-4 rounded-xl font-bold flex items-center justify-between active:scale-[0.98] transition-transform text-xs",
                        myTasksProjectFilter === p.id ? "bg-accent-primary/10 text-accent-primary" : "bg-app-elevated text-tx-secondary"
                      )}
                    >
                      <span className="truncate">{p.name}</span>
                      {myTasksProjectFilter === p.id && <Check size={14} />}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
