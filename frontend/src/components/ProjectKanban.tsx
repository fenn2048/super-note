import React, { useState, useEffect, useRef } from "react";
import { Project, ProjectStage, ProjectTask, Tag, UserPublicInfo, AuditLog } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import { useTheme } from "next-themes";
import {
  Plus, Edit2, Trash2, Play, Pause, CheckSquare, Calendar, User, UserPlus,
  Tag as TagIcon, X, PlusCircle, CheckCircle2, Circle, Clock, Check, MoreHorizontal, Sparkles, MoveRight,
  Eye, FileVideo, Image as ImageIcon, Paperclip, Upload, AlertCircle, Link, Compass, Loader2, MessageSquare
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import GenericTagInput from "@/components/GenericTagInput";
import { AiFormatHelper } from "@/components/AiFormatHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import { toast } from "@/lib/toast";

import { ScrollArea } from "@/components/ui/scroll-area";
import TaskDetailModal from "./TaskDetailModal";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import { cn, detectSuMention, getTagColor } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

export const TASK_COLOR_MAP: Record<string, { font: string; borderLight: string; borderDark: string; bgLight: string; bgDark: string }> = {
  red: { font: "#ef4444", borderLight: "#fca5a5", borderDark: "#7f1d1d", bgLight: "#fef2f2", bgDark: "#450a0a" },
  orange: { font: "#f97316", borderLight: "#fed7aa", borderDark: "#7c2d12", bgLight: "#fff7ed", bgDark: "#431407" },
  yellow: { font: "#eab308", borderLight: "#fef08a", borderDark: "#854d0e", bgLight: "#fefce8", bgDark: "#422006" },
  green: { font: "#22c55e", borderLight: "#bbf7d0", borderDark: "#064e3b", bgLight: "#f0fdf4", bgDark: "#022c22" },
  emerald: { font: "#10b981", borderLight: "#a7f3d0", borderDark: "#065f46", bgLight: "#ecfdf5", bgDark: "#064e3b" },
  teal: { font: "#14b8a6", borderLight: "#99f6e4", borderDark: "#115e59", bgLight: "#f0fdfa", bgDark: "#134e4a" },
  cyan: { font: "#06b6d4", borderLight: "#a5f3fc", borderDark: "#0f766e", bgLight: "#ecfeff", bgDark: "#164e63" },
  blue: { font: "#3b82f6", borderLight: "#bfdbfe", borderDark: "#1e3a8a", bgLight: "#eff6ff", bgDark: "#172554" },
  indigo: { font: "#6366f1", borderLight: "#c7d2fe", borderDark: "#3730a3", bgLight: "#e0e7ff", bgDark: "#1e1b4b" },
  purple: { font: "#a855f7", borderLight: "#e9d5ff", borderDark: "#581c87", bgLight: "#faf5ff", bgDark: "#3b0764" },
  fuchsia: { font: "#d946ef", borderLight: "#f5d0fe", borderDark: "#86198f", bgLight: "#fdf4ff", bgDark: "#4a044e" },
  pink: { font: "#ec4899", borderLight: "#fbcfe8", borderDark: "#9d174d", bgLight: "#fdf2f8", bgDark: "#500724" },
  rose: { font: "#f43f5e", borderLight: "#fecdd3", borderDark: "#9f1239", bgLight: "#fff1f2", bgDark: "#4c0519" }
};

interface ProjectKanbanProps {
  project: Project;
  stages: ProjectStage[];
  onRefresh: () => void;
  onTaskClick?: (task: ProjectTask) => void;
  onToggleTaskComplete?: (taskId: string, currentCompleted: number) => void;
  initialActiveTaskId?: string | null;
  onClearActiveTaskId?: () => void;
  wsMembers?: any[];
}

export default function ProjectKanban({
  project,
  stages,
  onRefresh,
  onTaskClick,
  onToggleTaskComplete,
  initialActiveTaskId,
  onClearActiveTaskId,
  wsMembers = []
}: ProjectKanbanProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;
  const { resolvedTheme } = useTheme();
  /** Prefer next-themes; fall back to html class (SSR-safe after mount). */
  const isDark =
    resolvedTheme === "dark" ||
    (typeof document !== "undefined" &&
      !resolvedTheme &&
      document.documentElement.classList.contains("dark"));
  const taskDescRef = useRef<HTMLTextAreaElement>(null);


  const membersList = wsMembers && wsMembers.length > 0 ? wsMembers : (project.members || []);
  const [newStageName, setNewStageName] = useState("");
  const [addingStage, setAddingStage] = useState(false);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  // Task creation state
  const [addingTaskToStage, setAddingTaskToStage] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");

  // Editing stage state
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState("");

  // Task Detail Modal State
  const [activeTask, setActiveTask] = useState<ProjectTask | null>(null);
  const activeAssignee = activeTask ? membersList.find((m) => m.userId === activeTask.assigneeId) : null;
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [showParticipantDropdown, setShowParticipantDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">("edit");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  // Move Task State
  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const [taskLogs, setTaskLogs] = useState<AuditLog[]>([]);
  const [loadingTaskLogs, setLoadingTaskLogs] = useState(false);

  const [taskComments, setTaskComments] = useState<any[]>([]);
  const [loadingTaskComments, setLoadingTaskComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  useEffect(() => {
    if (activeTask?.id) {
      setLoadingTaskLogs(true);
      api.getTargetAuditLogs("project_task", activeTask.id)
        .then(setTaskLogs)
        .catch((err) => {
          console.error("Failed to load project task logs:", err);
          setTaskLogs([]);
        })
        .finally(() => setLoadingTaskLogs(false));

      setLoadingTaskComments(true);
      api.getTaskComments(activeTask.id)
        .then(setTaskComments)
        .catch((err) => {
          console.error("Failed to load task comments:", err);
          setTaskComments([]);
        })
        .finally(() => setLoadingTaskComments(false));
    } else {
      setTaskLogs([]);
      setTaskComments([]);
    }
  }, [activeTask?.id]);

  const handleAddComment = async () => {
    if (!activeTask?.id || !newCommentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const added = await api.addTaskComment(activeTask.id, newCommentText.trim());
      setTaskComments((prev) => [...prev, added]);
      setNewCommentText("");
      // 刷新修改记录，以便看到刚才发表的评论记录
      api.getTargetAuditLogs("project_task", activeTask.id)
        .then(setTaskLogs)
        .catch(() => {});
    } catch (err) {
      console.error("Failed to add comment:", err);
      alert("发表评论失败，请重试");
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleCloseModal = () => {
    setActiveTask(null);
    onClearActiveTaskId?.();
    setShowColorDropdown(false);
  };

  // Listen to initialActiveTaskId
  useEffect(() => {
    if (initialActiveTaskId) {
      for (const stage of stages) {
        const task = stage.tasks?.find((t) => t.id === initialActiveTaskId);
        if (task) {
          setActiveTask(task);
          break;
        }
      }
    }
  }, [initialActiveTaskId, stages]);

  // Listen to open-task events from other components (like Calendar or Discussion)
  useEffect(() => {
    const handleOpenTaskEvent = (e: Event) => {
      const customEvent = e as CustomEvent;
      const taskId = customEvent.detail;
      if (taskId) {
        // Find task in current stages
        for (const stage of stages) {
          const task = stage.tasks?.find((t) => t.id === taskId);
          if (task) {
            setActiveTask(task);
            break;
          }
        }
      }
    };
    window.addEventListener("super:open-project-task", handleOpenTaskEvent);
    return () => window.removeEventListener("super:open-project-task", handleOpenTaskEvent);
  }, [stages]);

  // Fetch workspace tags when Task Details opens

  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageName.trim()) return;
    try {
      await api.createProjectStage(project.id, { name: newStageName.trim() });
      setNewStageName("");
      setAddingStage(false);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "添加阶段失败");
    }
  };

  const handleRenameStage = async (stageId: string) => {
    if (!editingStageName.trim()) return;
    try {
      await api.updateProjectStage(stageId, { name: editingStageName.trim() });
      setEditingStageId(null);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "重命名阶段失败");
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    if (!confirm("删除该阶段将同时删除其下的所有任务，确定吗？")) return;
    try {
      await api.deleteProjectStage(stageId);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "删除阶段失败");
    }
  };

  const handleAddTask = async (stageId: string) => {
    if (!newTaskTitle.trim()) return;
    const rawInput = newTaskTitle.trim();
    try {
      // 检测 @su 标记 — AI 提炼标题 + 剩余内容作为任务描述
      const su = detectSuMention(rawInput);
      const taskTitle = su.hasSu ? su.cleanText.slice(0, 50) : rawInput;
      const taskDesc = su.hasSu ? su.cleanText : rawInput;

      // 家庭TODO项目：自动将工作区所有成员设为参与人
      const isFamilyTodo = project.name === "家庭TODO";
      let participants: string[] | undefined;
      if (isFamilyTodo && project.workspaceId) {
        try {
          const members = await api.getWorkspaceMembers(project.workspaceId);
          participants = members.map((m) => m.userId);
        } catch {
          // 获取成员失败时不阻塞任务创建
        }
      }

      const task = await api.createProjectTask(project.id, {
        stageId,
        title: taskTitle,
        description: taskDesc,
        participants,
      });
      setNewTaskTitle("");
      setAddingTaskToStage(null);
      onRefresh();

      // 仅含 @su 时用 AI 提炼简短标题，不含则不总结
      if (su.hasSu) {
        api.aiChat("title", su.cleanText.slice(0, 2000)).then(async (rawTitle) => {
          const cleanedTitle = rawTitle.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
          if (cleanedTitle) {
            await api.updateProjectTask(task.id, { title: cleanedTitle });
            onRefresh();
          }
        }).catch(console.error);
      }
    } catch (err: any) {
      toast.error(err?.message || "创建任务失败");
    }
  };

  const handleSaveTaskDetail = async (silent?: boolean | React.MouseEvent) => {
    const isSilent = silent === true;
    if (!activeTask) return;
    const prevDescription = activeTask.description || "";
    try {
      const updated = await api.updateProjectTask(activeTask.id, {
        title: activeTask.title,
        description: activeTask.description,
        isCompleted: activeTask.isCompleted,
        progress: activeTask.progress || 0,
        assigneeId: activeTask.assigneeId,
        startDate: activeTask.startDate || null,
        endDate: activeTask.endDate || null,
        checklists: activeTask.checklists || [],
        participants: activeTask.participants?.map((p) => p.userId) || [],
        tags: activeTask.tags?.map((t) => t.id) || [],
        titleColor: activeTask.titleColor || null,
        dependencies: activeTask.dependencies?.map((d) => d.id) || [],
      });
      if (!isSilent) {
        toast.success("保存成功");
      }
      onRefresh();
      handleCloseModal();

      // 异步 AI 总结：若新描述包含 @su 且内容有变化，触发 AI 提炼标题
      const newDesc = activeTask.description || "";
      if (newDesc.includes("@su") && newDesc !== prevDescription) {
        const cleanDesc = newDesc.replace(/@su\s*/g, "").trim();
        if (cleanDesc) {
          api.aiChat("title", cleanDesc.slice(0, 2000)).then(async (rawTitle) => {
            const cleanedTitle = rawTitle.replace(/^["'"""'']+|["'"""'']+$/g, "").trim();
            if (cleanedTitle) {
              await api.updateProjectTask(activeTask.id, { title: cleanedTitle }).catch(() => {});
              onRefresh();
            }
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "更新任务失败");
    }
  };

  const loadAvailableProjects = async () => {
    try {
      const projs = await api.getProjects();
      setAvailableProjects(projs.filter(p => p.id !== project.id));
    } catch (err: any) {
      toast.error(err?.message || "加载项目失败");
    }
  };

  const handleMoveTask = async (targetProjectId: string) => {
    if (!activeTask) return;
    try {
      const stages = await api.getProjectStages(targetProjectId);
      if (!stages || stages.length === 0) {
        toast.error("目标项目没有阶段，无法移动");
        return;
      }
      await api.updateProjectTask(activeTask.id, { projectId: targetProjectId, stageId: stages[0].id });
      toast.success("移动成功");
      handleCloseModal();
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "移动任务失败");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("确定要删除该任务吗？")) return;
    try {
      await api.deleteProjectTask(taskId);
      handleCloseModal();
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "删除任务失败");
    }
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistTitle.trim() || !activeTask) return;
    const newItem = {
      id: "", // Empty for creation
      taskId: activeTask.id,
      title: newChecklistTitle.trim(),
      isCompleted: 0,
      sortOrder: activeTask.checklists?.length || 0,
      createdAt: new Date().toISOString(),
    };
    setActiveTask((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        checklists: [...(prev.checklists || []), newItem],
      };
    });
    setNewChecklistTitle("");
  };

  const toggleChecklistItem = (index: number) => {
    if (!activeTask) return;
    setActiveTask((prev) => {
      if (!prev) return null;
      const copy = [...(prev.checklists || [])];
      copy[index] = {
        ...copy[index],
        isCompleted: copy[index].isCompleted === 1 ? 0 : 1,
      };
      return {
        ...prev,
        checklists: copy,
      };
    });
  };

  const removeChecklistItem = (index: number) => {
    if (!activeTask) return;
    setActiveTask((prev) => {
      if (!prev) return null;
      const copy = [...(prev.checklists || [])];
      copy.splice(index, 1);
      return {
        ...prev,
        checklists: copy,
      };
    });
  };

  const toggleTaskParticipant = (user: { userId: string; username: string; displayName: string | null; avatarUrl: string | null }) => {
    if (!activeTask) return;
    const isParticipant = activeTask.participants?.some((p) => p.userId === user.userId);
    setActiveTask((prev) => {
      if (!prev) return null;
      const current = prev.participants || [];
      const updated = isParticipant
        ? current.filter((p) => p.userId !== user.userId)
        : [...current, user];
      return {
        ...prev,
        participants: updated,
      };
    });
    setShowParticipantDropdown(false);
  };

  const handleAddDependency = (depId: string) => {
    if (!activeTask) return;
    const depTask = stages.flatMap(s => s.tasks || []).find(t => t.id === depId);
    if (!depTask) return;
    const existing = activeTask.dependencies || [];
    if (existing.some(d => d.id === depId)) return;
    setActiveTask({
      ...activeTask,
      dependencies: [...existing, { id: depId, title: depTask.title, isCompleted: depTask.isCompleted }]
    });
  };

  const handleRemoveDependency = (depId: string) => {
    if (!activeTask) return;
    setActiveTask({
      ...activeTask,
      dependencies: (activeTask.dependencies || []).filter(d => d.id !== depId)
    });
  };

  const toggleTaskTag = (tag: Tag) => {
    if (!activeTask) return;
    const hasTag = activeTask.tags?.some((t) => t.id === tag.id);
    setActiveTask((prev) => {
      if (!prev) return null;
      const current = prev.tags || [];
      const updated = hasTag
        ? current.filter((t) => t.id !== tag.id)
        : [...current, { id: tag.id, name: tag.name, color: tag.color }];
      return {
        ...prev,
        tags: updated,
      };
    });
  };

  const setAssignee = (user: { userId: string; username: string; displayName: string | null; avatarUrl: string | null } | null) => {
    if (!activeTask) return;
    setActiveTask((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        assigneeId: user ? user.userId : null,
        assigneeName: user ? user.username : undefined,
        assigneeDisplayName: user ? (user.displayName ?? undefined) : undefined,
        assigneeAvatarUrl: user ? user.avatarUrl : null,
      };
    });
    setShowMemberDropdown(false);
  };

  return (
    <div className="flex-1 flex gap-4 overflow-x-auto p-4 md:p-6 h-full pb-20 select-none">
      {/* Stages List */}
      {stages.map((stage) => {
        const isDragOver = dragOverStageId === stage.id;
        return (
          <div
            key={stage.id}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverStageId !== stage.id) setDragOverStageId(stage.id);
            }}
            onDragLeave={() => {
              if (dragOverStageId === stage.id) setDragOverStageId(null);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOverStageId(null);
              const taskId = e.dataTransfer.getData("text/plain");
              if (!taskId) return;
              try {
                await api.updateProjectTask(taskId, { stageId: stage.id });
                onRefresh();
              } catch (err: any) {
                toast.error(err?.message || "移动任务失败");
              }
            }}
            className={cn(
              "w-72 shrink-0 bg-app-sidebar border rounded-xl flex flex-col h-full max-h-[85vh] shadow-sm overflow-hidden transition-[transform,opacity,background-color,box-shadow,border-color] duration-normal",
              isDragOver ? "border-accent-primary ring-2 ring-accent-primary/20 bg-app-active/10" : "border-app-border"
            )}
          >
            {/* Stage Header */}
            <div className="p-3 border-b border-app-border flex items-center justify-between shrink-0 bg-app-hover/35">
              {editingStageId === stage.id ? (
                <div className="flex flex-col gap-2 w-full">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRenameStage(stage.id);
                    }}
                    className="flex items-center gap-1.5 w-full"
                  >
                    <Input
                      value={editingStageName}
                      onChange={(e) => setEditingStageName(e.target.value)}
                      className="h-7 text-xs px-2 py-0.5 focus-visible:ring-1"
                      autoFocus
                      onBlur={() => handleRenameStage(stage.id)}
                    />
                  </form>
                  {/* Stage Card Bg selection */}
                  <div className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[9px] text-tx-tertiary font-semibold uppercase tracking-wider shrink-0">卡片背景:</span>
                    <button
                      type="button"
                      onMouseDown={async (e) => {
                        e.preventDefault();
                        try {
                          await api.updateProjectStage(stage.id, { bgColor: null });
                          onRefresh();
                        } catch {}
                      }}
                      className={cn(
                        "w-4 h-4 rounded-full border flex items-center justify-center text-[8px] text-tx-tertiary hover:bg-app-hover bg-app-bg shrink-0",
                        !stage.bgColor && "ring-1 ring-accent-primary ring-offset-1 ring-offset-app-elevated"
                      )}
                      title="无颜色"
                    >
                      <X size={8} />
                    </button>
                    {Object.keys(TASK_COLOR_MAP).map((colorKey) => {
                      const colorInfo = TASK_COLOR_MAP[colorKey];
                      const isSelected = stage.bgColor === colorKey;
                      return (
                        <button
                          key={colorKey}
                          type="button"
                          onMouseDown={async (e) => {
                            e.preventDefault();
                            try {
                              await api.updateProjectStage(stage.id, { bgColor: colorKey });
                              onRefresh();
                            } catch {}
                          }}
                          className={cn(
                            "w-4 h-4 rounded-full border transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out [@media(hover:hover)_and_(pointer:fine)]:hover:scale-110 shrink-0",
                            isSelected && "ring-1 ring-accent-primary ring-offset-1 ring-offset-app-elevated"
                          )}
                          style={{ backgroundColor: colorInfo.font }}
                          title={colorKey}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 group/header w-full justify-between">
                  <span
                    className="font-bold text-xs text-tx-primary cursor-pointer truncate"
                    onClick={() => {
                      setEditingStageId(stage.id);
                      setEditingStageName(stage.name);
                    }}
                  >
                    {stage.name}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-app-hover text-tx-secondary">
                      {stage.tasks?.length || 0}
                    </span>
                    <button
                      className="p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-accent-danger transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out opacity-0 group-hover/header:opacity-100"
                      onClick={() => handleDeleteStage(stage.id)}
                      title="删除列表"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Cards List container */}
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
              {stage.tasks?.map((task) => {
                const checklistTotal = task.checklists?.length || 0;
                const checklistCompleted = task.checklists?.filter((c) => c.isCompleted === 1).length || 0;
                const hasChecklist = checklistTotal > 0;

                // Card tint: task title color takes priority, then stage default
                const cardColorKey = task.titleColor || stage.bgColor || "";
                const customStyles =
                  cardColorKey && TASK_COLOR_MAP[cardColorKey]
                    ? TASK_COLOR_MAP[cardColorKey]
                    : null;

                const titleColorKey = task.titleColor || "";
                const hasTitleColor = !!(titleColorKey && TASK_COLOR_MAP[titleColorKey]);
                const titleStyle = hasTitleColor
                  ? { color: TASK_COLOR_MAP[titleColorKey].font }
                  : undefined;

                return (
                  <div
                    key={task.id}
                    onClick={() => setActiveTask(task)}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                    }}
                    style={
                      customStyles
                        ? {
                            backgroundColor: isDark
                              ? customStyles.bgDark
                              : customStyles.bgLight,
                            borderColor: isDark
                              ? customStyles.borderDark
                              : customStyles.borderLight,
                          }
                        : undefined
                    }
                    className={cn(
                      // Semantic surfaces only — never hardcode white/zinc (breaks dark mode)
                      "rounded-xl p-3.5 space-y-3 shadow-sm",
                      "hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]",
                      "transition-[transform,box-shadow,background-color,border-color,opacity] duration-press ease-out",
                      "cursor-grab active:cursor-grabbing group/card animate-in fade-in duration-200",
                      !customStyles &&
                        "bg-app-elevated border border-app-border text-tx-primary",
                      customStyles && "border",
                      task.isCompleted === 1 && "opacity-60 saturate-50",
                    )}
                  >
                    {/* Task Tags list */}
                    {task.tags && task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {task.tags.map((tag) => (
                          <span
                            key={tag.id}
                            style={{
                              backgroundColor: `${getTagColor(tag)}15`,
                              borderColor: `${getTagColor(tag)}35`,
                              color: getTagColor(tag),
                            }}
                            className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase border tracking-wider shrink-0"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Title — default uses tx-primary so dark/light both stay readable */}
                    <h4
                      style={titleStyle}
                      className={cn(
                        "text-xs font-semibold leading-snug break-words",
                        !hasTitleColor && "text-tx-primary",
                        task.isCompleted === 1 &&
                          "line-through opacity-55 decoration-tx-primary/30",
                        task.status === "paused" && task.isCompleted !== 1 && "opacity-60",
                      )}
                    >
                      {task.title}
                      {task.status === "paused" && (
                        <span className="ml-2 px-1 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] rounded border border-amber-500/20 font-bold">
                          已暂停
                        </span>
                      )}
                    </h4>

                    {/* Progress Bar & Quick Pickers */}
                    <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between text-[9px] text-tx-tertiary">
                        <span>进度: {task.progress || 0}%</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const newStatus = task.status === "paused" ? "in_progress" : "paused";
                            api.updateProjectTask(task.id, { status: newStatus }).then(() => onRefresh());
                          }}
                          className="p-1 rounded text-tx-tertiary hover:text-accent-primary transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out shrink-0"
                          title={task.status === "paused" ? "恢复" : "暂停"}
                        >
                          {task.status === "paused" ? <Play size={10} /> : <Pause size={10} />}
                        </button>
                      </div>
                      <div className="w-full bg-app-hover/50 h-1 rounded-full overflow-hidden">
                        <div
                          className="bg-accent-primary h-full transition-[transform,opacity,background-color,box-shadow,border-color] duration-panel"
                          style={{ width: `${task.progress || 0}%` }}
                        />
                      </div>
                      <div className="flex justify-between items-center gap-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity">
                        {[0, 25, 50, 75, 100].map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={async () => {
                              try {
                                const isCompleted = p === 100 ? 1 : 0;
                                await api.updateProjectTask(task.id, {
                                  isCompleted,
                                  progress: p,
                                });
                                onRefresh();
                              } catch (err: any) {
                                toast.error(err?.message || "更新进度失败");
                              }
                            }}
                            className={cn(
                              "flex-1 py-0.5 text-[8px] font-mono rounded transition-colors text-center border border-transparent",
                              (task.progress || 0) === p
                                ? "bg-accent-primary text-white border-accent-primary"
                                : "bg-app-sidebar/40 hover:bg-app-hover hover:text-tx-primary text-tx-tertiary"
                            )}
                          >
                            {p}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Bottom Stats Meta info */}
                    <div className="flex items-center justify-between text-[10px] text-tx-tertiary pt-1.5 border-t border-app-border/40 shrink-0">
                      <div className="flex items-center gap-2">
                        {/* Dates */}
                        {(task.startDate || task.endDate) && (() => {
                          const isOverdue = task.endDate && task.isCompleted !== 1 && new Date(task.endDate).getTime() < Date.now();
                          return (
                            <div className={cn(
                              "flex items-center gap-0.5 font-mono px-1.5 py-0.5 rounded text-[9px] transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
                              isOverdue
                                ? "bg-red-500/10 text-red-500 border border-red-500/20 animate-pulse font-semibold"
                                : "text-tx-tertiary"
                            )}>
                              <Calendar size={11} />
                              <span>
                                {task.endDate
                                  ? new Date(task.endDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                                  : "-"}
                              </span>
                            </div>
                          );
                        })()}

                        {/* Checklist */}
                        {hasChecklist && (
                          <div className="flex items-center gap-0.5">
                            <CheckSquare size={11} />
                            <span>
                              {checklistCompleted}/{checklistTotal}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Assignee Avatar */}
                      {task.assigneeId ? (
                        task.assigneeAvatarUrl ? (
                          <img
                            src={task.assigneeAvatarUrl}
                            alt={task.assigneeDisplayName || task.assigneeName}
                            className="w-5 h-5 rounded-full border border-app-border object-cover"
                          />
                        ) : (
                          <div className="w-5 h-5 rounded-full bg-accent-primary/10 border border-app-border flex items-center justify-center text-[9px] font-bold text-accent-primary uppercase">
                            {(task.assigneeDisplayName || task.assigneeName || "").slice(0, 1)}
                          </div>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })}

              {/* Inline task composer */}
              {addingTaskToStage === stage.id ? (
                <div className="bg-app-bg border border-app-border rounded-xl p-2.5 space-y-2">
                  <Input
                    placeholder={t("projects.taskTitlePlaceholder") || "输入任务标题…"}
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    className="h-8 text-xs focus-visible:ring-1 border-app-border"
                    autoFocus
                  />
                  <div className="flex items-center gap-1.5 justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAddingTaskToStage(null)}
                      className="h-7 text-xs px-2.5"
                    >
                      {t("common.cancel") || "取消"}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleAddTask(stage.id)}
                      className="h-7 text-xs px-2.5 bg-accent-primary hover:bg-accent-primary/95 text-white"
                    >
                      {t("common.add") || "确认"}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setAddingTaskToStage(stage.id);
                    setNewTaskTitle("");
                  }}
                  className="w-full flex items-center justify-center gap-1 py-1.5 border border-dashed border-app-border/60 rounded-xl hover:border-app-border text-tx-tertiary hover:text-tx-secondary text-[11px] font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
                >
                  <Plus size={12} />
                  <span>{t("projects.addTask") || "添加任务"}</span>
                </button>
              )}
            </div>
          </div>
        );
      })}

      {/* Add Stage Column entry */}
      {addingStage ? (
        <form
          onSubmit={handleAddStage}
          className="w-72 shrink-0 bg-app-sidebar border border-app-border rounded-xl p-3 h-fit space-y-2 shadow-sm"
        >
          <Input
            placeholder={t("projects.stageNamePlaceholder") || "输入列表名称…"}
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            className="h-8 text-xs border-app-border"
            autoFocus
          />
          <div className="flex items-center gap-1.5 justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAddingStage(false)}
              className="h-7 text-xs"
            >
              {t("common.cancel") || "取消"}
            </Button>
            <Button
              size="sm"
              type="submit"
              className="h-7 text-xs bg-accent-primary hover:bg-accent-primary/95 text-white"
            >
              {t("common.confirm") || "确认"}
            </Button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setAddingStage(true)}
          className="w-72 shrink-0 h-11 flex items-center justify-center gap-1.5 border border-dashed border-app-border/80 hover:border-app-border bg-app-sidebar/35 rounded-xl text-tx-secondary hover:text-tx-primary text-xs font-bold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out"
        >
          <PlusCircle size={14} />
          <span>{t("projects.addStage") || "添加任务列表"}</span>
        </button>
      )}

      {/* Task Detail Modal */}
      {activeTask && (
        <TaskDetailModal
          task={activeTask}
          wsMembers={wsMembers}
          onClose={handleCloseModal}
          onRefresh={onRefresh}
          showProjectName={false}
        />
      )}
    </div>
  );
}
