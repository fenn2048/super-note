/**
 * 账单导入
 * Phase1: 步骤条、规则展示、合计、Toast 式结果、AccountPicker
 * Phase2: 同商户套用、重复对比、导入历史
 * Phase3: 还款提示展示
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Sparkles, Upload } from "lucide-react";
import { api } from "@/lib/api";
import type { FinanceAccount } from "@/types";
import { cn } from "@/lib/utils";
import AccountPicker from "@/components/finance/AccountPicker";
import TagPicker from "@/components/finance/TagPicker";

function yuan(minor: number | undefined | null) {
  if (minor == null) return "0.00";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

function normalizePayee(s: string) {
  return (s || "").replace(/\*+/g, "").replace(/\s+/g, "").toLowerCase();
}

export default function ImportPanel({
  ledgerId,
  unlockToken,
  onError,
  onGoRules,
  onGoTx,
  onGoStats,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
  onGoRules?: () => void;
  onGoTx?: () => void;
  onGoStats?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [channel, setChannel] = useState("");
  const [detectedChannel, setDetectedChannel] = useState("");
  const [detectConfidence, setDetectConfidence] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [committing, setCommitting] = useState(false);
  const [filter, setFilter] = useState<"all" | "needs_review" | "ready" | "duplicate" | "ignored">(
    "needs_review",
  );
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkMethod, setBulkMethod] = useState("");
  const [importRules, setImportRules] = useState<any[]>([]);
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [useAllRules, setUseAllRules] = useState(true);
  const [tagCatalog, setTagCatalog] = useState<{ tags: string[]; presets: string[]; used: string[] }>({
    tags: [],
    presets: [],
    used: [],
  });
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [resultBanner, setResultBanner] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const expInc = useMemo(
    () => accounts.filter((a) => a.type === "EXPENSES" || a.type === "INCOME"),
    [accounts],
  );
  const assetsLiab = useMemo(
    () => accounts.filter((a) => a.type === "ASSETS" || a.type === "LIABILITIES"),
    [accounts],
  );

  const loadHistory = useCallback(() => {
    api.finance
      .listImportBatches(ledgerId, unlockToken, 8)
      .then(setHistory)
      .catch(() => {});
  }, [ledgerId, unlockToken]);

  useEffect(() => {
    api.finance.listAccounts(ledgerId, unlockToken).then(setAccounts).catch(() => {});
    api.finance
      .listImportRules(ledgerId, unlockToken)
      .then((list) => setImportRules(list.filter((r: any) => r.enabled !== false)))
      .catch(() => {});
    api.finance.listFinanceTags(ledgerId, unlockToken).then(setTagCatalog).catch(() => {});
    loadHistory();
  }, [ledgerId, unlockToken, loadHistory]);

  const onFile = async (file: File) => {
    setBusy(true);
    onError("");
    setResultBanner(null);
    try {
      const ruleIds = useAllRules ? ["ALL"] : selectedRuleIds.length ? selectedRuleIds : ["ALL"];
      const res = await api.finance.importDetectParse(
        ledgerId,
        file,
        unlockToken,
        channel || undefined,
        ruleIds,
      );
      setBatchId(res.batchId);
      setStats(res.stats);
      setDetectedChannel(res.channel || "");
      setDetectConfidence(res.detectConfidence ?? null);
      const detail = await api.finance.getImportBatch(ledgerId, res.batchId, unlockToken);
      setRows(detail.rows);
      setFilter(
        (res.stats?.needs_review || 0) > 0
          ? "needs_review"
          : (res.stats?.ready || 0) > 0
            ? "ready"
            : "all",
      );
      loadHistory();
    } catch (e: any) {
      onError(e?.message || "解析失败");
    } finally {
      setBusy(false);
    }
  };

  const refreshRows = async () => {
    if (!batchId) return;
    const detail = await api.finance.getImportBatch(ledgerId, batchId, unlockToken);
    setRows(detail.rows);
    if (detail.batch?.stats) setStats((s: any) => ({ ...s, ...detail.batch.stats }));
  };

  const visibleRows = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    const kw = search.trim().toLowerCase();
    if (kw) {
      list = list.filter((r) => {
        const p = `${r.draft?.payee || r.parsed?.payee || ""} ${r.draft?.narration || r.parsed?.item || ""}`.toLowerCase();
        return p.includes(kw);
      });
    }
    return list;
  }, [rows, filter, search]);

  const selectedRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.draft?.selected !== false &&
          r.status !== "ignored" &&
          r.status !== "duplicate",
      ),
    [rows],
  );

  const commitPreview = useMemo(() => {
    let expense = 0;
    let income = 0;
    let count = 0;
    for (const r of selectedRows) {
      if (!r.draft?.targetAccountId || !r.draft?.methodAccountId) continue;
      const m = Number(r.draft?.amountMinor ?? r.parsed?.amountMinor ?? 0);
      const dir = r.draft?.direction || r.parsed?.direction;
      if (dir === "in" || m > 0) income += Math.abs(m);
      else expense += Math.abs(m);
      count++;
    }
    return { expense, income, count };
  }, [selectedRows]);

  const step = !batchId ? 1 : rows.length === 0 ? 1 : 2;

  const commit = async () => {
    if (!batchId) return;
    setCommitting(true);
    try {
      const res = await api.finance.commitImportBatch(ledgerId, batchId, {}, unlockToken);
      setResultBanner(
        `已导入 ${res.committed} 笔，跳过 ${res.skipped} 笔${res.errors?.length ? `；${res.errors[0]}` : ""}`,
      );
      setBatchId(null);
      setRows([]);
      setStats(null);
      loadHistory();
    } catch (e: any) {
      onError(e?.message || "提交失败");
    } finally {
      setCommitting(false);
    }
  };

  const applySamePayee = async (sourceRow: any) => {
    const payee = normalizePayee(sourceRow.draft?.payee || sourceRow.parsed?.payee || "");
    const target = sourceRow.draft?.targetAccountId;
    const method = sourceRow.draft?.methodAccountId;
    if (!payee || !target) {
      onError("请先为本行选择分类账户");
      return;
    }
    const ids = rows
      .filter((r) => {
        if (r.id === sourceRow.id) return false;
        if (r.status === "ignored" || r.status === "duplicate") return false;
        const p = normalizePayee(r.draft?.payee || r.parsed?.payee || "");
        return p && (p.includes(payee) || payee.includes(p));
      })
      .map((r) => r.id);
    if (!ids.length) {
      onError("本批没有相同对方的其他行");
      return;
    }
    await api.finance.bulkImportRows(
      ledgerId,
      batchId!,
      {
        rowIds: ids,
        targetAccountId: target,
        ...(method ? { methodAccountId: method } : {}),
        selected: true,
      },
      unlockToken,
    );
    await refreshRows();
  };

  const channelLabel = (c: string) => {
    const map: Record<string, string> = {
      alipay: "支付宝",
      wechat: "微信",
      jd: "京东",
      icbc_credit_eml: "工行信用卡邮件",
      cmb_credit_eml: "招行信用卡邮件",
      cgb_credit_eml: "广发信用卡邮件",
      cmb_debit_pdf: "招行储蓄卡 PDF",
      cmb_debit_txt: "招行储蓄卡 TXT",
      bocom_debit_pdf: "交行储蓄卡 PDF",
      ccb_debit_xls: "建行储蓄卡 XLS",
      icbc_debit_pdf: "工行储蓄卡 PDF",
    };
    return map[c] || c || "未知";
  };

  return (
    <div className="p-4 space-y-4">
      {/* 步骤条 */}
      <div className="flex items-center gap-2 text-xs">
        {[
          { n: 1, t: "上传解析" },
          { n: 2, t: "复核分类" },
          { n: 3, t: "确认导入" },
        ].map((s, i) => (
          <React.Fragment key={s.n}>
            {i > 0 && <div className="flex-1 h-px bg-app-border" />}
            <div
              className={cn(
                "flex items-center gap-1 shrink-0",
                step >= s.n ? "text-emerald-600" : "text-tx-tertiary",
              )}
            >
              <span
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium",
                  step >= s.n ? "bg-emerald-600 text-white" : "bg-app-hover",
                )}
              >
                {s.n}
              </span>
              {s.t}
            </div>
          </React.Fragment>
        ))}
      </div>

      {resultBanner && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm flex flex-wrap gap-2 items-center justify-between">
          <span>{resultBanner}</span>
          <div className="flex gap-2">
            {onGoTx && (
              <button type="button" className="text-emerald-700 dark:text-emerald-300 text-xs underline" onClick={onGoTx}>
                查看明细
              </button>
            )}
            {onGoStats && (
              <button type="button" className="text-emerald-700 dark:text-emerald-300 text-xs underline" onClick={onGoStats}>
                查看统计
              </button>
            )}
            <button type="button" className="text-tx-tertiary text-xs" onClick={() => setResultBanner(null)}>
              关闭
            </button>
          </div>
        </div>
      )}

      <div
        className={cn(
          "rounded-xl border border-dashed p-6 text-center transition-colors",
          dragOver ? "border-emerald-500 bg-emerald-500/5" : "border-app-border",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
      >
        <Upload className="w-8 h-8 mx-auto text-tx-tertiary mb-2" />
        <p className="text-sm text-tx-secondary mb-1">上传支付宝 / 微信 / 京东 / 银行账单</p>
        <p className="text-xs text-tx-tertiary mb-3">支持拖拽文件到此处 · CSV / Excel / PDF / 邮件 EML</p>
        <select
          className="mb-3 px-2 py-1.5 text-sm rounded-lg border border-app-border bg-app-bg"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="">自动识别</option>
          <option value="alipay">支付宝 CSV</option>
          <option value="wechat">微信账单</option>
          <option value="jd">京东 CSV</option>
          <option value="icbc_credit_eml">工行信用卡（邮箱导出）</option>
          <option value="cmb_credit_eml">招行信用卡（邮箱导出）</option>
          <option value="cgb_credit_eml">广发信用卡（邮箱导出）</option>
          <option value="cmb_debit_pdf">招行储蓄卡 PDF</option>
          <option value="cmb_debit_txt">招行储蓄卡 TXT</option>
          <option value="bocom_debit_pdf">交行储蓄卡 PDF</option>
          <option value="ccb_debit_xls">建行储蓄卡表格</option>
          <option value="icbc_debit_pdf">工行储蓄卡 PDF</option>
        </select>
        <div className="mb-3 text-left max-w-md mx-auto space-y-2">
          <div className="flex items-center justify-between text-xs text-tx-secondary">
            <span>应用规则</span>
            <button type="button" className="text-emerald-600" onClick={() => onGoRules?.()}>
              管理规则
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useAllRules}
              onChange={(e) => setUseAllRules(e.target.checked)}
            />
            全部启用规则（{importRules.length}）
          </label>
          {!useAllRules && (
            <div className="max-h-28 overflow-y-auto border border-app-border rounded-lg p-2 space-y-1">
              {importRules.length === 0 ? (
                <p className="text-xs text-tx-tertiary">暂无规则，将仅用默认账户</p>
              ) : (
                importRules.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selectedRuleIds.includes(r.id)}
                      onChange={(e) => {
                        setSelectedRuleIds((prev) =>
                          e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                        );
                      }}
                    />
                    <span className="truncate">{r.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm cursor-pointer">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
          选择文件
          <input
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xls,.pdf,.eml,.txt"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {/* 导入历史 */}
      {history.length > 0 && !batchId && (
        <div className="rounded-xl border border-app-border p-3">
          <div className="text-xs font-medium text-tx-secondary mb-2">最近导入</div>
          <ul className="space-y-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2 text-xs">
                <button
                  type="button"
                  className="text-left truncate flex-1 hover:text-emerald-600"
                  onClick={async () => {
                    try {
                      const detail = await api.finance.getImportBatch(ledgerId, h.id, unlockToken);
                      setBatchId(h.id);
                      setRows(detail.rows);
                      setStats(h.stats || detail.batch?.stats);
                      setDetectedChannel(h.channel);
                    } catch (e: any) {
                      onError(e?.message || "无法打开批次（可能已过期）");
                    }
                  }}
                >
                  <span className="font-medium">{h.fileName || h.id.slice(0, 8)}</span>
                  <span className="text-tx-tertiary ml-1">
                    {channelLabel(h.channel)} · {h.status}
                  </span>
                </button>
                <span className="text-tx-tertiary shrink-0 tabular-nums">
                  {h.stats?.total != null ? `${h.stats.total} 笔` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && (
        <div className="text-sm text-tx-secondary flex flex-wrap gap-3 items-center">
          {detectedChannel && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-app-hover">
              {channelLabel(detectedChannel)}
              {detectConfidence != null ? ` · 置信 ${(detectConfidence * 100).toFixed(0)}%` : ""}
            </span>
          )}
          <span>共 {stats.total}</span>
          <span className="text-emerald-600">就绪 {stats.ready}</span>
          <span className="text-amber-600">待确认 {stats.needs_review}</span>
          <span>重复 {stats.duplicate}</span>
          {stats.crossDup > 0 && (
            <span className="text-violet-600" title="与其他渠道同日同额可能重复">
              跨源疑似 {stats.crossDup}
            </span>
          )}
          <span>忽略 {stats.ignored}</span>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="rounded-xl border border-app-border bg-app-card p-3 text-sm space-y-1">
            <div className="font-medium text-tx-primary">将导入预览</div>
            <div className="text-tx-secondary text-xs flex flex-wrap gap-3">
              <span>可提交约 {commitPreview.count} 笔</span>
              <span className="text-rose-500">支出合计 ¥{yuan(commitPreview.expense)}</span>
              <span className="text-emerald-600">收入合计 ¥{yuan(commitPreview.income)}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 items-center justify-between">
            <div className="flex flex-wrap gap-1">
              {(["needs_review", "ready", "duplicate", "ignored", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-2 py-1 rounded text-xs border",
                    filter === f
                      ? "border-emerald-500 text-emerald-600"
                      : "border-app-border text-tx-tertiary",
                  )}
                >
                  {f === "all"
                    ? "全部"
                    : f === "needs_review"
                      ? "待确认"
                      : f === "ready"
                        ? "就绪"
                        : f === "duplicate"
                          ? "重复"
                          : "忽略"}
                </button>
              ))}
              <input
                className="px-2 py-1 rounded text-xs border border-app-border bg-app-bg w-28"
                placeholder="搜对方/商品"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                type="button"
                className="px-2 py-1 rounded text-xs border border-app-border"
                onClick={async () => {
                  await api.finance.bulkImportRows(
                    ledgerId,
                    batchId!,
                    { selected: true },
                    unlockToken,
                  );
                  await refreshRows();
                }}
              >
                勾选就绪+待确认
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded text-xs border border-violet-500/40 text-violet-600"
                onClick={async () => {
                  if (!confirm("将「重复」行改为可导入并勾选？仅在确认非重复消费时使用。")) return;
                  await api.finance.bulkImportRows(
                    ledgerId,
                    batchId!,
                    { forceImportDuplicates: true, selected: true },
                    unlockToken,
                  );
                  await refreshRows();
                }}
              >
                强制导入重复
              </button>
            </div>
            <button
              type="button"
              disabled={committing || commitPreview.count === 0}
              onClick={commit}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
            >
              <Check size={14} />{" "}
              {committing
                ? "提交中…"
                : `导入 ${commitPreview.count} 笔（就绪 ${stats?.ready ?? 0} / 待确认 ${stats?.needs_review ?? 0}）`}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 items-center text-xs">
            <span className="text-tx-tertiary">批量设置当前列表：</span>
            <div className="w-[160px]">
              <AccountPicker
                accounts={expInc}
                value={bulkTarget}
                onChange={setBulkTarget}
                placeholder="分类账户"
                emptyLabel="分类账户"
              />
            </div>
            <div className="w-[160px]">
              <AccountPicker
                accounts={assetsLiab}
                value={bulkMethod}
                onChange={setBulkMethod}
                placeholder="资产账户"
                emptyLabel="资产账户"
              />
            </div>
            <button
              type="button"
              className="px-2 py-1 rounded border border-app-border"
              onClick={async () => {
                const ids = visibleRows
                  .filter((r) => r.status !== "ignored")
                  .map((r) => r.id);
                if (!ids.length) return;
                await api.finance.bulkImportRows(
                  ledgerId,
                  batchId!,
                  {
                    rowIds: ids,
                    ...(bulkTarget ? { targetAccountId: bulkTarget } : {}),
                    ...(bulkMethod ? { methodAccountId: bulkMethod } : {}),
                  },
                  unlockToken,
                );
                await refreshRows();
              }}
            >
              应用到当前列表
            </button>
          </div>

          <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
            {visibleRows.map((r) => (
              <li
                key={r.id}
                className={cn(
                  "rounded-lg border p-3 text-sm",
                  r.status === "ready" && "border-emerald-500/40 bg-emerald-500/5",
                  r.status === "needs_review" && "border-amber-500/40 bg-amber-500/5",
                  r.status === "duplicate" && "border-violet-500/30 bg-violet-500/5",
                  r.status === "ignored" && "border-app-border opacity-40",
                )}
              >
                <div className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{r.draft?.payee || r.parsed?.payee}</div>
                    <div className="text-xs text-tx-tertiary truncate">
                      {r.draft?.date} · {r.draft?.narration || r.parsed?.item}
                    </div>
                  </div>
                  <div className="tabular-nums shrink-0">
                    ¥{yuan(r.draft?.amountMinor ?? r.parsed?.amountMinor)}
                  </div>
                </div>

                {r.draft?.reviewHint && (
                  <div className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-500/10 rounded px-2 py-1">
                    {r.draft.reviewHint}
                  </div>
                )}

                {r.status === "duplicate" && r.draft?.dup && (
                  <div className="mt-1.5 text-[11px] text-violet-700 dark:text-violet-300 bg-violet-500/10 rounded px-2 py-1.5 space-y-0.5">
                    <div className="font-medium">疑似与账本已有交易重复</div>
                    <div>
                      已有：{r.draft.dup.existingSource || "未知来源"}
                      {r.draft.dup.existingDate ? ` · ${r.draft.dup.existingDate}` : ""}
                      {r.draft.dup.existingTime ? ` ${r.draft.dup.existingTime}` : ""}
                      {r.draft.dup.existingPayee ? ` · ${r.draft.dup.existingPayee}` : ""}
                      {` · ${r.draft.dup.reason} · 置信 ${((r.draft.dup.confidence || 0) * 100).toFixed(0)}%`}
                    </div>
                    <button
                      type="button"
                      className="underline"
                      onClick={async () => {
                        const draft = { ...r.draft, selected: true };
                        await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
                        await api.finance.bulkImportRows(
                          ledgerId,
                          batchId!,
                          { rowIds: [r.id], forceImportDuplicates: true, selected: true },
                          unlockToken,
                        );
                        await refreshRows();
                      }}
                    >
                      仍要导入本行
                    </button>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-2 items-center">
                  <span className="text-xs text-tx-tertiary">
                    {r.status === "ready"
                      ? "就绪"
                      : r.status === "needs_review"
                        ? "待确认"
                        : r.status === "duplicate"
                          ? "重复"
                          : r.status === "ignored"
                            ? "忽略"
                            : r.status}
                    {" · "}
                    置信 {((r.confidence || 0) * 100).toFixed(0)}%
                    {r.draft?.matchedRuleName && (
                      <span className="ml-1 text-emerald-600">
                        · 规则「{r.draft.matchedRuleName}」
                      </span>
                    )}
                  </span>
                  <div className="w-[150px]">
                    <AccountPicker
                      accounts={expInc}
                      value={r.draft?.targetAccountId || ""}
                      onChange={async (id) => {
                        const draft = { ...r.draft, targetAccountId: id };
                        await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
                        setRows((prev) =>
                          prev.map((x) =>
                            x.id === r.id ? { ...x, draft, status: "ready" } : x,
                          ),
                        );
                      }}
                      placeholder="分类账户"
                      emptyLabel="分类账户"
                    />
                  </div>
                  <div className="w-[150px]">
                    <AccountPicker
                      accounts={assetsLiab}
                      value={r.draft?.methodAccountId || ""}
                      onChange={async (id) => {
                        const draft = { ...r.draft, methodAccountId: id };
                        await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, draft, status: "ready" } : x)),
                        );
                      }}
                      placeholder="支付账户"
                      emptyLabel="支付账户"
                    />
                  </div>
                  <label className="text-xs flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={
                        r.draft?.selected !== false &&
                        r.status !== "duplicate" &&
                        r.status !== "ignored"
                      }
                      onChange={async (e) => {
                        const draft = { ...r.draft, selected: e.target.checked };
                        await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, draft } : x)),
                        );
                      }}
                    />
                    导入
                  </label>
                  <button
                    type="button"
                    className="text-xs text-violet-600"
                    title="将本行分类套用到相同对方"
                    onClick={() => applySamePayee(r)}
                  >
                    同商户套用
                  </button>
                  <div className="w-full basis-full mt-1">
                    <TagPicker
                      value={r.draft?.tags || []}
                      onChange={async (tags) => {
                        const draft = { ...r.draft, tags };
                        await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
                        setRows((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, draft } : x)),
                        );
                      }}
                      suggestions={tagCatalog.used}
                      presets={tagCatalog.presets.slice(0, 10)}
                      placeholder="标签"
                    />
                  </div>
                  <button
                    type="button"
                    title="从本行生成规则"
                    className="text-xs inline-flex items-center gap-0.5 text-emerald-600 px-1"
                    onClick={async () => {
                      const payee = (r.draft?.payee || r.parsed?.payee || "").trim();
                      const target = r.draft?.targetAccountId;
                      if (!payee || !target) {
                        onError("请先填写对方与分类账户再生成规则");
                        return;
                      }
                      const keyword = payee.replace(/\*+/g, "").slice(0, 12);
                      const itemKw = String(r.draft?.narration || r.parsed?.item || "")
                        .slice(0, 20)
                        .trim();
                      try {
                        await api.finance.saveImportRule(
                          ledgerId,
                          {
                            name: `自动:${keyword}`,
                            peer: keyword,
                            item: itemKw || undefined,
                            fullMatch: false,
                            logic: "OR",
                            separator: "|",
                            targetAccountId: target,
                            methodAccountId: r.draft?.methodAccountId || undefined,
                            tags: r.draft?.tags || undefined,
                          },
                          unlockToken,
                        );
                        setResultBanner(`已创建规则：对方/商品含「${keyword}」`);
                        onGoRules?.();
                      } catch (e: any) {
                        onError(e?.message || "创建规则失败");
                      }
                    }}
                  >
                    <Sparkles size={12} /> 存为规则
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
