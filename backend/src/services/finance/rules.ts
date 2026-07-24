/**
 * 导入规则引擎（对齐 beancount-gs ImportRule / EvaluateRules）
 * ---------------------------------------------------------------------------
 * 匹配：对方/类型/商品/分类/支付方式/标签 + 金额区间 + 时间段 + 平台单号等
 * 动作：目标账户、支付账户、支付方式映射、默认收支账户、标签、忽略
 * 优先级：priority 大者优先；同分 updatedAt 新优先（调用方排序）
 */
import type {
  ImportEntry,
  ImportRuleAction,
  ImportRuleMatch,
  ImportRuleRow,
} from "./types.js";

function matchField(
  value: string | undefined,
  pattern: string | undefined,
  fullMatch: boolean,
  separator: string,
): boolean {
  if (!pattern) return true;
  const hay = (value || "").trim();
  const parts = pattern
    .split(separator || ",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return true;
  return parts.some((p) => {
    if (fullMatch) return hay === p;
    return hay.includes(p);
  });
}

/**
 * 标签匹配（基础条件）：
 * 「若交易明细的标签中包含我输入的文字，则命中」
 * - 规则侧可用分隔符写多个关键词，任一关键词命中任一标签即可（OR）
 * - 默认：标签字符串 includes 关键词；fullMatch 时要求标签整段相等
 */
function matchTags(
  entryTags: string[] | undefined,
  pattern: string | undefined,
  fullMatch: boolean,
  separator: string,
): boolean {
  if (!pattern) return true;
  const parts = pattern
    .split(separator || ",")
    .map((s) => s.trim().replace(/^#/, ""))
    .filter(Boolean);
  if (parts.length === 0) return true;
  const tags = (entryTags || [])
    .map((t) => String(t).trim().replace(/^#/, ""))
    .filter(Boolean);
  if (tags.length === 0) return false;
  return parts.some((p) => tags.some((t) => (fullMatch ? t === p : t.includes(p))));
}

/** 汇总 entry 上可用于匹配的标签（含 raw 账单字段） */
function entryTagsForMatch(entry: ImportEntry): string[] {
  const fromEntry = (entry.tags || []).map((t) => String(t).trim()).filter(Boolean);
  if (fromEntry.length) return fromEntry;
  const raw = entry.rawItems || {};
  const rawTag =
    raw["标签"] || raw["tags"] || raw["Tags"] || raw["交易标签"] || raw["备注标签"] || "";
  if (!rawTag) return [];
  return String(rawTag)
    .split(/[,|，、;\s]+/)
    .map((s) => s.trim().replace(/^#/, ""))
    .filter(Boolean);
}

function matchTimeRange(val: string | undefined, rangeStr: string): boolean {
  if (!rangeStr) return true;
  if (!val) return false;
  const parts = rangeStr.split("-");
  if (parts.length !== 2) return false;
  const t = val.slice(0, 5); // HH:MM
  const a = parts[0].trim();
  const b = parts[1].trim();
  return t >= a && t <= b;
}

/** 从 entry / rawItems 取平台字段 */
function entryField(entry: ImportEntry, key: string): string {
  const raw = entry.rawItems || {};
  switch (key) {
    case "tradeNo":
      return entry.sourceId || raw["交易订单号"] || raw["交易号"] || raw["流水号"] || raw["tradeNo"] || "";
    case "orderNo":
      return raw["商家订单号"] || raw["商户单号"] || raw["orderNo"] || "";
    case "transactionId":
      return raw["交易单号"] || raw["transactionId"] || entry.sourceId || "";
    case "merchantId":
      return raw["商户号"] || raw["merchantId"] || "";
    case "transactionCode":
      return raw["交易代码"] || raw["transactionCode"] || "";
    case "branchCode":
      return raw["网点"] || raw["branchCode"] || "";
    case "asset":
      return raw["asset"] || raw["资产"] || "";
    case "side":
      return entry.direction || raw["side"] || "";
    default:
      return raw[key] || "";
  }
}

/**
 * 判断 entry 是否命中规则 match 条件（对齐 beancount-gs matchRule）
 */
export function matchRule(entry: ImportEntry, match: ImportRuleMatch): boolean {
  const fullMatch = !!match.fullMatch;
  const sep = match.separator || ",";
  const logic = (match.logic || "AND").toUpperCase() === "OR" ? "OR" : "AND";

  const peerMatch = matchField(entry.payee, match.peer, fullMatch, sep);
  const typeMatch = matchField(entry.type, match.type, fullMatch, sep);
  const itemMatch = matchField(entry.item, match.item, fullMatch, sep);
  const categoryMatch = matchField(entry.category, match.category, fullMatch, sep);
  const methodMatch = matchField(entry.method, match.method, fullMatch, sep);
  const tagsMatch = matchTags(entryTagsForMatch(entry), match.tags, fullMatch, sep);

  const hasBasic =
    !!(match.peer || match.type || match.item || match.category || match.method || match.tags);

  let basicMatched: boolean;
  if (logic === "OR") {
    if (!hasBasic) {
      basicMatched = true; // 无基础条件时交给金额/时间决定
    } else {
      basicMatched =
        (!!match.peer && peerMatch) ||
        (!!match.type && typeMatch) ||
        (!!match.item && itemMatch) ||
        (!!match.category && categoryMatch) ||
        (!!match.method && methodMatch) ||
        (!!match.tags && tagsMatch);
    }
  } else {
    basicMatched =
      peerMatch && typeMatch && itemMatch && categoryMatch && methodMatch && tagsMatch;
  }
  if (!basicMatched) return false;

  // 金额：用绝对值（元），更符合「最低/最高金额」产品语义
  const absYuan = Math.abs(entry.amountMinor) / 100;
  const signedYuan = entry.amountMinor / 100;

  if (typeof match.minPrice === "number" && match.minPrice !== 0) {
    // 兼容：若 minPrice 为正，按绝对值比较；否则按有符号（与 gs 一致）
    if (match.minPrice > 0) {
      if (absYuan < match.minPrice) return false;
    } else if (signedYuan < match.minPrice) {
      return false;
    }
  }
  if (typeof match.maxPrice === "number" && match.maxPrice !== 0) {
    if (match.maxPrice > 0) {
      if (absYuan > match.maxPrice) return false;
    } else if (signedYuan > match.maxPrice) {
      return false;
    }
  }
  if (typeof match.price === "number" && match.price !== 0) {
    const target = Math.abs(match.price);
    if (Math.abs(absYuan - target) > 0.01) return false;
  }

  // 时间 HH:MM-HH:MM（字段 timeRange 或 time 兼容）
  const timeRange = match.timeRange || (match as any).time;
  if (timeRange && !matchTimeRange(entry.time, timeRange)) return false;

  // 时间戳范围 ts1-ts2（可选）
  if (match.timestampRange) {
    const parts = match.timestampRange.split("-");
    if (parts.length === 2) {
      const ts = entry.timestamp || 0;
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      if (!ts || ts < a || ts > b) return false;
    }
  }

  // 平台专属（有配置才校验）
  if (match.tradeNo && !matchField(entryField(entry, "tradeNo"), match.tradeNo, fullMatch, sep)) {
    return false;
  }
  if (match.orderNo && !matchField(entryField(entry, "orderNo"), match.orderNo, fullMatch, sep)) {
    return false;
  }
  if (
    match.transactionId &&
    !matchField(entryField(entry, "transactionId"), match.transactionId, fullMatch, sep)
  ) {
    return false;
  }
  if (
    match.merchantId &&
    !matchField(entryField(entry, "merchantId"), match.merchantId, fullMatch, sep)
  ) {
    return false;
  }
  if (
    match.transactionCode &&
    !matchField(entryField(entry, "transactionCode"), match.transactionCode, fullMatch, sep)
  ) {
    return false;
  }
  if (
    match.branchCode &&
    !matchField(entryField(entry, "branchCode"), match.branchCode, fullMatch, sep)
  ) {
    return false;
  }
  if (match.asset && !matchField(entryField(entry, "asset"), match.asset, fullMatch, sep)) {
    return false;
  }
  if (match.side && !matchField(entryField(entry, "side"), match.side, fullMatch, sep)) {
    return false;
  }

  // 至少有一项有效条件，否则空规则不匹配
  if (
    !hasBasic &&
    !match.minPrice &&
    !match.maxPrice &&
    !match.price &&
    !timeRange &&
    !match.timestampRange &&
    !match.tradeNo &&
    !match.orderNo &&
    !match.transactionId &&
    !match.merchantId &&
    !match.transactionCode &&
    !match.branchCode &&
    !match.asset &&
    !match.side
  ) {
    return false;
  }

  return true;
}

export interface RuleEvalResult {
  ignore: boolean;
  targetAccountId: string | null;
  methodAccountId: string | null;
  tags: string[];
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  confidence: number;
}

export function evaluateRules(
  entry: ImportEntry,
  rules: ImportRuleRow[],
  defaults: {
    expenseAccountId?: string;
    incomeAccountId?: string;
    assetAccountId?: string;
  },
  /** 仅使用这些规则 id；空/不传 = 全部启用规则 */
  selectedRuleIds?: string[] | null,
): RuleEvalResult {
  const selected =
    selectedRuleIds && selectedRuleIds.length && !selectedRuleIds.includes("ALL")
      ? new Set(selectedRuleIds)
      : null;

  // 调用方已按 priority DESC, updatedAt DESC 排序 → 首个命中即用（高优先）
  let matched: ImportRuleRow | null = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (selected && !selected.has(rule.id)) continue;
    let match: ImportRuleMatch = {};
    try {
      match = JSON.parse(rule.matchJson || "{}");
    } catch {
      continue;
    }
    if (matchRule(entry, match)) {
      matched = rule;
      break;
    }
  }

  let action: ImportRuleAction = {};
  if (matched) {
    try {
      action = JSON.parse(matched.actionJson || "{}");
    } catch {
      action = {};
    }
  }

  if (action.ignore) {
    return {
      ignore: true,
      targetAccountId: null,
      methodAccountId: null,
      tags: action.tags || [],
      matchedRuleId: matched?.id || null,
      matchedRuleName: matched?.name || null,
      confidence: 1,
    };
  }

  let targetAccountId = action.targetAccountId || null;
  let methodAccountId = action.methodAccountId || null;

  // 收入用 defaultPlus，支出用 defaultMinus
  if (!targetAccountId) {
    if (entry.direction === "in" || entry.amountMinor > 0) {
      targetAccountId = action.defaultPlusAccountId || defaults.incomeAccountId || null;
    } else {
      targetAccountId = action.defaultMinusAccountId || defaults.expenseAccountId || null;
    }
  }

  // 支付方式多映射
  if (entry.method && action.methodMappings?.length) {
    for (const m of action.methodMappings) {
      if (entry.method.includes(m.method)) {
        methodAccountId = m.accountId;
        break;
      }
    }
  }
  if (!methodAccountId) {
    methodAccountId = defaults.assetAccountId || null;
  }

  const confidence = matched
    ? targetAccountId && methodAccountId
      ? 0.95
      : 0.65
    : targetAccountId && methodAccountId
      ? 0.4
      : 0.15;

  return {
    ignore: false,
    targetAccountId,
    methodAccountId,
    tags: action.tags || [],
    matchedRuleId: matched?.id || null,
    matchedRuleName: matched?.name || null,
    confidence,
  };
}

/** 将 beancount-web 扁平表单拆成 match + action */
export function splitRuleBody(body: Record<string, any>): {
  name: string;
  priority: number;
  enabled: boolean;
  match: ImportRuleMatch;
  action: ImportRuleAction;
} {
  // 已是嵌套结构
  if (body.match || body.action) {
    return {
      name: String(body.name || "").trim(),
      priority: Number(body.priority ?? 0),
      enabled: body.enabled !== false && body.enabled !== 0,
      match: (body.match || {}) as ImportRuleMatch,
      action: (body.action || {}) as ImportRuleAction,
    };
  }

  // 匹配标签：扁平字段 matchTags；兼容 match.tags / tagsMatch
  let matchTagsStr: string | undefined;
  if (typeof body.matchTags === "string" && body.matchTags.trim()) {
    matchTagsStr = body.matchTags.trim();
  } else if (Array.isArray(body.matchTags) && body.matchTags.length) {
    matchTagsStr = body.matchTags.map(String).filter(Boolean).join(body.separator || ",");
  } else if (typeof body.tagsMatch === "string" && body.tagsMatch.trim()) {
    matchTagsStr = body.tagsMatch.trim();
  }

  const match: ImportRuleMatch = {
    peer: body.peer || undefined,
    type: body.type || undefined,
    item: body.item || undefined,
    category: body.category || undefined,
    method: body.method || undefined,
    tags: matchTagsStr,
    fullMatch: !!body.fullMatch,
    separator: body.separator || ",",
    logic: body.logic === "OR" ? "OR" : "AND",
    minPrice: body.minPrice != null && body.minPrice !== "" ? Number(body.minPrice) : undefined,
    maxPrice: body.maxPrice != null && body.maxPrice !== "" ? Number(body.maxPrice) : undefined,
    price: body.price != null && body.price !== "" ? Number(body.price) : undefined,
    timeRange: body.time || body.timeRange || undefined,
    timestampRange: body.timestampRange || undefined,
    tradeNo: body.tradeNo || undefined,
    orderNo: body.orderNo || undefined,
    transactionId: body.transactionId || undefined,
    merchantId: body.merchantId || undefined,
    transactionCode: body.transactionCode || undefined,
    branchCode: body.branchCode || undefined,
    asset: body.asset || undefined,
    side: body.side || undefined,
  };

  const action: ImportRuleAction = {
    ignore: !!body.ignore,
    targetAccountId: body.targetAccountId || body.targetAccount || undefined,
    methodAccountId: body.methodAccountId || body.methodAccount || undefined,
    defaultPlusAccountId: body.defaultPlusAccountId || body.defaultPlusAccount || undefined,
    defaultMinusAccountId: body.defaultMinusAccountId || body.defaultMinusAccount || undefined,
    // 动作标签（命中后写入）；与 match.tags 区分
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    methodMappings: Array.isArray(body.methodMappings)
      ? body.methodMappings.map((m: any) => ({
          method: String(m.method || ""),
          accountId: String(m.accountId || m.account || ""),
        }))
      : undefined,
  };

  return {
    name: String(body.name || "").trim(),
    priority: Number(body.priority ?? 0),
    enabled: body.enabled !== false && body.enabled !== 0,
    match,
    action,
  };
}

/** 展平规则供前端编辑（对齐 beancount-web form 字段） */
export function flattenRule(row: ImportRuleRow): Record<string, any> {
  let match: ImportRuleMatch = {};
  let action: ImportRuleAction = {};
  try {
    match = JSON.parse(row.matchJson || "{}");
  } catch {
    /* */
  }
  try {
    action = JSON.parse(row.actionJson || "{}");
  } catch {
    /* */
  }
  return {
    id: row.id,
    name: row.name,
    priority: row.priority,
    enabled: !!row.enabled,
    peer: match.peer || "",
    type: match.type || "",
    item: match.item || "",
    category: match.category || "",
    method: match.method || "",
    matchTags: match.tags || "",
    fullMatch: !!match.fullMatch,
    separator: match.separator || ",",
    logic: match.logic || "AND",
    minPrice: match.minPrice ?? undefined,
    maxPrice: match.maxPrice ?? undefined,
    price: match.price ?? undefined,
    time: match.timeRange || "",
    timestampRange: match.timestampRange || "",
    tradeNo: match.tradeNo || "",
    orderNo: match.orderNo || "",
    transactionId: match.transactionId || "",
    merchantId: match.merchantId || "",
    transactionCode: match.transactionCode || "",
    branchCode: match.branchCode || "",
    asset: match.asset || "",
    side: match.side || "",
    targetAccountId: action.targetAccountId || "",
    methodAccountId: action.methodAccountId || "",
    defaultPlusAccountId: action.defaultPlusAccountId || "",
    defaultMinusAccountId: action.defaultMinusAccountId || "",
    methodMappings: action.methodMappings || [],
    tags: action.tags || [],
    ignore: !!action.ignore,
    match,
    action,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
