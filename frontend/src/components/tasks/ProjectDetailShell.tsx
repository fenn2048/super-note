/**
 * 项目详情壳：主 Tab（看板 / 列表 / 概况）+ 更多（讨论 / 日历 / 甘特）
 */
import React from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Award,
  Calendar,
  Clock,
  Edit2,
  Grid,
  List as ListIcon,
  Loader2,
  MessageSquare,
  MoreVertical,
  ChevronDown,
  Star,
  Monitor,
} from "lucide-react";
import type { Project, ProjectStage } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import MobileChromeHeader, { MobileChromeIconButton } from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";
import { Motion } from "@/components/common/Motion";
import { springs } from "@/lib/motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import ProjectOverview from "@/components/ProjectOverview";
import ProjectKanban from "@/components/ProjectKanban";
import ProjectList from "@/components/ProjectList";
import ProjectDiscussion from "@/components/ProjectDiscussion";
import ProjectCalendar from "@/components/ProjectCalendar";
import ProjectGantt from "@/components/ProjectGantt";

export type ProjectDetailTab =
  | "kanban"
  | "list"
  | "discussion"
  | "calendar"
  | "gantt"
  | "overview";

type Props = {
  project: Project;
  filteredStages: ProjectStage[];
  loadingDetail: boolean;
  detailTab: ProjectDetailTab;
  setDetailTab: (t: ProjectDetailTab) => void;
  wsMembers: any[];
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  onClose: () => void;
  onEdit: (e?: React.MouseEvent) => void;
  onToggleTaskComplete: (taskId: string, currentCompleted: number) => void;
  activeTaskId: string | null;
  onClearActiveTaskId: () => void;
  onRefreshStages: () => Promise<void>;
  onRefresh: () => void;
};

