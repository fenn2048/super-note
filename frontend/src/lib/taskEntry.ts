/**
 * 统一任务创建入口（P1 · 方案 A）
 * ---------------------------------------------------------------------------
 * 产品路径：一律落到 Project 体系（个人TODO / 家庭TODO）。
 * 不再写入 legacy `tasks` 表（v20 已迁移；旧 API 仅兼容读）。
 */
import { api, getCurrentWorkspace } from "@/lib/api";
import type { Project, ProjectTask } from "@/types";

const PERSONAL_TODO = "个人TODO";
const FAMILY_TODO = "家庭TODO";

/**
 * 确保当前空间下有默认 TODO 项目，返回 projectId。
 */
export async function ensureDefaultTodoProject(): Promise<Project> {
  const workspaceId = getCurrentWorkspace();
  const projects = await api.getProjects(
    workspaceId && workspaceId !== "" ? workspaceId : undefined,
    "active",
  );

  const preferName =
    workspaceId && workspaceId !== "" && workspaceId !== "personal"
      ? FAMILY_TODO
      : PERSONAL_TODO;

  let project =
    projects.find((p) => p.name === preferName) ||
    projects.find((p) => p.name === PERSONAL_TODO || p.name === FAMILY_TODO);

  if (!project) {
    project = await api.createProject({
      name: preferName,
      description:
        preferName === FAMILY_TODO ? "家庭共享待办" : "个人待办事项项目",
      cover: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    });
  }

  return project;
}

async function firstStageId(projectId: string): Promise<string> {
  const stages = await api.getProjectStages(projectId);
  if (stages.length > 0) return stages[0].id;
  const created = await api.createProjectStage(projectId, { name: "进行中" });
  return created.id;
}

export interface UnifiedTaskInput {
  title: string;
  description?: string;
  dueDate?: string | null;
  remindAt?: string | null;
  priority?: number;
  /** 若指定则写入该项目；否则用默认 TODO 项目 */
  projectId?: string;
  assigneeId?: string | null;
  tagIds?: string[];
}

/**
 * 创建一条统一任务（project_tasks）。
 */
export async function createUnifiedTask(
  input: UnifiedTaskInput,
): Promise<ProjectTask> {
  const project = input.projectId
    ? await api.getProject(input.projectId)
    : await ensureDefaultTodoProject();

  const stageId = await firstStageId(project.id);

  const endDate = input.dueDate
    ? input.dueDate.includes("T") || input.dueDate.includes(" ")
      ? new Date(input.dueDate).toISOString()
      : new Date(`${input.dueDate}T00:00:00`).toISOString()
    : null;

  return api.createProjectTask(project.id, {
    stageId,
    title: input.title.trim() || "未命名任务",
    description: input.description || "",
    endDate,
    remindAt: input.remindAt || null,
    priority: input.priority ?? 2,
    assigneeId: input.assigneeId ?? null,
    tags: input.tagIds,
  });
}
