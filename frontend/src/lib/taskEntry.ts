/**
 * 统一任务创建入口（P1 · 方案 A）
 * ---------------------------------------------------------------------------
 * 产品路径：一律落到 Project 体系（个人TODO / 家庭TODO）。
 * 不再写入 legacy `tasks` 表（v20 已迁移；旧 API 仅兼容读）。
 *
 * 个人TODO：任何工作区下每个用户都有一份，owner=自己、PRIVATE、仅自己可见。
 * 家庭TODO：工作区内共享待办。
 */
import { api, getCurrentWorkspace } from "@/lib/api";
import type { Project, ProjectTask } from "@/types";

const PERSONAL_TODO = "个人TODO";
const FAMILY_TODO = "家庭TODO";

function isPersonalTodo(p: Project): boolean {
  return (
    p.name === PERSONAL_TODO && (!p.workspaceId || p.workspaceId === "")
  );
}

/**
 * 确保当前用户有「个人TODO」（不依赖当前工作区）。
 */
export async function ensurePersonalTodoProject(): Promise<Project> {
  // 不带 workspaceId 拉列表 → 后端 ensure 个人TODO，且返回 owner 自己的项目
  const personalList = await api.getProjects(undefined, "active");
  let project = personalList.find(isPersonalTodo);
  if (!project) {
    project = await api.createProject({
      name: PERSONAL_TODO,
      description: "个人待办事项项目",
      cover: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      workspaceId: null,
      visibility: "PRIVATE",
    } as Partial<Project>);
  }
  return project;
}

/**
 * 确保当前空间下有默认 TODO 项目，返回 projectId。
 * - 个人空间 → 个人TODO
 * - 工作区 → 家庭TODO（同时保证个人TODO 也已存在）
 */
export async function ensureDefaultTodoProject(): Promise<Project> {
  const workspaceId = getCurrentWorkspace();
  const inWorkspace =
    !!workspaceId && workspaceId !== "" && workspaceId !== "personal";

  // 任何场景都先保证个人TODO
  const personal = await ensurePersonalTodoProject();
  if (!inWorkspace) return personal;

  const projects = await api.getProjects(workspaceId, "active");
  let family =
    projects.find(
      (p) => p.name === FAMILY_TODO && p.workspaceId === workspaceId,
    ) || projects.find((p) => p.name === FAMILY_TODO);

  if (!family) {
    family = await api.createProject({
      name: FAMILY_TODO,
      description: "家庭共享待办",
      cover: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      workspaceId,
    } as Partial<Project>);
  }

  return family;
}

/**
 * 新建任务默认阶段：优先「待启动」（创建 ≠ 开始做）。
 * 无则「待规划」→ 非「已完成」的第一列 → 没有阶段时创建「待启动」。
 */
export async function resolveNotStartedStageId(projectId: string): Promise<string> {
  const stages = await api.getProjectStages(projectId);
  const notStarted =
    stages.find((s) => s.name === "待启动") ||
    stages.find((s) => s.name === "待规划");
  if (notStarted) return notStarted.id;
  const open = stages.find((s) => s.name !== "已完成");
  if (open) return open.id;
  if (stages[0]) return stages[0].id;
  const created = await api.createProjectStage(projectId, { name: "待启动" });
  return created.id;
}

/** 启动任务：进入「进行中」列 */
export async function resolveInProgressStageId(projectId: string): Promise<string> {
  const stages = await api.getProjectStages(projectId);
  const inProgress = stages.find((s) => s.name === "进行中");
  if (inProgress) return inProgress.id;
  const created = await api.createProjectStage(projectId, { name: "进行中" });
  return created.id;
}

/** 已完成列（补录 / 勾选完成） */
export async function resolveCompletedStageId(projectId: string): Promise<string> {
  const stages = await api.getProjectStages(projectId);
  let completed = stages.find((s) => s.name === "已完成");
  if (!completed) {
    completed = await api.createProjectStage(projectId, { name: "已完成" });
  }
  return completed.id;
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
  /** 四象限：1 / 0 / null 未归类 */
  isImportant?: number | null;
  isUrgent?: number | null;
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

  const stageId = await resolveNotStartedStageId(project.id);

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
    status: "pending",
    isImportant: input.isImportant ?? null,
    isUrgent: input.isUrgent ?? null,
  });
}
