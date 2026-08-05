/**
 * 家庭事务分类树（任务统计主维度）
 * - code 稳定，name 可改，保证历史环比不断档
 * - description：小类说明（选择器气泡 / 管理页小字）
 * - kind: normal | urgent | planned_node（第 6 大类洞察拆分）
 */
import type Database from "better-sqlite3";
import { v4 as uuid } from "uuid";

export type TaskCategoryKind = "normal" | "urgent" | "planned_node";

export interface TaskCategoryRow {
  id: string;
  workspaceId: string | null;
  ownerUserId: string;
  parentId: string | null;
  code: string;
  name: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  isActive: number;
  isPreset: number;
  kind: TaskCategoryKind | string;
  createdAt: string;
  updatedAt: string;
}

type PresetNode = {
  code: string;
  name: string;
  /** 分类说明：例「主业工作、学习提升、职场应酬」 */
  description?: string;
  color?: string;
  kind?: TaskCategoryKind;
  children?: PresetNode[];
};

/** 家庭事务 6 大类 + 小类预设（育儿 3A/3B；说明文案供 UI 小字/气泡） */
export const FAMILY_TASK_TAXONOMY_PRESET: PresetNode[] = [
  {
    code: "1",
    name: "个人私事",
    color: "#6366f1",
    description: "个人工作、健康、社交与私人开支",
    children: [
      {
        code: "1.1",
        name: "工作事业",
        description: "主业工作、学习提升、职场应酬",
      },
      {
        code: "1.2",
        name: "身心健康",
        description: "运动养生、就医体检、个人打理",
      },
      {
        code: "1.3",
        name: "休闲社交",
        description: "朋友聚会、个人爱好",
      },
      {
        code: "1.4",
        name: "个人开支",
        description: "零花钱、私人随礼",
      },
    ],
  },
  {
    code: "2",
    name: "夫妻共同事务",
    color: "#ec4899",
    description: "夫妻相处、家庭财务、资产与亲友长辈",
    children: [
      {
        code: "2.1",
        name: "夫妻相处",
        description: "纪念日、谈心沟通、双人短途出行",
      },
      {
        code: "2.2",
        name: "家庭财务",
        description: "记账对账、理财储蓄、大额消费、保险配置",
      },
      {
        code: "2.3",
        name: "资产证件",
        description: "房车手续、重要证件归档保管",
      },
      {
        code: "2.4",
        name: "亲友基础往来",
        description: "双方父母探望、普通亲戚人情",
      },
      {
        code: "2.5",
        name: "长辈专项",
        description: "长辈育儿月薪、返乡车票、生活用品采购",
      },
    ],
  },
  {
    code: "3",
    name: "育儿事项",
    color: "#f59e0b",
    description: "大宝 / 二宝分栏，起居、健康、教育与物资",
    children: [
      {
        code: "3A",
        name: "大宝（长女·中班）",
        description: "长女中班阶段的起居接送、教育与玩乐",
        children: [
          {
            code: "3A.1",
            name: "起居接送",
            description: "穿衣洗漱、上下学接送",
          },
          {
            code: "3A.2",
            name: "健康医疗",
            description: "体检、疫苗、生病护理",
          },
          {
            code: "3A.3",
            name: "学前教育",
            description: "幼儿园学费、园所杂费、家校沟通、绘本早教",
          },
          {
            code: "3A.4",
            name: "物资玩乐",
            description: "衣物用品、玩具、亲子游玩",
          },
        ],
      },
      {
        code: "3B",
        name: "二宝（幼子·2岁半）",
        description: "幼子日常照料、早教与母婴耗材",
        children: [
          {
            code: "3B.1",
            name: "起居照料",
            description: "喂养、作息哄睡、日常看护",
          },
          {
            code: "3B.2",
            name: "健康医疗",
            description: "体检、疫苗、小病护理",
          },
          {
            code: "3B.3",
            name: "早教陪伴",
            description: "亲子互动、适龄玩具绘本",
          },
          {
            code: "3B.4",
            name: "母婴耗材",
            description: "奶粉、尿不湿、辅食、洗护用品",
          },
        ],
      },
    ],
  },
  {
    code: "4",
    name: "居家家务",
    color: "#10b981",
    description: "清洁、洗衣、餐饮与家居维护",
    children: [
      {
        code: "4.1",
        name: "清洁清运",
        description: "全屋保洁、厨卫清洁、垃圾清运",
      },
      {
        code: "4.2",
        name: "洗衣收纳",
        description: "洗衣晾晒、换季收纳",
      },
      {
        code: "4.3",
        name: "餐饮厨务",
        description: "食材采购、三餐制作、厨具清洁",
      },
      {
        code: "4.4",
        name: "补货维修绿植",
        description: "日用品补货、家电房屋维修、绿植养护",
      },
    ],
  },
  {
    code: "5",
    name: "车辆与外勤",
    color: "#06b6d4",
    description: "用车、全家出行与外勤办事",
    children: [
      {
        code: "5.1",
        name: "车辆使用",
        description: "加油、洗车、保养、年检、停车违章",
      },
      {
        code: "5.2",
        name: "全家出行",
        description: "长途旅行、返乡行程",
      },
      {
        code: "5.3",
        name: "外勤业务",
        description: "政务办理、物业对接、快递收发",
      },
    ],
  },
  {
    code: "6",
    name: "临时与节点事务",
    color: "#f43f5e",
    description: "突发急症故障、人情节点与节日筹备",
    children: [
      {
        code: "6.1",
        name: "急症与故障抢修",
        kind: "urgent",
        description: "家人急症、房屋设施故障、车辆故障抢修",
      },
      {
        code: "6.2",
        name: "临时人情礼金/红白",
        kind: "urgent",
        description: "临时人情礼金、突发红白事",
      },
      {
        code: "6.3",
        name: "节日与家庭生日筹备",
        kind: "planned_node",
        description: "节日置办、家庭生日筹备",
      },
      {
        code: "6.4",
        name: "闲置物品处理",
        kind: "planned_node",
        description: "闲置物品清理、转让或丢弃",
      },
      {
        code: "6.5",
        name: "长辈突发就医购药",
        kind: "urgent",
        description: "长辈突发看病、门诊买药、检查费用",
      },
    ],
  },
];

