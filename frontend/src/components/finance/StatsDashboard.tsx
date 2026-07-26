/**
 * 统计看板
 * Phase1: 父级聚合饼图、环比 KPI、下钻明细
 * Phase2: 日趋势补 0、净资产图、商户下钻
 * Phase3: 支出结构、标签统计、预算进度、洞察摘要
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const PIE_COLORS = [
  "#10b981",
  "#f43f5e",
  "#8b5cf6",
  "#f59e0b",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
  "#6366f1",
  "#14b8a6",
  "#a855f7",
  "#64748b",
];

export type StatsDrillFilter = {
  from?: string;
  to?: string;
  accountId?: string;
  accountPrefix?: string;
  payee?: string;
  tag?: string;
  q?: string;
};

function yuan(minor: number | undefined | null) {
  if (minor == null) return "0.00";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

function accountShort(name: string) {
  const parts = name.split(":");
  return parts[parts.length - 1] || name;
}

/** 父级聚合：Expenses:Transportation:Car:Fuel → Expenses:Transportation */
function parentPath(name: string, depth = 2): string {
  const parts = (name || "").split(":").filter(Boolean);
  if (parts.length <= depth) return name;
  return parts.slice(0, depth).join(":");
}

function parentLabel(path: string): string {
  const map: Record<string, string> = {
    "Expenses:DailyLiving": "日常生活",
    "Expenses:Transportation": "交通出行",
    "Expenses:Family": "家庭",
    "Expenses:Insurance": "保险",
    "Expenses:Entertainment": "娱乐人情",
    "Expenses:HouseholdGoods": "耐用家居",
    "Expenses:Household": "家庭维护",
    "Expenses:Housing": "住房",
    "Expenses:Tax": "个税",
    "Expenses:Professional": "学习副业",
    "Expenses:Other": "未分类",
    "Income:Salary": "工作收入",
    "Income:Wechat": "微信收入",
    "Income:AliPay": "支付宝收入",
    "Income:Investment": "投资收入",
    "Income:Benefits": "福利",
    "Income:HouseProvidingFund": "公积金",
    "Income:Other": "其他收入",
  };
  if (map[path]) return map[path];
  return accountShort(path);
}

type PieSlice = {
  key: string;
  name: string;
  value: number;
  accountId?: string;
  accountPrefix?: string;
  fullName?: string;
};

function buildPieSlices(
  raw: Array<{ accountId?: string; accountName?: string; amountMinor?: number }>,
  mode: "parent" | "leaf",
  topN = 8,
): PieSlice[] {
  if (mode === "leaf") {
    const leaves = raw.map((r) => ({
      key: r.accountId || r.accountName || "?",
      name: accountShort(r.accountName || "?"),
      value: Number(((r.amountMinor || 0) / 100).toFixed(2)),
      accountId: r.accountId,
      fullName: r.accountName,
    }));
    return mergeTail(leaves, topN);
  }
  const map = new Map<string, PieSlice>();
  for (const r of raw) {
    const path = parentPath(r.accountName || "?", 2);
    const cur = map.get(path) || {
      key: path,
      name: parentLabel(path),
      value: 0,
      accountPrefix: path,
      fullName: path,
    };
    cur.value += Number(((r.amountMinor || 0) / 100).toFixed(2));
    map.set(path, cur);
  }
  const list = [...map.values()].map((s) => ({
    ...s,
    value: Number(s.value.toFixed(2)),
  }));
  list.sort((a, b) => b.value - a.value);
  return mergeTail(list, topN);
}

function mergeTail(list: PieSlice[], topN: number): PieSlice[] {
  if (list.length <= topN) return list;
  const head = list.slice(0, topN);
  const tail = list.slice(topN);
  const otherVal = tail.reduce((s, x) => s + x.value, 0);
  return [
    ...head,
    {
      key: "__other__",
      name: "其他",
      value: Number(otherVal.toFixed(2)),
      fullName: `其他 ${tail.length} 项`,
    },
  ];
}

function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

type StatsTab = "months" | "balance" | "daily" | "pie" | "payee" | "structure" | "tags";

