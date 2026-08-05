/**
 * 任务复盘统计看板
 * 复盘 · 事务分类（合并入口）
 * KPI 默认 3 张核心卡 + 展开详细
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Inbox,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Tags,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { api, getCurrentWorkspace } from "@/lib/api";
import { cn } from "@/lib/utils";
import PageHeader from "@/components/layout/PageHeader";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingBlock } from "@/components/common/FeedbackStates";
import { toast } from "@/lib/toast";
import { Motion } from "@/components/common/Motion";
import { springs } from "@/lib/motion";

const TaskCategoryManager = React.lazy(() => import("./TaskCategoryManager"));

type Panel = "review" | "categories";

function readInitialPanel(): Panel {
  try {
    const p = sessionStorage.getItem("super-analytics-panel");
    if (p === "categories") {
      sessionStorage.removeItem("super-analytics-panel");
      return "categories";
    }
  } catch {
    /* ignore */
  }
  return "review";
}

const PIE_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#f43f5e",
  "#8b5cf6",
  "#84cc16",
  "#64748b",
];

type Period = "today" | "week" | "month";
type Scope = "self" | "workspace";

function pct(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function fmtDelta(d: number | null | undefined) {
  if (d == null || Number.isNaN(d)) return null;
  const sign = d > 0 ? "+" : "";
  return `${sign}${Math.round(d * 100)}%`;
}

function fmtMins(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 60) return `${m} 分`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 48) return r ? `${h}h ${r}m` : `${h}h`;
  return `${Math.floor(h / 24)} 天`;
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  const label = fmtDelta(value);
  if (!label) return <span className="text-[10px] text-tx-tertiary">vs 上期 —</span>;
  const up = (value || 0) > 0;
  const down = (value || 0) < 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-[10px] font-semibold",
        up && "text-amber-600 dark:text-amber-400",
        down && "text-emerald-600 dark:text-emerald-400",
        !up && !down && "text-tx-tertiary",
      )}
    >
      {up ? <TrendingUp size={10} /> : down ? <TrendingDown size={10} /> : null}
      {label}
    </span>
  );
}

