import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Project, ProjectGroup, ProjectStage, ProjectTask, Tag } from "@/types";
import { PullToRefresh } from "@/components/PullToRefresh";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { useApp } from "@/store/AppContext";
import {
  Plus, Calendar, ListTodo, Briefcase, Star, Search, Filter, Loader2,
  ChevronRight, ChevronDown, ArrowLeft, MoreVertical, Edit2, Trash2, Eye, EyeOff, FolderOpen,
  CheckCircle2, Clock, Globe, Lock, Check, Grid, List as ListIcon, MessageSquare,
  Bookmark, Award, Circle, Bell, X, User, Maximize2
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
import MentionPicker, { useMentionState, replaceMentionText } from "@/components/MentionPicker";

// Import sub-views
import ProjectOverview from "./ProjectOverview";
import ProjectKanban from "./ProjectKanban";
import ProjectList from "./ProjectList";
import ProjectDiscussion from "./ProjectDiscussion";
import ProjectCalendar from "./ProjectCalendar";
import ProjectGantt from "./ProjectGantt";

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
  let className = "text-tx-tertiary";
  let text = format(date, "MM/dd", { locale: dateLocale });

  if (isToday(date)) {
    className = "text-green-500";
    text = t('tasks.today') || "今天";
  } else if (isTomorrow(date)) {
    className = "text-accent-primary";
    text = t('tasks.tomorrow') || "明天";
  } else if (isPast(date)) {
    className = "text-red-500";
    text = (t('tasks.overdue') || "逾期") + " " + format(date, "MM/dd");
  } else if (isThisWeek(date, { weekStartsOn: 1 })) {
    text = format(date, "EEEE", { locale: dateLocale });
  }

  return (
    <span className={`flex items-center gap-1 text-xs whitespace-nowrap ${className}`}>
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
}: {
  task: ProjectTask;
  onToggleComplete: (taskId: string, currentCompleted: number) => void;
  onDelete: (taskId: string) => void;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <div className="group flex items-center justify-between p-3.5 hover:bg-app-hover/20 transition-all gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Checkbox button */}
        <button
          onClick={() => onToggleComplete(task.id, task.isCompleted)}
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
            onClick={() => {
              onSelectProject(task.projectId);
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
              }, 100);
            }}
            className={`font-semibold text-tx-secondary cursor-pointer hover:text-accent-primary transition-colors text-sm truncate ${
              task.isCompleted === 1 ? "line-through opacity-50 text-tx-tertiary" : ""
            }`}
          >
            <TitleView title={task.title} isCompleted={task.isCompleted === 1} />
          </div>
          
          <div className="flex items-center gap-2 text-[10px] text-tx-tertiary font-bold mt-0.5">
            <span>所在项目: {(task as any).projectName || "个人TODO"}</span>
            <span className="opacity-40">•</span>
            <span>阶段: {(task as any).stageName || "进行中"}</span>
          </div>
        </div>
      </div>

      {/* Due Date & Assignee & Actions */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Due Date Badge */}
        {task.endDate && <DateBadge dateStr={task.endDate} />}

        {/* Assignee Avatar */}
        {task.assigneeId ? (
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
              {(task.assigneeDisplayName || task.assigneeName || "?").slice(0, 1).toUpperCase()}
            </div>
          )
        ) : null}

        {/* Trash can button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-accent-danger transition-all shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
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

  const [showMobileMyTasksSearch, setShowMobileMyTasksSearch] = useState(false);
  const [showMobileRoleSelector, setShowMobileRoleSelector] = useState(false);

  // Make workspaceId a reactive state
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());

  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // Navigation Filter State (synced with Sidebar)
  const [activeFilter, setActiveFilter] = useState<{ type: string; groupId?: string; projectId?: string }>(() => {
    try {
      const val = sessionStorage.getItem("super-active-project-filter");
      return val ? JSON.parse(val) : { type: "all" };
    } catch {
      return { type: "all" };
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
  const [roleFilter, setRoleFilter] = useState<"assigned" | "created" | "participating">("assigned");
  const [statusFilter, setStatusFilter] = useState<"pending" | "today" | "overdue" | "completed">("pending");
  const [wsMembers, setWsMembers] = useState<any[]>([]);
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [selectedProjectTagId, setSelectedProjectTagId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);

  // 监听来自全局的任务打开事件
  useEffect(() => {
    const handleOpenTask = (e: Event) => {
      const customEvent = e as CustomEvent;
      const taskId = customEvent.detail;
      if (taskId) {
        setActiveTaskId(taskId);
        setDetailTab("kanban");
      }
    };
    window.addEventListener("super:open-project-task", handleOpenTask);
    return () => window.removeEventListener("super:open-project-task", handleOpenTask);
  }, []);

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
  const [taskDescription, setTaskDescription] = useState("");

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
    pending: true,
    completed: true,
    today: true
  });

  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    overdue: 15,
    today: 15,
    pending: 15,
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

  // Sync state filter from Sidebar
  useEffect(() => {
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

  const fetchMyTasks = useCallback(async () => {
    if (activeFilter.type === "my-tasks" && currentUserId) {
      setLoadingMyTasks(true);
      try {
        const tasks = await api.getMyTasks(workspaceId, roleFilter);
        setMyTasks(tasks);
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
      const title = task.title?.toLowerCase() || "";
      const description = task.description?.toLowerCase() || "";
      const projectName = ((task as any).projectName || "").toLowerCase();
      if (!title.includes(query) && !description.includes(query) && !projectName.includes(query)) {
        return false;
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
    return myTasks.filter(taskMatchesProjectFilters);
  }, [myTasks, projectSearchQuery, selectedProjectTagId]);

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
  }, [workspaceStages, projectSearchQuery, selectedProjectTagId]);

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
      await api.updateProjectTask(taskId, { isCompleted, progress });
      // Re-fetch project details stages
      if (selectedProject) {
        const stages = await api.getProjectStages(selectedProject.id);
        setProjectStages(stages);
      }
      // Re-fetch aggregated views if active
      if (activeFilter.type === "my-tasks") {
        fetchMyTasks();
      }
    } catch (e) {
      console.error(e);
      toast.error("操作失败");
    }
  };

  const handleDeleteProjectTask = async (taskId: string) => {
    if (!confirm("确定要删除此任务吗？")) return;
    try {
      await api.deleteProjectTask(taskId);
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
        const newStage = await api.createProjectStage(targetProjectId, { name: "进行中" });
        stageId = newStage.id;
      } else {
        stageId = stages[0].id;
      }

      const defaultRemindAt = quickAddDueDate ? calculateDefaultReminderDate(quickAddDueDate) : null;
      const payload = {
        stageId,
        title: quickAddTitle.trim(),
        assigneeId: quickAddAssigneeId || null,
        endDate: quickAddDueDate ? new Date(quickAddDueDate).toISOString() : null,
        priority: 2,
        remindAt: defaultRemindAt,
      };

      const newTask = await api.createProjectTask(targetProjectId, payload);
      toast.success(t("projects.createTaskSuccess") || "创建任务成功");
      setQuickAddTitle("");
      fetchMyTasks();

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
        const newStage = await api.createProjectStage(taskProjId, { name: "进行中" });
        stageId = newStage.id;
      } else {
        stageId = stages[0].id;
      }

      const payload = {
        stageId,
        title: taskTitle.trim(),
        description: taskDescription.trim(),
        assigneeId: taskAssigneeId || null,
        endDate: taskDueDate ? new Date(taskDueDate).toISOString() : null,
        priority: taskPriority,
        remindAt: taskRemindAt || null,
      };

      const newTask = await api.createProjectTask(taskProjId, payload);
      toast.success("创建任务成功");
      fetchMyTasks();

      if (newTask.remindAt) {
        syncTaskNotification(newTask as any);
      }

      if (createAnother) {
        setTaskTitle("");
        setTaskDescription("");
        setTaskDueDate("");
        setTaskRemindAt("");
      } else {
        setShowTaskCreateModal(false);
        setQuickAddTitle(""); // Clear quick add input too
      }
    } catch (err: any) {
      toast.error(err?.message || "创建任务失败");
    }
  };

  // Categorize my tasks
  const myTasksCategorized = useMemo(() => {
    const overdue: ProjectTask[] = [];
    const today: ProjectTask[] = [];
    const pending: ProjectTask[] = [];
    const completed: ProjectTask[] = [];

    const isTaskToday = (dateStr: string | null) => {
      if (!dateStr) return false;
      const date = toLocalDate(dateStr);
      return isToday(date);
    };

    const isTaskOverdue = (dateStr: string | null) => {
      if (!dateStr) return false;
      const date = toLocalDate(dateStr);
      return isPast(date) && !isToday(date);
    };

    filteredMyTasks.forEach((t) => {
      if (t.isCompleted === 1) {
        completed.push(t);
      } else {
        if (t.endDate) {
          if (isTaskToday(t.endDate)) {
            today.push(t);
          } else if (isTaskOverdue(t.endDate)) {
            overdue.push(t);
          } else {
            pending.push(t);
          }
        } else {
          pending.push(t);
        }
      }
    });

    return { overdue, today, pending, completed };
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
            className="px-4 py-3 border-b border-app-border bg-app-sidebar flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-2"
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
              <ProjectOverview project={selectedProject} stages={projectStages} />
            )}
            {detailTab === "kanban" && (
              <ProjectKanban
                project={selectedProject}
                stages={projectStages}
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
                stages={projectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
                onToggleTaskComplete={handleToggleTaskComplete}
                onRefresh={async () => {
                  const stages = await api.getProjectStages(selectedProject.id);
                  setProjectStages(stages);
                }}
              />
            )}
            {detailTab === "discussion" && (
              <ProjectDiscussion project={selectedProject} tasks={projectStages.flatMap((s) => s.tasks || [])} />
            )}
            {detailTab === "calendar" && (
              <ProjectCalendar
                stages={projectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
              />
            )}
            {detailTab === "gantt" && (
              <ProjectGantt
                stages={projectStages}
                onTaskClick={(task) => window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }))}
              />
            )}
          </div>
        </div>
      ) : activeFilter.type === "my-tasks" ? (
        /* 2. Global "My Tasks" aggregated board */
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div
            className={cn(
              "border-b border-app-border bg-app-sidebar shrink-0 flex items-center justify-between gap-4",
              window.innerWidth < 768 ? "px-4 py-3 min-h-[56px] h-auto" : "px-6 py-4"
            )}
            style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
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
                    className={cn(
                      "pl-9 pr-8 w-full rounded-full bg-app-hover border-none",
                      window.innerWidth < 768 ? "h-8 text-xs" : "h-10 text-sm"
                    )}
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
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {window.innerWidth < 768 ? (
                    <div className="flex items-center gap-1.5">
                      <h1 className="text-base font-bold text-tx-primary">项目管理</h1>
                      <button
                        onClick={() => setShowMobileRoleSelector(true)}
                        className="flex items-center gap-0.5 text-xs font-semibold text-accent-primary py-1 px-1.5 rounded-lg hover:bg-accent-primary/5 active:scale-95 transition-all"
                      >
                        <span>
                          {roleFilter === "assigned"
                            ? "我负责的"
                            : roleFilter === "created"
                            ? "我创建的"
                            : "我参与的"}
                        </span>
                        <ChevronDown size={14} className="mt-0.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <ListTodo size={18} className="text-accent-primary" />
                      <h1 className="text-base font-bold text-tx-primary">{t("projects.myTasks") || "我的任务"}</h1>
                      <span className="text-xs text-tx-tertiary">({t("projects.myTasksDesc") || "跨项目指派给我的任务"})</span>
                    </>
                  )}
                </div>

                {window.innerWidth < 768 && (
                  <button
                    onClick={() => setShowMobileMyTasksSearch(true)}
                    className="p-2 rounded-lg text-tx-secondary hover:bg-app-hover active:scale-95"
                  >
                    <Search size={18} />
                  </button>
                )}

                {/* Role Filter Tabs */}
                {window.innerWidth >= 768 && (
                  <div className="flex items-center bg-app-hover/50 p-0.5 rounded-lg border border-app-border/40 text-xs font-semibold shrink-0">
                    <button
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        roleFilter === "assigned" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                      }`}
                      onClick={() => setRoleFilter("assigned")}
                    >
                      {t("projects.roleAssigned") || "我负责的"}
                    </button>
                    <button
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        roleFilter === "created" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                      }`}
                      onClick={() => setRoleFilter("created")}
                    >
                      {t("projects.roleCreated") || "我创建的"}
                    </button>
                    <button
                      className={`px-3 py-1.5 rounded-md transition-all ${
                        roleFilter === "participating" ? "bg-app-bg text-tx-primary shadow-sm" : "text-tx-secondary hover:text-tx-primary"
                      }`}
                      onClick={() => setRoleFilter("participating")}
                    >
                      {t("projects.roleParticipating") || "我参与的"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Scrollable Container */}
          <PullToRefresh onRefresh={fetchMyTasks} className="flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
            {window.innerWidth >= 768 && (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
                    <Input
                      placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
                      className="pl-9 h-10 text-sm"
                      value={projectSearchQuery}
                      onChange={(e) => setProjectSearchQuery(e.target.value)}
                    />
                  </div>
                  {selectedProjectTagId ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedProjectTagId(null)}
                      className="shrink-0"
                    >
                      {t("projects.clearTagFilter") || "清除标签"}
                    </Button>
                  ) : null}
                </div>
                {availableProjectTags.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => setSelectedProjectTagId(null)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border",
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
                          "flex w-full items-center gap-2 text-left px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                          selectedProjectTagId === tag.id
                            ? "bg-accent-primary text-white border-accent-primary"
                            : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover"
                        )}
                      >
                        <span
                          className="inline-block rounded-full"
                          style={{ width: 10, height: 10, backgroundColor: tag.color }}
                        />
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stats Cards Row */}
            <div className="grid grid-cols-4 gap-1.5 md:gap-4 shrink-0 sticky top-0 z-30 bg-app-bg py-2 -my-2">
              {/* Card 1: 今日到期 */}
              <div
                onClick={() => setStatusFilter("today")}
                className={`cursor-pointer p-2 md:p-4 rounded-xl md:rounded-2xl border transition-all flex flex-col justify-between h-16 md:h-24 min-w-0 flex-1 shrink-0 ${
                  statusFilter === "today"
                    ? "bg-blue-500/15 border-blue-500 text-blue-400 ring-1 ring-blue-500/20"
                    : "bg-app-sidebar/40 border-app-border hover:bg-blue-500/5 hover:border-blue-500/40 text-tx-secondary"
                }`}
              >
                <span className="text-[9px] md:text-xs font-bold font-mono tracking-tight uppercase opacity-80 truncate">{t("projects.statusToday") || "今日到期"}</span>
                <span className="text-base md:text-2xl font-black font-mono mt-0.5 text-blue-400">{myTasksCategorized.today.length}</span>
              </div>

              {/* Card 2: 逾期任务 */}
              <div
                onClick={() => setStatusFilter("overdue")}
                className={`cursor-pointer p-2 md:p-4 rounded-xl md:rounded-2xl border transition-all flex flex-col justify-between h-16 md:h-24 min-w-0 flex-1 shrink-0 ${
                  statusFilter === "overdue"
                    ? "bg-red-500/15 border-red-500 text-red-400 ring-1 ring-red-500/20"
                    : "bg-app-sidebar/40 border-app-border hover:bg-red-500/5 hover:border-red-500/40 text-tx-secondary"
                }`}
              >
                <span className="text-[9px] md:text-xs font-bold font-mono tracking-tight uppercase opacity-80 truncate">{t("projects.statusOverdue") || "逾期任务"}</span>
                <span className="text-base md:text-2xl font-black font-mono mt-0.5 text-red-400">{myTasksCategorized.overdue.length}</span>
              </div>

              {/* Card 3: 待完成 */}
              <div
                onClick={() => setStatusFilter("pending")}
                className={`cursor-pointer p-2 md:p-4 rounded-xl md:rounded-2xl border transition-all flex flex-col justify-between h-16 md:h-24 min-w-0 flex-1 shrink-0 ${
                  statusFilter === "pending"
                    ? "bg-amber-500/15 border-amber-500 text-amber-400 ring-1 ring-amber-500/20"
                    : "bg-app-sidebar/40 border-app-border hover:bg-amber-500/5 hover:border-amber-500/40 text-tx-secondary"
                }`}
              >
                <span className="text-[9px] md:text-xs font-bold font-mono tracking-tight uppercase opacity-80 truncate">{t("projects.statusPending") || "待完成"}</span>
                <span className="text-base md:text-2xl font-black font-mono mt-0.5 text-amber-400">
                  {myTasksCategorized.today.length + myTasksCategorized.overdue.length + myTasksCategorized.pending.length}
                </span>
              </div>

              {/* Card 4: 已完成 */}
              <div
                onClick={() => setStatusFilter("completed")}
                className={`cursor-pointer p-2 md:p-4 rounded-xl md:rounded-2xl border transition-all flex flex-col justify-between h-16 md:h-24 min-w-0 flex-1 shrink-0 ${
                  statusFilter === "completed"
                    ? "bg-green-500/15 border-green-500 text-green-400 ring-1 ring-green-500/20"
                    : "bg-app-sidebar/40 border-app-border hover:bg-green-500/5 hover:border-green-500/40 text-tx-secondary"
                }`}
              >
                <span className="text-[9px] md:text-xs font-bold font-mono tracking-tight uppercase opacity-80 truncate">{t("projects.statusCompleted") || "已完成"}</span>
                <span className="text-base md:text-2xl font-black font-mono mt-0.5 text-green-400">{myTasksCategorized.completed.length}</span>
              </div>
            </div>

            {/* Quick Add Form Panel */}
            {window.innerWidth >= 768 && (
              <form
                onSubmit={handleQuickAddTask}
                className="bg-app-sidebar/35 border border-app-border rounded-2xl p-4 space-y-3 shadow-sm max-w-4xl mx-auto"
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
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-app-border/40">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Personal TODO Checkbox + Target Display */}
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={quickAddIsPersonal}
                      onChange={(e) => {
                        const isPersonal = e.target.checked;
                        setQuickAddIsPersonal(isPersonal);
                        if (isPersonal && personalTodoProject) {
                          setQuickAddProjId(personalTodoProject.id);
                        } else {
                          // When unchecked, switch to first non-personal project
                          const nonPersonalProjects = projects.filter((p) => p.id !== personalTodoProject?.id);
                          if (nonPersonalProjects.length > 0) {
                            setQuickAddProjId(nonPersonalProjects[0].id);
                          }
                        }
                      }}
                      className="w-4 h-4 rounded cursor-pointer accent-accent-primary"
                    />
                    {/* Display project based on checkbox state */}
                    {quickAddIsPersonal && personalTodoProject ? (
                      <div className="flex items-center gap-1.5 bg-accent-primary/10 border border-accent-primary/20 px-2.5 py-1 rounded-lg text-xs text-tx-secondary">
                        <Briefcase size={12} className="text-accent-primary" />
                        <span className="font-medium text-tx-primary">{personalTodoProject.name}</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 bg-app-sidebar/80 border border-app-border/80 px-2.5 py-1 rounded-lg text-xs text-tx-secondary">
                        <Briefcase size={12} className="text-tx-tertiary" />
                        <select
                          value={quickAddProjId}
                          onChange={(e) => {
                            const newProjId = e.target.value;
                            setQuickAddProjId(newProjId);
                            if (newProjId && newProjId !== personalTodoProject?.id) {
                              // Ensure checkbox is unchecked if non-personal project is selected
                              setQuickAddIsPersonal(false);
                            }
                          }}
                          className="sleek-select sleek-select-inline bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-medium"
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
                  <div className="flex items-center gap-1.5 bg-app-sidebar/80 border border-app-border/80 px-2.5 py-1 rounded-lg text-xs text-tx-secondary">
                    <User size={12} className="text-tx-tertiary" />
                    <select
                      value={quickAddAssigneeId}
                      onChange={(e) => setQuickAddAssigneeId(e.target.value)}
                      className="sleek-select sleek-select-inline bg-transparent border-0 focus:outline-none text-xs text-tx-secondary cursor-pointer font-medium"
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
                  <SleekDatePicker
                    value={quickAddDueDate}
                    onChange={setQuickAddDueDate}
                    placeholder={t("projects.dueDate") || "截止日期"}
                    showTime={true}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={!quickAddTitle.trim() || (!quickAddIsPersonal && !quickAddProjId)}
                  className="h-8 text-xs font-semibold px-4 rounded-lg bg-accent-primary hover:bg-accent-primary/95 text-white disabled:opacity-40 disabled:pointer-events-none transition-all"
                >
                  {t("common.add") || "添加"}
                </Button>
              </div>
              </form>
            )}

            {/* Tasks Lists Sections */}
            <div className="space-y-4 max-w-4xl mx-auto pb-12">
              {loadingMyTasks ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-accent-primary" />
                </div>
              ) : (
                <>
                  {/* 1. OVERDUE SECTION (shown if statusFilter is 'pending' or 'overdue') */}
                  {(statusFilter === "pending" || statusFilter === "overdue") && (
                    <div className="border border-app-border/40 rounded-2xl overflow-hidden bg-app-sidebar/10">
                      {/* Section Collapsible Header */}
                      <div
                        onClick={() => setExpandedSections(prev => ({ ...prev, overdue: !prev.overdue }))}
                        className="flex items-center justify-between p-3.5 bg-app-sidebar/40 hover:bg-app-sidebar/60 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-2">
                          {expandedSections.overdue ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                          <span className="text-xs font-bold text-red-500 uppercase tracking-wider">{t("projects.overdueTasks") || "逾期任务"}</span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 font-mono">
                            {myTasksCategorized.overdue.length}
                          </span>
                        </div>
                      </div>

                      {/* Section Content */}
                      {expandedSections.overdue && (
                        <div className="divide-y divide-app-border/20">
                          {myTasksCategorized.overdue.length === 0 ? (
                            <div className="p-4 text-center text-xs text-tx-tertiary">{t("projects.noOverdueTasks") || "没有逾期的任务"}</div>
                          ) : (
                            <>
                              {myTasksCategorized.overdue.slice(0, visibleCounts.overdue).map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  onToggleComplete={handleToggleTaskComplete}
                                  onDelete={handleDeleteProjectTask}
                                  onSelectProject={selectProject}
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
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. TODAY SECTION (shown if statusFilter is 'pending' or 'today') */}
                  {(statusFilter === "pending" || statusFilter === "today") && (
                    <div className="border border-app-border/40 rounded-2xl overflow-hidden bg-app-sidebar/10">
                      {/* Section Collapsible Header */}
                      <div
                        onClick={() => setExpandedSections(prev => ({ ...prev, today: !prev.today }))}
                        className="flex items-center justify-between p-3.5 bg-app-sidebar/40 hover:bg-app-sidebar/60 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-2">
                          {expandedSections.today ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                          <span className="text-xs font-bold text-blue-400 uppercase tracking-wider">{t("projects.todayTasks") || "今日到期"}</span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20 font-mono">
                            {myTasksCategorized.today.length}
                          </span>
                        </div>
                      </div>

                      {/* Section Content */}
                      {expandedSections.today && (
                        <div className="divide-y divide-app-border/20">
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
                  )}

                  {/* 3. OTHER PENDING SECTION (shown if statusFilter is 'pending') */}
                  {statusFilter === "pending" && (
                    <div className="border border-app-border/40 rounded-2xl overflow-hidden bg-app-sidebar/10">
                      {/* Section Collapsible Header */}
                      <div
                        onClick={() => setExpandedSections(prev => ({ ...prev, pending: !prev.pending }))}
                        className="flex items-center justify-between p-3.5 bg-app-sidebar/40 hover:bg-app-sidebar/60 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-2">
                          {expandedSections.pending ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                          <span className="text-xs font-bold text-amber-500 uppercase tracking-wider">{t("projects.pendingTasks") || "待完成"}</span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                            {myTasksCategorized.pending.length}
                          </span>
                        </div>
                      </div>

                      {/* Section Content */}
                      {expandedSections.pending && (
                        <div className="divide-y divide-app-border/20">
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
                  )}

                  {/* 4. COMPLETED SECTION (shown if statusFilter is 'completed') */}
                  {statusFilter === "completed" && (
                    <div className="border border-app-border/40 rounded-2xl overflow-hidden bg-app-sidebar/10">
                      {/* Section Collapsible Header */}
                      <div
                        onClick={() => setExpandedSections(prev => ({ ...prev, completed: !prev.completed }))}
                        className="flex items-center justify-between p-3.5 bg-app-sidebar/40 hover:bg-app-sidebar/60 border-b border-app-border/30 cursor-pointer transition-colors select-none"
                      >
                        <div className="flex items-center gap-2">
                          {expandedSections.completed ? <ChevronDown size={14} className="text-tx-tertiary" /> : <ChevronRight size={14} className="text-tx-tertiary" />}
                          <span className="text-xs font-bold text-green-500 uppercase tracking-wider">{t("projects.completedTasks") || "已完成"}</span>
                          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-green-500/10 text-green-400 border border-green-500/20 font-mono">
                            {myTasksCategorized.completed.length}
                          </span>
                        </div>
                      </div>

                      {/* Section Content */}
                      {expandedSections.completed && (
                        <div className="divide-y divide-app-border/20">
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
                  )}
                </>
              )}
            </div>
          </div>
        </PullToRefresh>
      </div>
      ) : activeFilter.type === "calendar" ? (
        /* 3. Global "Calendar" aggregated view */
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <div
            className={cn(
              "border-b border-app-border bg-app-sidebar shrink-0 space-y-3",
              window.innerWidth < 768 ? "px-4 py-3" : "px-6 py-4"
            )}
            style={window.innerWidth < 768 ? { paddingTop: "calc(var(--safe-area-top) + 4px)" } : undefined}
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-accent-primary" />
                <div>
                  <h1 className="text-base font-bold text-tx-primary">{t("projects.calendar") || "日历"}</h1>
                  <p className="text-xs text-tx-tertiary">{t("projects.calendarDesc") || "按标签与标题搜索任务"}</p>
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
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setSelectedProjectTagId(null)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all border",
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
                      "flex w-full items-center gap-2 text-left px-3 py-2 rounded-xl text-xs font-medium border transition-all",
                      selectedProjectTagId === tag.id
                        ? "bg-accent-primary text-white border-accent-primary"
                        : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover"
                    )}
                  >
                    <span
                      className="inline-block rounded-full"
                      style={{ width: 10, height: 10, backgroundColor: tag.color }}
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
              onTaskClick={(task) => {
                selectProject(task.projectId);
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
                }, 100);
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
              "border-b border-app-border bg-app-sidebar shrink-0 flex items-center justify-between",
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
                        <h3 className="font-bold text-sm text-tx-primary truncate group-hover/card:text-accent-primary transition-colors">
                          {p.name}
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

              {/* Description */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider">{t("projects.description") || "任务描述"}</label>
                <Textarea
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-text">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowTaskCreateModal(false)} />
          <div
            className="relative bg-app-elevated w-full max-w-lg rounded-2xl border border-app-border shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in scale-in duration-200 text-sm text-tx-primary"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <h3 className="text-sm font-bold text-tx-primary">
                新建任务
              </h3>
              <button
                type="button"
                onClick={() => setShowTaskCreateModal(false)}
                className="p-1 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <ScrollArea className="flex-1 min-h-0 px-6 py-5 space-y-4">
              {/* Title */}
              <div className="space-y-1 relative">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">任务标题</label>
                <Input
                  value={taskTitle}
                  onChange={(e) => {
                    setTaskTitle(e.target.value);
                    setTitleCursorPos(e.target.selectionStart || 0);
                  }}
                  onKeyUp={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
                  onClick={(e) => setTitleCursorPos(e.currentTarget.selectionStart || 0)}
                  placeholder="输入任务标题…"
                  className="h-9 text-xs border-app-border w-full"
                  required
                  autoFocus
                />
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

              {/* Project Selection */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">所属项目</label>
                <select
                  value={taskProjId}
                  onChange={(e) => setTaskProjId(e.target.value)}
                  className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
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
              <div className="space-y-1">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">指派给</label>
                <select
                  value={taskAssigneeId}
                  onChange={(e) => setTaskAssigneeId(e.target.value)}
                  className="sleek-select w-full h-9 px-3 text-xs text-tx-secondary"
                >
                  <option value={currentUserId}>我自己</option>
                  {wsMembers.filter(m => m.userId !== currentUserId).map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.displayName || m.username}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">优先级</label>
                <div className="grid grid-cols-4 gap-2">
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
                      className={`py-1.5 rounded-lg border text-xs font-semibold transition-all ${prio.color} ${
                        taskPriority === prio.level ? "ring-2 ring-accent-primary border-transparent" : "opacity-80"
                      }`}
                    >
                      {prio.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeline & Reminder Date Row */}
              <div className="grid grid-cols-2 gap-4">
                {/* Due Date */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">截止日期</label>
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
                    className="w-full"
                    placeholder="选择截止日期"
                    showTime={true}
                  />
                </div>

                {/* Reminder Date */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">提醒日期</label>
                  <SleekDatePicker
                    value={taskRemindAt}
                    onChange={setTaskRemindAt}
                    className="w-full"
                    placeholder="选择提醒日期"
                    showTime={true}
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1 relative">
                <label className="text-xs font-bold text-tx-secondary uppercase tracking-wider block">详细描述</label>
                <Textarea
                  value={taskDescription}
                  onChange={(e) => {
                    setTaskDescription(e.target.value);
                    setDescCursorPos(e.target.selectionStart || 0);
                  }}
                  onKeyUp={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
                  onClick={(e) => setDescCursorPos(e.currentTarget.selectionStart || 0)}
                  placeholder="输入任务描述信息（支持Markdown及@提及）…"
                  className="text-xs leading-relaxed min-h-[100px] border-app-border rounded-xl w-full"
                />
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
            </ScrollArea>

            {/* Footer */}
            <div className="px-6 py-3 border-t border-app-border bg-app-sidebar/30 flex justify-end gap-2 shrink-0">
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
    </div>
  );
}
