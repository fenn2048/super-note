/**
 * 工作区级聚合日历（跨项目 stages）
 * 路由级懒加载：import("@/components/tasks/WorkspaceCalendarView")
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, Loader2, Search } from "lucide-react";
import type { Project, ProjectStage, ProjectTask, Tag } from "@/types";
import { api } from "@/lib/api";
import { cn, getTagColor } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";

const ProjectCalendarLazy = React.lazy(() => import("@/components/ProjectCalendar"));

export type WorkspaceCalendarViewProps = {
  projects: Project[];
  workspaceId: string;
  /** 返回（默认切回我的任务） */
  onBack?: () => void;
};

export default function WorkspaceCalendarView({
  projects,
  workspaceId,
  onBack,
}: WorkspaceCalendarViewProps) {
  const { t } = useTranslation();

  const [workspaceStages, setWorkspaceStages] = useState<ProjectStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);

  const personalTodoProject = useMemo(
    () => projects.find((p) => p.name === "个人TODO" && (!p.workspaceId || p.workspaceId === "")),
    [projects],
  );

  const loadStages = useCallback(
    async (opts?: { soft?: boolean }) => {
      const soft = opts?.soft === true;
      const isInitial = workspaceStages.length === 0;
      if (!soft || isInitial) setLoading(true);
      try {
        const allProjs = await api.getProjects(workspaceId, "active");
        const promises = allProjs.map(async (p) => {
          try {
            const stages = await api.getProjectStages(p.id);
            stages.forEach((st) => {
              st.tasks?.forEach((task) => {
                (task as ProjectTask & { projectName?: string }).projectName = p.name;
              });
            });
            return stages;
          } catch {
            return [] as ProjectStage[];
          }
        });
        const results = await Promise.all(promises);
        setWorkspaceStages(results.flat());
      } catch (err) {
        console.error(err);
      } finally {
        if (!soft || isInitial) setLoading(false);
      }
    },
    [workspaceId, workspaceStages.length],
  );

  useEffect(() => {
    void loadStages();
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps -- remount/load on workspace change only

  const availableTags = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const st of workspaceStages) {
      for (const task of st.tasks || []) {
        for (const tg of task.tags || []) {
          map.set(tg.id, tg as Tag);
        }
      }
    }
    return [...map.values()];
  }, [workspaceStages]);

  const taskMatchesFilters = useCallback(
    (task: ProjectTask) => {
      const query = searchQuery.trim().toLowerCase();
      if (query) {
        const terms = query.split(/\s+/).filter(Boolean);
        if (terms.length > 0) {
          const matches = terms.map((term) => {
            if (term.startsWith("#")) {
              const tagSearch = term.substring(1);
              return task.tags?.some((tag) => tag.name.toLowerCase().includes(tagSearch)) || false;
            }
            const title = task.title?.toLowerCase() || "";
            const description = task.description?.toLowerCase() || "";
            const projectName = ((task as ProjectTask & { projectName?: string }).projectName || "").toLowerCase();
            return title.includes(term) || description.includes(term) || projectName.includes(term);
          });
          // 多词默认 AND
          if (!matches.every(Boolean)) return false;
        }
      }
      if (selectedTagId) {
        if (!task.tags?.some((tag) => tag.id === selectedTagId)) return false;
      }
      return true;
    },
    [searchQuery, selectedTagId],
  );

  const filteredStages = useMemo(() => {
    if (!searchQuery && !selectedTagId) return workspaceStages;
    return workspaceStages
      .map((stage) => ({
        ...stage,
        tasks: stage.tasks?.filter(taskMatchesFilters),
      }))
      .filter((stage) => (stage.tasks?.length || 0) > 0);
  }, [workspaceStages, searchQuery, selectedTagId, taskMatchesFilters]);

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    const filter = { type: "my-tasks" };
    sessionStorage.setItem("super-active-project-filter", JSON.stringify(filter));
    window.dispatchEvent(new CustomEvent("super:project-filter-changed", { detail: filter }));
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <MobileChromeHeader
        variant="stack"
        title={t("projects.calendar") || "日历"}
        onLeadingClick={handleBack}
      />
      <PageHeader
        mdOnly
        title={
          <span className="inline-flex items-center gap-2">
            <Calendar size={18} className="text-accent-primary" />
            {t("projects.calendar") || "日历"}
          </span>
        }
        subtitle={t("projects.calendarDesc") || "按标签与标题搜索任务"}
        actions={
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
            <Input
              placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
              className="pl-9 h-9 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        }
      />
      <div className="border-b border-app-border bg-app-bg shrink-0 space-y-3 px-4 py-3 md:px-6">
        <div className="md:hidden relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-tx-tertiary" size={14} />
          <Input
            placeholder={t("projects.searchTasksPlaceholder") || "搜索任务..."}
            className="pl-9 h-10 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {availableTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => setSelectedTagId(null)}
              className={cn(
                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out border",
                !selectedTagId
                  ? "bg-accent-primary text-white border-accent-primary"
                  : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover",
              )}
            >
              {t("projects.allTags") || "全部标签"}
            </button>
            {availableTags.map((tag) => (
              <button
                type="button"
                key={tag.id}
                onClick={() => setSelectedTagId(tag.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-[transform,background-color,color,border-color,box-shadow,opacity] duration-fast ease-out",
                  selectedTagId === tag.id
                    ? "bg-accent-primary text-white border-accent-primary"
                    : "bg-app-sidebar text-tx-secondary border-app-border hover:bg-app-hover",
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
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-accent-primary" />
        </div>
      ) : (
        <React.Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Loader2 size={22} className="animate-spin text-accent-primary" />
            </div>
          }
        >
          <ProjectCalendarLazy
            stages={filteredStages}
            showProjectFilter={true}
            onTaskClick={(task) => {
              window.dispatchEvent(new CustomEvent("super:open-project-task", { detail: task.id }));
            }}
            onRefresh={() => void loadStages({ soft: true })}
            defaultProjectId={personalTodoProject?.id}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
        </React.Suspense>
      )}
    </div>
  );
}
