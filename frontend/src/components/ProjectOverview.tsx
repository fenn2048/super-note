import React from "react";
import { Project, ProjectStage } from "@/types";
import { useTranslation } from "react-i18next";
import { Calendar, User, Eye, EyeOff, CheckCircle2, Circle, Clock, Layers } from "lucide-react";

interface ProjectOverviewProps {
  project: Project;
  stages: ProjectStage[];
}

export default function ProjectOverview({ project, stages }: ProjectOverviewProps) {
  const { t } = useTranslation();

  // Calculate stats
  const totalTasks = stages.reduce((acc, stage) => acc + (stage.tasks?.length || 0), 0);
  const completedTasks = stages.reduce(
    (acc, stage) => acc + (stage.tasks?.filter((t) => t.isCompleted === 1).length || 0),
    0
  );
  const pendingTasks = totalTasks - completedTasks;
  const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Format dates
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6 overflow-y-auto h-full pb-20">
      {/* Top Card: Banner-like with Project Cover */}
      <div className="relative rounded-2xl overflow-hidden border border-app-border bg-app-sidebar p-6 md:p-8 flex flex-col md:flex-row items-center md:items-start gap-6 shadow-sm">
        <div
          className="w-24 h-24 md:w-32 md:h-32 rounded-xl flex-shrink-0 border border-white/10 shadow-md"
          style={{
            background: project.cover || "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="flex-1 text-center md:text-left space-y-2">
          <div className="flex flex-col md:flex-row md:items-center gap-2 justify-center md:justify-start">
            <h1 className="text-xl md:text-2xl font-bold text-tx-primary">{project.name}</h1>
            <div className="inline-flex items-center self-center md:self-auto gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-app-hover border border-app-border text-tx-secondary">
              {project.visibility === "PUBLIC" ? (
                <>
                  <Eye size={12} />
                  <span>{t("projects.public") || "公开"}</span>
                </>
              ) : (
                <>
                  <EyeOff size={12} />
                  <span>{t("projects.private") || "私有"}</span>
                </>
              )}
            </div>
          </div>
          <p className="text-sm text-tx-secondary leading-relaxed max-w-2xl whitespace-pre-wrap">
            {project.description || t("projects.noDescription") || "暂无项目描述"}
          </p>
          <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 pt-2 text-xs text-tx-tertiary">
            <div className="flex items-center gap-1">
              <Calendar size={14} />
              <span>
                {formatDate(project.startDate)} ~ {formatDate(project.endDate)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <User size={14} />
              <span>
                {t("projects.creator") || "负责人"}: {project.ownerDisplayName || project.ownerName}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Progress Card */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl flex items-center justify-between shadow-sm">
          <div className="space-y-1">
            <span className="text-xs text-tx-tertiary font-medium">{t("projects.progress") || "项目进度"}</span>
            <div className="text-2xl font-bold text-tx-primary">{progressPercent}%</div>
          </div>
          <div className="relative w-14 h-14 shrink-0">
            {/* SVG Progress Circle */}
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="28"
                cy="28"
                r="22"
                className="stroke-app-hover"
                strokeWidth="4"
                fill="transparent"
              />
              <circle
                cx="28"
                cy="28"
                r="22"
                className="stroke-accent-primary"
                strokeWidth="4"
                fill="transparent"
                strokeDasharray={2 * Math.PI * 22}
                strokeDashoffset={2 * Math.PI * 22 * (1 - progressPercent / 100)}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-tx-secondary">
              {completedTasks}/{totalTasks}
            </div>
          </div>
        </div>

        {/* Completed Tasks */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="p-3 bg-green-500/10 text-green-500 rounded-xl">
            <CheckCircle2 size={22} />
          </div>
          <div className="space-y-0.5">
            <span className="text-xs text-tx-tertiary font-medium">{t("projects.completed") || "已完成"}</span>
            <div className="text-2xl font-bold text-tx-primary">{completedTasks}</div>
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="p-3 bg-amber-500/10 text-amber-500 rounded-xl">
            <Clock size={22} />
          </div>
          <div className="space-y-0.5">
            <span className="text-xs text-tx-tertiary font-medium">{t("projects.pending") || "待进行"}</span>
            <div className="text-2xl font-bold text-tx-primary">{pendingTasks}</div>
          </div>
        </div>

        {/* Total Stages */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl flex items-center gap-4 shadow-sm">
          <div className="p-3 bg-blue-500/10 text-blue-500 rounded-xl">
            <Layers size={22} />
          </div>
          <div className="space-y-0.5">
            <span className="text-xs text-tx-tertiary font-medium">{t("projects.stagesCount") || "阶段数"}</span>
            <div className="text-2xl font-bold text-tx-primary">{stages.length}</div>
          </div>
        </div>
      </div>

      {/* Detail Analysis Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Stages Distribution */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl space-y-4 shadow-sm md:col-span-2">
          <h2 className="text-sm font-bold text-tx-primary tracking-wide flex items-center gap-1.5 border-b border-app-border pb-3">
            <Layers size={16} className="text-accent-primary" />
            <span>{t("projects.stageDistribution") || "阶段任务分布"}</span>
          </h2>
          <div className="space-y-3 pt-1">
            {stages.length === 0 ? (
              <p className="text-xs text-tx-tertiary text-center py-4">{t("projects.noStages") || "暂无阶段"}</p>
            ) : (
              stages.map((stage) => {
                const stageTotal = stage.tasks?.length || 0;
                const stageCompleted = stage.tasks?.filter((t) => t.isCompleted === 1).length || 0;
                const ratio = totalTasks > 0 ? (stageTotal / totalTasks) * 100 : 0;
                const complRatio = stageTotal > 0 ? (stageCompleted / stageTotal) * 100 : 0;

                return (
                  <div key={stage.id} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-tx-secondary font-medium">{stage.name}</span>
                      <span className="text-tx-tertiary font-mono">
                        {stageCompleted}/{stageTotal} ({Math.round(ratio)}%)
                      </span>
                    </div>
                    {/* Double progress bar: Total volume in gray, completed in overlay accent */}
                    <div className="relative w-full h-3 rounded-full bg-app-hover overflow-hidden border border-app-border/10">
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-accent-primary/20 rounded-full transition-[transform,opacity,background-color,box-shadow,border-color] duration-panel"
                        style={{ width: `${ratio}%` }}
                      />
                      <div
                        className="absolute top-0 bottom-0 left-0 bg-accent-primary rounded-full transition-[transform,opacity,background-color,box-shadow,border-color] duration-panel"
                        style={{ width: `${(ratio * complRatio) / 100}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Project Members */}
        <div className="bg-app-sidebar border border-app-border p-5 rounded-2xl space-y-4 shadow-sm">
          <h2 className="text-sm font-bold text-tx-primary tracking-wide flex items-center gap-1.5 border-b border-app-border pb-3">
            <User size={16} className="text-accent-primary" />
            <span>{t("projects.members") || "项目成员"}</span>
          </h2>
          <div className="space-y-3 pt-1 overflow-y-auto max-h-[220px]">
            {project.members && project.members.length > 0 ? (
              project.members.map((member) => (
                <div key={member.userId} className="flex items-center gap-3">
                  {member.avatarUrl ? (
                    <img
                      src={member.avatarUrl}
                      alt={member.displayName || member.username}
                      className="w-8 h-8 rounded-full border border-app-border shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-accent-primary/10 border border-app-border shrink-0 flex items-center justify-center text-xs font-bold text-accent-primary uppercase">
                      {(member.displayName || member.username).slice(0, 1)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-tx-primary truncate">
                      {member.displayName || member.username}
                    </div>
                    <div className="text-[10px] text-tx-tertiary">
                      {member.role === "owner" ? (
                        <span className="text-accent-primary font-medium">{t("projects.ownerRole") || "项目所有者"}</span>
                      ) : (
                        t("projects.memberRole") || "成员"
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-xs text-tx-tertiary text-center py-4">{t("projects.noMembers") || "暂无成员"}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
