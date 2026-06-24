import { Hono } from "hono";
import { getDb } from "../db/schema.js";
import { getUserWorkspaceRole } from "../middleware/acl.js";
import { v4 as uuid } from "uuid";
import { logAudit } from "../services/audit.js";
import { propagateStatusDown, propagateMilestoneStatusUp } from "../lib/planStatusSync.js";

const plansRouter = new Hono();

// Helper to check plan access permission
function getPlanPermission(planId: string, userId: string) {
  const db = getDb();
  const plan = db.prepare("SELECT ownerId, workspaceId FROM plans WHERE id = ?").get(planId) as { ownerId: string; workspaceId: string | null } | undefined;
  if (!plan) return { canRead: false, canWrite: false, isOwner: false, plan: null };

  const isOwner = plan.ownerId === userId;

  if (plan.workspaceId) {
    const role = getUserWorkspaceRole(plan.workspaceId, userId);
    if (!role) return { canRead: false, canWrite: false, isOwner: false, plan };
    // Workspace member can read/write plans
    return { canRead: true, canWrite: true, isOwner, plan };
  } else {
    return { canRead: isOwner, canWrite: isOwner, isOwner, plan };
  }
}

// 1. List Plans
plansRouter.get("/", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const workspaceId = c.req.query("workspaceId") || null;

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权访问该工作区", code: "FORBIDDEN" }, 403);
  }

  let sql = "SELECT * FROM plans";
  const params: any[] = [];
  if (workspaceId) {
    sql += " WHERE workspaceId = ?";
    params.push(workspaceId);
  } else {
    sql += " WHERE ownerId = ? AND workspaceId IS NULL";
    params.push(userId);
  }
  sql += " ORDER BY createdAt DESC";

  const plans = db.prepare(sql).all(params) as any[];

  // Attach milestones and progress counts
  for (const plan of plans) {
    const milestones = db.prepare("SELECT * FROM milestones WHERE planId = ? ORDER BY sortOrder ASC").all(plan.id) as any[];
    plan.milestones = milestones;
    plan.totalMilestones = milestones.length;
    plan.completedMilestones = milestones.filter(m => m.status === "completed").length;

    // Fetch participants details
    plan.participants = db.prepare(`
      SELECT u.id as userId, u.username, u.displayName, u.avatarUrl
      FROM plan_participants pp
      JOIN users u ON pp.userId = u.id
      WHERE pp.planId = ?
    `).all(plan.id);
  }

  return c.json(plans);
});

// 2. Fetch Plan Detail
plansRouter.get("/:id", (c) => {
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canRead, plan } = getPlanPermission(id, userId);
  if (!plan) return c.json({ error: "计划不存在", code: "NOT_FOUND" }, 404);
  if (!canRead) return c.json({ error: "无权查看该计划", code: "FORBIDDEN" }, 403);

  const db = getDb();
  const planData = db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as any;

  // Milestones
  const milestones = db.prepare("SELECT * FROM milestones WHERE planId = ? ORDER BY sortOrder ASC").all(id) as any[];

  // For each milestone, query associated projects
  for (const ms of milestones) {
    ms.projects = db.prepare(`
      SELECT p.*, u.username as ownerName, u.displayName as ownerDisplayName,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.projectId = p.id AND pt.isCompleted = 1) as completedTasksCount,
        (SELECT COUNT(*) FROM project_tasks pt WHERE pt.projectId = p.id) as totalTasksCount
      FROM projects p
      LEFT JOIN users u ON p.ownerId = u.id
      WHERE p.milestoneId = ? AND p.isDeleted = 0 AND p.isArchived = 0
    `).all(ms.id);
  }
  planData.milestones = milestones;

  // Participants
  planData.participants = db.prepare(`
    SELECT u.id as userId, u.username, u.displayName, u.avatarUrl
    FROM plan_participants pp
    JOIN users u ON pp.userId = u.id
    WHERE pp.planId = ?
  `).all(id);

  return c.json(planData);
});

