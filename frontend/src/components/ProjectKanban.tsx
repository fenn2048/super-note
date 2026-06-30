import React, { useState, useEffect, useRef } from "react";
import { Project, ProjectStage, ProjectTask, Tag, UserPublicInfo, AuditLog } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import {
  Plus, Edit2, Trash2, Play, Pause, CheckSquare, Calendar, User, UserPlus,
  Tag as TagIcon, X, PlusCircle, CheckCircle2, Circle, Clock, Check, MoreHorizontal, Sparkles, MoveRight,
  Eye, FileVideo, Image as ImageIcon, Paperclip, Upload, AlertCircle, Link, Compass, Loader2
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import GenericTagInput from "@/components/GenericTagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import { cn, detectSuMention } from "@/lib/utils";
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
}

export default function ProjectKanban({
  project,
  stages,
  onRefresh,
  onTaskClick,
  onToggleTaskComplete,
  initialActiveTaskId,
  onClearActiveTaskId
}: ProjectKanbanProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === "zh-CN" ? zhCN : enUS;
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
    } else {
      setTaskLogs([]);
    }
  }, [activeTask?.id]);

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
              "w-72 shrink-0 bg-app-sidebar border rounded-xl flex flex-col h-full max-h-[85vh] shadow-sm overflow-hidden transition-all duration-200",
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
                            "w-4 h-4 rounded-full border transition-all hover:scale-110 shrink-0",
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
                      className="p-1 hover:bg-app-hover rounded text-tx-tertiary hover:text-accent-danger transition-all opacity-0 group-hover/header:opacity-100"
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

                const isDark = document.documentElement.classList.contains("dark");
                const cardColor = task.titleColor || stage.bgColor || "";
                const hasCustomColor = cardColor ? !!TASK_COLOR_MAP[cardColor] : false;
                const customStyles = hasCustomColor ? TASK_COLOR_MAP[cardColor] : null;

                const titleColor = task.titleColor || "";
                const hasTitleColor = titleColor ? !!TASK_COLOR_MAP[titleColor] : false;
                const titleStyle = hasTitleColor ? { color: TASK_COLOR_MAP[titleColor].font } : {};

                return (
                  <div
                    key={task.id}
                    onClick={() => setActiveTask(task)}
                    draggable={true}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", task.id);
                    }}
                    style={customStyles ? {
                      backgroundColor: isDark ? customStyles.bgDark : customStyles.bgLight,
                      borderColor: isDark ? customStyles.borderDark : customStyles.borderLight,
                    } : {}}
                    className={cn(
                      "bg-app-elevated border border-app-border rounded-xl p-3.5 space-y-3 shadow-sm hover:shadow-md transition-all cursor-pointer group/card animate-in fade-in duration-200",
                      !customStyles && "hover:border-app-border/80"
                    )}
                  >
                    {/* Task Tags list */}
                    {task.tags && task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {task.tags.map((tag) => (
                          <span
                            key={tag.id}
                            style={{
                              backgroundColor: `${tag.color}15`,
                              borderColor: `${tag.color}35`,
                              color: tag.color,
                            }}
                            className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase border tracking-wider shrink-0"
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Title */}
                    <h4
                      style={titleStyle}
                      className={`text-xs font-semibold text-tx-primary leading-snug break-words ${
                        task.isCompleted === 1 ? "line-through opacity-55 decoration-tx-primary/30" : (task.status === "paused" ? "opacity-60" : "")
                      }`}
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
                          className="p-1 rounded text-tx-tertiary hover:text-accent-primary transition-all shrink-0"
                          title={task.status === "paused" ? "恢复" : "暂停"}
                        >
                          {task.status === "paused" ? <Play size={10} /> : <Pause size={10} />}
                        </button>
                      </div>
                      <div className="w-full bg-app-hover/50 h-1 rounded-full overflow-hidden">
                        <div
                          className="bg-accent-primary h-full transition-all duration-300"
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
                        {(task.startDate || task.endDate) && (
                          <div className="flex items-center gap-0.5 font-mono">
                            <Calendar size={11} />
                            <span>
                              {task.endDate
                                ? new Date(task.endDate).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                                : "-"}
                            </span>
                          </div>
                        )}

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
                  className="w-full flex items-center justify-center gap-1 py-1.5 border border-dashed border-app-border/60 rounded-xl hover:border-app-border text-tx-tertiary hover:text-tx-secondary text-[11px] font-semibold transition-all"
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
          className="w-72 shrink-0 h-11 flex items-center justify-center gap-1.5 border border-dashed border-app-border/80 hover:border-app-border bg-app-sidebar/35 rounded-xl text-tx-secondary hover:text-tx-primary text-xs font-bold transition-all"
        >
          <PlusCircle size={14} />
          <span>{t("projects.addStage") || "添加任务列表"}</span>
        </button>
      )}

      {/* Task Detail Modal */}
      {activeTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-text">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => handleSaveTaskDetail(true)}
          />
          <div className="relative bg-app-elevated w-full max-w-2xl rounded-2xl border border-app-border shadow-2xl flex flex-col max-h-[85vh] animate-in scale-in duration-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const hasIncompleteDeps = activeTask.dependencies?.some((d) => d.isCompleted === 0);
                    if (activeTask.isCompleted !== 1 && hasIncompleteDeps) {
                      toast.error("前置依赖任务尚未完成，无法完成当前任务");
                      return;
                    }
                    setActiveTask((prev) => {
                      if (!prev) return null;
                      const nextCompleted = prev.isCompleted === 1 ? 0 : 1;
                      const nextProgress = nextCompleted === 1 ? 100 : 0;
                      return { ...prev, isCompleted: nextCompleted, progress: nextProgress };
                    });
                  }}
                  className="text-tx-tertiary hover:text-accent-primary transition-colors focus:outline-none"
                >
                  {activeTask.isCompleted === 1 ? (
                    <CheckCircle2 size={18} className="text-green-500" />
                  ) : (
                    <Circle size={18} />
                  )}
                </button>
                <span className="text-[10px] uppercase font-bold text-tx-tertiary tracking-wider font-mono">
                  {t("projects.taskDetails") || "任务详情"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={() => {
                      if (!showMoveDropdown) loadAvailableProjects();
                      setShowMoveDropdown(!showMoveDropdown);
                    }}
                    className="p-1.5 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
                    title="移动到其他项目"
                  >
                    <MoveRight size={16} />
                  </button>
                  {showMoveDropdown && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-app-elevated border border-app-border rounded-xl shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
                      {availableProjects.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-tx-tertiary text-center">无其他可用项目</div>
                      ) : (
                        availableProjects.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => { setShowMoveDropdown(false); handleMoveTask(p.id); }}
                            className="w-full text-left px-3 py-2 text-xs text-tx-secondary hover:bg-app-hover hover:text-tx-primary truncate"
                          >
                            {p.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => handleDeleteTask(activeTask.id)}
                  className="p-1.5 hover:bg-accent-danger/10 text-tx-tertiary hover:text-accent-danger rounded-lg transition-colors"
                  title="删除任务"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={() => handleSaveTaskDetail(true)}
                  className="p-1.5 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto min-h-0 px-6 pt-3.5 pb-6 space-y-5">
              {/* Task Title and Color Selection */}
              <div className="flex items-center justify-between gap-4">
                <Input
                  value={activeTask.title}
                  onChange={(e) =>
                    setActiveTask((prev) => (prev ? { ...prev, title: e.target.value } : null))
                  }
                  className="text-base font-bold bg-transparent border-none p-0 focus-visible:ring-0 focus-visible:border-none focus-visible:outline-none placeholder:text-tx-tertiary flex-1"
                  placeholder={t("projects.taskTitlePlaceholder") || "任务标题"}
                />
                {/* Title Color Picker Dropdown */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowColorDropdown(!showColorDropdown)}
                    className={cn(
                      "p-1.5 hover:bg-app-hover rounded-lg transition-colors border border-app-border/40 flex items-center justify-center",
                      activeTask.titleColor ? "text-accent-primary" : "text-tx-tertiary"
                    )}
                    style={activeTask.titleColor ? { color: TASK_COLOR_MAP[activeTask.titleColor].font, borderColor: TASK_COLOR_MAP[activeTask.titleColor].borderLight } : {}}
                    title="选择标题颜色"
                  >
                    <Sparkles size={16} />
                  </button>

                  {showColorDropdown && (
                    <div className="absolute top-full right-0 mt-1 bg-app-elevated border border-app-border rounded-xl shadow-xl z-50 p-2 w-48">
                      <div className="text-[10px] text-tx-tertiary font-bold mb-1.5 px-1">选择标题颜色</div>
                      <div className="grid grid-cols-5 gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTask((prev) => prev ? { ...prev, titleColor: null } : null);
                            setShowColorDropdown(false);
                          }}
                          className={cn(
                            "w-6 h-6 rounded-full border flex items-center justify-center text-[10px] text-tx-tertiary hover:bg-app-hover bg-app-bg shrink-0",
                            !activeTask.titleColor && "ring-2 ring-accent-primary ring-offset-1 ring-offset-app-elevated"
                          )}
                          title="无颜色"
                        >
                          <X size={12} />
                        </button>
                        {Object.keys(TASK_COLOR_MAP).map((colorKey) => {
                          const colorInfo = TASK_COLOR_MAP[colorKey];
                          const isSelected = activeTask.titleColor === colorKey;
                          return (
                            <button
                              key={colorKey}
                              type="button"
                              onClick={() => {
                                setActiveTask((prev) => prev ? { ...prev, titleColor: colorKey } : null);
                                setShowColorDropdown(false);
                              }}
                              className={cn(
                                "w-6 h-6 rounded-full border transition-all hover:scale-110 shrink-0",
                                isSelected && "ring-2 ring-accent-primary ring-offset-1 ring-offset-app-elevated"
                              )}
                              style={{ backgroundColor: colorInfo.font }}
                              title={colorKey}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {activeTask.dependencies?.some((d) => d.isCompleted === 0) && (
                <div className="flex items-center gap-2 p-3 bg-amber-50 text-amber-800 border border-amber-200/50 rounded-xl text-xs">
                  <AlertCircle size={14} className="text-amber-600 shrink-0" />
                  <span>前置依赖任务尚未完成，无法完成当前任务</span>
                </div>
              )}

              {/* Grid Metadata Config */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Assignee */}
                <div className="flex items-center gap-3 relative">
                  <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5">
                    <User size={13} />
                    <span>{t("projects.assignee") || "负责人"}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMemberDropdown(!showMemberDropdown)}
                    className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-app-border bg-app-sidebar/40 hover:bg-app-hover text-tx-secondary text-left font-medium text-[11px] truncate"
                  >
                    {activeTask.assigneeId ? (
                      <>
                        {activeTask.assigneeAvatarUrl ? (
                          <img
                            src={activeTask.assigneeAvatarUrl}
                            alt=""
                            className="w-4 h-4 rounded-full border border-app-border object-cover"
                          />
                        ) : (
                          <div className="w-4 h-4 rounded-full bg-accent-primary/10 border border-app-border flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                            {(activeTask.assigneeDisplayName || activeTask.assigneeName || "").slice(0, 1)}
                          </div>
                        )}
                        <span className="truncate">
                          {activeTask.assigneeDisplayName || activeTask.assigneeName}
                        </span>
                      </>
                    ) : (
                      <span className="text-tx-tertiary italic">{t("projects.noAssignee") || "暂无负责人"}</span>
                    )}
                  </button>

                  {/* Dropdown list */}
                  {showMemberDropdown && (
                    <div className="absolute top-8 left-20 right-0 bg-app-elevated border border-app-border rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5 space-y-0.5">
                      <button
                        type="button"
                        onClick={() => setAssignee(null)}
                        className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-app-hover text-[11px] font-medium text-tx-tertiary italic"
                      >
                        {t("projects.clearAssignee") || "取消指派"}
                      </button>
                      {project.members?.map((m) => {
                        const isAssignee = activeTask.assigneeId === m.userId;
                        return (
                          <button
                            key={m.userId}
                            type="button"
                            onClick={() =>
                              setAssignee({
                                userId: m.userId,
                                username: m.username,
                                displayName: m.displayName,
                                avatarUrl: m.avatarUrl,
                              })
                            }
                            className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-app-hover text-left text-[11px] font-semibold text-tx-secondary hover:text-tx-primary"
                          >
                            <div className="flex items-center gap-2 truncate">
                              {m.avatarUrl ? (
                                <img src={m.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                              ) : (
                                <div className="w-4 h-4 rounded-full bg-accent-primary/10 flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                                  {(m.displayName || m.username).slice(0, 1)}
                                </div>
                              )}
                              <span className="truncate">{m.displayName || m.username}</span>
                            </div>
                            {isAssignee && <Check size={11} className="text-accent-primary" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                  {/* Timeline dates */}
                  <div className="flex items-center gap-3">
                    <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5 flex-shrink-0">
                      <Calendar size={13} />
                      <span>{t("projects.timeline") || "时间周期"}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2 font-mono text-[11px] text-tx-secondary">
                      <SleekDatePicker
                        value={activeTask.startDate ? activeTask.startDate.split("T")[0] : ""}
                        onChange={(val) =>
                          setActiveTask((prev) =>
                            prev ? { ...prev, startDate: val || null } : null
                          )
                        }
                        className="w-full"
                        placeholder="开始日期"
                      />
                      <span className="text-tx-tertiary">~</span>
                      <SleekDatePicker
                        value={activeTask.endDate ? activeTask.endDate.split("T")[0] : ""}
                        onChange={(val) =>
                          setActiveTask((prev) =>
                            prev ? { ...prev, endDate: val || null } : null
                          )
                        }
                        className="w-full"
                        placeholder="结束日期"
                      />
                    </div>
                  </div>

                  {/* Task Tags */}
                  <div className="flex items-center gap-3 relative md:col-span-2">
                    <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5">
                      <TagIcon size={13} />
                      <span>{t("projects.tags") || "标签"}</span>
                    </div>
                    <div className="flex-1">
                      <GenericTagInput
                        selectedTags={activeTask.tags || []}
                        onTagsChange={(newTags) =>
                          setActiveTask((prev) => (prev ? { ...prev, tags: newTags } : null))
                        }
                        placeholder={t("projects.addTag") || "添加标签"}
                      />
                    </div>
                  </div>

                  {/* Participants */}
                  <div className="flex items-center gap-3 relative md:col-span-2">
                    <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5">
                      <UserPlus size={13} />
                      <span>{t("projects.participants") || "参与用户"}</span>
                    </div>
                    <div className="flex-1 flex items-center flex-wrap gap-1.5">
                      {activeTask.participants?.map((p) => (
                        <span
                          key={p.userId}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-lg border border-app-border bg-app-sidebar/30 text-tx-secondary font-semibold text-[10px]"
                        >
                          <span>{p.displayName || p.username}</span>
                          <button
                            type="button"
                            onClick={() => toggleTaskParticipant(p)}
                            className="hover:text-red-500 rounded p-0.5"
                          >
                            <X size={8} />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowParticipantDropdown(!showParticipantDropdown)}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg border border-dashed border-app-border/80 hover:border-app-border text-tx-tertiary hover:text-tx-secondary font-semibold text-[10px]"
                      >
                        <Plus size={10} />
                        <span>{t("projects.addParticipant") || "添加成员"}</span>
                      </button>
                    </div>

                    {/* Participants Dropdown */}
                    {showParticipantDropdown && (
                      <div className="absolute top-8 left-20 bg-app-elevated border border-app-border rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5 space-y-0.5 w-56">
                        {project.members
                          ?.filter((m) => m.userId !== activeTask.assigneeId)
                          .map((m) => {
                            const isPart = activeTask.participants?.some((p) => p.userId === m.userId);
                            return (
                              <button
                                key={m.userId}
                                type="button"
                                onClick={() =>
                                  toggleTaskParticipant({
                                    userId: m.userId,
                                    username: m.username,
                                    displayName: m.displayName,
                                    avatarUrl: m.avatarUrl,
                                  })
                                }
                                className="w-full flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-app-hover text-left text-[11px] font-semibold text-tx-secondary hover:text-tx-primary"
                              >
                                <div className="flex items-center gap-2 truncate">
                                  {m.avatarUrl ? (
                                    <img src={m.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-accent-primary/10 flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                                      {(m.displayName || m.username).slice(0, 1)}
                                    </div>
                                  )}
                                  <span className="truncate">{m.displayName || m.username}</span>
                                </div>
                                {isPart && <Check size={11} className="text-accent-primary" />}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Slider */}
                <div className="space-y-2.5 border-t border-app-border/40 pt-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-tx-primary tracking-wide">
                      {t("projects.progress") || "任务进度"}
                    </h5>
                    <span className="text-xs font-semibold text-accent-primary font-mono">
                      {activeTask.progress || 0}%
                    </span>
                  </div>
                  <div className="flex items-center gap-3 bg-app-sidebar/20 p-3 rounded-xl border border-app-border/50">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={activeTask.progress || 0}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10) || 0;
                        setActiveTask((prev) => {
                          if (!prev) return null;
                          return {
                            ...prev,
                            progress: val,
                            isCompleted: val === 100 ? 1 : 0
                          };
                        });
                      }}
                      className="flex-1 h-1.5 bg-app-sidebar rounded-lg appearance-none cursor-pointer accent-accent-primary focus:outline-none"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={activeTask.progress === undefined ? 0 : activeTask.progress}
                        onChange={(e) => {
                          let val = parseInt(e.target.value, 10);
                          if (isNaN(val)) val = 0;
                          val = Math.min(100, Math.max(0, val));
                          setActiveTask((prev) => {
                            if (!prev) return null;
                            return {
                              ...prev,
                              progress: val,
                              isCompleted: val === 100 ? 1 : 0
                            };
                          });
                        }}
                        className="w-16 h-7 text-xs font-mono font-bold text-center border-app-border bg-app-bg px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus-visible:ring-1 focus-visible:ring-accent-primary"
                      />
                      <span className="text-xs font-bold text-tx-secondary">%</span>
                    </div>
                  </div>
                </div>

                {/* Description with Edit/Preview tabs */}
                <div className="space-y-1.5 border-t border-app-border/40 pt-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-tx-primary tracking-wide">
                      {t("projects.description") || "任务描述"}
                    </h5>
                    <div className="flex items-center gap-0.5 bg-app-hover/60 rounded-lg p-0.5">
                      <button
                        type="button"
                        onClick={() => setDescriptionMode("edit")}
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors",
                          descriptionMode === "edit"
                            ? "bg-app-elevated text-tx-primary shadow-sm"
                            : "text-tx-tertiary hover:text-tx-secondary"
                        )}
                      >
                        <Edit2 size={10} />
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescriptionMode("preview")}
                        className={cn(
                          "flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors",
                          descriptionMode === "preview"
                            ? "bg-app-elevated text-tx-primary shadow-sm"
                            : "text-tx-tertiary hover:text-tx-secondary"
                        )}
                      >
                        <Eye size={10} />
                        预览
                      </button>
                    </div>
                  </div>
                  {descriptionMode === "edit" ? (
                    <Textarea
                      value={activeTask.description || ""}
                      onChange={(e) =>
                        setActiveTask((prev) => (prev ? { ...prev, description: e.target.value } : null))
                      }
                      className="text-xs leading-relaxed min-h-[120px] font-mono bg-app-sidebar/20 border-app-border rounded-xl"
                      placeholder={t("projects.taskDescPlaceholder") || "支持 Markdown 和 HTML/CSS 格式…"}
                    />
                  ) : (
                    <div
                      className={cn(
                        "min-h-[80px] p-3 rounded-xl border border-app-border bg-app-sidebar/20 text-xs leading-relaxed text-tx-secondary",
                        "prose prose-sm max-w-none prose-headings:text-tx-primary prose-p:text-tx-secondary",
                        "prose-code:text-accent-primary prose-pre:bg-app-hover prose-a:text-accent-primary"
                      )}
                    >
                      {activeTask.description ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                          {activeTask.description}
                        </ReactMarkdown>
                      ) : (
                        <span className="text-tx-tertiary italic text-[11px]">{t("projects.taskDescPlaceholder") || "暂无描述"}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Attachments */}
                <div className="space-y-2 border-t border-app-border/40 pt-4">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-tx-primary tracking-wide flex items-center gap-1.5">
                      <Paperclip size={13} className="text-accent-primary" />
                      附件
                    </h5>
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={uploadingAttachment}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-app-hover hover:bg-app-active text-tx-secondary text-[10px] font-semibold border border-app-border transition-colors disabled:opacity-50"
                    >
                      <Upload size={10} />
                      {uploadingAttachment ? "上传中…" : "上传文件"}
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !activeTask) return;
                        e.target.value = "";
                        setUploadingAttachment(true);
                        try {
                          const result = await api.taskAttachments.upload(file, activeTask.id);
                          setActiveTask((prev) => {
                            if (!prev) return null;
                            const existing = prev.attachments || [];
                            return {
                              ...prev,
                              attachments: [
                                ...existing,
                                { id: result.id, filename: result.filename, mimeType: result.mimeType, size: result.size },
                              ],
                            };
                          });
                          toast.success("附件上传成功");
                        } catch (err: any) {
                          toast.error(err?.message || "附件上传失败");
                        } finally {
                          setUploadingAttachment(false);
                        }
                      }}
                    />
                  </div>

                  {(!activeTask.attachments || activeTask.attachments.length === 0) ? (
                    <div className="text-[11px] text-tx-tertiary italic py-2 px-3 rounded-xl border border-dashed border-app-border/60">
                      暂无附件，支持图片和视频格式
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      {activeTask.attachments.map((att) => {
                        const url = api.taskAttachments.urlFor(att.id);
                        const isVideo = att.mimeType?.startsWith("video/");
                        return (
                          <div key={att.id} className="relative group/att rounded-lg overflow-hidden border border-app-border bg-app-sidebar/30 aspect-square">
                            {isVideo ? (
                              <video
                                src={`${url}?inline=1`}
                                className="w-full h-full object-cover"
                                controls={false}
                                muted
                              />
                            ) : (
                              <img
                                src={url}
                                alt={att.filename}
                                className="w-full h-full object-cover"
                              />
                            )}
                            {/* overlay on hover */}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/att:opacity-100 transition-opacity flex items-center justify-center gap-2">
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 bg-white/20 hover:bg-white/30 rounded-full text-white"
                                title="查看原图"
                              >
                                <Eye size={12} />
                              </a>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!confirm("确定要删除该附件吗？")) return;
                                  try {
                                    await api.taskAttachments.remove(att.id);
                                    setActiveTask((prev) => {
                                      if (!prev) return null;
                                      return { ...prev, attachments: (prev.attachments || []).filter((a) => a.id !== att.id) };
                                    });
                                    toast.success("附件已删除");
                                  } catch (err: any) {
                                    toast.error(err?.message || "删除失败");
                                  }
                                }}
                                className="p-1.5 bg-red-500/60 hover:bg-red-500/80 rounded-full text-white"
                                title="删除附件"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            {/* type badge */}
                            <div className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1 py-0.5 rounded bg-black/50 text-white text-[9px]">
                              {isVideo ? <FileVideo size={8} /> : <ImageIcon size={8} />}
                              <span className="max-w-[60px] truncate">{att.filename}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Checklist / Subtasks */}
                <div className="space-y-3 border-t border-app-border/40 pt-4">
                  <h5 className="text-xs font-bold text-tx-primary tracking-wide flex items-center gap-1.5">
                    <CheckSquare size={14} className="text-accent-primary" />
                    <span>{t("projects.checklist") || "任务清单"}</span>
                  </h5>

                  <div className="space-y-2">
                    {activeTask.checklists?.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between group/chk p-2 rounded-xl bg-app-sidebar/10 hover:bg-app-hover/30 border border-app-border/40 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleChecklistItem(idx)}
                            className="text-tx-tertiary hover:text-accent-primary transition-colors focus:outline-none"
                          >
                            {item.isCompleted === 1 ? (
                              <CheckCircle2 size={15} className="text-green-500" />
                            ) : (
                              <Circle size={15} />
                            )}
                          </button>
                          <span
                            className={`text-xs font-medium text-tx-secondary truncate ${
                              item.isCompleted === 1 ? "line-through opacity-55" : ""
                            }`}
                          >
                            {item.title}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeChecklistItem(idx)}
                          className="opacity-0 group-hover/chk:opacity-100 p-0.5 hover:bg-app-active rounded text-tx-tertiary hover:text-accent-danger transition-all"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    {/* Add checklist item form */}
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        placeholder={t("projects.addChecklistItem") || "添加清单项…"}
                        value={newChecklistTitle}
                        onChange={(e) => setNewChecklistTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleAddChecklistItem()}
                        className="h-8 text-xs flex-1 border-app-border bg-app-sidebar/20"
                      />
                      <Button
                        type="button"
                        onClick={handleAddChecklistItem}
                        className="h-8 text-xs bg-app-hover hover:bg-app-active text-tx-secondary border border-app-border"
                        variant="outline"
                      >
                        {t("common.add") || "添加"}
                      </Button>
                    </div>
                  </div>
                </div>

                {/* Task Dependencies */}
                <div className="space-y-3 border-t border-app-border/40 pt-4">
                  <h5 className="text-xs font-bold text-tx-primary tracking-wide flex items-center gap-1.5">
                    <Link size={13} className="text-accent-primary" />
                    <span>前置依赖任务</span>
                  </h5>

                  {/* List of current dependencies */}
                  {(!activeTask.dependencies || activeTask.dependencies.length === 0) ? (
                    <div className="text-[11px] text-tx-tertiary italic py-1.5 px-3 rounded-xl border border-dashed border-app-border/60">
                      暂无前置依赖任务
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {activeTask.dependencies.map((dep) => (
                        <div 
                          key={dep.id}
                          className="flex items-center justify-between p-2 rounded-xl bg-app-sidebar/10 hover:bg-app-hover/30 border border-app-border/40 transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {dep.isCompleted === 1 ? (
                              <CheckCircle2 size={13} className="text-green-500 shrink-0" />
                            ) : (
                              <AlertCircle size={13} className="text-amber-500 shrink-0" />
                            )}
                            <span className={cn("text-xs font-medium truncate text-tx-secondary", dep.isCompleted === 1 && "line-through opacity-55")}>
                              {dep.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0", 
                              dep.isCompleted === 1 
                                ? "bg-green-50 text-green-700 border-green-200/50" 
                                : "bg-amber-50 text-amber-700 border-amber-200/50"
                            )}>
                              {dep.isCompleted === 1 ? "已完成" : "未完成"}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleRemoveDependency(dep.id)}
                              className="p-1 hover:bg-app-active rounded text-tx-tertiary hover:text-red-500 transition-colors"
                            >
                              <X size={11} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add dependency selector */}
                  {stages.flatMap(s => s.tasks || []).filter(t => t.id !== activeTask.id && !(activeTask.dependencies || []).some(d => d.id === t.id)).length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-tx-tertiary shrink-0">添加依赖：</span>
                      <select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleAddDependency(e.target.value);
                            e.target.value = "";
                          }
                        }}
                        className="flex-1 text-[11px] border border-app-border bg-app-sidebar/20 rounded p-1 outline-none text-tx-secondary"
                      >
                        <option value="">-- 选择前置依赖任务 --</option>
                        {stages.flatMap(s => s.tasks || [])
                          .filter(t => t.id !== activeTask.id && !(activeTask.dependencies || []).some(d => d.id === t.id))
                          .map((t) => (
                            <option key={t.id} value={t.id}>{t.title}</option>
                          ))
                        }
                      </select>
                    </div>
                  )}
                </div>

                {/* Task Modification Logs */}
                <div className="space-y-3 border-t border-app-border/40 pt-4">
                  <h5 className="text-xs font-bold text-tx-primary tracking-wide flex items-center gap-1.5">
                    <Compass size={13} className="text-accent-primary" />
                    <span>任务修改记录</span>
                  </h5>

                  {loadingTaskLogs ? (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 size={16} className="animate-spin text-accent-primary" />
                    </div>
                  ) : taskLogs.length === 0 ? (
                    <div className="text-[11px] text-tx-tertiary italic py-1.5 px-3 rounded-xl border border-dashed border-app-border/60">
                      暂无修改记录
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[200px] overflow-y-auto pr-1">
                      {taskLogs.map((log) => (
                        <div key={log.id} className="text-[11px] text-tx-secondary space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-tx-primary">{log.displayName || log.username}</span>
                            <span className="text-[9px] text-tx-tertiary font-mono">
                              {format(parseISO(log.createdAt + (log.createdAt.endsWith("Z") ? "" : "Z")), "yyyy-MM-dd HH:mm", { locale: dateLocale })}
                            </span>
                          </div>
                          <p className="bg-app-sidebar/10 px-2 py-1 rounded border border-app-border/20">
                            {log.details || log.action}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-app-border bg-app-sidebar/30 flex justify-end gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseModal}
                className="text-xs"
              >
                {t("common.cancel") || "取消"}
              </Button>
              <Button
                size="sm"
                onClick={handleSaveTaskDetail}
                className="text-xs bg-accent-primary hover:bg-accent-primary/95 text-white"
              >
                {t("common.save") || "保存"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
