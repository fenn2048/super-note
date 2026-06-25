import { logAudit } from "../services/audit.js";

function getChineseStatus(status: string) {
  if (status === "pending") return "待启动";
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "paused") return "已暂停";
  return status;
}

/**
 * Sync milestone status directly by milestoneId
 */
export function syncMilestoneStatusDirect(db: any, milestoneId: string, userId: string) {
  // Query all active projects associated with this milestone
  const projects = db.prepare("SELECT status, name FROM projects WHERE milestoneId = ? AND isDeleted = 0 AND isArchived = 0").all(milestoneId) as { status: string; name: string }[];
  
  let newMilestoneStatus = "pending";
  if (projects.length > 0) {
    if (projects.every(p => p.status === "completed")) {
      newMilestoneStatus = "completed";
    } else if (projects.some(p => p.status === "paused")) {
      // If any project is paused, does it make the milestone paused?
      // Usually upward sync doesn't force 'paused' unless all are paused?
      // User didn't specify upward sync for 'paused', only downward.
      // Keeping existing logic for pending/in_progress/completed.
      if (projects.every(p => p.status === "completed" || p.status === "paused")) {
          // If all are done or paused, maybe it stays in_progress or becomes paused?
          // Let's stick to standard progress unless specifically told otherwise.
      }
      newMilestoneStatus = "in_progress";
    } else if (projects.some(p => p.status === "in_progress" || p.status === "completed")) {
      newMilestoneStatus = "in_progress";
    }
  }

  const milestone = db.prepare("SELECT status, planId, name FROM milestones WHERE id = ?").get(milestoneId) as { status: string; planId: string; name: string } | undefined;
  if (!milestone) return;

  if (milestone.status !== newMilestoneStatus && milestone.status !== 'paused') {
    // We don't automatically un-pause a milestone via upward sync usually.
    db.prepare("UPDATE milestones SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(newMilestoneStatus, milestoneId);
    logAudit(userId, "task", "milestone_status_auto_update", `项目更新触发里程碑「${milestone.name}」状态自动变为: ${getChineseStatus(newMilestoneStatus)}`, { targetType: "milestone", targetId: milestoneId });
    
    // Propagate up to plan
    propagateMilestoneStatusUp(db, milestone.planId, userId);
  }
}

/**
 * Upward propagation: Project -> Milestone
 */
export function propagateProjectStatusUp(db: any, projectId: string, userId: string) {
  const project = db.prepare("SELECT milestoneId, name FROM projects WHERE id = ?").get(projectId) as { milestoneId: string | null; name: string } | undefined;
  if (!project || !project.milestoneId) return;

  syncMilestoneStatusDirect(db, project.milestoneId, userId);
}

/**
 * Upward propagation: Milestone -> Plan
 */
export function propagateMilestoneStatusUp(db: any, planId: string, userId: string) {
  const milestones = db.prepare("SELECT status, name FROM milestones WHERE planId = ?").all(planId) as { status: string; name: string }[];
  
  let newPlanStatus = "pending";
  if (milestones.length > 0) {
    if (milestones.every(m => m.status === "completed")) {
      newPlanStatus = "completed";
    } else if (milestones.some(m => m.status === "in_progress" || m.status === "completed" || m.status === "paused")) {
      newPlanStatus = "in_progress";
    }
  }

  const plan = db.prepare("SELECT status, name FROM plans WHERE id = ?").get(planId) as { status: string; name: string } | undefined;
  if (!plan) return;

  if (plan.status !== newPlanStatus && plan.status !== 'paused') {
    db.prepare("UPDATE plans SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(newPlanStatus, planId);
    logAudit(userId, "task", "plan_status_auto_update", `里程碑状态更新触发计划「${plan.name}」状态自动变为: ${getChineseStatus(newPlanStatus)}`, { targetType: "plan", targetId: planId });
  }
}

/**
 * Downward propagation: Plan/Milestone/Project/Task -> Sub-entities
 */
export function propagateStatusDown(db: any, type: "plan" | "milestone" | "project" | "task", id: string, targetStatus: string, userId: string) {
  if (type === "plan") {
    // Update milestones of this plan
    const milestones = db.prepare("SELECT id, name, status FROM milestones WHERE planId = ?").all(id) as { id: string; name: string; status: string }[];
    for (const ms of milestones) {
      let runUpdate = false;
      if (targetStatus === "paused" && ms.status !== "paused") {
        runUpdate = true;
      } else if (targetStatus === "completed" && ms.status !== "completed") {
        runUpdate = true;
      } else if (targetStatus === "pending" && ms.status !== "pending") {
        runUpdate = true;
      } else if (targetStatus === "in_progress" && ms.status === "pending") {
        runUpdate = true;
      }

      if (runUpdate) {
        db.prepare("UPDATE milestones SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(targetStatus, ms.id);
        logAudit(userId, "task", "milestone_status_auto_update", `计划状态更新触发里程碑「${ms.name}」状态自动变为: ${getChineseStatus(targetStatus)}`, { targetType: "milestone", targetId: ms.id });
        // Update projects under this milestone
        propagateStatusDown(db, "milestone", ms.id, targetStatus, userId);
      }
    }
  } else if (type === "milestone") {
    // Update projects of this milestone
    const projects = db.prepare("SELECT id, name, status FROM projects WHERE milestoneId = ? AND isDeleted = 0 AND isArchived = 0").all(id) as { id: string; name: string; status: string }[];
    for (const proj of projects) {
      let runUpdate = false;
      if (targetStatus === "paused" && proj.status !== "paused") {
        runUpdate = true;
      } else if (targetStatus === "completed" && proj.status !== "completed") {
        runUpdate = true;
      } else if (targetStatus === "pending" && proj.status !== "pending") {
        runUpdate = true;
      } else if (targetStatus === "in_progress" && proj.status === "pending") {
        runUpdate = true;
      }

      if (runUpdate) {
        db.prepare("UPDATE projects SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(targetStatus, proj.id);
        logAudit(userId, "task", "project_status_auto_update", `里程碑状态更新触发项目「${proj.name}」状态自动变为: ${getChineseStatus(targetStatus)}`, { targetType: "project", targetId: proj.id });

        // Update tasks under this project
        propagateStatusDown(db, "project", proj.id, targetStatus, userId);
      }
    }
  } else if (type === "project") {
    // Update tasks of this project
    const tasks = db.prepare("SELECT id, title, status FROM project_tasks WHERE projectId = ?").all(id) as { id: string; title: string; status: string }[];
    for (const task of tasks) {
        if (targetStatus === "paused" && task.status !== "paused") {
            db.prepare("UPDATE project_tasks SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(targetStatus, task.id);
            logAudit(userId, "task", "task_status_auto_update", `项目状态更新触发任务「${task.title}」状态自动变为: ${getChineseStatus(targetStatus)}`, { targetType: "project_task", targetId: task.id });
        }
        // Other statuses (completed, in_progress, pending) usually don't force update project tasks automatically in current logic,
        // but 'paused' is explicitly requested to sync.
    }
  } else if (type === "task") {
    // Update sub-tasks (for general tasks)
    const subTasks = db.prepare("SELECT id, title, status FROM tasks WHERE parentId = ?").all(id) as { id: string; title: string; status: string }[];
    for (const st of subTasks) {
        if (targetStatus === "paused" && st.status !== "paused") {
            db.prepare("UPDATE tasks SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(targetStatus, st.id);
            logAudit(userId, "task", "task_status_auto_update", `父任务状态更新触发子任务「${st.title}」状态自动变为: ${getChineseStatus(targetStatus)}`, { targetType: "task", targetId: st.id });
            // Recursively propagate
            propagateStatusDown(db, "task", st.id, targetStatus, userId);
        }
    }
  }
}