export default function ProjectDetailShell({
  project,
  filteredStages,
  loadingDetail,
  detailTab,
  setDetailTab,
  wsMembers,
  isFavorite,
  onToggleFavorite,
  onClose,
  onEdit,
  onToggleTaskComplete,
  activeTaskId,
  onClearActiveTaskId,
  onRefreshStages,
  onRefresh,
}: Props) {
  const { t } = useTranslation();
  const isDesktop = useMediaQuery("(min-width: 768px)");

  const primaryTabs = [
    { id: "kanban" as const, icon: Grid, label: t("projects.kanban") || "看板" },
    { id: "list" as const, icon: ListIcon, label: t("projects.list") || "列表" },
    { id: "overview" as const, icon: Award, label: t("projects.overview") || "概况" },
  ];
  const moreTabs = [
    { id: "discussion" as const, icon: MessageSquare, label: t("projects.discussion") || "讨论" },
    { id: "calendar" as const, icon: Calendar, label: t("projects.calendar") || "日历" },
    {
      id: "gantt" as const,
      icon: Clock,
      label: isDesktop
        ? t("projects.gantt") || "甘特图"
        : `${t("projects.gantt") || "甘特图"} · 大屏`,
    },
  ];

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <MobileChromeHeader
        variant="stack"
        title={
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="truncate font-bold">{project.name}</span>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="p-1 hover:bg-app-hover rounded-button text-tx-tertiary hover:text-accent-primary shrink-0"
              aria-label="收藏项目"
            >
              <Star
                size={14}
                className={isFavorite ? "fill-accent-primary text-accent-primary" : ""}
              />
            </button>
          </span>
        }
        onLeadingClick={onClose}
        right={
          <MobileChromeIconButton title="编辑项目 / 成员" onClick={() => onEdit()}>
            <Edit2 size={16} />
          </MobileChromeIconButton>
        }
      />
      <PageHeader
        mdOnly
        dense
        title={
          <span className="inline-flex items-center gap-2 min-w-0">
            <span className="truncate">{project.name}</span>
            <button
              type="button"
              onClick={onToggleFavorite}
              className="p-1 hover:bg-app-hover rounded-button text-tx-tertiary hover:text-accent-primary"
              aria-label="收藏项目"
            >
              <Star
                size={14}
                className={isFavorite ? "fill-accent-primary text-accent-primary" : ""}
              />
            </button>
          </span>
        }
        leading={
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="返回">
            <ArrowLeft size={16} />
          </Button>
        }
        actions={
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={(e) => onEdit(e)}>
            <Edit2 size={13} />
            编辑 / 成员
          </Button>
        }
      />

      <div className="px-3 md:px-4 py-2 border-b border-app-border bg-app-bg shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 w-max min-w-full md:min-w-0 md:w-auto">
          <div className="flex items-center bg-app-hover/50 p-0.5 rounded-button border border-app-border/40 text-[11px] font-semibold flex-1">
            {primaryTabs.map((tab) => {
              const Icon = tab.icon;
              const active = detailTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={cn(
                    "relative px-3 py-2 min-h-11 rounded-md transition-colors duration-fast ease-out flex items-center gap-1 z-0",
                    active ? "text-tx-primary" : "text-tx-secondary hover:text-tx-primary",
                  )}
                  onClick={() => setDetailTab(tab.id)}
                >
                  {active && (
                    <Motion.div
                      layoutId="project-detail-tab"
                      className="absolute inset-0 rounded-md bg-app-bg shadow-sm -z-10"
                      transition={springs.snappy}
                    />
                  )}
                  <Icon size={12} className="relative z-10" />
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="relative shrink-0">
            <details className="group">
              <summary
                className={cn(
                  "list-none flex items-center gap-1 px-2.5 py-2 min-h-11 rounded-button text-[11px] font-semibold border cursor-pointer select-none",
                  "transition-colors duration-fast ease-out",
                  ["discussion", "calendar", "gantt"].includes(detailTab)
                    ? "bg-app-active text-tx-primary border-app-border"
                    : "text-tx-tertiary border-transparent hover:bg-app-hover hover:text-tx-secondary",
                )}
              >
                <MoreVertical size={12} />
                更多
                <ChevronDown
                  size={12}
                  className="opacity-60 group-open:rotate-180 transition-transform"
                />
              </summary>
              <div className="absolute right-0 top-full mt-1 z-20 min-w-[9rem] rounded-xl border border-app-border bg-app-elevated shadow-lg py-1">
                {moreTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold min-h-10",
                        detailTab === tab.id
                          ? "bg-accent-primary/10 text-accent-primary"
                          : "text-tx-secondary hover:bg-app-hover",
                      )}
                      onClick={(e) => {
                        setDetailTab(tab.id);
                        const details = (e.currentTarget as HTMLElement).closest("details");
                        if (details) details.open = false;
                      }}
                    >
                      <Icon size={13} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        {loadingDetail ? (
          <div className="absolute inset-0 flex items-center justify-center bg-app-bg/60 z-10">
            <Loader2 size={24} className="animate-spin text-accent-primary" />
          </div>
        ) : null}

        {detailTab === "overview" && (
          <ProjectOverview project={project} stages={filteredStages} />
        )}
        {detailTab === "kanban" && (
          <ProjectKanban
            project={project}
            stages={filteredStages}
            wsMembers={wsMembers}
            onRefresh={onRefreshStages}
            onToggleTaskComplete={onToggleTaskComplete}
            initialActiveTaskId={activeTaskId}
            onClearActiveTaskId={onClearActiveTaskId}
          />
        )}
        {detailTab === "list" && (
          <ProjectList
            stages={filteredStages}
            onRefresh={onRefreshStages}
            onToggleTaskComplete={onToggleTaskComplete}
            onTaskClick={(task) =>
              window.dispatchEvent(
                new CustomEvent("super:open-project-task", { detail: task.id }),
              )
            }
          />
        )}
        {detailTab === "discussion" && (
          <ProjectDiscussion
            project={project}
            tasks={filteredStages.flatMap((s) => s.tasks || [])}
          />
        )}
        {detailTab === "calendar" && (
          <ProjectCalendar
            stages={filteredStages}
            onTaskClick={(task) =>
              window.dispatchEvent(
                new CustomEvent("super:open-project-task", { detail: task.id }),
              )
            }
            onRefresh={onRefresh}
            defaultProjectId={project.id}
            projects={[{ id: project.id, name: project.name }]}
          />
        )}
        {detailTab === "gantt" &&
          (isDesktop ? (
            <ProjectGantt
              stages={filteredStages}
              onTaskClick={(task) =>
                window.dispatchEvent(
                  new CustomEvent("super:open-project-task", { detail: task.id }),
                )
              }
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center min-h-[40vh]">
              <span className="w-12 h-12 rounded-card bg-app-hover flex items-center justify-center text-tx-tertiary">
                <Monitor size={22} />
              </span>
              <p className="text-sm font-semibold text-tx-primary">甘特图更适合大屏</p>
              <p className="text-xs text-tx-tertiary max-w-xs leading-relaxed">
                手机上横向时间轴操作吃力。请用列表或看板管理任务，或在平板/电脑上查看甘特。
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setDetailTab("list")}
                >
                  <ListIcon size={14} />
                  列表
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11"
                  onClick={() => setDetailTab("kanban")}
                >
                  <Grid size={14} />
                  看板
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setDetailTab("calendar")}
                >
                  <Calendar size={14} />
                  日历
                </Button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
