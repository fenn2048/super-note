/**
 * 账单导入 — 编排层
 * 子组件见 ./import/*
 * P0: ready_only CTA / partial / 商户聚类 / sticky / 移动摘要流
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { FinanceAccount } from "@/types";
import { confirm } from "@/components/ui/confirm";
import { computeCommitPreview, statusCounts } from "@/lib/finance/commitPreview";
import {
  clusterNeedsReview,
  normalizePayee,
  type PayeeCluster,
} from "@/lib/finance/importClustering";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { yuan, type FilterKey } from "./import/labels";
import ImportStepper from "./import/ImportStepper";
import ImportResultBanner from "./import/ImportResultBanner";
import ImportUploadZone from "./import/ImportUploadZone";
import ImportHistoryList from "./import/ImportHistoryList";
import ImportSummaryBar from "./import/ImportSummaryBar";
import ImportFilterChips from "./import/ImportFilterChips";
import ImportBulkBar from "./import/ImportBulkBar";
import ImportClusterList from "./import/ImportClusterList";
import ImportClusterDetail from "./import/ImportClusterDetail";
import ImportRowCard from "./import/ImportRowCard";
import ImportStickyCommitBar from "./import/ImportStickyCommitBar";

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
  const isCompact = useMediaQuery("(max-width: 767px)");
  const pickerVariant = isCompact ? "sheet" : "dropdown";

  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string>("preview");
  const [readOnly, setReadOnly] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [channel, setChannel] = useState("");
  const [detectedChannel, setDetectedChannel] = useState("");
  const [detectConfidence, setDetectConfidence] = useState<number | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [committing, setCommitting] = useState(false);
  const [filter, setFilter] = useState<FilterKey>("needs_review");
  const [bulkTarget, setBulkTarget] = useState("");
  const [bulkMethod, setBulkMethod] = useState("");
  const [clusterTarget, setClusterTarget] = useState("");
  const [clusterMethod, setClusterMethod] = useState("");
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
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [saveRuleOnApply, setSaveRuleOnApply] = useState(false);

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

  const applyDetail = useCallback(
    (detail: Awaited<ReturnType<typeof api.finance.getImportBatch>>) => {
      setRows(detail.rows);
      setBatchStatus(detail.batch?.status || "preview");
      setReadOnly(!!(detail.readOnly || detail.batch?.readOnly));
      if (detail.batch?.stats) setStats((s: any) => ({ ...s, ...detail.batch.stats }));
      if (detail.batch?.channel) setDetectedChannel(detail.batch.channel);
    },
    [],
  );

  const refreshRows = async () => {
    if (!batchId) return;
    const detail = await api.finance.getImportBatch(ledgerId, batchId, unlockToken);
    applyDetail(detail);
  };

  const onFile = async (file: File) => {
    setBusy(true);
    onError("");
    setResultBanner(null);
    setSelectedClusterId(null);
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
      setBatchStatus("preview");
      setReadOnly(false);
      const detail = await api.finance.getImportBatch(ledgerId, res.batchId, unlockToken);
      applyDetail(detail);
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

  const counts = useMemo(() => statusCounts(rows), [rows]);
  const commitPreview = useMemo(() => computeCommitPreview(rows), [rows]);
  const { clusters, unclustered } = useMemo(() => clusterNeedsReview(rows), [rows]);
  const activeCluster = useMemo(
    () => clusters.find((c) => c.key === selectedClusterId) || null,
    [clusters, selectedClusterId],
  );

  const visibleRows = useMemo(() => {
    let list = rows;
    if (filter !== "all") list = list.filter((r) => r.status === filter);
    const kw = search.trim().toLowerCase();
    if (kw) {
      list = list.filter((r) => {
        const p =
          `${r.draft?.payee || r.parsed?.payee || ""} ${r.draft?.narration || r.parsed?.item || ""}`.toLowerCase();
        return p.includes(kw);
      });
    }
    return list;
  }, [rows, filter, search]);

  const residualDup = counts.duplicate || 0;
  const onlyDupResidual =
    batchStatus === "partial" &&
    residualDup > 0 &&
    (counts.ready || 0) === 0 &&
    (counts.needs_review || 0) === 0;

  const step = !batchId ? 1 : rows.length === 0 ? 1 : 2;

  const clearBatchUi = () => {
    setBatchId(null);
    setRows([]);
    setStats(null);
    setBatchStatus("preview");
    setReadOnly(false);
    setSelectedClusterId(null);
  };

  const handleCommitResult = async (res: {
    committed: number;
    skipped: number;
    errors?: string[];
    batchStatus?: string;
    stats?: Record<string, number>;
  }) => {
    const status = res.batchStatus || batchStatus;
    setResultBanner(
      `已导入 ${res.committed} 笔，跳过 ${res.skipped} 笔${res.errors?.length ? `；${res.errors[0]}` : ""}`,
    );
    if (res.stats) setStats((s: any) => ({ ...s, ...res.stats }));
    if (status === "committed") {
      clearBatchUi();
      loadHistory();
      return;
    }
    setBatchStatus(status);
    await refreshRows();
    loadHistory();
  };

  const commitReady = async () => {
    if (!batchId || readOnly) return;
    setCommitting(true);
    try {
      const res = await api.finance.commitImportBatch(
        ledgerId,
        batchId,
        { mode: "ready_only" },
        unlockToken,
      );
      await handleCommitResult(res);
    } catch (e: any) {
      onError(e?.message || "提交失败");
    } finally {
      setCommitting(false);
    }
  };

  const commitIncludeReview = async () => {
    if (!batchId || readOnly) return;
    const n = commitPreview.reviewSelectedCount;
    const ok = await confirm({
      title: "同时导入待确认行？",
      description: `将额外提交 ${n} 笔尚未充分确认的记录（以及全部已勾选的就绪行）。请确认分类与支付账户无误。`,
      confirmText: "仍要导入",
      danger: true,
    });
    if (!ok) return;
    setCommitting(true);
    try {
      const res = await api.finance.commitImportBatch(
        ledgerId,
        batchId,
        { mode: "include_review" },
        unlockToken,
      );
      await handleCommitResult(res);
    } catch (e: any) {
      onError(e?.message || "提交失败");
    } finally {
      setCommitting(false);
    }
  };

  const markIgnoredDuplicates = async () => {
    if (!batchId || readOnly || residualDup <= 0) return;
    const ok = await confirm({
      title: `忽略剩余 ${residualDup} 笔重复？`,
      description:
        "将标记为忽略，不再计入待处理；不会写入账本。批次在无其它待处理项时将标记为已完成。",
      confirmText: "忽略重复",
    });
    if (!ok) return;
    try {
      const res = await api.finance.bulkImportRows(
        ledgerId,
        batchId,
        { markIgnored: true },
        unlockToken,
      );
      if (res.stats) setStats((s: any) => ({ ...s, ...res.stats }));
      if (res.batchStatus === "committed") {
        setResultBanner(`已忽略 ${res.updated} 笔重复，批次完成`);
        clearBatchUi();
        loadHistory();
        return;
      }
      setBatchStatus(res.batchStatus || batchStatus);
      await refreshRows();
    } catch (e: any) {
      onError(e?.message || "操作失败");
    }
  };

  const applySamePayee = async (sourceRow: any) => {
    if (readOnly) return;
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
        if (r.status === "ignored" || r.status === "duplicate" || r.status === "committed") {
          return false;
        }
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

  const applyCluster = async (cluster: PayeeCluster) => {
    if (readOnly || !cluster.applyable) return;
    if (!clusterTarget || !clusterMethod) {
      onError("请同时选择分类账户与支付账户");
      return;
    }
    const ok = await confirm({
      title: `应用到 ${cluster.count} 笔？`,
      description: `对方「${cluster.displayPayee}」· 合计 ¥${yuan(cluster.totalMinor)}\n将设置分类与支付账户并勾选导入。`,
      confirmText: "应用",
    });
    if (!ok) return;
    try {
      await api.finance.bulkImportRows(
        ledgerId,
        batchId!,
        {
          rowIds: cluster.rowIds,
          targetAccountId: clusterTarget,
          methodAccountId: clusterMethod,
          selected: true,
        },
        unlockToken,
      );
      if (saveRuleOnApply) {
        const keyword = cluster.displayPayee.replace(/\*+/g, "").slice(0, 12);
        await api.finance
          .saveImportRule(
            ledgerId,
            {
              name: `自动:${keyword}`,
              peer: keyword,
              fullMatch: false,
              logic: "OR",
              separator: "|",
              targetAccountId: clusterTarget,
              methodAccountId: clusterMethod,
            },
            unlockToken,
          )
          .catch(() => {});
      }
      setClusterTarget("");
      setClusterMethod("");
      setSelectedClusterId(null);
      await refreshRows();
    } catch (e: any) {
      onError(e?.message || "套用失败");
    }
  };

  const patchRowAccount = async (
    r: any,
    patch: { targetAccountId?: string; methodAccountId?: string },
  ) => {
    if (readOnly || r.status === "committed") return;
    const draft = { ...r.draft, ...patch };
    await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
    const both = !!(draft.targetAccountId && draft.methodAccountId);
    const nextStatus =
      both && (r.status === "needs_review" || r.status === "ready")
        ? "ready"
        : r.status === "ready" && !both
          ? "needs_review"
          : r.status;
    setRows((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, draft, status: nextStatus } : x)),
    );
  };

  const openHistory = async (h: any) => {
    try {
      const detail = await api.finance.getImportBatch(ledgerId, h.id, unlockToken);
      setBatchId(h.id);
      setResultBanner(null);
      setSelectedClusterId(null);
      applyDetail(detail);
      setStats(h.stats || detail.batch?.stats);
      setDetectedChannel(h.channel || detail.batch?.channel);
      setFilter(
        detail.readOnly
          ? "all"
          : (detail.batch?.stats?.needs_review || 0) > 0
            ? "needs_review"
            : "all",
      );
    } catch (e: any) {
      onError(e?.message || "无法打开批次（可能已过期）");
    }
  };

  const showClusterPanel =
    filter === "needs_review" && !readOnly && !selectedClusterId && clusters.length > 0;
  const listRows = selectedClusterId || showClusterPanel ? [] : visibleRows;

  const rowCardProps = {
    readOnly,
    isCompact,
    pickerVariant: pickerVariant as "dropdown" | "sheet",
    expInc,
    assetsLiab,
    tagCatalog: { used: tagCatalog.used, presets: tagCatalog.presets },
    onPatchAccount: patchRowAccount,
    onToggleSelected: async (r: any, selected: boolean) => {
      const draft = { ...r.draft, selected };
      await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, draft } : x)));
    },
    onApplySamePayee: applySamePayee,
    onForceImportRow: async (r: any) => {
      await api.finance.bulkImportRows(
        ledgerId,
        batchId!,
        { rowIds: [r.id], forceImportDuplicates: true, selected: true },
        unlockToken,
      );
      await refreshRows();
    },
    onSaveRule: async (r: any) => {
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
    },
    onTagsChange: async (r: any, tags: string[]) => {
      const draft = { ...r.draft, tags };
      await api.finance.updateImportRow(ledgerId, batchId!, r.id, draft, unlockToken);
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, draft } : x)));
    },
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4" data-import-scroll>
        <ImportStepper step={step} />

        {resultBanner && (
          <ImportResultBanner
            message={resultBanner}
            onClose={() => setResultBanner(null)}
            onGoTx={onGoTx}
            onGoStats={onGoStats}
          />
        )}

        {(!batchId || !isCompact) && (
          <ImportUploadZone
            busy={busy}
            hasBatch={!!batchId}
            compact={!!batchId}
            channel={channel}
            onChannelChange={setChannel}
            channelDisabled={!!batchId && !readOnly}
            useAllRules={useAllRules}
            onUseAllRulesChange={setUseAllRules}
            importRules={importRules}
            selectedRuleIds={selectedRuleIds}
            onToggleRule={(id, checked) => {
              setSelectedRuleIds((prev) =>
                checked ? [...prev, id] : prev.filter((x) => x !== id),
              );
            }}
            onGoRules={onGoRules}
            onFile={onFile}
          />
        )}

        {history.length > 0 && !batchId && (
          <ImportHistoryList history={history} onOpen={openHistory} />
        )}

        {batchId && rows.length > 0 && (
          <>
            <ImportSummaryBar
              readOnly={readOnly}
              batchStatus={batchStatus}
              detectedChannel={detectedChannel}
              detectConfidence={detectConfidence}
              counts={counts}
              commitPreview={commitPreview}
              residualDup={residualDup}
              onlyDupResidual={onlyDupResidual}
              onMarkIgnoredDuplicates={markIgnoredDuplicates}
              isCompact={isCompact}
              busy={busy}
              onFile={onFile}
            />

            {selectedClusterId && activeCluster && (
              <ImportClusterDetail
                cluster={activeCluster}
                clusterTarget={clusterTarget}
                clusterMethod={clusterMethod}
                onClusterTarget={setClusterTarget}
                onClusterMethod={setClusterMethod}
                saveRuleOnApply={saveRuleOnApply}
                onSaveRuleOnApply={setSaveRuleOnApply}
                onBack={() => setSelectedClusterId(null)}
                onApply={() => applyCluster(activeCluster)}
                pickerVariant={pickerVariant}
                expInc={expInc}
                assetsLiab={assetsLiab}
              />
            )}

            {!selectedClusterId && (
              <>
                <ImportFilterChips
                  filter={filter}
                  onFilterChange={setFilter}
                  counts={counts}
                  search={search}
                  onSearchChange={setSearch}
                  readOnly={readOnly}
                  residualDup={residualDup}
                  onSelectReadyAndReview={async () => {
                    await api.finance.bulkImportRows(
                      ledgerId,
                      batchId!,
                      { selected: true },
                      unlockToken,
                    );
                    await refreshRows();
                  }}
                  onForceDuplicates={async () => {
                    const ok = await confirm({
                      title: "强制导入重复？",
                      description:
                        "将「重复」行改为可导入并勾选。仅在确认并非重复消费时使用。",
                      confirmText: "强制导入",
                      danger: true,
                    });
                    if (!ok) return;
                    await api.finance.bulkImportRows(
                      ledgerId,
                      batchId!,
                      { forceImportDuplicates: true, selected: true },
                      unlockToken,
                    );
                    await refreshRows();
                  }}
                  onMarkIgnoredDuplicates={markIgnoredDuplicates}
                />

                {!readOnly && (
                  <ImportBulkBar
                    expInc={expInc}
                    assetsLiab={assetsLiab}
                    bulkTarget={bulkTarget}
                    bulkMethod={bulkMethod}
                    onBulkTarget={setBulkTarget}
                    onBulkMethod={setBulkMethod}
                    pickerVariant={pickerVariant}
                    onApply={async () => {
                      const ids = visibleRows
                        .filter(
                          (r) =>
                            r.status !== "ignored" &&
                            r.status !== "committed" &&
                            r.status !== "duplicate",
                        )
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
                  />
                )}

                {showClusterPanel && (
                  <ImportClusterList
                    clusters={clusters}
                    unclustered={unclustered}
                    isCompact={isCompact}
                    clusterTarget={clusterTarget}
                    clusterMethod={clusterMethod}
                    onClusterTarget={setClusterTarget}
                    onClusterMethod={setClusterMethod}
                    saveRuleOnApply={saveRuleOnApply}
                    onSaveRuleOnApply={setSaveRuleOnApply}
                    onSelectCluster={(c) => {
                      setSelectedClusterId(c.key);
                      setClusterTarget(c.commonTargetId || clusterTarget);
                      setClusterMethod(c.commonMethodId || clusterMethod);
                    }}
                    onApplyCluster={applyCluster}
                    pickerVariant={pickerVariant}
                    expInc={expInc}
                    assetsLiab={assetsLiab}
                    rowCardProps={rowCardProps}
                  />
                )}

                {!selectedClusterId && !showClusterPanel && (
                  <ul className="space-y-2 pb-2">
                    {listRows.map((r) => (
                      <ImportRowCard key={r.id} row={r} {...rowCardProps} />
                    ))}
                    {listRows.length === 0 && (
                      <p className="text-xs text-tx-tertiary text-center py-4">无匹配行</p>
                    )}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>

      {batchId && rows.length > 0 && !readOnly && !selectedClusterId && (
        <ImportStickyCommitBar
          commitPreview={commitPreview}
          residualDup={residualDup}
          committing={committing}
          onCommitReady={commitReady}
          onCommitIncludeReview={commitIncludeReview}
        />
      )}
    </div>
  );
}
