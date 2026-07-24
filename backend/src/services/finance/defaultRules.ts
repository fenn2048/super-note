/**
 * 默认导入规则：源自 beancount-gs 账本 `.beancount-gs/import_rule.json`
 * 目标/支付账户以账户全名存储，创建账本时解析为 id。
 */
import { v4 as uuidv4 } from "uuid";
import type Database from "better-sqlite3";
import type { ImportRuleAction, ImportRuleMatch } from "./types.js";
import rulesData from "./defaultRulesData.json";

export type DefaultRuleTemplate = {
  name: string;
  peer?: string;
  type?: string;
  item?: string;
  category?: string;
  method?: string;
  fullMatch?: boolean;
  separator?: string;
  logic?: "AND" | "OR";
  minPrice?: number;
  maxPrice?: number;
  price?: number;
  time?: string;
  targetAccountName?: string;
  methodAccountName?: string;
  defaultPlusAccountName?: string;
  defaultMinusAccountName?: string;
  tags?: string[];
  ignore?: boolean;
  methodMappings?: Array<{ method: string; accountName: string }>;
};

export const DEFAULT_IMPORT_RULES = rulesData as DefaultRuleTemplate[];

/** 按账户名查找 id（精确 → 去 CNY → 前缀宽松匹配） */
export function resolveAccountIdByName(
  nameToId: Map<string, string>,
  name: string | undefined | null,
): string | null {
  if (!name) return null;
  const n = name.trim();
  if (!n) return null;
  if (nameToId.has(n)) return nameToId.get(n)!;

  const stripped = n.replace(/\s*CNY\s*$/i, "").trim();
  if (nameToId.has(stripped)) return nameToId.get(stripped)!;

  for (const [accName, id] of nameToId) {
    if (accName === stripped || accName.startsWith(stripped + ":")) return id;
    if (stripped.startsWith(accName + ":") || stripped.startsWith(accName)) return id;
  }

  const parts = stripped.split(":");
  if (parts.length >= 3) {
    const prefix = parts.slice(0, -1).join(":");
    for (const [accName, id] of nameToId) {
      if (accName.startsWith(prefix + ":") || accName.startsWith(prefix)) {
        const last = parts[parts.length - 1];
        if (last && accName.includes(last.slice(0, Math.min(4, last.length)))) return id;
      }
    }
    for (const [accName, id] of nameToId) {
      if (accName.startsWith(prefix)) return id;
    }
  }
  return null;
}

export function buildAccountNameMap(
  accounts: Array<{ id: string; name: string }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of accounts) map.set(a.name, a.id);
  return map;
}

/** 模板 → match / action（账户名已解析为 id） */
export function templateToMatchAction(
  rule: DefaultRuleTemplate,
  nameToId: Map<string, string>,
): { match: ImportRuleMatch; action: ImportRuleAction } {
  const match: ImportRuleMatch = {
    peer: rule.peer || undefined,
    type: rule.type || undefined,
    item: rule.item || undefined,
    category: rule.category || undefined,
    method: rule.method || undefined,
    fullMatch: !!rule.fullMatch,
    separator: rule.separator || "|",
    logic: rule.logic === "AND" ? "AND" : "OR",
  };
  if (rule.minPrice) match.minPrice = rule.minPrice;
  if (rule.maxPrice) match.maxPrice = rule.maxPrice;
  if (rule.price) match.price = rule.price;
  if (rule.time) match.timeRange = rule.time;

  const action: ImportRuleAction = {
    ignore: !!rule.ignore,
    tags: rule.tags?.length ? rule.tags : undefined,
  };
  const target = resolveAccountIdByName(nameToId, rule.targetAccountName);
  if (target) action.targetAccountId = target;
  const methodAcc = resolveAccountIdByName(nameToId, rule.methodAccountName);
  if (methodAcc) action.methodAccountId = methodAcc;
  const plus = resolveAccountIdByName(nameToId, rule.defaultPlusAccountName);
  if (plus) action.defaultPlusAccountId = plus;
  const minus = resolveAccountIdByName(nameToId, rule.defaultMinusAccountName);
  if (minus) action.defaultMinusAccountId = minus;

  if (rule.methodMappings?.length) {
    const mapped: Array<{ method: string; accountId: string }> = [];
    for (const m of rule.methodMappings) {
      const id = resolveAccountIdByName(nameToId, m.accountName);
      if (id && m.method) mapped.push({ method: m.method, accountId: id });
    }
    if (mapped.length) action.methodMappings = mapped;
  }

  return { match, action };
}

/**
 * 创建账本时种子默认导入规则。
 * priority 从高到低：列表越靠前优先级越高（与 beancount-gs 列表顺序一致）。
 */
export function seedDefaultRules(db: Database.Database, ledgerId: string): number {
  const rules = DEFAULT_IMPORT_RULES;
  if (!rules.length) return 0;

  const accounts = db
    .prepare(`SELECT id, name FROM finance_accounts WHERE ledgerId = ? AND isOpen = 1`)
    .all(ledgerId) as Array<{ id: string; name: string }>;
  const nameToId = buildAccountNameMap(accounts);

  const ins = db.prepare(
    `INSERT INTO finance_import_rules (id, ledgerId, name, priority, enabled, matchJson, actionJson, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`,
  );

  const n = rules.length;
  let inserted = 0;
  for (let i = 0; i < n; i++) {
    const rule = rules[i];
    const { match, action } = templateToMatchAction(rule, nameToId);
    const priority = (n - i) * 10;
    ins.run(
      uuidv4(),
      ledgerId,
      rule.name,
      priority,
      JSON.stringify(match),
      JSON.stringify(action),
    );
    inserted++;
  }
  return inserted;
}
