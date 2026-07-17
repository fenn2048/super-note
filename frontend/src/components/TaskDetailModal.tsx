import React, { useState, useEffect, useRef } from "react";
import { Project, ProjectStage, ProjectTask, Tag, UserPublicInfo, AuditLog } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import {
  Plus, Edit2, Trash2, CheckSquare, Calendar, User, UserPlus, Bell,
  Tag as TagIcon, X, PlusCircle, CheckCircle2, Circle, Clock, Check, Sparkles,
  Eye, FileVideo, Image as ImageIcon, Paperclip, Upload, AlertCircle, Link, Compass, Loader2, MessageSquare, MoveRight
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { zhCN, enUS } from "date-fns/locale";
import GenericTagInput from "@/components/GenericTagInput";
import { AiFormatHelper } from "@/components/AiFormatHelper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import TextareaFormatToolbar from "@/components/common/TextareaFormatToolbar";
import ReminderOffsetPicker from "@/components/common/ReminderOffsetPicker";
import { toast } from "@/lib/toast";
import SleekDatePicker from "@/components/common/SleekDatePicker";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { syncTaskNotification } from "@/hooks/useCapacitor";
import { TASK_COLOR_MAP } from "./ProjectKanban";

interface TaskDetailModalProps {
  task: ProjectTask;
  wsMembers: any[];
  onClose: () => void;
  onRefresh: () => void;
  showProjectName?: boolean;
}

export default function TaskDetailModal({
  task,
  wsMembers,
  onClose,
  onRefresh,
  showProjectName = false
}: TaskDetailModalProps) {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language.startsWith("zh") ? zhCN : enUS;

  // Unify WorkspaceMember and UserPublicInfo structures
  const membersList = (wsMembers || []).map((m) => {
    const id = m.userId || m.id;
    return {
      userId: id,
      username: m.username,
      displayName: m.displayName,
      avatarUrl: m.avatarUrl,
    };
  });

  const [activeTask, setActiveTask] = useState<ProjectTask | null>(null);
  const activeAssignee = activeTask ? membersList.find((m) => m.userId === activeTask.assigneeId) : null;
  const [newChecklistTitle, setNewChecklistTitle] = useState("");
  const [showMemberDropdown, setShowMemberDropdown] = useState(false);
  const [showParticipantDropdown, setShowParticipantDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [descriptionMode, setDescriptionMode] = useState<"edit" | "preview">("edit");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const [showMoveDropdown, setShowMoveDropdown] = useState(false);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const taskDescRef = useRef<HTMLTextAreaElement>(null);

  const [taskLogs, setTaskLogs] = useState<AuditLog[]>([]);
  const [loadingTaskLogs, setLoadingTaskLogs] = useState(false);
  const [taskComments, setTaskComments] = useState<any[]>([]);
  const [loadingTaskComments, setLoadingTaskComments] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);

  const [projectStages, setProjectStages] = useState<ProjectStage[]>([]);

  useEffect(() => {
    setActiveTask(task);
  }, [task]);

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

      if (activeTask.projectId) {
        api.getProjectStages(activeTask.projectId)
          .then(setProjectStages)
          .catch(console.error);
      }
    } else {
      setTaskLogs([]);
      setTaskComments([]);
      setProjectStages([]);
    }
  }, [activeTask?.id]);

  const handleAddComment = async () => {
    if (!activeTask?.id || !newCommentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const added = await api.addTaskComment(activeTask.id, newCommentText.trim());
      setTaskComments((prev) => [...prev, added]);
      setNewCommentText("");
      api.getTargetAuditLogs("project_task", activeTask.id)
        .then(setTaskLogs)
        .catch(() => {});
    } catch (err) {
      console.error("Failed to add comment:", err);
      toast.error("发表评论失败，请重试");
    } finally {
      setSubmittingComment(false);
    }
  };

  const loadAvailableProjects = async () => {
    try {
      const projs = await api.getProjects();
      setAvailableProjects(projs.filter((p) => p.id !== activeTask?.projectId));
    } catch (err) {
      console.error(err);
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
        remindAt: activeTask.remindAt || null,
        reminderOffsetValue: activeTask.reminderOffsetValue,
        reminderOffsetUnit: activeTask.reminderOffsetUnit,
      });
      if (updated.remindAt) {
        syncTaskNotification(updated as any);
      }
      if (!isSilent) {
        toast.success("保存成功");
      }
      try {
        window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
      } catch {}
      onRefresh();
      onClose();

      // AI auto summary
      const newDesc = activeTask.description || "";
      if (newDesc.includes("@su") && newDesc !== prevDescription) {
        const cleanDesc = newDesc.replace(/@su\s*/g, "").trim();
        if (cleanDesc) {
          api.aiChat("title", cleanDesc.slice(0, 2000)).then(async (rawTitle) => {
            const cleanedTitle = rawTitle.replace(/^[#\s*"-]+|[#\s*"-]+$/g, "").trim();
            if (cleanedTitle && cleanedTitle.length > 1) {
              await api.updateProjectTask(activeTask.id, { title: cleanedTitle }).catch(() => {});
              onRefresh();
            }
          }).catch(console.error);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || "保存失败");
    }
  };

  const handleMoveTask = async (targetProjectId: string) => {
    if (!activeTask) return;
    try {
      const stages = await api.getProjectStages(targetProjectId);
      if (stages.length === 0) {
        toast.error("目标项目无可用任务列表/阶段，请先在目标项目中创建");
        return;
      }
      await api.updateProjectTask(activeTask.id, { projectId: targetProjectId, stageId: stages[0].id });
      toast.success("移动成功");
      try {
        window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
      } catch {}
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "移动任务失败");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("确定要删除该任务吗？")) return;
    try {
      await api.deleteProjectTask(taskId);
      try {
        window.dispatchEvent(new CustomEvent("super:task-stats-changed"));
      } catch {}
      onRefresh();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "删除任务失败");
    }
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistTitle.trim() || !activeTask) return;
    const newItem = {
      id: "",
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
    const depTask = projectStages.flatMap(s => s.tasks || []).find(t => t.id === depId);
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

  if (!activeTask) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center md:p-4 select-text">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => handleSaveTaskDetail(true)}
      />
      <div className="relative bg-app-elevated w-full md:max-w-2xl h-[100dvh] md:h-auto rounded-none md:rounded-2xl border-0 md:border border-app-border shadow-2xl flex flex-col max-h-none md:max-h-[85vh] animate-in slide-in-from-bottom-full md:slide-in-from-bottom-0 md:scale-in duration-200 overflow-hidden">
        {/* Modal Header */}
        <div className="px-4 md:px-6 py-3 md:py-4 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
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

          {/* Top Middle Project Name */}
          {showProjectName && activeTask.projectName && (
            <div className="text-xs font-bold text-tx-primary px-3 py-1 rounded-full bg-app-hover border border-app-border max-w-[240px] truncate">
              所属项目: {activeTask.projectName}
            </div>
          )}

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
        <div className="flex-1 overflow-y-auto min-h-0 px-4 md:px-6 pt-3.5 pb-[calc(1.5rem+var(--safe-area-bottom))] md:pb-6 space-y-5">
          {/* Task Title and Color Selection */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <Input
                value={activeTask.title}
                onChange={(e) =>
                  setActiveTask((prev) => (prev ? { ...prev, title: e.target.value } : null))
                }
                className="text-base font-bold bg-transparent border-none p-0 h-auto shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-none w-full"
                placeholder={t("projects.taskNamePlaceholder") || "任务名称"}
              />
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColorDropdown(!showColorDropdown)}
                className="w-5 h-5 rounded-full border border-app-border flex items-center justify-center shrink-0 hover:scale-105 transition-transform"
                style={{ backgroundColor: activeTask.titleColor ? TASK_COLOR_MAP[activeTask.titleColor]?.font : "transparent" }}
              >
                {!activeTask.titleColor && <Sparkles size={11} className="text-tx-tertiary" />}
              </button>
              {showColorDropdown && (
                <div className="absolute top-7 right-0 bg-app-elevated border border-app-border rounded-xl shadow-xl p-2.5 z-20 w-48">
                  <h6 className="text-[10px] font-bold text-tx-tertiary uppercase tracking-wider mb-2">任务标题高亮色</h6>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTask((prev) => prev ? { ...prev, titleColor: null } : null);
                        setShowColorDropdown(false);
                      }}
                      className={cn(
                        "w-6 h-6 rounded-full border border-app-border transition-all hover:scale-110 shrink-0 flex items-center justify-center bg-transparent text-tx-tertiary",
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
                <span>负责人</span>
              </div>
              <button
                type="button"
                onClick={() => setShowMemberDropdown(!showMemberDropdown)}
                className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg border border-app-border bg-app-sidebar/40 hover:bg-app-hover text-tx-secondary text-left font-medium text-[11px] truncate"
              >
                {activeTask.assigneeId ? (
                  <>
                    {activeTask.assigneeAvatarUrl || activeAssignee?.avatarUrl ? (
                      <img
                        src={activeTask.assigneeAvatarUrl || activeAssignee?.avatarUrl || ""}
                        alt=""
                        className="w-4 h-4 rounded-full border border-app-border object-cover"
                      />
                    ) : (
                      <div className="w-4 h-4 rounded-full bg-accent-primary/10 border border-app-border flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                        {((activeAssignee?.displayName || activeAssignee?.username || activeTask.assigneeDisplayName || activeTask.assigneeName || "?").slice(0, 1))}
                      </div>
                    )}
                    <span className="truncate">
                      {activeAssignee?.displayName || activeAssignee?.username || activeTask.assigneeDisplayName || activeTask.assigneeName}
                    </span>
                  </>
                ) : (
                  <span className="text-tx-tertiary italic">暂无负责人</span>
                )}
              </button>

              {showMemberDropdown && (
                <div className="absolute top-8 left-20 right-0 bg-app-elevated border border-app-border rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                  <button
                    type="button"
                    onClick={() => setAssignee(null)}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-app-hover text-[11px] font-medium text-tx-tertiary italic"
                  >
                    取消指派
                  </button>
                  {membersList.map((m) => {
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
                              {(m.displayName || m.username || "?").slice(0, 1)}
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
            <div className="flex items-center gap-3 md:col-span-2">
              <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5 flex-shrink-0">
                <Calendar size={13} />
                <span>时间周期</span>
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

            {/* Reminder Offset */}
            {(activeTask.endDate || activeTask.isRecurring) ? (
              <div className="flex items-center gap-3 md:col-span-2">
                <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5 flex-shrink-0">
                  <Bell size={13} />
                  <span>提醒设置</span>
                </div>
                <div className="flex-1 flex items-center">
                  <ReminderOffsetPicker
                    value={activeTask.reminderOffsetValue !== undefined ? activeTask.reminderOffsetValue : 1}
                    unit={activeTask.reminderOffsetUnit || 'day'}
                    onChangeValue={(val) =>
                      setActiveTask((prev) =>
                        prev ? { ...prev, reminderOffsetValue: val } : null
                      )
                    }
                    onChangeUnit={(val) =>
                      setActiveTask((prev) =>
                        prev ? { ...prev, reminderOffsetUnit: val } : null
                      )
                    }
                  />
                </div>
              </div>
            ) : null}

            {/* Task Tags */}
            <div className="flex items-center gap-3 relative md:col-span-2">
              <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5">
                <TagIcon size={13} />
                <span>标签</span>
              </div>
              <div className="flex-1">
                <GenericTagInput
                  selectedTags={activeTask.tags || []}
                  onTagsChange={(newTags) =>
                    setActiveTask((prev) => (prev ? { ...prev, tags: newTags } : null))
                  }
                  placeholder="添加标签"
                />
              </div>
            </div>

            {/* Participants */}
            <div className="flex items-center gap-3 relative md:col-span-2">
              <div className="w-20 text-tx-tertiary font-semibold flex items-center gap-1.5">
                <UserPlus size={13} />
                <span>参与用户</span>
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
                  <span>添加成员</span>
                </button>
              </div>

              {showParticipantDropdown && (
                <div className="absolute top-8 left-20 bg-app-elevated border border-app-border rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto p-1.5 space-y-0.5 w-56 animate-in fade-in slide-in-from-top-1 duration-150">
                  {membersList
                    .filter((m) => m.userId !== activeTask.assigneeId)
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
                                {(m.displayName || m.username || "?").slice(0, 1)}
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
                任务进度
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

          {/* Description */}
          <div className="space-y-1.5 border-t border-app-border/40 pt-4">
            <div className="flex items-center justify-between">
              <h5 className="text-xs font-bold text-tx-primary tracking-wide">
                任务描述
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
              <div className="w-full">
                <TextareaFormatToolbar
                  textareaRef={taskDescRef}
                  value={activeTask.description || ""}
                  onChange={(val) =>
                    setActiveTask((prev) => (prev ? { ...prev, description: val } : null))
                  }
                />
                <Textarea
                  ref={taskDescRef}
                  value={activeTask.description || ""}
                  onChange={(e) =>
                    setActiveTask((prev) => (prev ? { ...prev, description: e.target.value } : null))
                  }
                  className="text-xs leading-relaxed min-h-[120px] font-mono bg-app-sidebar/20 border-app-border rounded-xl w-full"
                  placeholder="支持 Markdown 和 HTML/CSS 格式…"
                />
                <AiFormatHelper
                  value={activeTask.description || ""}
                  onChange={(val) =>
                    setActiveTask((prev) => (prev ? { ...prev, description: val } : null))
                  }
                />
              </div>
            ) : (
              <div
                className={cn(
                  "min-h-[80px] p-3 rounded-xl border border-app-border bg-app-sidebar/20 text-xs leading-relaxed text-tx-secondary",
                  "prose prose-sm max-w-none prose-headings:text-tx-primary prose-p:text-tx-secondary",
                  "prose-code:text-accent-primary prose-pre:bg-app-hover prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline hover:prose-a:text-blue-800 dark:hover:prose-a:text-blue-300"
                )}
              >
                {activeTask.description ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                    {activeTask.description}
                  </ReactMarkdown>
                ) : (
                  <span className="text-tx-tertiary italic text-[11px]">暂无描述</span>
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
              <span>任务清单</span>
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

              <div className="flex items-center gap-2 pt-1">
                <Input
                  placeholder="添加清单项…"
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
                  添加
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

            {projectStages.flatMap(s => s.tasks || []).filter(t => t.id !== activeTask.id && !(activeTask.dependencies || []).some(d => d.id === t.id)).length > 0 && (
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
                  {projectStages.flatMap(s => s.tasks || [])
                    .filter(t => t.id !== activeTask.id && !(activeTask.dependencies || []).some(d => d.id === t.id))
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))
                  }
                </select>
              </div>
            )}
          </div>

          {/* Task Comments */}
          <div className="space-y-3 border-t border-app-border/40 pt-4">
            <h5 className="text-xs font-bold text-tx-primary tracking-wide flex items-center gap-1.5">
              <MessageSquare size={13} className="text-accent-primary" />
              <span>任务评论 ({taskComments.length})</span>
            </h5>

            {loadingTaskComments ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={16} className="animate-spin text-accent-primary" />
              </div>
            ) : taskComments.length === 0 ? (
              <div className="text-[11px] text-tx-tertiary italic py-2 px-3 rounded-xl border border-dashed border-app-border/60">
                暂无评论，发表第一条评论吧！
              </div>
            ) : (
              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                {taskComments.map((comment) => (
                  <div key={comment.id} className="text-[11px] text-tx-secondary space-y-1 bg-app-sidebar/20 p-2.5 rounded-xl border border-app-border/40">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-tx-primary">
                        {comment.avatarUrl ? (
                          <img src={comment.avatarUrl} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded-full bg-accent-primary/10 flex items-center justify-center text-[7px] font-bold text-accent-primary uppercase">
                            {(comment.displayName || comment.username || "?").slice(0, 1)}
                          </div>
                        )}
                        <span>{comment.displayName || comment.username}</span>
                      </div>
                      <span className="text-[9px] text-tx-tertiary font-mono">
                        {format(parseISO(comment.createdAt + (comment.createdAt.endsWith("Z") ? "" : "Z")), "yyyy-MM-dd HH:mm", { locale: dateLocale })}
                      </span>
                    </div>
                    <p className="text-tx-secondary leading-relaxed pl-5 font-medium whitespace-pre-wrap">
                      {comment.content}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <input
                type="text"
                placeholder="写下你的任务评论..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleAddComment();
                  }
                }}
                className="flex-1 px-3 py-1.5 bg-app-sidebar/40 border border-app-border rounded-xl text-xs focus:outline-none focus:border-accent-primary text-tx-primary placeholder:text-tx-tertiary transition-all"
              />
              <Button
                size="sm"
                onClick={handleAddComment}
                disabled={submittingComment || !newCommentText.trim()}
                className="text-xs px-3 rounded-xl bg-accent-primary hover:bg-accent-primary/95 text-white shrink-0 font-semibold"
              >
                {submittingComment ? <Loader2 size={12} className="animate-spin" /> : "评论"}
              </Button>
            </div>
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
            onClick={onClose}
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
  );
}