function scopeWhere(workspaceId: string | null, ownerUserId: string): { sql: string; params: string[] } {
  if (workspaceId) {
    return { sql: "workspaceId = ?", params: [workspaceId] };
  }
  return { sql: "(workspaceId IS NULL OR workspaceId = '') AND ownerUserId = ?", params: [ownerUserId] };
}

/** 将预设里的 description 写回已有分类（仅补空 / 可强制） */
export function backfillPresetDescriptions(
  db: Database.Database,
  workspaceId: string | null,
  ownerUserId: string,
  opts?: { force?: boolean },
): number {
  const descByCode = new Map<string, string>();
  const walk = (nodes: PresetNode[]) => {
    for (const n of nodes) {
      if (n.description) descByCode.set(n.code, n.description);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(FAMILY_TASK_TAXONOMY_PRESET);

  const { sql, params } = scopeWhere(workspaceId, ownerUserId);
  const force = !!opts?.force;
  let changed = 0;
  const stmt = force
    ? db.prepare(
        `UPDATE task_categories SET description = ?, updatedAt = datetime('now')
         WHERE ${sql} AND code = ?`,
      )
    : db.prepare(
        `UPDATE task_categories SET description = ?, updatedAt = datetime('now')
         WHERE ${sql} AND code = ?
           AND (description IS NULL OR TRIM(description) = '')`,
      );

  const tx = db.transaction(() => {
    for (const [code, description] of descByCode) {
      const r = stmt.run(description, ...params, code);
      changed += r.changes;
    }
  });
  tx();
  return changed;
}

export function listTaskCategories(
  db: Database.Database,
  workspaceId: string | null,
  ownerUserId: string,
  opts?: { includeInactive?: boolean; backfillDescriptions?: boolean },
): TaskCategoryRow[] {
  const { sql, params } = scopeWhere(workspaceId, ownerUserId);
  if (opts?.backfillDescriptions !== false) {
    try {
      backfillPresetDescriptions(db, workspaceId, ownerUserId, { force: false });
    } catch (e) {
      console.warn("[task-taxonomy] backfill descriptions:", e);
    }
  }
  const active = opts?.includeInactive ? "1=1" : "isActive = 1";
  return db
    .prepare(
      `SELECT * FROM task_categories
       WHERE ${sql} AND ${active}
       ORDER BY sortOrder ASC, code ASC`,
    )
    .all(...params) as TaskCategoryRow[];
}

export function getCategoryById(db: Database.Database, id: string): TaskCategoryRow | undefined {
  return db.prepare("SELECT * FROM task_categories WHERE id = ?").get(id) as TaskCategoryRow | undefined;
}

/** 新建自定义分类（叶子或大类） */
export function createTaskCategory(
  db: Database.Database,
  params: {
    workspaceId: string | null;
    ownerUserId: string;
    parentId?: string | null;
    code: string;
    name: string;
    description?: string | null;
    color?: string | null;
    kind?: string;
  },
): TaskCategoryRow {
  const code = params.code.trim();
  const name = params.name.trim();
  if (!code) throw new Error("分类编码不能为空");
  if (!name) throw new Error("分类名称不能为空");
  if (!/^[A-Za-z0-9._-]+$/.test(code)) {
    throw new Error("编码仅允许字母数字与 . _ -");
  }

  const { sql, params: scopeParams } = scopeWhere(params.workspaceId, params.ownerUserId);
  const dup = db
    .prepare(`SELECT id FROM task_categories WHERE ${sql} AND code = ?`)
    .get(...scopeParams, code) as { id: string } | undefined;
  if (dup) throw new Error(`编码「${code}」已存在`);

  let parentId = params.parentId || null;
  if (parentId) {
    const parent = getCategoryById(db, parentId);
    if (!parent) throw new Error("父分类不存在");
    if (params.workspaceId) {
      if (parent.workspaceId !== params.workspaceId) throw new Error("父分类不在当前工作区");
    } else if (parent.workspaceId || parent.ownerUserId !== params.ownerUserId) {
      throw new Error("父分类不在当前空间");
    }
  }

  const maxSort = db
    .prepare(`SELECT COALESCE(MAX(sortOrder), -1) AS m FROM task_categories WHERE ${sql}`)
    .get(...scopeParams) as { m: number };

  const id = uuid();
  const description =
    params.description != null && String(params.description).trim()
      ? String(params.description).trim()
      : null;

  db.prepare(
    `INSERT INTO task_categories (
      id, workspaceId, ownerUserId, parentId, code, name, description, color,
      sortOrder, isActive, isPreset, kind, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, datetime('now'), datetime('now'))`,
  ).run(
    id,
    params.workspaceId,
    params.ownerUserId,
    parentId,
    code,
    name,
    description,
    params.color || null,
    (maxSort?.m ?? -1) + 1,
    params.kind || "normal",
  );

  return getCategoryById(db, id)!;
}

/**
 * 应用家庭预设：按 code upsert（已有则更新 name/description/kind/color/sort，不改 id）
 */
export function applyFamilyTaxonomyPreset(
  db: Database.Database,
  workspaceId: string | null,
  ownerUserId: string,
): { created: number; updated: number; total: number } {
  let created = 0;
  let updated = 0;
  const { sql, params } = scopeWhere(workspaceId, ownerUserId);

  const insert = db.prepare(`
    INSERT INTO task_categories (
      id, workspaceId, ownerUserId, parentId, code, name, description, color,
      sortOrder, isActive, isPreset, kind, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, datetime('now'), datetime('now'))
  `);
  const update = db.prepare(`
    UPDATE task_categories
    SET name = ?, description = ?, color = COALESCE(?, color), parentId = ?, sortOrder = ?,
        kind = ?, isPreset = 1, isActive = 1, updatedAt = datetime('now')
    WHERE id = ?
  `);

  const codeToId = new Map<string, string>();
  const existing = db
    .prepare(`SELECT id, code FROM task_categories WHERE ${sql}`)
    .all(...params) as { id: string; code: string }[];
  for (const e of existing) codeToId.set(e.code, e.id);

  let sortCounter = 0;

  const walk = (nodes: PresetNode[], parentCode: string | null) => {
    for (const node of nodes) {
      const sortOrder = sortCounter++;
      const parentId = parentCode ? codeToId.get(parentCode) || null : null;
      const kind = node.kind || "normal";
      const color = node.color || null;
      const description = node.description || null;
      let id = codeToId.get(node.code);
      if (id) {
        update.run(node.name, description, color, parentId, sortOrder, kind, id);
        updated++;
      } else {
        id = uuid();
        insert.run(
          id,
          workspaceId,
          ownerUserId,
          parentId,
          node.code,
          node.name,
          description,
          color,
          sortOrder,
          kind,
        );
        codeToId.set(node.code, id);
        created++;
      }
      if (node.children?.length) walk(node.children, node.code);
    }
  };

  const tx = db.transaction(() => walk(FAMILY_TASK_TAXONOMY_PRESET, null));
  tx();

  return { created, updated, total: created + updated };
}

export type TaskCategoryTreeNode = TaskCategoryRow & { children: TaskCategoryTreeNode[] };

export function buildCategoryTree(rows: TaskCategoryRow[]): TaskCategoryTreeNode[] {
  const byParent = new Map<string | null, TaskCategoryRow[]>();
  for (const r of rows) {
    const key = r.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(r);
  }
  const build = (parentId: string | null): TaskCategoryTreeNode[] => {
    return (byParent.get(parentId) || []).map((r) => ({
      ...r,
      children: build(r.id),
    }));
  };
  return build(null);
}

/** 解析叶子分类的大类 root（沿 parent 上溯） */
export function resolveRootCategory(
  db: Database.Database,
  categoryId: string | null | undefined,
): TaskCategoryRow | null {
  if (!categoryId) return null;
  let cur = getCategoryById(db, categoryId);
  if (!cur) return null;
  const guard = new Set<string>();
  while (cur.parentId) {
    if (guard.has(cur.id)) break;
    guard.add(cur.id);
    const parent = getCategoryById(db, cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function mapCategoriesById(rows: TaskCategoryRow[]): Map<string, TaskCategoryRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

/** 给定叶子 id，沿 map 找 root code/name */
export function findRootInMap(
  map: Map<string, TaskCategoryRow>,
  categoryId: string | null | undefined,
): TaskCategoryRow | null {
  if (!categoryId) return null;
  let cur = map.get(categoryId);
  if (!cur) return null;
  const guard = new Set<string>();
  while (cur.parentId) {
    if (guard.has(cur.id)) break;
    guard.add(cur.id);
    const p = map.get(cur.parentId);
    if (!p) break;
    cur = p;
  }
  return cur;
}
