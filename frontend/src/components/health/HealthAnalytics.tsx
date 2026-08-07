/**
 * 健康档案复盘统计
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Info,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
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
import { api } from "@/lib/api";
import type { HealthInsight, HealthMember } from "@/types";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import MobileChromeHeader from "@/components/common/MobileChromeHeader";
import PageHeader from "@/components/layout/PageHeader";
import ContentCanvas from "@/components/layout/ContentCanvas";
import { EmptyState, LoadingBlock, ErrorBanner } from "@/components/common/FeedbackStates";
import { Button } from "@/components/ui/button";

const PIE_COLORS = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#f43f5e",
  "#8b5cf6",
  "#84cc16",
];

const TYPE_LABEL: Record<string, string> = {
  visit: "门诊",
  hospitalization: "住院",
  surgery: "手术",
  infusion: "输液",
  checkup: "体检",
  medication: "用药",
  emergency: "急诊",
  other: "其他",
};

type Period = "month" | "year" | "custom";

export default function HealthAnalytics({
  workspaceId,
  memberId,
  members,
  onBack,
}: {
  workspaceId: string;
  memberId: string | null;
  members: HealthMember[];
  onBack: () => void;
}) {
  const [period, setPeriod] = useState<Period>("month");
  const [filterMember, setFilterMember] = useState<string | null>(memberId);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const params = useMemo(() => {
    const p: Record<string, string> = {
      workspaceId,
      period: period === "custom" ? "custom" : period,
    };
    if (filterMember) p.memberId = filterMember;
    if (period === "custom") {
      if (customFrom) p.from = customFrom;
      if (customTo) p.to = customTo;
    }
    return p as {
      workspaceId: string;
      memberId?: string;
      period?: string;
      from?: string;
      to?: string;
    };
  }, [workspaceId, period, filterMember, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setAiText(null);
    try {
      const res = await api.health.getAnalytics(params);
      setData(res);
    } catch (e: any) {
      setError(e?.message || "加载失败");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, params]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAi = async () => {
    setAiLoading(true);
    try {
      const r = await api.health.getAnalyticsAdvice(params);
      if (r.aiText) {
        setAiText(r.aiText);
        toast.success("AI 建议已生成");
      } else {
        toast.error(r.message || "未能生成 AI 建议");
      }
    } catch (e: any) {
      toast.error(e?.message || "AI 调用失败");
    } finally {
      setAiLoading(false);
    }
  };

  const handleExport = async (withAi: boolean) => {
    setExporting(true);
    try {
      if (withAi) {
        const r = await api.health.getAnalyticsAdvice(params, { includeReport: true });
        if (r.aiText) setAiText(r.aiText);
        const md =
          r.markdown ||
          (await api.health.getAnalyticsReport(params)).markdown;
        downloadMd(md, `health-review-${params.period || "period"}.md`);
        toast.success(r.aiText ? "已导出含 AI 建议的报告" : "已导出报告");
      } else {
        const r = await api.health.getAnalyticsReport(params);
        downloadMd(r.markdown, r.filename);
        toast.success("报告已导出");
      }
    } catch (e: any) {
      toast.error(e?.message || "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const k = data?.kpis?.current;
  const typeChart = (data?.byType || []).map((t: any) => ({
    name: TYPE_LABEL[t.recordType] || t.recordType,
    value: t.count,
  }));
  const memberChart = (data?.byMember || []).map((m: any) => ({
    name: m.displayName,
    count: m.count,
  }));

  const mat =
    "bg-app-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-app-bg/70";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-app-bg">
      <div className="md:hidden">
        <MobileChromeHeader
          title="健康复盘"
          variant="stack"
          onLeadingClick={onBack}
          className={mat}
        />
      </div>
      <div className="hidden md:block">
        <PageHeader
          title="健康复盘"
          subtitle="统计 · 规则洞察 · AI 建议（非医疗诊断）"
          className={mat}
          leading={
            <button
              type="button"
              onClick={onBack}
              className="min-h-11 min-w-11 inline-flex items-center justify-center rounded-button text-tx-secondary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover"
              aria-label="返回"
            >
              <ArrowLeft size={18} />
            </button>
          }
          actions={
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="min-h-11"
                disabled={exporting}
                onClick={() => handleExport(false)}
              >
                <Download size={16} className="mr-1" />
                导出
              </Button>
              <Button
                size="sm"
                className="min-h-11"
                disabled={aiLoading}
                onClick={handleAi}
              >
                {aiLoading ? (
                  <Loader2 size={16} className="animate-spin mr-1" />
                ) : (
                  <Sparkles size={16} className="mr-1" />
                )}
                AI 建议
              </Button>
            </div>
          }
        />
      </div>

      <ContentCanvas
        maxWidthClass="max-w-5xl"
        className="flex flex-col gap-6 pb-24"
      >
        {/* 筛选工具条 */}
        <div className="rounded-card border border-app-border bg-app-surface p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            {(["month", "year", "custom"] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={cn(
                  "min-h-11 px-3 rounded-button text-xs font-medium",
                  "transition-[background-color,color,transform] duration-fast ease-out active:scale-[0.97]",
                  period === p
                    ? "bg-accent-primary text-white shadow-accent"
                    : "bg-app-elevated border border-app-border text-tx-secondary [@media(hover:hover)_and_(pointer:fine)]:hover:bg-app-hover",
                )}
              >
                {p === "month" ? "本月" : p === "year" ? "本年" : "自定义"}
              </button>
            ))}
            <select
              className="min-h-11 rounded-button border border-app-border bg-app-bg text-tx-primary px-3 text-sm"
              value={filterMember || ""}
              onChange={(e) => setFilterMember(e.target.value || null)}
            >
              <option value="">全部成员</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 min-w-11"
              onClick={load}
              aria-label="刷新"
            >
              <RefreshCw size={16} />
            </Button>
          </div>

          {period === "custom" && (
            <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-app-border">
              <input
                type="date"
                className="min-h-11 rounded-button border border-app-border px-3 text-sm bg-app-bg text-tx-primary"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
              <span className="text-tx-tertiary text-xs">至</span>
              <input
                type="date"
                className="min-h-11 rounded-button border border-app-border px-3 text-sm bg-app-bg text-tx-primary"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="md:hidden flex gap-3">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1 min-h-11"
            disabled={exporting}
            onClick={() => handleExport(true)}
          >
            导出报告
          </Button>
          <Button size="sm" className="flex-1 min-h-11" disabled={aiLoading} onClick={handleAi}>
            AI 建议
          </Button>
        </div>

        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading ? (
          <LoadingBlock label="统计中…" />
        ) : !data ? (
          <EmptyState title="暂无数据" description="录入病历后可查看复盘。" />
        ) : (
          <>
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-tx-primary">概览</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <KpiCard label="记录数" value={k?.total ?? 0} />
                <KpiCard label="西医" value={k?.western ?? 0} />
                <KpiCard label="中医" value={k?.tcm ?? 0} />
                <KpiCard label="进行中" value={k?.ongoing ?? 0} warn={(k?.ongoing ?? 0) > 0} />
                <KpiCard
                  label="登记费用"
                  value={
                    k?.costSumMinor
                      ? `¥${(k.costSumMinor / 100).toFixed(0)}`
                      : "—"
                  }
                />
                <KpiCard label="涉及成员" value={k?.memberCount ?? 0} />
                <KpiCard label="中西医结合" value={k?.integrated ?? 0} />
                <KpiCard label="已痊愈" value={k?.recovered ?? 0} />
              </div>
            </section>

            {(typeChart.length > 0 || memberChart.length > 0) && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-tx-primary">分布</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  {typeChart.length > 0 && (
                    <div className="rounded-card border border-app-border bg-app-surface p-4 h-60">
                      <div className="text-sm font-medium text-tx-secondary mb-3">类型分布</div>
                      <ResponsiveContainer width="100%" height="85%">
                        <PieChart>
                          <Pie data={typeChart} dataKey="value" nameKey="name" outerRadius={70} label>
                            {typeChart.map((_: any, i: number) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={{
                              background: "var(--color-elevated, #fffaf2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: 8,
                              color: "var(--color-text-primary)",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {memberChart.length > 0 && (
                    <div className="rounded-card border border-app-border bg-app-surface p-4 h-60">
                      <div className="text-sm font-medium text-tx-secondary mb-3">成员记录</div>
                      <ResponsiveContainer width="100%" height="85%">
                        <BarChart data={memberChart}>
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                          />
                          <YAxis
                            allowDecimals={false}
                            width={28}
                            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
                          />
                          <Tooltip
                            contentStyle={{
                              background: "var(--color-elevated, #fffaf2)",
                              border: "1px solid var(--color-border)",
                              borderRadius: 8,
                              color: "var(--color-text-primary)",
                            }}
                          />
                          <Bar dataKey="count" fill="#6366f1" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-tx-primary flex items-center gap-1.5">
                <Lightbulb size={16} className="text-accent-primary" />
                规则洞察
              </h3>
              <ul className="space-y-3">
                {(data.insights as HealthInsight[]).map((ins) => (
                  <li
                    key={ins.id}
                    className="rounded-card border border-app-border bg-app-surface p-4"
                  >
                    <div className="flex items-start gap-3">
                      <SeverityIcon severity={ins.severity} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-tx-primary">{ins.title}</div>
                        <div className="text-xs text-tx-secondary mt-1 leading-relaxed">
                          {ins.detail}
                        </div>
                        {ins.actionHint && (
                          <div className="text-[11px] text-tx-tertiary mt-2 leading-relaxed">
                            {ins.actionHint}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {aiText && (
              <section className="rounded-card border border-accent-primary/30 bg-accent-primary/5 p-4 space-y-2">
                <h3 className="text-sm font-semibold flex items-center gap-1.5 text-tx-primary">
                  <Sparkles size={16} className="text-accent-primary" />
                  AI 建议
                </h3>
                <div className="text-sm text-tx-secondary whitespace-pre-wrap leading-relaxed">
                  {aiText}
                </div>
                <p className="text-[10px] text-tx-tertiary">
                  以上为档案管理辅助建议，不能替代执业医师诊断。
                </p>
              </section>
            )}

            {(data.openLists?.ongoing || []).length > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-tx-primary">进行中</h3>
                <ul className="space-y-2">
                  {data.openLists.ongoing.map((r: any) => (
                    <li
                      key={r.id}
                      className="text-sm rounded-card border border-app-border bg-app-surface px-4 py-3 min-h-12 flex items-center justify-between gap-3"
                    >
                      <span className="text-tx-primary min-w-0 truncate">
                        {r.memberName} · {r.title}
                      </span>
                      <span className="text-xs text-tx-tertiary shrink-0 tabular-nums">
                        {r.occurredAt}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </ContentCanvas>
    </div>
  );
}

function KpiCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-card border border-app-border bg-app-surface p-4 min-h-[88px]">
      <div className="text-xs text-tx-tertiary">{label}</div>
      <div
        className={cn(
          "text-2xl font-semibold mt-2 tabular-nums tracking-tight",
          warn ? "text-accent-warning" : "text-tx-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "warn")
    return <AlertTriangle size={16} className="text-accent-warning shrink-0 mt-0.5" />;
  if (severity === "good")
    return <CheckCircle2 size={16} className="text-accent-primary shrink-0 mt-0.5" />;
  return <Info size={16} className="text-tx-secondary shrink-0 mt-0.5" />;
}

function downloadMd(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