function ChartBox({
  height = 300,
  children,
}: {
  height?: number;
  children: (width: number) => React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth || el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.floor(w));
    };
    measure();
    const t = requestAnimationFrame(measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(t);
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={ref} className="w-full min-w-0" style={{ height, minHeight: height }}>
      {width > 0 ? (
        children(width)
      ) : (
        <div className="h-full flex items-center justify-center text-xs text-tx-tertiary">
          <Loader2 size={16} className="animate-spin mr-2" />
          准备图表…
        </div>
      )}
    </div>
  );
}

function settledValue<T>(r: PromiseSettledResult<T>, fallback: T): T {
  return r.status === "fulfilled" ? r.value : fallback;
}

export default function StatsDashboard({
  ledgerId,
  unlockToken,
  onDrill,
  onGoImport,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onDrill?: (f: StatsDrillFilter) => void;
  onGoImport?: () => void;
}) {
  const now = new Date();
  const [ym, setYm] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [hideMoney, setHideMoney] = useState(() => {
    try {
      return localStorage.getItem("finance.hideMoney") === "1";
    } catch {
      return false;
    }
  });
  const [tab, setTab] = useState<StatsTab>("months");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<any>(null);
  const [prevSummary, setPrevSummary] = useState<any>(null);
  const [monthSeries, setMonthSeries] = useState<any[]>([]);
  const [dailyTrend, setDailyTrend] = useState<any[]>([]);
  const [expenseRaw, setExpenseRaw] = useState<any[]>([]);
  const [incomeRaw, setIncomeRaw] = useState<any[]>([]);
  const [pieMode, setPieMode] = useState<"EXPENSES" | "INCOME">("EXPENSES");
  const [pieLevel, setPieLevel] = useState<"parent" | "leaf">("parent");
  const [balanceType, setBalanceType] = useState<"ASSETS" | "LIABILITIES" | "NET">("NET");
  const [balanceSeries, setBalanceSeries] = useState<any[]>([]);
  const [payees, setPayees] = useState<any[]>([]);
  const [payeeMode, setPayeeMode] = useState<"sum" | "cot" | "avg">("sum");
  const [structure, setStructure] = useState<any[]>([]);
  const [tagStats, setTagStats] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);

  const [year, monthStr] = ym.split("-");
  const monthNum = String(Number(monthStr) || now.getMonth() + 1);
  const mPad = monthNum.padStart(2, "0");
  const from = `${year}-${mPad}-01`;
  const last = new Date(Number(year), Number(monthNum), 0).getDate();
  const to = `${year}-${mPad}-${String(last).padStart(2, "0")}`;

  const money = (minor: number) => (hideMoney ? "****" : `¥${yuan(minor)}`);

  useEffect(() => {
    try {
      localStorage.setItem("finance.hideMoney", hideMoney ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [hideMoney]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const prevM = Number(monthNum) - 1;
    const prevYear = prevM >= 1 ? year : String(Number(year) - 1);
    const prevMonth = prevM >= 1 ? String(prevM) : "12";

    Promise.allSettled([
      api.finance.statsSummary(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.statsSummary(ledgerId, { year: prevYear, month: prevMonth }, unlockToken),
      api.finance.statsMonths(ledgerId, 18, unlockToken),
      api.finance.statsTrend(ledgerId, { from, to, bucket: "day" }, unlockToken),
      api.finance.statsBreakdown(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.statsIncomeBreakdown(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.statsBalanceSeries(
        ledgerId,
        { year, month: monthNum, type: "ASSETS", from, to },
        unlockToken,
      ),
      api.finance.statsBalanceSeries(
        ledgerId,
        { year, month: monthNum, type: "LIABILITIES", from, to },
        unlockToken,
      ),
      api.finance.statsPayees(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.statsStructure(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.statsTags(ledgerId, { year, month: monthNum }, unlockToken),
      api.finance.listBudgets(ledgerId, ym, unlockToken),
      api.finance.getAdvice(ledgerId, { year, month: monthNum }, unlockToken),
    ])
      .then((results) => {
        if (cancelled) return;
        const fails = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
        if (fails.length === results.length) {
          setLoadError(fails[0]?.reason?.message || "统计接口全部失败，请确认后端已重启");
        }

        setSummary(settledValue(results[0], null));
        setPrevSummary(settledValue(results[1], null));
        const months = settledValue(results[2], [] as any[]);
        setMonthSeries(
          (months || []).map((r: any) => ({
            month: r.month,
            income: Number(((r.incomeMinor || 0) / 100).toFixed(2)),
            expense: Number(((r.expensesMinor || 0) / 100).toFixed(2)),
            net: Number((((r.incomeMinor || 0) - (r.expensesMinor || 0)) / 100).toFixed(2)),
          })),
        );
        setDailyTrend(
          (settledValue(results[3], [] as any[]) || []).map((r: any) => {
            const d = String(r.bucket || r.date || "");
            return {
              date: d.length >= 10 ? d.slice(5) : d,
              full: d,
              income: Number(((r.incomeMinor || 0) / 100).toFixed(2)),
              expense: Number(((r.expensesMinor || 0) / 100).toFixed(2)),
            };
          }),
        );
        setExpenseRaw(settledValue(results[4], [] as any[]) || []);
        setIncomeRaw(settledValue(results[5], [] as any[]) || []);

        const assets = settledValue(results[6], [] as any[]) || [];
        const liabs = settledValue(results[7], [] as any[]) || [];
        // 合并净资产序列
        const byDate = new Map<string, { a: number; l: number }>();
        for (const r of assets) {
          const d = String(r.date || "");
          const cur = byDate.get(d) || { a: 0, l: 0 };
          cur.a = Number(r.balanceMinor || 0);
          byDate.set(d, cur);
        }
        for (const r of liabs) {
          const d = String(r.date || "");
          const cur = byDate.get(d) || { a: 0, l: 0 };
          cur.l = Number(r.balanceMinor || 0);
          byDate.set(d, cur);
        }
        const merged = [...byDate.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({
            date: date.slice(5),
            full: date,
            assets: Number((v.a / 100).toFixed(2)),
            // 负债展示绝对值（便于阅读）
            liabilities: Number((Math.abs(v.l) / 100).toFixed(2)),
            netWorth: Number(((v.a + v.l) / 100).toFixed(2)),
          }));
        setBalanceSeries(merged);

        setPayees(settledValue(results[8], [] as any[]) || []);
        setStructure(settledValue(results[9], [] as any[]) || []);
        setTagStats(settledValue(results[10], [] as any[]) || []);
        setBudgets(settledValue(results[11], [] as any[]) || []);
        const advice = settledValue(results[12], null as any);
        setInsights(advice?.insights || []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [ledgerId, unlockToken, year, monthNum, ym, from, to]);

  const expensePie = useMemo(
    () => buildPieSlices(expenseRaw, pieLevel),
    [expenseRaw, pieLevel],
  );
  const incomePie = useMemo(
    () => buildPieSlices(incomeRaw, pieLevel),
    [incomeRaw, pieLevel],
  );
  const pieData = pieMode === "EXPENSES" ? expensePie : incomePie;
  const pieTotal = useMemo(
    () => pieData.reduce((s, d) => s + (d.value || 0), 0) || 1,
    [pieData],
  );

  const payeeRows = useMemo(() => {
    const sorted = [...payees];
    if (payeeMode === "cot") sorted.sort((a, b) => (b.count || 0) - (a.count || 0));
    else if (payeeMode === "avg") sorted.sort((a, b) => (b.avgMinor || 0) - (a.avgMinor || 0));
    else sorted.sort((a, b) => (b.expenseMinor || 0) - (a.expenseMinor || 0));
    return sorted.slice(0, 20);
  }, [payees, payeeMode]);

  const maxPayee = Math.max(
    ...payeeRows.map((p) =>
      payeeMode === "cot" ? p.count || 0 : payeeMode === "avg" ? p.avgMinor || 0 : p.expenseMinor || 0,
    ),
    1,
  );

  const expDelta = pctChange(summary?.expensesMinor ?? 0, prevSummary?.expensesMinor ?? 0);
  const incDelta = pctChange(summary?.incomeMinor ?? 0, prevSummary?.incomeMinor ?? 0);
  const topExp = expensePie[0];
  const budgetOver = budgets.filter((b) => (b.ratio || 0) > 1).length;

  const summaryLine = useMemo(() => {
    if (!summary) return null;
    const parts: string[] = [];
    const net = summary.netMinor ?? 0;
    parts.push(net >= 0 ? `本月结余 ¥${yuan(net)}` : `本月超支 ¥${yuan(Math.abs(net))}`);
    if (expDelta != null) {
      parts.push(
        expDelta > 0
          ? `支出较上月 +${expDelta.toFixed(1)}%`
          : expDelta < 0
            ? `支出较上月 ${expDelta.toFixed(1)}%`
            : "支出与上月持平",
      );
    }
    if (topExp?.name) parts.push(`最大支出类「${topExp.name}」`);
    if (budgetOver > 0) parts.push(`${budgetOver} 项预算超支`);
    return parts.join(" · ");
  }, [summary, expDelta, topExp, budgetOver]);

  const tabs: Array<{ id: StatsTab; label: string }> = [
    { id: "months", label: "月度收支" },
    { id: "balance", label: "净资产" },
    { id: "daily", label: "每日趋势" },
    { id: "pie", label: "分类占比" },
    { id: "structure", label: "支出结构" },
    { id: "tags", label: "标签" },
    { id: "payee", label: "商户排行" },
  ];

  const drillMonth = (extra: Partial<StatsDrillFilter> = {}) => {
    onDrill?.({ from, to, ...extra });
  };

  const chartTip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="rounded-lg border border-app-border bg-app-card px-3 py-2 text-xs shadow-lg">
        <div className="font-medium mb-1 text-tx-primary">{label}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-4" style={{ color: p.color || p.stroke }}>
            <span>{p.name}</span>
            <span className="tabular-nums">
              {hideMoney ? "****" : `¥${Number(p.value).toFixed(2)}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const balanceKey =
    balanceType === "ASSETS" ? "assets" : balanceType === "LIABILITIES" ? "liabilities" : "netWorth";
  const balanceName =
    balanceType === "ASSETS" ? "资产" : balanceType === "LIABILITIES" ? "负债" : "净资产";
  const balanceColor =
    balanceType === "ASSETS" ? "#10b981" : balanceType === "LIABILITIES" ? "#f59e0b" : "#8b5cf6";

  return (
    <div className="p-4 space-y-4 min-w-0">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <label className="text-sm text-tx-secondary">月份</label>
          <input
            type="month"
            className="px-2 py-1.5 rounded-lg border border-app-border bg-app-bg text-sm"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
          />
          <button
            type="button"
            title={hideMoney ? "显示金额" : "隐藏金额"}
            className="p-1.5 rounded-lg border border-app-border text-tx-tertiary hover:text-tx-primary"
            onClick={() => setHideMoney((v) => !v)}
          >
            {hideMoney ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-tx-tertiary" />}
      </div>

      {loadError && (
        <div className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{loadError}</div>
      )}

      {summaryLine && (
        <div className="rounded-xl border border-accent-primary/30 bg-accent-primary/5 px-3 py-2 text-sm text-tx-primary">
          {summaryLine}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label="资产总额"
          value={money(summary?.assetsMinor ?? 0)}
          onClick={() => drillMonth()}
        />
        <KpiCard
          label="本期收入"
          value={money(summary?.incomeMinor ?? 0)}
          tone="income"
          sub={incDelta != null ? `较上月 ${incDelta >= 0 ? "+" : ""}${incDelta.toFixed(1)}%` : undefined}
          onClick={() => drillMonth()}
        />
        <KpiCard
          label="本期支出"
          value={money(summary?.expensesMinor ?? 0)}
          tone="expense"
          sub={expDelta != null ? `较上月 ${expDelta >= 0 ? "+" : ""}${expDelta.toFixed(1)}%` : undefined}
          onClick={() => drillMonth()}
        />
        <KpiCard
          label="负债"
          value={money(Math.abs(summary?.liabilitiesMinor ?? 0))}
          tone="expense"
          onClick={() => drillMonth()}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KpiCard
          label="结余"
          value={money(summary?.netMinor ?? 0)}
          tone={(summary?.netMinor ?? 0) >= 0 ? "income" : "expense"}
          onClick={() => drillMonth()}
        />
        <KpiCard label="净资产" value={money(summary?.netWorthMinor ?? 0)} onClick={() => drillMonth()} />
      </div>

      {budgets.length > 0 && (
        <div className="rounded-xl border border-app-border bg-app-card p-3 space-y-2">
          <div className="text-xs font-medium text-tx-secondary">本月预算</div>
          {budgets.slice(0, 4).map((b: any) => (
            <div key={b.id} className="text-xs">
              <div className="flex justify-between mb-0.5">
                <span className="truncate text-tx-secondary">
                  {b.accountName || "总支出"}
                </span>
                <span className={cn("tabular-nums", b.ratio > 1 ? "text-rose-500" : "text-tx-tertiary")}>
                  {hideMoney ? "****" : `¥${yuan(b.spentMinor)} / ¥${yuan(b.amountMinor)}`}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-app-hover overflow-hidden">
                <div
                  className={cn("h-full rounded-full", b.ratio > 1 ? "bg-rose-500" : "bg-accent-primary")}
                  style={{ width: `${Math.min(100, (b.ratio || 0) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && summary && !(summary.expensesMinor > 0 || summary.incomeMinor > 0) && (
        <div className="rounded-xl border border-dashed border-app-border p-6 text-center text-sm text-tx-tertiary">
          <p>本月暂无收支数据</p>
          {onGoImport && (
            <button
              type="button"
              className="mt-2 text-accent-primary text-sm"
              onClick={onGoImport}
            >
              去导入账单
            </button>
          )}
        </div>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-app-border pb-px min-w-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              tab === t.id
                ? "border-accent-primary text-accent-primary font-medium"
                : "border-transparent text-tx-tertiary hover:text-tx-secondary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-[300px] min-w-0 w-full">
        {tab === "months" && (
          <section className="min-w-0">
            <p className="text-xs text-tx-tertiary mb-2">近 18 个月收入 / 支出 / 结余</p>
            {monthSeries.length === 0 ? (
              <Empty hint="无月度汇总数据" onImport={onGoImport} />
            ) : (
              <ChartBox height={300}>
                {(w) => (
                  <ResponsiveContainer width={w} height={300}>
                    <AreaChart data={monthSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="incFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="expFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #333)" opacity={0.4} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v) => (hideMoney ? "*" : String(v))} />
                      <Tooltip content={chartTip} />
                      <Legend />
                      <Area type="monotone" dataKey="income" name="收入" stroke="#10b981" fill="url(#incFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Area type="monotone" dataKey="expense" name="支出" stroke="#f43f5e" fill="url(#expFill)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="net" name="结余" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </ChartBox>
            )}
          </section>
        )}

        {tab === "balance" && (
          <section className="min-w-0">
            <div className="flex gap-1 mb-2">
              {(
                [
                  ["NET", "净资产"],
                  ["ASSETS", "资产"],
                  ["LIABILITIES", "负债"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBalanceType(k)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs border",
                    balanceType === k
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-app-border text-tx-tertiary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-tx-tertiary mb-2">当月累计走势（净资产 = 资产 + 负债余额）</p>
            {balanceSeries.length === 0 ? (
              <Empty hint="该月没有对应账户变动" />
            ) : (
              <ChartBox height={300}>
                {(w) => (
                  <ResponsiveContainer width={w} height={300}>
                    <LineChart data={balanceSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #333)" opacity={0.4} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v) => (hideMoney ? "*" : String(v))} />
                      <Tooltip content={chartTip} />
                      <Line
                        type="monotone"
                        dataKey={balanceKey}
                        name={balanceName}
                        stroke={balanceColor}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartBox>
            )}
          </section>
        )}

        {tab === "daily" && (
          <section className="min-w-0">
            <p className="text-xs text-tx-tertiary mb-2">当月每日收入 / 支出（无交易日已补 0）</p>
            {dailyTrend.length === 0 ? (
              <Empty hint="该月没有收支类分录" onImport={onGoImport} />
            ) : (
              <ChartBox height={300}>
                {(w) => (
                  <ResponsiveContainer width={w} height={300}>
                    <LineChart data={dailyTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border, #333)" opacity={0.4} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11 }} width={52} tickFormatter={(v) => (hideMoney ? "*" : String(v))} />
                      <Tooltip content={chartTip} />
                      <Legend />
                      <Line type="monotone" dataKey="income" name="收入" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="expense" name="支出" stroke="#f43f5e" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartBox>
            )}
          </section>
        )}

        {tab === "pie" && (
          <section className="min-w-0">
            <div className="flex flex-wrap gap-1 mb-2">
              {(
                [
                  ["EXPENSES", "支出分类"],
                  ["INCOME", "收入分类"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPieMode(k)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs border",
                    pieMode === k
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-app-border text-tx-tertiary",
                  )}
                >
                  {label}
                </button>
              ))}
              {(
                [
                  ["parent", "大类"],
                  ["leaf", "明细账户"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPieLevel(k)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs border",
                    pieLevel === k
                      ? "border-violet-500 bg-violet-500/10 text-violet-600"
                      : "border-app-border text-tx-tertiary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {pieData.length === 0 ? (
              <Empty hint={pieMode === "EXPENSES" ? "该月无支出分类" : "该月无收入分类"} />
            ) : (
              <div className="flex flex-col sm:flex-row gap-4 items-center min-w-0">
                <div className="w-full sm:w-1/2 min-w-0">
                  <ChartBox height={260}>
                    {(w) => (
                      <ResponsiveContainer width={w} height={260}>
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={88}
                            paddingAngle={1}
                            isAnimationActive={false}
                            style={{ cursor: onDrill ? "pointer" : undefined }}
                            onClick={(_: any, idx: number) => {
                              const s = pieData[idx];
                              if (!s || s.key === "__other__") return;
                              drillMonth(
                                pieLevel === "leaf" && s.accountId
                                  ? { accountId: s.accountId }
                                  : { accountPrefix: s.accountPrefix || s.key },
                              );
                            }}
                          >
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(v: any, name: any) => [
                              hideMoney ? "****" : `¥${Number(v).toFixed(2)}`,
                              String(name),
                            ]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </ChartBox>
                </div>
                <ul className="flex-1 w-full space-y-1.5 max-h-[260px] overflow-y-auto">
                  {pieData.map((d, i) => (
                    <li key={d.key + i}>
                      <button
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-2 text-sm text-left rounded-lg px-1 py-0.5",
                          d.key !== "__other__" && onDrill && "hover:bg-app-hover cursor-pointer",
                        )}
                        title={d.fullName}
                        disabled={d.key === "__other__" || !onDrill}
                        onClick={() => {
                          if (d.key === "__other__") return;
                          drillMonth(
                            pieLevel === "leaf" && d.accountId
                              ? { accountId: d.accountId }
                              : { accountPrefix: d.accountPrefix || d.key },
                          );
                        }}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                        />
                        <span className="flex-1 truncate text-tx-secondary">{d.name}</span>
                        <span className="tabular-nums text-tx-tertiary text-xs">
                          {((d.value / pieTotal) * 100).toFixed(1)}%
                        </span>
                        <span className="tabular-nums font-medium w-20 text-right">
                          {hideMoney ? "****" : `¥${Number(d.value).toFixed(2)}`}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-tx-tertiary mt-2">点击分类可跳转明细查看相关交易</p>
          </section>
        )}

        {tab === "structure" && (
          <section className="space-y-3">
            <p className="text-xs text-tx-tertiary">固定成本 / 可变生活 / 家庭代际人情（按账户路径启发式）</p>
            {structure.length === 0 ? (
              <Empty hint="该月无支出结构数据" />
            ) : (
              <ul className="space-y-2">
                {structure.map((s: any) => {
                  const totalS = structure.reduce((a: number, x: any) => a + (x.amountMinor || 0), 0) || 1;
                  const pct = ((s.amountMinor || 0) / totalS) * 100;
                  return (
                    <li key={s.bucket} className="text-sm">
                      <div className="flex justify-between mb-0.5">
                        <span>{s.label}</span>
                        <span className="tabular-nums">
                          {hideMoney ? "****" : `¥${yuan(s.amountMinor)}`} · {pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-app-hover overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent-primary/80"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {tab === "tags" && (
          <section className="space-y-2">
            <p className="text-xs text-tx-tertiary">按交易标签汇总支出（点击跳转明细）</p>
            {tagStats.length === 0 ? (
              <Empty hint="该月交易尚无标签" />
            ) : (
              <ul className="space-y-2">
                {tagStats.slice(0, 20).map((t: any) => (
                  <li key={t.tag}>
                    <button
                      type="button"
                      className="w-full text-left text-sm flex justify-between gap-2 hover:bg-app-hover rounded-lg px-2 py-1.5"
                      onClick={() => drillMonth({ tag: t.tag })}
                    >
                      <span className="text-accent-primary">#{t.tag}</span>
                      <span className="tabular-nums text-tx-secondary">
                        {t.count} 笔 · {hideMoney ? "****" : `¥${yuan(t.amountMinor)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "payee" && (
          <section>
            <div className="flex gap-1 mb-3">
              {(
                [
                  ["sum", "累计金额"],
                  ["cot", "频次"],
                  ["avg", "单笔均额"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPayeeMode(k)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs border",
                    payeeMode === k
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-app-border text-tx-tertiary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {payeeRows.length === 0 ? (
              <Empty hint="该月无商户支出" />
            ) : (
              <ul className="space-y-2">
                {payeeRows.map((p, idx) => {
                  const val =
                    payeeMode === "cot"
                      ? p.count || 0
                      : payeeMode === "avg"
                        ? p.avgMinor || 0
                        : p.expenseMinor || 0;
                  const display =
                    payeeMode === "cot"
                      ? `${p.count} 次`
                      : hideMoney
                        ? "****"
                        : `¥${yuan(val)}`;
                  const widthPct = Math.max(4, (val / maxPayee) * 100);
                  return (
                    <li key={(p.payee || "") + idx} className="text-sm">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => {
                          const payee = (p.payee || "").replace(/\*+/g, "").slice(0, 20);
                          if (payee && payee !== "(无)") drillMonth({ payee });
                          else drillMonth();
                        }}
                      >
                        <div className="flex justify-between gap-2 mb-0.5">
                          <span className="truncate text-tx-primary">
                            <span className="text-tx-tertiary mr-1.5 tabular-nums w-4 inline-block">
                              {idx + 1}.
                            </span>
                            {p.payee || "(无)"}
                          </span>
                          <span className="tabular-nums shrink-0 font-medium">{display}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-app-hover overflow-hidden">
                          <div
                            className="h-full rounded-full bg-rose-500/70"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {insights.length > 0 && (
        <div className="rounded-xl border border-app-border bg-app-card p-3 space-y-2">
          <div className="text-xs font-medium text-tx-secondary">本月洞察</div>
          {insights.slice(0, 3).map((ins: any) => (
            <div
              key={ins.id}
              className={cn(
                "text-xs rounded-lg px-2 py-1.5",
                ins.level === "warn" && "bg-amber-500/10 text-amber-800 dark:text-amber-200",
                ins.level === "good" && "bg-accent-primary/10 text-accent-primary",
                ins.level === "info" && "bg-app-hover text-tx-secondary",
              )}
            >
              <div className="font-medium">{ins.title}</div>
              <div className="opacity-90 mt-0.5">{ins.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "income" | "expense";
  sub?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "rounded-xl border border-app-border bg-app-card p-3 text-left w-full",
        onClick && "hover:border-accent-primary/40 transition-colors",
      )}
    >
      <div className="text-xs text-tx-tertiary">{label}</div>
      <div
        className={cn(
          "text-lg font-semibold mt-1 tabular-nums tracking-tight",
          tone === "income" && "text-accent-primary",
          tone === "expense" && "text-rose-500",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-tx-tertiary mt-0.5">{sub}</div>}
    </Comp>
  );
}

function Empty({ hint, onImport }: { hint?: string; onImport?: () => void }) {
  return (
    <div className="h-[200px] flex flex-col items-center justify-center text-sm text-tx-tertiary gap-1">
      <span>暂无图表数据</span>
      {hint && <span className="text-xs opacity-80">{hint}</span>}
      {onImport && (
        <button type="button" className="text-accent-primary text-xs mt-2" onClick={onImport}>
          去导入账单
        </button>
      )}
    </div>
  );
}
