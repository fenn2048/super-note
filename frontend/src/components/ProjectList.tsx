import React from "react";
import { ProjectStage, ProjectTask } from "@/types";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Circle, Calendar, User, Tag, FileText, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";

interface ProjectListProps {
  stages: ProjectStage[];
  onTaskClick?: (task: ProjectTask) => void;
  onToggleTaskComplete?: (taskId: string, currentCompleted: number) => void;
  onRefresh?: () => void;
}

export default function ProjectList({ stages, onTaskClick, onToggleTaskComplete, onRefresh }: ProjectListProps) {
  const { t } = useTranslation();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    } catch {
      return dateStr;
    }
  };

  const getPriorityColor = (priority?: number) => {
    if (priority === 3) return "text-red-500 bg-red-500/10 border-red-500/20";
    if (priority === 2) return "text-orange-500 bg-orange-500/10 border-orange-500/20";
    return "text-green-500 bg-green-500/10 border-green-500/20";
  };

  const getPriorityLabel = (priority?: number) => {
    if (priority === 3) return t("priority.high") || "高";
    if (priority === 2) return t("priority.medium") || "中";
    return t("priority.low") || "低";
  };

  const hasTasks = stages.some((stage) => stage.tasks && stage.tasks.length > 0);

  return (
    <div className="flex flex-col h-full bg-app-bg text-tx-primary pb-20 overflow-y-auto">
      {!hasTasks ? (
        <div className="flex flex-col items-center justify-center p-12 text-center text-tx-tertiary">
          <FileText size={48} className="stroke-1 mb-2 opacity-50" />
          <p className="text-sm font-semibold">{t("projects.noTasksToDisplay") || "当前项目没有任务"}</p>
          <p className="text-xs max-w-xs">{t("projects.noTasksDesc") || "请在看板中添加任务"}</p>
        </div>
      ) : (
        <div className="p-4 md:p-6 space-y-6">
          {stages
            .filter((stage) => stage.tasks && stage.tasks.length > 0)
            .map((stage) => (
              <div key={stage.id} className="bg-app-sidebar border border-app-border rounded-xl overflow-hidden shadow-sm">
                {/* Stage Header */}
                <div className="px-4 py-3 bg-app-hover/40 border-b border-app-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-6 rounded bg-accent-primary" />
                    <h3 className="font-bold text-sm text-tx-primary">{stage.name}</h3>
                  </div>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-app-hover text-tx-secondary">
                    {stage.tasks?.length || 0}
                  </span>
                </div>

                {/* Tasks Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-app-border text-xs font-bold text-tx-tertiary select-none">
                        <th className="p-3 w-10"></th>
                        <th className="p-3 min-w-[200px]">{t("projects.taskName") || "任务名称"}</th>
                        <th className="p-3 w-28">{t("projects.assignee") || "负责人"}</th>
                        <th className="p-3 w-36">{t("projects.timeline") || "时间周期"}</th>
                        <th className="p-3 w-40">进度</th>
                        <th className="p-3 min-w-[150px]">{t("projects.tags") || "标签"}</th>
                        <th className="p-3 w-24 text-right"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-app-border/40 text-xs">
                      {stage.tasks?.map((task) => (
                        <tr
                          key={task.id}
                          className="hover:bg-app-hover/10 transition-colors group/row"
                        >
                          {/* Complete Checkbox */}
                          <td className="p-3 text-center">
                            <button
                              onClick={() =>
                                onToggleTaskComplete?.(task.id, task.isCompleted)
                              }
                              className="text-tx-tertiary hover:text-accent-primary transition-colors focus:outline-none"
                            >
                              {task.isCompleted === 1 ? (
                                <CheckCircle2 size={16} className="text-green-500" />
                              ) : (
                                <Circle size={16} />
                              )}
                            </button>
                          </td>

                          {/* Task Title */}
                          <td
                            className="p-3 font-semibold text-tx-secondary cursor-pointer group-hover/row:text-tx-primary"
                            onClick={() => onTaskClick?.(task)}
                          >
                            <div className="flex flex-col gap-1">
                              <span className={task.isCompleted === 1 ? "line-through opacity-50" : ""}>
                                {task.title}
                              </span>
                              {task.description && (
                                <span className="text-[10px] text-tx-tertiary font-normal line-clamp-1 max-w-lg">
                                  {task.description}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Assignee */}
                          <td className="p-3">
                            <div className="flex items-center gap-1.5 text-tx-secondary">
                              {task.assigneeAvatarUrl ? (
                                <img
                                  src={task.assigneeAvatarUrl}
                                  alt={task.assigneeDisplayName || task.assigneeName}
                                  className="w-5 h-5 rounded-full border border-app-border shrink-0 object-cover"
                                />
                              ) : task.assigneeId ? (
                                <div className="w-5 h-5 rounded-full bg-accent-primary/15 shrink-0 flex items-center justify-center text-[9px] font-bold text-accent-primary uppercase">
                                  {(task.assigneeDisplayName || task.assigneeName || "").slice(0, 1)}
                                </div>
                              ) : (
                                <User size={12} className="text-tx-tertiary shrink-0" />
                              )}
                              <span className="truncate text-[11px]">
                                {task.assigneeDisplayName || task.assigneeName || "-"}
                              </span>
                            </div>
                          </td>

                          {/* Timeline Dates */}
                          <td className="p-3 text-tx-secondary">
                            <div className="flex items-center gap-1 font-mono text-[10px]">
                              <Calendar size={12} className="text-tx-tertiary shrink-0" />
                              <span>{formatDate(task.startDate)}</span>
                              {(task.startDate || task.endDate) && (
                                <span className="text-tx-tertiary scale-75">~</span>
                              )}
                              <span>{formatDate(task.endDate)}</span>
                            </div>
                          </td>

                          {/* Progress Column */}
                          <td className="p-3 w-40" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-col gap-1 w-full max-w-[150px]">
                              <div className="flex items-center justify-between text-[10px] text-tx-tertiary">
                                <span>{task.progress || 0}%</span>
                              </div>
                              <div className="w-full bg-app-hover/50 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="bg-accent-primary h-full transition-all duration-300"
                                  style={{ width: `${task.progress || 0}%` }}
                                />
                              </div>
                              <div className="flex gap-0.5 mt-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
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
                                        onRefresh?.();
                                      } catch (err: any) {
                                        toast.error(err?.message || "更新进度失败");
                                      }
                                    }}
                                    className={cn(
                                      "flex-1 py-0.5 text-[9px] font-mono rounded transition-colors text-center border border-transparent",
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
                          </td>

                          {/* Tags */}
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {task.tags && task.tags.length > 0 ? (
                                task.tags.map((tag) => (
                                  <span
                                    key={tag.id}
                                    style={{
                                      backgroundColor: `${tag.color}15`,
                                      borderColor: `${tag.color}35`,
                                      color: tag.color,
                                    }}
                                    className="px-1.5 py-0.5 rounded border text-[9px] font-bold tracking-wide uppercase shrink-0"
                                  >
                                    {tag.name}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-tx-tertiary">-</span>
                              )}
                            </div>
                          </td>

                          {/* Action Details Arrow */}
                          <td className="p-3 text-right">
                            <button
                              onClick={() => onTaskClick?.(task)}
                              className="opacity-0 group-hover/row:opacity-100 p-1 hover:bg-app-hover rounded transition-all text-tx-tertiary hover:text-tx-primary"
                              title={t("projects.viewDetails") || "查看详情"}
                            >
                              <ArrowRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
