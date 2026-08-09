/**
 * 健康档案复盘统计（规则洞察 + 可选 AI 在路由层润色）
 */
import type Database from "better-sqlite3";
import type { HealthRecordRow } from "./types.js";

export interface HealthAnalyticsQuery {
  workspaceId: string;
  memberId?: string | null;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export interface HealthInsight {
  id: string;
  severity: "info" | "warn" | "good";
  title: string;
  detail: string;
  actionHint?: string;
}

function inRange(d: string, from: string, to: string) {
  return d >= from && d <= to;
}

function loadRecords(db: Database.Database, workspaceId: string, memberId?: string | null) {
  if (memberId) {
    return db
      .prepare(
        `SELECT * FROM health_records WHERE workspaceId = ? AND memberId = ? AND isDeleted = 0`,
      )
      .all(workspaceId, memberId) as HealthRecordRow[];
  }
  return db
    .prepare(`SELECT * FROM health_records WHERE workspaceId = ? AND isDeleted = 0`)
    .all(workspaceId) as HealthRecordRow[];
}

function loadMemberNames(db: Database.Database, workspaceId: string) {
  const rows = db
    .prepare(`SELECT id, displayName FROM health_members WHERE workspaceId = ? AND isArchived = 0`)
    .all(workspaceId) as { id: string; displayName: string }[];
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.id, r.displayName);
  return map;
}

function kpisFor(rows: HealthRecordRow[]) {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byMedicine: Record<string, number> = {};
  const members = new Set<string>();
  let costSum = 0;
  let costCount = 0;
  for (const r of rows) {
    members.add(r.memberId);
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    byType[r.recordType] = (byType[r.recordType] || 0) + 1;
    const ms = r.medicineSystem || "unknown";
    byMedicine[ms] = (byMedicine[ms] || 0) + 1;
    if (r.costMinor != null && Number.isFinite(r.costMinor)) {
      costSum += r.costMinor;
      costCount++;
    }
  }
  return {
    total: rows.length,
    memberCount: members.size,
    ongoing: byStatus.ongoing || 0,
    recovered: byStatus.recovered || 0,
    chronic: byStatus.chronic || 0,
    western: byMedicine.western || 0,
    tcm: byMedicine.tcm || 0,
    integrated: byMedicine.integrated || 0,
    byType,
    byStatus,
    byMedicineSystem: byMedicine,
    costSumMinor: costSum,
    costCount,
  };
}

function deltaRatio(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return (cur - prev) / prev;
}