// 3. Create Plan
plansRouter.post("/", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const body = await c.req.json();

  const { name, background = "", goal = "", details = "", startDate = null, endDate = null, workspaceId = null, milestones = [], participants = [] } = body;
  if (!name) return c.json({ error: "计划名称不能为空" }, 400);

  if (workspaceId) {
    const role = getUserWorkspaceRole(workspaceId, userId);
    if (!role) return c.json({ error: "无权在该工作区内创建计划", code: "FORBIDDEN" }, 403);
  }

  const planId = uuid();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO plans (id, name, background, goal, details, startDate, endDate, status, workspaceId, ownerId)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(planId, name, background, goal, details, startDate, endDate, workspaceId, userId);

    // Save milestones
    for (let i = 0; i < milestones.length; i++) {
      const ms = milestones[i];
      const msId = uuid();
      db.prepare(`
        INSERT INTO milestones (id, planId, name, description, startDate, endDate, status, sortOrder)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(msId, planId, ms.name, ms.description || "", ms.startDate || null, ms.endDate || null, ms.status || "pending", i);
    }

    // Save participants
    for (const pUserId of participants) {
      db.prepare("INSERT INTO plan_participants (planId, userId) VALUES (?, ?)").run(planId, pUserId);
    }

    logAudit(userId, "system", "create_plan", `创建计划「${name}」`, { targetType: "plan", targetId: planId });
  });

  tx();

  const createdPlan = db.prepare("SELECT * FROM plans WHERE id = ?").get(planId);
  return c.json(createdPlan);
});

// 4. Update Plan
plansRouter.put("/:id", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");
  const body = await c.req.json();

  const { canWrite, plan } = getPlanPermission(id, userId);
  if (!plan) return c.json({ error: "计划不存在", code: "NOT_FOUND" }, 404);
  if (!canWrite) return c.json({ error: "无权编辑该计划", code: "FORBIDDEN" }, 403);

  const { name, background, goal, details, startDate, endDate, status, milestones, participants } = body;

  const tx = db.transaction(() => {
    const updates: string[] = [];
    const params: any[] = [];

    const oldPlan = db.prepare("SELECT status, name FROM plans WHERE id = ?").get(id) as { status: string; name: string };

    if (name !== undefined) { updates.push("name = ?"); params.push(name); }
    if (background !== undefined) { updates.push("background = ?"); params.push(background); }
    if (goal !== undefined) { updates.push("goal = ?"); params.push(goal); }
    if (details !== undefined) { updates.push("details = ?"); params.push(details); }
    if (startDate !== undefined) { updates.push("startDate = ?"); params.push(startDate); }
    if (endDate !== undefined) { updates.push("endDate = ?"); params.push(endDate); }
    if (status !== undefined) { updates.push("status = ?"); params.push(status); }

    if (updates.length > 0) {
      updates.push("updatedAt = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE plans SET ${updates.join(", ")} WHERE id = ?`).run(params);
    }

    // Status changed -> trigger downward propagation
    if (status !== undefined && status !== oldPlan.status) {
      logAudit(userId, "system", "plan_status_update", `修改计划「${name || oldPlan.name}」状态为: ${status}`, { targetType: "plan", targetId: id });
      propagateStatusDown(db, "plan", id, status, userId);
    } else {
      logAudit(userId, "system", "plan_update", `修改了计划「${name || oldPlan.name}」的属性`, { targetType: "plan", targetId: id });
    }

    // Sync Milestones if provided
    if (milestones && Array.isArray(milestones)) {
      const currentMilestoneIds = milestones.map(m => m.id).filter(id => !!id);
      
      // Before deleting, reset milestoneId for projects referencing them
      if (currentMilestoneIds.length > 0) {
        const placeholders = currentMilestoneIds.map(() => "?").join(",");
        db.prepare(`UPDATE projects SET milestoneId = NULL WHERE milestoneId IN (SELECT id FROM milestones WHERE planId = ? AND id NOT IN (${placeholders}))`).run(id, ...currentMilestoneIds);
        db.prepare(`DELETE FROM milestones WHERE planId = ? AND id NOT IN (${placeholders})`).run(id, ...currentMilestoneIds);
      } else {
        db.prepare("UPDATE projects SET milestoneId = NULL WHERE milestoneId IN (SELECT id FROM milestones WHERE planId = ?)").run(id);
        db.prepare("DELETE FROM milestones WHERE planId = ?").run(id);
      }

      for (let i = 0; i < milestones.length; i++) {
        const ms = milestones[i];
        if (ms.id) {
          db.prepare(`
            UPDATE milestones
            SET name = ?, description = ?, startDate = ?, endDate = ?, status = ?, sortOrder = ?, updatedAt = datetime('now')
            WHERE id = ?
          `).run(ms.name, ms.description || "", ms.startDate || null, ms.endDate || null, ms.status || "pending", i, ms.id);
        } else {
          db.prepare(`
            INSERT INTO milestones (id, planId, name, description, startDate, endDate, status, sortOrder)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(uuid(), id, ms.name, ms.description || "", ms.startDate || null, ms.endDate || null, ms.status || "pending", i);
        }
      }
    }

    // Sync Participants if provided
    if (participants && Array.isArray(participants)) {
      db.prepare("DELETE FROM plan_participants WHERE planId = ?").run(id);
      for (const pUserId of participants) {
        db.prepare("INSERT INTO plan_participants (planId, userId) VALUES (?, ?)").run(id, pUserId);
      }
    }
  });

  tx();

  const updatedPlan = db.prepare("SELECT * FROM plans WHERE id = ?").get(id);
  return c.json(updatedPlan);
});

// 5. Delete Plan
plansRouter.delete("/:id", (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const id = c.req.param("id");

  const { canWrite, plan } = getPlanPermission(id, userId);
  if (!plan) return c.json({ error: "计划不存在", code: "NOT_FOUND" }, 404);
  if (!canWrite) return c.json({ error: "无权删除该计划", code: "FORBIDDEN" }, 403);

  const tx = db.transaction(() => {
    // Reset milestoneId on projects referencing this plan's milestones
    db.prepare(`
      UPDATE projects SET milestoneId = NULL
      WHERE milestoneId IN (SELECT id FROM milestones WHERE planId = ?)
    `).run(id);

    // Delete plan (cascades milestones & participants)
    db.prepare("DELETE FROM plans WHERE id = ?").run(id);
    
    logAudit(userId, "system", "delete_plan", "删除了计划", { targetType: "plan", targetId: id });
  });

  tx();

  return c.json({ success: true });
});

// 6. Update Milestone Status Manually
plansRouter.put("/milestones/:milestoneId", async (c) => {
  const db = getDb();
  const userId = c.req.header("X-User-Id")!;
  const milestoneId = c.req.param("milestoneId");
  const body = await c.req.json();

  const { status } = body;
  if (!status) return c.json({ error: "状态不能为空" }, 400);

  const milestone = db.prepare("SELECT planId, name FROM milestones WHERE id = ?").get(milestoneId) as { planId: string; name: string } | undefined;
  if (!milestone) return c.json({ error: "里程碑不存在" }, 404);

  const { canWrite } = getPlanPermission(milestone.planId, userId);
  if (!canWrite) return c.json({ error: "无权编辑该计划的里程碑", code: "FORBIDDEN" }, 403);

  const tx = db.transaction(() => {
    db.prepare("UPDATE milestones SET status = ?, updatedAt = datetime('now') WHERE id = ?").run(status, milestoneId);
    
    logAudit(userId, "task", "milestone_status_update", `修改里程碑「${milestone.name}」状态为: ${status}`, { targetType: "milestone", targetId: milestoneId });

    // Downward propagation
    propagateStatusDown(db, "milestone", milestoneId, status, userId);

    // Upward propagation
    propagateMilestoneStatusUp(db, milestone.planId, userId);
  });

  tx();

  const updatedMilestone = db.prepare("SELECT * FROM milestones WHERE id = ?").get(milestoneId);
  return c.json(updatedMilestone);
});

export default plansRouter;
