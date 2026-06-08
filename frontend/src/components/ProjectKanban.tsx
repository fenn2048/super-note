import React, { useState, useEffect } from "react";
import { Project, ProjectStage, ProjectTask, Tag, UserPublicInfo } from "@/types";
import { api } from "@/lib/api";
import { useTranslation } from "react-i18next";
import {
  Plus, Edit2, Trash2, CheckSquare, Calendar, User, UserPlus,
  Tag as TagIcon, X, PlusCircle, CheckCircle2, Circle, Clock, Check, MoreHorizontal
} from "lucide-react";
import GenericTagInput from "@/components/GenericTagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import SleekDatePicker from "@/components/common/SleekDatePicker";

interface ProjectKanbanProps {
  project: Project;
  stages: ProjectStage[];
  onRefresh: () => void;
  onTaskClick?: (task: ProjectTask) => void;
  onToggleTaskComplete?: (taskId: string, currentCompleted: number) => void;
}

export default function ProjectKanban({ project, stages, onRefresh, onTaskClick, onToggleTaskComplete }: ProjectKanbanProps) {
  const { t } = useTranslation();
  const [newStageName, setNewStageName] = useState("");
  const [addingStage, setAddingStage] = useState(false);

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
    window.addEventListener("nowen:open-project-task", handleOpenTaskEvent);
    return () => window.removeEventListener("nowen:open-project-task", handleOpenTaskEvent);
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
    try {
      await api.createProjectTask(project.id, {
        stageId,
        title: newTaskTitle.trim(),
      });
      setNewTaskTitle("");
      setAddingTaskToStage(null);
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || "创建任务失败");
    }
  };

  const handleSaveTaskDetail = async () => {
    if (!activeTask) return;
    try {
      const updated = await api.updateProjectTask(activeTask.id, {
        title: activeTask.title,
        description: activeTask.description,
        isCompleted: activeTask.isCompleted,
        assigneeId: activeTask.assigneeId,
        startDate: activeTask.startDate || null,
        endDate: activeTask.endDate || null,
        checklists: activeTask.checklists || [],
        participants: activeTask.participants?.map((p) => p.userId) || [],
        tags: activeTask.tags?.map((t) => t.id) || [],
      });
      toast.success("保存成功");
      onRefresh();
      // Re-fetch stage details to get formatted names for the assignee, etc.
      // For now, we can just update local copy or let refresh trigger it.
      setActiveTask(null);
    } catch (err: any) {
      toast.error(err?.message || "更新任务失败");
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm("确定要删除该任务吗？")) return;
    try {
      await api.deleteProjectTask(taskId);
      setActiveTask(null);
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
      {stages.map((stage) => (
        <div
          key={stage.id}
          className="w-72 shrink-0 bg-app-sidebar border border-app-border rounded-xl flex flex-col h-full max-h-[85vh] shadow-sm overflow-hidden"
        >
          {/* Stage Header */}
          <div className="p-3 border-b border-app-border flex items-center justify-between shrink-0 bg-app-hover/35">
            {editingStageId === stage.id ? (
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

              return (
                <div
                  key={task.id}
                  onClick={() => setActiveTask(task)}
                  className="bg-app-bg border border-app-border hover:border-app-border/80 rounded-xl p-3.5 space-y-3 shadow-sm hover:shadow-md transition-all cursor-pointer group/card animate-in fade-in duration-200"
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
                    className={`text-xs font-semibold text-tx-primary leading-snug break-words ${
                      task.isCompleted === 1 ? "line-through opacity-55 decoration-tx-primary/30" : ""
                    }`}
                  >
                    {task.title}
                  </h4>

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
      ))}

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
            onClick={handleSaveTaskDetail}
          />
          <div className="relative bg-app-elevated w-full max-w-2xl rounded-2xl border border-app-border shadow-2xl flex flex-col max-h-[85vh] animate-in scale-in duration-200 overflow-hidden">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-app-border flex items-center justify-between bg-app-sidebar/30 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setActiveTask((prev) =>
                      prev ? { ...prev, isCompleted: prev.isCompleted === 1 ? 0 : 1 } : null
                    )
                  }
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
                <button
                  onClick={() => handleDeleteTask(activeTask.id)}
                  className="p-1.5 hover:bg-accent-danger/10 text-tx-tertiary hover:text-accent-danger rounded-lg transition-colors"
                  title="删除任务"
                >
                  <Trash2 size={16} />
                </button>
                <button
                  onClick={handleSaveTaskDetail}
                  className="p-1.5 hover:bg-app-hover rounded-lg text-tx-tertiary hover:text-tx-primary transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <ScrollArea className="flex-1 min-h-0 px-6 py-5 space-y-6">
              {/* Task Title */}
              <div className="space-y-1">
                <Input
                  value={activeTask.title}
                  onChange={(e) =>
                    setActiveTask((prev) => (prev ? { ...prev, title: e.target.value } : null))
                  }
                  className="text-base font-bold bg-transparent border-none p-0 focus-visible:ring-0 focus-visible:border-none focus-visible:outline-none placeholder:text-tx-tertiary"
                  placeholder={t("projects.taskTitlePlaceholder") || "任务标题"}
                />
              </div>

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
                      {project.members?.map((m) => (
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
                          className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-app-hover text-left text-[11px] font-semibold text-tx-secondary hover:text-tx-primary"
                        >
                          {m.avatarUrl ? (
                            <img src={m.avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover" />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-accent-primary/10 flex items-center justify-center text-[8px] font-bold text-accent-primary uppercase">
                              {(m.displayName || m.username).slice(0, 1)}
                            </div>
                          )}
                          <span className="truncate">{m.displayName || m.username}</span>
                        </button>
                      ))}
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

              {/* Description */}
              <div className="space-y-1.5">
                <h5 className="text-xs font-bold text-tx-primary tracking-wide">
                  {t("projects.description") || "任务描述"}
                </h5>
                <Textarea
                  value={activeTask.description}
                  onChange={(e) =>
                    setActiveTask((prev) => (prev ? { ...prev, description: e.target.value } : null))
                  }
                  className="text-xs leading-relaxed min-h-[80px] bg-app-sidebar/20 border-app-border rounded-xl"
                  placeholder={t("projects.taskDescPlaceholder") || "添加更详细的任务描述…"}
                />
              </div>

              {/* Checklist / Subtasks */}
              <div className="space-y-3">
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
            </ScrollArea>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-app-border bg-app-sidebar/30 flex justify-end gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTask(null)}
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