export default function TaskAnalytics() {
  const [workspaceId, setWorkspaceId] = useState(() => getCurrentWorkspace());
  const isFamily = !!(workspaceId && workspaceId !== "personal" && workspaceId !== "");

  const [panel, setPanel] = useState<Panel>(readInitialPanel);
  const [period, setPeriod] = useState<Period>("week");
  const [scope, setScope] = useState<Scope>("self");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [listTab, setListTab] = useState<"overdue" | "unscheduled" | "uncategorized">("unscheduled");
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 导出周报时是否附带 AI 润色（嵌入能力，非第三按钮） */
  const [exportWithAi, setExportWithAi] = useState(false);
  /** KPI：默认 3 张核心，展开看全部 */
  const [kpiExpanded, setKpiExpanded] = useState(false);

  useEffect(() => {
    const onPanel = (e: Event) => {
      const detail = (e as CustomEvent<{ panel?: Panel }>).detail;
      if (detail?.panel === "categories" || detail?.panel === "review") {
        setPanel(detail.panel);
      }
    };
    window.addEventListener("super:analytics-panel", onPanel);
    return () => window.removeEventListener("super:analytics-panel", onPanel);
  }, []);

  useEffect(() => {
    const onWs = (e: Event) => {
      const custom = e as CustomEvent<{ workspaceId?: string }>;
      setWorkspaceId(custom.detail?.workspaceId || getCurrentWorkspace());
    };
    window.addEventListener("super:workspace-changed", onWs);
    return () => window.removeEventListener("super:workspace-changed", onWs);
  }, []);

  const analyticsParams = useMemo(
    () => ({
      workspaceId: workspaceId || null,
      scope: (isFamily ? scope : "self") as Scope,
      period,
      weekStartsOn: 1 as const,
    }),
    [workspaceId, isFamily, scope, period],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAiText(null);
    try {
      const res = await api.getTaskAnalytics(analyticsParams);
      setData(res);
    } catch (e: any) {
      setError(e?.message || "加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [analyticsParams]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApplyPreset = async () => {
    setApplying(true);
    try {
      const r = await api.applyTaskCategoryPreset(workspaceId || null);
      toast.success(`已导入分类（新建 ${r.created}，更新 ${r.updated}）`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "导入失败");
    } finally {
      setApplying(false);
    }
  };

  const downloadMarkdown = (markdown: string, filename: string) => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportReport = async (withAi: boolean) => {
    setExporting(true);
    try {
      if (withAi) {
        const r = await api.getTaskAnalyticsAdvice(analyticsParams, { includeReport: true });
        if (r.aiText) setAiText(r.aiText);
        if (r.message && !r.aiText) toast.error(r.message);
        const md =
          r.markdown ||
          (await api.getTaskAnalyticsReport(analyticsParams)).markdown;
        const from = data?.range?.from || "period";
        const to = data?.range?.to || "";
        downloadMarkdown(md, `task-review-${from}_${to}.md`);
        toast.success(r.aiText ? "已导出含 AI 建议的报告" : "已导出报告（无 AI 段落）");
      } else {
        const r = await api.getTaskAnalyticsReport(analyticsParams);
        downloadMarkdown(r.markdown, r.filename);
        toast.success("周报已导出");
      }
    } catch (e: any) {
      toast.error(e?.message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleAiAdvice = async () => {
    setAiLoading(true);
    try {
      const r = await api.getTaskAnalyticsAdvice(analyticsParams);
      if (r.aiText) {
        setAiText(r.aiText);
        toast.success("AI 建议已生成");
      } else {
        setAiText(null);
        toast.error(r.message || "未能生成 AI 建议");
      }
    } catch (e: any) {
      toast.error(e?.message || "AI 调用失败");
    } finally {
      setAiLoading(false);
    }
  };

  const kpis = data?.kpis?.current;
  const deltas = data?.kpis?.deltas;
  const rootCats = data?.categories?.root || [];
  const members = data?.members || [];
  const weekdays = data?.weekdays || [];
  const insights = data?.insights || [];
  const openLists = data?.openLists || { overdue: [], unscheduled: [], uncategorized: [] };

  const pieData = useMemo(
    () =>
      rootCats
        .filter((c: any) => c.completed > 0)
        .map((c: any) => ({ name: c.name, value: c.completed, code: c.code })),
    [rootCats],
  );

  const listItems =
    listTab === "overdue"
      ? openLists.overdue
      : listTab === "uncategorized"
        ? openLists.uncategorized
        : openLists.unscheduled;

  const uncategorizedCount = openLists.uncategorized?.length ?? 0;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden bg-app-bg">
      <MobileChromeHeader
        variant="bare"
        title="任务复盘"
        right={
          panel === "review" ? (
            <button
              type="button"
              onClick={load}
              className="p-2 rounded-button text-tx-secondary active:scale-[0.97] transition-transform duration-press ease-out min-w-11 min-h-11 inline-flex items-center justify-center"
              aria-label="刷新"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          ) : null
        }
      />
      <PageHeader
        mdOnly
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-card bg-accent-primary flex items-center justify-center shadow-accent">
              <BarChart3 size={18} className="text-white" />
            </span>
            <span>
              <span className="block tracking-tight">任务复盘</span>
              <span className="block text-xs font-normal text-tx-tertiary mt-0.5">
                看见完成结构 · 管好事务分类
              </span>
            </span>
          </span>
        }
        actions={
          panel === "review" ? (
            <Button variant="ghost" size="sm" onClick={load} className="gap-1.5">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              刷新
            </Button>
          ) : null
        }
      />

      {/* 复盘 | 分类 — 合并入口 */}
      <div className="px-3 md:px-6 pt-2 md:pt-3 shrink-0">
        <div className="flex items-center bg-app-hover/50 p-0.5 rounded-button border border-app-border/40 text-xs font-semibold w-full max-w-5xl mx-auto">
          {(
            [
              { id: "review" as const, icon: BarChart3, label: "复盘" },
              { id: "categories" as const, icon: Tags, label: "事务分类" },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = panel === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  "relative flex-1 px-3 py-2 min-h-11 rounded-md flex items-center justify-center gap-1.5 z-0",
                  "transition-colors duration-fast ease-out",
                  active ? "text-tx-primary" : "text-tx-secondary hover:text-tx-primary",
                )}
                onClick={() => setPanel(tab.id)}
              >
                {active && (
                  <Motion.div
                    layoutId="task-analytics-panel"
                    className="absolute inset-0 rounded-md bg-app-bg shadow-sm -z-10"
                    transition={springs.snappy}
                  />
                )}
                <Icon size={14} className="relative z-10" />
                <span className="relative z-10">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-5 pb-24 md:pb-12">
          {panel === "categories" ? (
            <React.Suspense fallback={<LoadingBlock label="加载分类…" className="py-16" />}>
              <TaskCategoryManager embedded />
            </React.Suspense>
          ) : (
            <>
          {/* 筛选 */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-xl border border-app-border/50 bg-app-elevated p-0.5">
              {(
                [
                  ["today", "今日"],
                  ["week", "本周"],
                  ["month", "本月"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPeriod(k)}
                  className={cn(
                    "px-3 py-1.5 min-h-9 rounded-lg text-xs font-semibold transition-colors duration-fast ease-out active:scale-[0.97]",
                    period === k
                      ? "bg-accent-primary text-white"
                      : "text-tx-secondary hover:bg-app-hover",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {isFamily && (
              <div className="flex rounded-xl border border-app-border/50 bg-app-elevated p-0.5">
                {(
                  [
                    ["self", "我的"],
                    ["workspace", "全家"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setScope(k)}
                    className={cn(
                      "px-3 py-1.5 min-h-9 rounded-lg text-xs font-semibold transition-colors duration-fast ease-out inline-flex items-center gap-1 active:scale-[0.97]",
                      scope === k
                        ? "bg-accent-primary text-white"
                        : "text-tx-secondary hover:bg-app-hover",
                    )}
                  >
                    {k === "workspace" ? <Users size={12} /> : null}
                    {label}
                  </button>
                ))}
              </div>
            )}
            {data?.range && (
              <span className="text-[11px] text-tx-tertiary ml-auto">
                {data.range.from} → {data.range.to}
                <span className="opacity-60"> · 对比 {data.range.prevFrom}→{data.range.prevTo}</span>
              </span>
            )}
          </div>

          {/* 分类预设 */}
          {(data?.taxonomyCount === 0 || !data) && !loading && (
            <div className="rounded-xl border border-dashed border-accent-primary/40 bg-accent-primary/5 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-tx-primary flex items-center gap-1.5">
                  <Tags size={16} className="text-accent-primary" />
                  启用家庭事务分类
                </div>
                <p className="text-xs text-tx-tertiary mt-1">
                  导入 6 大类（个人 / 夫妻 / 育儿大宝·二宝 / 家务 / 车辆 / 临时）后，统计才能按事务结构复盘。
                </p>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button onClick={handleApplyPreset} disabled={applying} className="gap-1.5">
                  {applying ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  一键导入预设
                </Button>
                <Button variant="outline" onClick={() => setPanel("categories")} className="gap-1.5">
                  管理分类
                </Button>
              </div>
            </div>
          )}

          {loading && !data ? (
            <LoadingBlock label="加载复盘数据…" className="py-16" />
          ) : error ? (
            <EmptyState
              icon={AlertTriangle}
              title="统计加载失败"
              description={error}
              action={
                <Button onClick={load} variant="outline" size="sm">
                  重试
                </Button>
              }
            />
          ) : (
            <>
              {!data?.hasActiveTime && (
                <p className="text-[11px] text-tx-tertiary bg-app-elevated border border-app-border/40 rounded-lg px-3 py-2">
                  尚未记录「开始→完成」的处理时长，以下以<strong className="text-tx-secondary">完成数量</strong>与中位完成耗时为主。对任务点「开始」可积累实际投入时间。
                </p>
              )}

              {/* KPI：默认 完成 / 未安排 / 未归类，展开其余 */}
              <div>
                <div className="grid grid-cols-3 gap-2.5">
                  <KpiCard
                    label="完成"
                    value={String(kpis?.completed ?? 0)}
                    delta={deltas?.completed}
                    icon={<CheckCircle2 size={14} className="text-emerald-500" />}
                    emphasis
                  />
                  <KpiCard
                    label="未安排"
                    value={String(kpis?.unscheduledOpen ?? 0)}
                    delta={deltas?.unscheduledOpen}
                    invertDelta
                    icon={<Inbox size={14} className="text-sky-500" />}
                    emphasis
                  />
                  <KpiCard
                    label="未归类"
                    value={String(uncategorizedCount)}
                    icon={<Tags size={14} className="text-amber-500" />}
                    emphasis
                  />
                </div>
                <Motion.div
                  initial={false}
                  animate={{ height: kpiExpanded ? "auto" : 0, opacity: kpiExpanded ? 1 : 0 }}
                  transition={springs.ui}
                  className="overflow-hidden"
                >
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-2.5">
                    <KpiCard
                      label="新创建"
                      value={String(kpis?.created ?? 0)}
                      delta={deltas?.created}
                    />
                    <KpiCard
                      label="完成率"
                      value={pct(kpis?.completionRate)}
                      delta={deltas?.completionRate}
                    />
                    <KpiCard
                      label="按时完成"
                      value={pct(kpis?.onTimeRate)}
                      delta={deltas?.onTimeRate}
                    />
                    <KpiCard
                      label="中位耗时"
                      value={fmtMins(kpis?.medianCycleMinutes)}
                      delta={deltas?.medianCycleMinutes}
                      icon={<Clock size={14} className="text-violet-500" />}
                    />
                  </div>
                </Motion.div>
                <button
                  type="button"
                  onClick={() => setKpiExpanded((v) => !v)}
                  className="mt-2 w-full flex items-center justify-center gap-1 py-2 min-h-11 text-[11px] font-semibold text-tx-tertiary hover:text-tx-secondary transition-colors duration-fast ease-out active:scale-[0.98]"
                >
                  <ChevronDown
                    size={14}
                    className={cn(
                      "transition-transform duration-fast ease-out",
                      kpiExpanded && "rotate-180",
                    )}
                  />
                  {kpiExpanded ? "收起详细指标" : "展开详细指标"}
                </button>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* 分类饼图 */}
                <section className="rounded-xl border border-app-border/40 bg-app-elevated p-4 shadow-xs">
                  <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider mb-3">
                    完成结构 · 大类
                  </h3>
                  {pieData.length === 0 ? (
                    <p className="text-xs text-tx-tertiary py-10 text-center">本期尚无完成任务</p>
                  ) : (
                    <div className="h-52">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={2}
                          >
                            {pieData.map((_: any, i: number) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: "var(--color-app-elevated, #fff)",
                              border: "1px solid var(--color-app-border, #e5e7eb)",
                              borderRadius: 8,
                              fontSize: 12,
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  <ul className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                    {rootCats.map((c: any, i: number) => (
                      <li key={c.categoryId || c.name} className="flex items-center gap-2 text-xs">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-tx-secondary">{c.name}</span>
                        <span className="font-mono text-tx-tertiary">{c.completed}</span>
                        <span className="w-10 text-right text-tx-tertiary">{pct(c.share)}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* 星期分布 */}
                <section className="rounded-xl border border-app-border/40 bg-app-elevated p-4 shadow-xs">
                  <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider mb-3">
                    完成 · 星期分布
                  </h3>
                  <div className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weekdays}>
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} width={28} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          contentStyle={{
                            background: "var(--color-app-elevated, #fff)",
                            border: "1px solid var(--color-app-border, #e5e7eb)",
                            borderRadius: 8,
                            fontSize: 12,
                          }}
                        />
                        <Bar dataKey="completed" name="完成" fill="#6366f1" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </section>
              </div>

              {/* 成员（家庭） */}
              {isFamily && scope === "workspace" && members.length > 0 && (
                <section className="rounded-xl border border-app-border/40 bg-app-elevated p-4 shadow-xs">
                  <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Users size={14} /> 成员完成量
                  </h3>
                  <div className="space-y-2">
                    {members.map((m: any) => {
                      const max = Math.max(...members.map((x: any) => x.completed), 1);
                      return (
                        <div key={m.userId || m.displayName} className="flex items-center gap-3 text-xs">
                          <span className="w-20 truncate font-medium text-tx-primary">{m.displayName}</span>
                          <div className="flex-1 h-2 rounded-full bg-app-hover overflow-hidden">
                            <div
                              className="h-full rounded-full bg-accent-primary/80"
                              style={{ width: `${(m.completed / max) * 100}%` }}
                            />
                          </div>
                          <span className="font-mono text-tx-tertiary w-8 text-right">{m.completed}</span>
                          <span className="w-10 text-right text-tx-tertiary">{pct(m.share)}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* 洞察 */}
              <section className="rounded-xl border border-app-border/40 bg-app-elevated p-4 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-tx-secondary uppercase tracking-wider flex items-center gap-1.5">
                    <Lightbulb size={14} className="text-amber-500" /> 反思建议
                  </h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-[11px]"
                      disabled={aiLoading || exporting}
                      onClick={handleAiAdvice}
                    >
                      {aiLoading ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Sparkles size={12} />
                      )}
                      AI 润色
                    </Button>
                    <label className="inline-flex items-center gap-1.5 h-8 px-2 rounded-button text-[11px] text-tx-tertiary cursor-pointer select-none hover:bg-app-hover transition-colors duration-fast ease-out">
                      <input
                        type="checkbox"
                        className="rounded border-app-border accent-[var(--color-accent-primary,#6366f1)]"
                        checked={exportWithAi}
                        onChange={(e) => setExportWithAi(e.target.checked)}
                        disabled={exporting || aiLoading}
                      />
                      导出含 AI
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-[11px]"
                      disabled={exporting || aiLoading}
                      onClick={() => handleExportReport(exportWithAi)}
                    >
                      {exporting ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      导出周报
                    </Button>
                  </div>
                </div>
                <ul className="space-y-2.5">
                  {insights.map((ins: any) => (
                    <li
                      key={ins.id}
                      className={cn(
                        "rounded-lg border px-3 py-2.5",
                        ins.severity === "warn" && "border-amber-500/30 bg-amber-500/5",
                        ins.severity === "good" && "border-emerald-500/30 bg-emerald-500/5",
                        ins.severity === "info" && "border-app-border/40 bg-app-sidebar/40",
                      )}
                    >
                      <div className="text-sm font-semibold text-tx-primary">{ins.title}</div>
                      <p className="text-xs text-tx-secondary mt-0.5 leading-relaxed">{ins.detail}</p>
                      {ins.actionHint && (
                        <p className="text-[11px] text-accent-primary mt-1.5 font-medium">→ {ins.actionHint}</p>
                      )}
                    </li>
                  ))}
                </ul>
                {aiText && (
                  <div className="rounded-lg border border-accent-primary/25 bg-accent-primary/5 px-3 py-2.5">
                    <div className="text-[11px] font-bold text-accent-primary uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <Sparkles size={12} /> AI 润色建议
                    </div>
                    <div className="text-sm text-tx-secondary whitespace-pre-wrap leading-relaxed">
                      {aiText}
                    </div>
                  </div>
                )}
              </section>

              {/* 积压列表 */}
              <section className="rounded-xl border border-app-border/40 bg-app-elevated overflow-hidden shadow-xs">
                <div className="flex border-b border-app-border/30">
                  {(
                    [
                      ["unscheduled", `未安排 (${openLists.unscheduled?.length || 0})`],
                      ["overdue", `逾期 (${openLists.overdue?.length || 0})`],
                      ["uncategorized", `未归类 (${openLists.uncategorized?.length || 0})`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setListTab(k)}
                      className={cn(
                        "flex-1 px-2 py-2.5 text-[11px] font-semibold transition-colors",
                        listTab === k
                          ? "text-accent-primary border-b-2 border-accent-primary bg-accent-primary/5"
                          : "text-tx-tertiary hover:bg-app-hover",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="divide-y divide-app-border/20 max-h-64 overflow-y-auto">
                  {listItems.length === 0 ? (
                    <p className="text-xs text-tx-tertiary text-center py-8">这一栏是空的 ✨</p>
                  ) : (
                    listItems.map((t: any) => (
                      <div key={t.id} className="px-3.5 py-2.5 flex items-start gap-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-tx-primary truncate">{t.title}</div>
                          <div className="text-tx-tertiary mt-0.5 truncate">
                            {t.projectName}
                            {t.endDate ? ` · 截止 ${String(t.endDate).slice(0, 10)}` : ""}
                            {t.assigneeName ? ` · ${t.assigneeName}` : ""}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>

              {data?.taxonomyCount > 0 && (
                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setPanel("categories")}
                    className="text-[11px] text-accent-primary font-medium active:scale-[0.97] transition-transform duration-press ease-out"
                  >
                    管理事务分类 →
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyPreset}
                    disabled={applying}
                    className="text-[11px] text-tx-tertiary hover:text-tx-secondary active:scale-[0.97] transition-[transform,color] duration-press ease-out"
                  >
                    重新同步分类预设
                  </button>
                </div>
              )}
            </>
          )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  delta,
  icon,
  invertDelta,
  emphasis,
}: {
  label: string;
  value: string;
  delta?: number | null;
  icon?: React.ReactNode;
  invertDelta?: boolean;
  emphasis?: boolean;
}) {
  const d = invertDelta && delta != null ? -delta : delta;
  return (
    <div
      className={cn(
        "rounded-xl border bg-app-elevated p-3 shadow-xs min-h-[76px]",
        emphasis
          ? "border-app-border/50 shadow-sm"
          : "border-app-border/40",
      )}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[10px] font-bold text-tx-tertiary uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <div
        className={cn(
          "font-bold text-tx-primary tabular-nums leading-tight tracking-tight",
          emphasis ? "text-xl" : "text-lg",
        )}
      >
        {value}
      </div>
      {delta !== undefined && (
        <div className="mt-0.5">
          <DeltaBadge value={d} />
        </div>
      )}
    </div>
  );
}