export function computeHealthAnalytics(db: Database.Database, q: HealthAnalyticsQuery) {
  const all = loadRecords(db, q.workspaceId, q.memberId);
  const names = loadMemberNames(db, q.workspaceId);

  const current = all.filter((r) => inRange(r.occurredAt, q.from, q.to));
  const previous = all.filter((r) => inRange(r.occurredAt, q.prevFrom, q.prevTo));

  const curK = kpisFor(current);
  const prevK = kpisFor(previous);

  // 成员分布
  const memberMap = new Map<string, number>();
  for (const r of current) {
    memberMap.set(r.memberId, (memberMap.get(r.memberId) || 0) + 1);
  }
  const byMember = [...memberMap.entries()]
    .map(([memberId, count]) => ({
      memberId,
      displayName: names.get(memberId) || "未知",
      count,
      share: curK.total ? count / curK.total : null,
    }))
    .sort((a, b) => b.count - a.count);

  // 医院 Top
  const hospitalMap = new Map<string, number>();
  for (const r of current) {
    const h = (r.hospital || "").trim() || "未填写医院";
    hospitalMap.set(h, (hospitalMap.get(h) || 0) + 1);
  }
  const byHospital = [...hospitalMap.entries()]
    .map(([hospital, count]) => ({ hospital, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // 按月
  const monthMap = new Map<string, number>();
  for (const r of current) {
    const m = r.occurredAt.slice(0, 7);
    monthMap.set(m, (monthMap.get(m) || 0) + 1);
  }
  const byMonth = [...monthMap.entries()]
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // 类型桶
  const byType = Object.entries(curK.byType)
    .map(([recordType, count]) => ({
      recordType,
      count,
      share: curK.total ? count / curK.total : null,
    }))
    .sort((a, b) => b.count - a.count);

  const byMedicineSystem = Object.entries(curK.byMedicineSystem || {})
    .map(([medicineSystem, count]) => ({
      medicineSystem,
      count,
      share: curK.total ? count / curK.total : null,
    }))
    .sort((a, b) => b.count - a.count);

  const insights = buildInsights(db, q, current, curK, prevK, byMember);

  const ongoingList = all
    .filter((r) => r.status === "ongoing")
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 20)
    .map((r) => ({
      id: r.id,
      title: r.title,
      memberId: r.memberId,
      memberName: names.get(r.memberId) || "未知",
      occurredAt: r.occurredAt,
      hospital: r.hospital,
      status: r.status,
    }));

  return {
    range: {
      from: q.from,
      to: q.to,
      prevFrom: q.prevFrom,
      prevTo: q.prevTo,
    },
    memberId: q.memberId || null,
    kpis: {
      current: curK,
      previous: prevK,
      deltas: {
        total: deltaRatio(curK.total, prevK.total),
        ongoing: deltaRatio(curK.ongoing, prevK.ongoing),
        costSumMinor: deltaRatio(curK.costSumMinor, prevK.costSumMinor),
      },
    },
    byType,
    byMedicineSystem,
    byMember,
    byHospital,
    byMonth,
    insights,
    openLists: {
      ongoing: ongoingList,
    },
  };
}

function buildInsights(
  db: Database.Database,
  q: HealthAnalyticsQuery,
  current: HealthRecordRow[],
  curK: ReturnType<typeof kpisFor>,
  prevK: ReturnType<typeof kpisFor>,
  byMember: Array<{ memberId: string; displayName: string; count: number }>,
): HealthInsight[] {
  const insights: HealthInsight[] = [];

  if (curK.total === 0) {
    insights.push({
      id: "empty",
      severity: "info",
      title: "本周期暂无病历记录",
      detail: "录入就诊与检查后，这里会汇总频次、费用与进行中事项。",
      actionHint: "可为家人创建成员并添加一条病历。",
    });
    return insights;
  }

  if (curK.ongoing > 0) {
    insights.push({
      id: "ongoing",
      severity: "warn",
      title: `${curK.ongoing} 条进行中的病历`,
      detail: "建议跟进症状变化与复查安排，痊愈后把状态改为「已痊愈」。",
      actionHint: "在时间轴中打开记录更新状态与阶段症状。",
    });
  }

  if (curK.chronic > 0) {
    insights.push({
      id: "chronic",
      severity: "info",
      title: `${curK.chronic} 条慢性/随访记录`,
      detail: "慢性病建议定期复查；可在病历本中单独归类便于跟踪。",
    });
  }

  if (curK.tcm > 0 && curK.western > 0) {
    insights.push({
      id: "dual-system",
      severity: "info",
      title: `本周期中医 ${curK.tcm} 次 · 西医 ${curK.western} 次`,
      detail:
        "家人同时看中西医时，建议在时间轴用体系筛选对照，复诊可带上双方病历与化验附件。中西药并用请遵医嘱。",
      actionHint: "记录时选择「中医/西医」标签，避免诊断混在同一字段。",
    });
  } else if (curK.tcm > 0 && curK.western === 0) {
    insights.push({
      id: "tcm-only",
      severity: "good",
      title: `本周期以中医记录为主（${curK.tcm} 次）`,
      detail: "可继续补充阶段症状与剂数变化，便于复诊对照方药。",
    });
  }

  // 短周期重复就诊（同成员 30 天内 ≥3 条）
  const byMid = new Map<string, HealthRecordRow[]>();
  for (const r of current) {
    const arr = byMid.get(r.memberId) || [];
    arr.push(r);
    byMid.set(r.memberId, arr);
  }
  for (const [mid, rows] of byMid) {
    if (rows.length >= 3) {
      const name =
        byMember.find((m) => m.memberId === mid)?.displayName || "成员";
      insights.push({
        id: `freq-${mid}`,
        severity: "warn",
        title: `${name} 本周期就诊较频繁（${rows.length} 次）`,
        detail: "可整理症状时间线，复诊时一并出示历史记录与检查附件。",
      });
    }
  }

  // 缺附件
  if (current.length) {
    const ids = current.map((r) => r.id);
    const placeholders = ids.map(() => "?").join(",");
    const withAtt = db
      .prepare(
        `SELECT DISTINCT recordId FROM health_attachments
         WHERE recordId IN (${placeholders})`,
      )
      .all(...ids) as { recordId: string }[];
    const has = new Set(withAtt.map((x) => x.recordId));
    const missing = current.filter((r) => !has.has(r.id)).length;
    if (missing > 0 && missing / current.length >= 0.5) {
      insights.push({
        id: "attachments",
        severity: "info",
        title: `${missing} 条记录尚无附件`,
        detail: "上传病历/发票/化验单并 OCR，可自动填充字段，也方便以后复查对照。",
        actionHint: "在病历详情中添加附件。",
      });
    }
  }

  if (prevK.total > 0 && curK.total > prevK.total * 1.5) {
    insights.push({
      id: "spike",
      severity: "warn",
      title: "本周期记录数明显高于上期",
      detail: `本期 ${curK.total} 条，上期 ${prevK.total} 条。关注是否有季节性高发或需要家庭护理支持。`,
    });
  } else if (curK.recovered > 0 && curK.recovered >= curK.total * 0.6) {
    insights.push({
      id: "recover-good",
      severity: "good",
      title: "多数记录已标记痊愈",
      detail: "保持附件与阶段症状完整，有助于下次类似情况快速对照。",
    });
  }

  if (curK.costSumMinor > 0) {
    const yuan = (curK.costSumMinor / 100).toFixed(0);
    insights.push({
      id: "cost",
      severity: "info",
      title: `本周期登记医疗费用约 ¥${yuan}`,
      detail:
        curK.costCount < curK.total
          ? "部分记录未填费用；发票 OCR 可自动填入金额。"
          : "可在复盘中按成员/医院对照开支。",
    });
  }

  if (insights.length === 0) {
    insights.push({
      id: "ok",
      severity: "good",
      title: "本周期记录平稳",
      detail: "继续按时间轴维护病历与附件即可。",
    });
  }

  return insights.slice(0, 8);
}

export function buildHealthAnalyticsMarkdown(
  data: ReturnType<typeof computeHealthAnalytics>,
  opts?: { aiText?: string | null },
): string {
  const k = data.kpis.current;
  const lines: string[] = [];
  lines.push(`# 家庭健康复盘报告`);
  lines.push(``);
  lines.push(`周期：${data.range.from} ~ ${data.range.to}`);
  lines.push(``);
  lines.push(`## 概览`);
  lines.push(`- 记录数：${k.total}`);
  lines.push(`- 涉及成员：${k.memberCount}`);
  lines.push(`- 进行中 / 已痊愈 / 慢性：${k.ongoing} / ${k.recovered} / ${k.chronic}`);
  lines.push(
    `- 西医 / 中医 / 结合：${k.western || 0} / ${k.tcm || 0} / ${k.integrated || 0}`,
  );
  if (k.costSumMinor > 0) {
    lines.push(`- 登记费用：¥${(k.costSumMinor / 100).toFixed(2)}（${k.costCount} 条含金额）`);
  }
  lines.push(``);
  lines.push(`## 医疗体系`);
  for (const t of data.byMedicineSystem || []) {
    lines.push(`- ${t.medicineSystem}: ${t.count}`);
  }
  lines.push(``);
  lines.push(`## 类型分布`);
  for (const t of data.byType) {
    lines.push(`- ${t.recordType}: ${t.count}`);
  }
  lines.push(``);
  lines.push(`## 成员分布`);
  for (const m of data.byMember) {
    lines.push(`- ${m.displayName}: ${m.count}`);
  }
  lines.push(``);
  lines.push(`## 规则洞察`);
  for (const i of data.insights) {
    lines.push(`- **[${i.severity}] ${i.title}**：${i.detail}`);
  }
  if (opts?.aiText) {
    lines.push(``);
    lines.push(`## AI 建议`);
    lines.push(``);
    lines.push(opts.aiText);
    lines.push(``);
    lines.push(`> 以上为辅助整理建议，不能替代执业医师诊断。`);
  }
  lines.push(``);
  lines.push(`_由 Super Note 健康档案复盘生成_`);
  return lines.join("\n");
}

/** 解析 period 快捷参数 */
export function resolveHealthPeriod(params: {
  period?: string;
  from?: string;
  to?: string;
}): { from: string; to: string; prevFrom: string; prevTo: string } {
  const today = new Date();
  const iso = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const addDays = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  };

  const period = params.period || "month";
  if (period === "custom" && params.from && params.to) {
    const from = params.from;
    const to = params.to;
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
    const prevTo = addDays(start, -1);
    const prevFrom = addDays(prevTo, -(days - 1));
    return { from, to, prevFrom: iso(prevFrom), prevTo: iso(prevTo) };
  }

  if (period === "year") {
    const y = today.getFullYear();
    const from = `${y}-01-01`;
    const to = iso(today);
    return {
      from,
      to,
      prevFrom: `${y - 1}-01-01`,
      prevTo: `${y - 1}-12-31`,
    };
  }

  // month default
  const y = today.getFullYear();
  const m = today.getMonth();
  const from = iso(new Date(y, m, 1));
  const to = iso(today);
  const prevFrom = iso(new Date(y, m - 1, 1));
  const prevTo = iso(addDays(new Date(y, m, 1), -1));
  return { from, to, prevFrom, prevTo };
}
