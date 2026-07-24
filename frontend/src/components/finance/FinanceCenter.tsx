/**
 * 记账中心：账本列表 / 解锁 / 概览 / 明细 / 记一笔 / 导入 / 账户 / 规则 / 统计 / 建议
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, BookOpen, Plus, Lock, Unlock, Trash2, Upload, Wallet,
  List, PieChart, Settings2, Lightbulb, Loader2, X, Check, Download, Fingerprint, Sparkles,
  Target, Pencil, Bookmark, RefreshCw, CalendarClock,
} from "lucide-react";
import { api, getFinanceUnlockToken, setFinanceUnlockToken } from "@/lib/api";
import {
  disableFinanceBio,
  enableFinanceBio,
  hasLocalFinanceBioToken,
  isFinanceBioAvailable,
  isFinanceBioPlatformSupported,
  unlockFinanceWithBio,
} from "@/lib/financeBio";
import StatsDashboard, { type StatsDrillFilter } from "@/components/finance/StatsDashboard";
import RulesPanel from "@/components/finance/RulesPanel";
import TagPicker from "@/components/finance/TagPicker";
import AccountPicker from "@/components/finance/AccountPicker";
import ImportPanel from "@/components/finance/ImportPanel";
import { useAppActions } from "@/store/AppContext";
import { haptic } from "@/hooks/useCapacitor";
import type {
  FinanceAccount,
  FinanceInsight,
  FinanceLedger,
  FinanceTransaction,
} from "@/types";
import { cn } from "@/lib/utils";

const TX_FILTER_KEY = (ledgerId: string) => `finance.txFilter.${ledgerId}`;

type Tab = "home" | "tx" | "import" | "accounts" | "rules" | "stats" | "budget" | "recurring" | "advice";

function yuan(minor: number | undefined | null) {
  if (minor == null) return "0.00";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${(abs / 100).toFixed(2)}`;
}

export default function FinanceCenter() {
  const appActions = useAppActions();
  const [ledgers, setLedgers] = useState<FinanceLedger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<FinanceLedger | null>(null);
  const [unlockToken, setUnlockToken] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");

  // create form
  const [showCreate, setShowCreate] = useState(false);

  const goBackFromFinance = useCallback(() => {
    // 移动端从「我的」进入记账，返回「更多」列表
    appActions.setViewMode("more");
    appActions.setMobileView("list");
  }, [appActions]);
  const [createTitle, setCreateTitle] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createWorkspaceId, setCreateWorkspaceId] = useState("");
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; icon?: string | null }>>([]);
  const [creating, setCreating] = useState(false);

  // unlock form
  const [unlockPw, setUnlockPw] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioLocal, setBioLocal] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  const loadLedgers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.finance.listLedgers();
      setLedgers(list);
    } catch (e: any) {
      setError(e?.message || "加载账本失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLedgers();
    api.getWorkspaces()
      .then((list) => setWorkspaces(list.map((w) => ({ id: w.id, name: w.name, icon: w.icon }))))
      .catch(() => setWorkspaces([]));
  }, [loadLedgers]);

  const refreshBioState = async (ledgerId: string) => {
    if (!isFinanceBioPlatformSupported()) {
      setBioAvailable(false);
      setBioLocal(false);
      return;
    }
    const [avail, local] = await Promise.all([
      isFinanceBioAvailable(),
      hasLocalFinanceBioToken(ledgerId),
    ]);
    setBioAvailable(avail);
    setBioLocal(local);
  };

  const openLedger = async (ledger: FinanceLedger) => {
    setError(null);
    if (!ledger.hasPassword) {
      setActive(ledger);
      setUnlockToken(null);
      setTab("home");
      return;
    }
    const cached = getFinanceUnlockToken(ledger.id);
    if (cached) {
      try {
        const fresh = await api.finance.getLedger(ledger.id, cached);
        if (!fresh.locked) {
          setActive(fresh);
          setUnlockToken(cached);
          setTab("home");
          void refreshBioState(ledger.id);
          return;
        }
      } catch {
        setFinanceUnlockToken(ledger.id, null);
      }
    }
    setActive({ ...ledger, locked: true });
    setUnlockToken(null);
    setUnlockPw("");
    void refreshBioState(ledger.id);
  };

  const handleUnlock = async () => {
    if (!active) return;
    setUnlocking(true);
    setError(null);
    try {
      const res = await api.finance.unlockLedger(active.id, unlockPw);
      if (res.unlockToken) {
        setFinanceUnlockToken(active.id, res.unlockToken);
        setUnlockToken(res.unlockToken);
        setActive({ ...active, locked: false });
        setUnlockPw("");
        void refreshBioState(active.id);
      }
    } catch (e: any) {
      setError(e?.message || "解锁失败");
    } finally {
      setUnlocking(false);
    }
  };

  const handleBioUnlock = async () => {
    if (!active) return;
    setBioBusy(true);
    setError(null);
    try {
      const res = await unlockFinanceWithBio(active.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setFinanceUnlockToken(active.id, res.unlockToken);
      setUnlockToken(res.unlockToken);
      setActive({ ...active, locked: false });
      setTab("home");
    } finally {
      setBioBusy(false);
    }
  };

  const handleEnableBio = async () => {
    if (!active || !unlockToken) return;
    setBioBusy(true);
    setError(null);
    try {
      const res = await enableFinanceBio(active.id, unlockToken);
      if (!res.ok) setError(res.error || "启用失败");
      else {
        setBioLocal(true);
        alert("已启用生物识别解锁");
      }
    } finally {
      setBioBusy(false);
    }
  };

  const handleDisableBio = async () => {
    if (!active) return;
    await disableFinanceBio(active.id);
    setBioLocal(false);
  };

  const handleExport = async (format: "csv" | "beancount") => {
    if (!active) return;
    try {
      const blob = await api.finance.exportLedger(active.id, format, unlockToken);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${active.title}.${format === "csv" ? "csv" : "bean"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || "导出失败");
    }
  };

  const handleCreate = async () => {
    if (!createTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const ledger = await api.finance.createLedger({
        title: createTitle.trim(),
        password: createPassword || undefined,
        workspaceId: createWorkspaceId || null,
      });
      if (ledger.unlockToken) {
        setFinanceUnlockToken(ledger.id, ledger.unlockToken);
      }
      setShowCreate(false);
      setCreateTitle("");
      setCreatePassword("");
      setCreateWorkspaceId("");
      await loadLedgers();
      setActive({ ...ledger, locked: false });
      setUnlockToken(ledger.unlockToken || null);
      setTab("home");
    } catch (e: any) {
      setError(e?.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteLedger = async (ledger: FinanceLedger) => {
    if (ledger.canManage === false) {
      setError("仅创建者或工作区管理员可删除共享账本");
      return;
    }
    const pw = ledger.hasPassword ? window.prompt("请输入账本密码以确认删除") : "";
    if (ledger.hasPassword && pw === null) return;
    if (!window.confirm(`确定删除账本「${ledger.title}」？此操作不可恢复。`)) return;
    try {
      await api.finance.deleteLedger(ledger.id, pw || undefined);
      setFinanceUnlockToken(ledger.id, null);
      if (active?.id === ledger.id) {
        setActive(null);
        setUnlockToken(null);
      }
      await loadLedgers();
    } catch (e: any) {
      setError(e?.message || "删除失败");
    }
  };

  // ─── List view ───
  if (!active) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg">
        {/* 移动端顶栏：左返回 · 标题绝对居中 · 右上角 + 新建（去掉 App 汉堡栏） */}
        <header
          className={cn(
            "md:hidden shrink-0 select-none z-40 relative",
            "flex items-center justify-between px-2",
            "bg-app-elevated/70 backdrop-blur-md border-b border-app-border/60",
            "min-h-[52px]",
          )}
          style={{ paddingTop: "calc(var(--safe-area-top) + 4px)" }}
        >
          <button
            type="button"
            onClick={() => {
              haptic.light();
              goBackFromFinance();
            }}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-button text-accent-primary hover:bg-app-hover active:bg-app-active transition-colors z-10"
            title="返回"
            aria-label="返回"
          >
            <ArrowLeft size={22} />
          </button>
          <h1 className="absolute left-0 right-0 text-center text-[15px] font-bold text-tx-primary tracking-tight pointer-events-none">
            记账
          </h1>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-button text-accent-primary hover:bg-app-hover transition-colors z-10"
            title="新建账本"
            aria-label="新建账本"
          >
            <Plus size={22} />
          </button>
        </header>

        {/* 桌面端顶栏 */}
        <header className="hidden md:flex shrink-0 px-4 py-3 border-b border-app-border items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-accent-primary" />
            <h1 className="text-lg font-semibold text-tx-primary">记账</h1>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm hover:opacity-90"
          >
            <Plus size={16} /> 新建账本
          </button>
        </header>

        {error && (
          <div className="mx-4 mt-3 text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="animate-spin text-tx-tertiary" />
            </div>
          ) : ledgers.length === 0 ? (
            <div className="text-center py-16 text-tx-tertiary">
              <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p>还没有账本</p>
              <p className="text-sm mt-1">创建第一个账本开始记账与导入账单</p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm"
              >
                创建账本
              </button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ledgers.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => openLedger(l)}
                  className="text-left rounded-xl border border-app-border bg-app-card p-4 hover:border-accent-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-2xl">{l.icon || "📒"}</div>
                    <div className="flex items-center gap-1 text-tx-tertiary">
                      {l.hasPassword ? <Lock size={14} /> : <Unlock size={14} />}
                      {l.canManage !== false && (
                        <button
                          type="button"
                          className="p-1 hover:text-red-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteLedger(l);
                          }}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 font-medium text-tx-primary flex items-center gap-2">
                    <span className="truncate">{l.title}</span>
                    {l.isShared || l.workspaceId ? (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400">
                        共享
                      </span>
                    ) : (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-app-hover text-tx-tertiary">
                        个人
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-tx-tertiary mt-1">
                    {l.operatingCurrency} · 自 {l.startDate}
                    {l.workspaceName ? ` · ${l.workspaceName}` : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {showCreate && (
          <Modal title="新建账本" onClose={() => setShowCreate(false)}>
            <label className="block text-sm text-tx-secondary mb-1">名称</label>
            <input
              className="w-full mb-3 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-tx-primary"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              placeholder="如：日常开销"
              autoFocus
            />
            <label className="block text-sm text-tx-secondary mb-1">归属</label>
            <select
              className="w-full mb-3 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-tx-primary"
              value={createWorkspaceId}
              onChange={(e) => setCreateWorkspaceId(e.target.value)}
            >
              <option value="">个人账本（仅自己）</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  共享 · {w.icon || "🏠"} {w.name}
                </option>
              ))}
            </select>
            {createWorkspaceId && (
              <p className="text-xs text-violet-600 dark:text-violet-400 mb-3">
                工作区成员均可查看与记账；删除/改密仅创建者或管理员。
              </p>
            )}
            <label className="block text-sm text-tx-secondary mb-1">访问密码（可选，二次隐私锁）</label>
            <input
              type="password"
              className="w-full mb-4 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-tx-primary"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              placeholder="留空则登录即可访问"
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="px-3 py-1.5 text-sm text-tx-secondary" onClick={() => setShowCreate(false)}>
                取消
              </button>
              <button
                type="button"
                disabled={creating || !createTitle.trim()}
                onClick={handleCreate}
                className="px-4 py-1.5 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50"
              >
                {creating ? "创建中…" : "创建"}
              </button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  // ─── Locked ───
  if (active.locked) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-app-bg">
        <header className="shrink-0 px-4 py-3 border-b border-app-border flex items-center gap-2">
          <button type="button" onClick={() => setActive(null)} className="p-1.5 rounded-lg hover:bg-app-hover">
            <ArrowLeft size={18} />
          </button>
          <span className="font-medium">{active.title}</span>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm rounded-2xl border border-app-border bg-app-card p-6">
            <div className="flex justify-center mb-4">
              <Lock className="w-10 h-10 text-amber-500" />
            </div>
            <h2 className="text-center font-semibold mb-1">账本已锁定</h2>
            <p className="text-center text-sm text-tx-tertiary mb-4">输入密码以查看明细与统计</p>
            {error && <p className="text-sm text-red-500 mb-2 text-center">{error}</p>}
            <input
              type="password"
              className="w-full mb-3 px-3 py-2 rounded-lg border border-app-border bg-app-bg"
              value={unlockPw}
              onChange={(e) => setUnlockPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="账本密码"
              autoFocus
            />
            <button
              type="button"
              disabled={unlocking || !unlockPw}
              onClick={handleUnlock}
              className="w-full py-2 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50"
            >
              {unlocking ? "解锁中…" : "解锁"}
            </button>
            {bioAvailable && bioLocal && (
              <button
                type="button"
                disabled={bioBusy}
                onClick={handleBioUnlock}
                className="w-full mt-2 py-2 rounded-lg border border-app-border text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Fingerprint size={16} />
                {bioBusy ? "验证中…" : "指纹 / 面容解锁"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Unlocked ledger shell ───
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-app-bg">
      <header className="shrink-0 px-3 py-2 border-b border-app-border flex items-center gap-2">
        <button type="button" onClick={() => { setActive(null); setUnlockToken(null); }} className="p-1.5 rounded-lg hover:bg-app-hover">
          <ArrowLeft size={18} />
        </button>
        <span className="font-medium truncate flex-1">
          {active.title}
          {(active.isShared || active.workspaceId) && (
            <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-600 dark:text-violet-400">
              共享{active.workspaceName ? ` · ${active.workspaceName}` : ""}
            </span>
          )}
        </span>
        <button
          type="button"
          title="导出 CSV"
          className="p-1.5 rounded-lg hover:bg-app-hover text-tx-tertiary"
          onClick={() => handleExport("csv")}
        >
          <Download size={16} />
        </button>
        <button
          type="button"
          title="导出 Beancount"
          className="px-2 py-1 rounded-lg hover:bg-app-hover text-tx-tertiary text-xs"
          onClick={() => handleExport("beancount")}
        >
          .bean
        </button>
        {active.hasPassword && isFinanceBioPlatformSupported() && bioAvailable && (
          <button
            type="button"
            title={bioLocal ? "关闭生物识别" : "启用生物识别"}
            className={cn("p-1.5 rounded-lg hover:bg-app-hover", bioLocal ? "text-accent-primary" : "text-tx-tertiary")}
            disabled={bioBusy}
            onClick={() => (bioLocal ? handleDisableBio() : handleEnableBio())}
          >
            <Fingerprint size={16} />
          </button>
        )}
        {active.hasPassword && (
          <button
            type="button"
            title="锁定"
            className="p-1.5 rounded-lg hover:bg-app-hover text-tx-tertiary"
            onClick={async () => {
              await api.finance.lockLedger(active.id);
              setFinanceUnlockToken(active.id, null);
              setUnlockToken(null);
              setActive({ ...active, locked: true });
              void refreshBioState(active.id);
            }}
          >
            <Lock size={16} />
          </button>
        )}
      </header>

      <nav className="shrink-0 flex gap-1 px-2 py-2 border-b border-app-border overflow-x-auto">
        {(
          [
            ["home", "概览", Wallet],
            ["tx", "明细", List],
            ["import", "导入", Upload],
            ["accounts", "账户", BookOpen],
            ["rules", "规则", Settings2],
            ["stats", "统计", PieChart],
            ["budget", "预算", Target],
            ["recurring", "定期", CalendarClock],
            ["advice", "建议", Lightbulb],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs sm:text-sm",
              tab === id ? "bg-accent-primary/15 text-accent-primary" : "text-tx-secondary hover:bg-app-hover",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mx-3 mt-2 text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2 flex justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {/* import tab: overflow-hidden + flex so ImportPanel owns scroller (K19 sticky bar) */}
      <div
        className={cn(
          "flex-1 min-h-0",
          tab === "import" ? "flex flex-col overflow-hidden" : "overflow-y-auto",
        )}
      >
        {tab === "home" && (
          <LedgerHome ledgerId={active.id} unlockToken={unlockToken} onGo={setTab} />
        )}
        {tab === "tx" && (
          <TxPanel ledgerId={active.id} unlockToken={unlockToken} onError={setError} />
        )}
        {tab === "import" && (
          <ImportPanel
            ledgerId={active.id}
            unlockToken={unlockToken}
            onError={setError}
            onGoRules={() => setTab("rules")}
            onGoTx={() => setTab("tx")}
            onGoStats={() => setTab("stats")}
          />
        )}
        {tab === "accounts" && (
          <AccountsPanel ledgerId={active.id} unlockToken={unlockToken} onError={setError} />
        )}
        {tab === "rules" && (
          <RulesPanel ledgerId={active.id} unlockToken={unlockToken} onError={setError} />
        )}
        {tab === "stats" && (
          <StatsDashboard
            ledgerId={active.id}
            unlockToken={unlockToken}
            onGoImport={() => setTab("import")}
            onDrill={(f: StatsDrillFilter) => {
              try {
                sessionStorage.setItem(TX_FILTER_KEY(active.id), JSON.stringify(f));
              } catch {
                /* ignore */
              }
              setTab("tx");
            }}
          />
        )}
        {tab === "budget" && (
          <BudgetPanel ledgerId={active.id} unlockToken={unlockToken} onError={setError} />
        )}
        {tab === "recurring" && (
          <RecurringPanel ledgerId={active.id} unlockToken={unlockToken} onError={setError} />
        )}
        {tab === "advice" && (
          <AdvicePanel ledgerId={active.id} unlockToken={unlockToken} />
        )}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" />
      <div
        className="relative z-10 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-app-border p-4 shadow-xl text-tx-primary"
        style={{ backgroundColor: "var(--color-elevated-solid, var(--color-elevated))" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-tx-primary">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-app-hover text-tx-secondary">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function LedgerHome({
  ledgerId,
  unlockToken,
  onGo,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onGo: (t: Tab) => void;
}) {
  const now = new Date();
  const [ym, setYm] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [summary, setSummary] = useState<any>(null);
  const [recent, setRecent] = useState<FinanceTransaction[]>([]);
  const [showTx, setShowTx] = useState(false);
  const [budgetHint, setBudgetHint] = useState<any[]>([]);

  useEffect(() => {
    const [year, month] = ym.split("-");
    api.finance
      .statsSummary(ledgerId, { year, month: String(Number(month)) }, unlockToken)
      .then(setSummary)
      .catch(() => {});
    api.finance
      .listTransactions(ledgerId, { limit: 8 }, unlockToken)
      .then((r) => setRecent(r.items))
      .catch(() => {});
    api.finance
      .listBudgets(ledgerId, ym, unlockToken)
      .then(setBudgetHint)
      .catch(() => setBudgetHint([]));
  }, [ledgerId, unlockToken, ym]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-tx-secondary">月份</label>
        <input
          type="month"
          className="px-2 py-1 rounded border border-app-border bg-app-bg text-sm"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="本月收入" value={yuan(summary?.incomeMinor)} tone="good" />
        <Kpi label="本月支出" value={yuan(summary?.expensesMinor)} tone="bad" />
        <Kpi label="结余" value={yuan(summary?.netMinor)} />
        <Kpi label="净资产" value={yuan(summary?.netWorthMinor)} />
      </div>
      {budgetHint.length > 0 && (
        <button
          type="button"
          onClick={() => onGo("budget")}
          className="w-full text-left rounded-xl border border-app-border bg-app-card p-3"
        >
          <div className="text-xs text-tx-tertiary mb-1">本月预算速览</div>
          {budgetHint.slice(0, 2).map((b) => (
            <div key={b.id} className="flex justify-between text-sm mb-1">
              <span>{b.accountName || "总支出"}</span>
              <span className={cn("tabular-nums", b.ratio > 1 && "text-rose-500")}>
                {Math.round((b.ratio || 0) * 100)}% · ¥{yuan(b.spentMinor)}/¥{yuan(b.amountMinor)}
              </span>
            </div>
          ))}
        </button>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setShowTx(true)} className="px-3 py-2 rounded-lg bg-accent-primary text-white text-sm inline-flex items-center gap-1">
          <Plus size={14} /> 记一笔
        </button>
        <button type="button" onClick={() => onGo("import")} className="px-3 py-2 rounded-lg border border-app-border text-sm inline-flex items-center gap-1">
          <Upload size={14} /> 导入账单
        </button>
        <button type="button" onClick={() => onGo("stats")} className="px-3 py-2 rounded-lg border border-app-border text-sm">
          查看统计
        </button>
        <button type="button" onClick={() => onGo("budget")} className="px-3 py-2 rounded-lg border border-app-border text-sm">
          预算
        </button>
      </div>

      <section>
        <h3 className="text-sm font-medium text-tx-secondary mb-2">最近明细</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-tx-tertiary">暂无交易，试试导入账单或手动记账</p>
        ) : (
          <ul className="divide-y divide-app-border rounded-xl border border-app-border overflow-hidden">
            {recent.map((t) => (
              <TxRow
                key={t.id}
                tx={t}
                onTagClick={(tag) => {
                  onGo("tx");
                  // 明细页会加载；通过 session 传递筛选
                  try {
                    sessionStorage.setItem(`finance.tagFilter.${ledgerId}`, tag);
                  } catch {
                    /* ignore */
                  }
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {showTx && (
        <ManualTxModal
          ledgerId={ledgerId}
          unlockToken={unlockToken}
          onClose={() => setShowTx(false)}
          onSaved={() => {
            setShowTx(false);
            api.finance.listTransactions(ledgerId, { limit: 8 }, unlockToken).then((r) => setRecent(r.items));
            const [year, month] = ym.split("-");
            api.finance
              .statsSummary(ledgerId, { year, month: String(Number(month)) }, unlockToken)
              .then(setSummary);
            api.finance.listBudgets(ledgerId, ym, unlockToken).then(setBudgetHint).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-app-border bg-app-card p-3">
      <div className="text-xs text-tx-tertiary">{label}</div>
      <div
        className={cn(
          "text-lg font-semibold mt-1 tabular-nums",
          tone === "good" && "text-accent-primary",
          tone === "bad" && "text-rose-500",
        )}
      >
        ¥{value}
      </div>
    </div>
  );
}

function TxRow({
  tx,
  onTagClick,
}: {
  tx: FinanceTransaction;
  onTagClick?: (tag: string) => void;
}) {
  const expense = tx.postings?.find((p) => p.accountType === "EXPENSES");
  const income = tx.postings?.find((p) => p.accountType === "INCOME");
  const amount = expense
    ? -Math.abs(expense.amountMinor)
    : income
      ? Math.abs(income.amountMinor)
      : tx.postings?.[0]?.amountMinor || 0;
  const tags = tx.tags || [];
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 bg-app-card">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{tx.payee || tx.narration || "未命名"}</div>
        <div className="text-xs text-tx-tertiary truncate">
          {tx.date} {tx.narration && tx.payee ? `· ${tx.narration}` : ""}
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                className="text-[11px] text-accent-primary hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  onTagClick?.(t);
                }}
              >
                #{t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className={cn("text-sm font-medium tabular-nums", amount < 0 ? "text-rose-500" : "text-accent-primary")}>
        {amount < 0 ? "-" : "+"}¥{yuan(Math.abs(amount))}
      </div>
    </li>
  );
}

function ManualTxModal({
  ledgerId,
  unlockToken,
  onClose,
  onSaved,
  editTx,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onClose: () => void;
  onSaved: () => void;
  editTx?: FinanceTransaction | null;
}) {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; payload: any }>>([]);
  const [kind, setKind] = useState<"expense" | "income" | "transfer">("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [payee, setPayee] = useState("");
  const [narration, setNarration] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagCatalog, setTagCatalog] = useState<{ tags: string[]; presets: string[]; used: string[] }>({
    tags: [],
    presets: [],
    used: [],
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isEdit = !!editTx;

  useEffect(() => {
    api.finance.listTemplates(ledgerId, unlockToken).then(setTemplates).catch(() => {});
    api.finance
      .listFinanceTags(ledgerId, unlockToken)
      .then(setTagCatalog)
      .catch(() => {});
  }, [ledgerId, unlockToken]);

  useEffect(() => {
    api.finance.listAccounts(ledgerId, unlockToken).then((list) => {
      setAccounts(list.filter((a) => a.isOpen));
      if (editTx?.postings && editTx.postings.length >= 2) {
        const exp = editTx.postings.find((p) => p.accountType === "EXPENSES");
        const inc = editTx.postings.find((p) => p.accountType === "INCOME");
        const assets = editTx.postings.filter(
          (p) => p.accountType === "ASSETS" || p.accountType === "LIABILITIES",
        );
        if (exp) {
          setKind("expense");
          setToId(exp.accountId);
          setFromId(assets.find((p) => p.amountMinor < 0)?.accountId || assets[0]?.accountId || "");
          setAmount((Math.abs(exp.amountMinor) / 100).toFixed(2));
        } else if (inc) {
          setKind("income");
          setFromId(inc.accountId);
          setToId(assets.find((p) => p.amountMinor > 0)?.accountId || assets[0]?.accountId || "");
          setAmount((Math.abs(inc.amountMinor) / 100).toFixed(2));
        } else {
          setKind("transfer");
          const toP = assets.find((p) => p.amountMinor > 0);
          const fromP = assets.find((p) => p.amountMinor < 0);
          setToId(toP?.accountId || "");
          setFromId(fromP?.accountId || "");
          setAmount((Math.abs(toP?.amountMinor || fromP?.amountMinor || 0) / 100).toFixed(2));
        }
        setDate(editTx.date);
        setPayee(editTx.payee || "");
        setNarration(editTx.narration || "");
        setTags(editTx.tags || []);
        return;
      }
      const cash =
        list.find((a) => a.name.includes("EBank:Wechat:Hubby")) ||
        list.find((a) => a.name === "Assets:Cash") ||
        list.find((a) => a.type === "ASSETS");
      const food =
        list.find((a) => a.name.includes("DailyLiving:Meals")) ||
        list.find((a) => a.name === "Expenses:Food") ||
        list.find((a) => a.type === "EXPENSES");
      const salary =
        list.find((a) => a.name.includes("Salary:Hubby:Base")) ||
        list.find((a) => a.name.startsWith("Income:Salary")) ||
        list.find((a) => a.type === "INCOME");
      if (kind === "expense") {
        setFromId(cash?.id || "");
        setToId(food?.id || "");
      } else if (kind === "income") {
        setFromId(salary?.id || "");
        setToId(cash?.id || "");
      } else {
        setFromId(cash?.id || "");
        setToId(list.find((a) => a.type === "ASSETS" && a.id !== cash?.id)?.id || "");
      }
    });
  }, [ledgerId, unlockToken, kind, editTx]);

  const fromOptions = useMemo(() => {
    if (kind === "expense") return accounts.filter((a) => a.type === "ASSETS" || a.type === "LIABILITIES");
    if (kind === "income") return accounts.filter((a) => a.type === "INCOME");
    return accounts.filter((a) => a.type === "ASSETS" || a.type === "LIABILITIES");
  }, [accounts, kind]);

  const toOptions = useMemo(() => {
    if (kind === "expense") return accounts.filter((a) => a.type === "EXPENSES");
    if (kind === "income") return accounts.filter((a) => a.type === "ASSETS" || a.type === "LIABILITIES");
    return accounts.filter((a) => a.type === "ASSETS" || a.type === "LIABILITIES");
  }, [accounts, kind]);

  const payload = () => ({
    kind,
    amountYuan: amount,
    date,
    payee,
    narration,
    fromAccountId: fromId,
    toAccountId: toId,
    tags,
  });

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      if (isEdit && editTx) {
        await api.finance.updateTransaction(ledgerId, editTx.id, payload(), unlockToken);
      } else {
        await api.finance.createTransaction(ledgerId, payload(), unlockToken);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const saveAsTemplate = async () => {
    const name = window.prompt("模板名称", payee || narration || "常用记账");
    if (!name) return;
    try {
      await api.finance.saveTemplate(ledgerId, { name, payload: payload() }, unlockToken);
      const list = await api.finance.listTemplates(ledgerId, unlockToken);
      setTemplates(list);
      alert("模板已保存");
    } catch (e: any) {
      setErr(e?.message || "保存模板失败");
    }
  };

  const applyTemplate = (p: any) => {
    if (p.kind) setKind(p.kind);
    if (p.amountYuan != null) setAmount(String(p.amountYuan));
    if (p.payee != null) setPayee(String(p.payee));
    if (p.narration != null) setNarration(String(p.narration));
    if (p.fromAccountId) setFromId(String(p.fromAccountId));
    if (p.toAccountId) setToId(String(p.toAccountId));
    if (Array.isArray(p.tags)) setTags(p.tags.map(String));
    // 日期默认今天，不覆盖
  };

  return (
    <Modal title={isEdit ? "编辑交易" : "记一笔"} onClose={onClose}>
      {!isEdit && templates.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {templates.slice(0, 6).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => applyTemplate(t.payload)}
              className="px-2 py-1 rounded-full text-xs border border-app-border hover:border-accent-primary/50"
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1 mb-3">
        {(["expense", "income", "transfer"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-sm",
              kind === k ? "bg-accent-primary text-white" : "bg-app-bg border border-app-border",
            )}
          >
            {k === "expense" ? "支出" : k === "income" ? "收入" : "转账"}
          </button>
        ))}
      </div>
      <label className="text-xs text-tx-tertiary">金额</label>
      <input
        inputMode="decimal"
        className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-lg"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
      />
      <label className="text-xs text-tx-tertiary">日期</label>
      <input type="date" className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={date} onChange={(e) => setDate(e.target.value)} />
      <label className="text-xs text-tx-tertiary">{kind === "expense" ? "付款账户" : kind === "income" ? "收入分类" : "转出账户"}</label>
      <div className="mb-2">
        <AccountPicker
          accounts={fromOptions}
          value={fromId}
          onChange={setFromId}
          allowEmpty={false}
          placeholder={kind === "expense" ? "付款账户" : kind === "income" ? "收入分类" : "转出账户"}
        />
      </div>
      <label className="text-xs text-tx-tertiary">{kind === "expense" ? "支出分类" : kind === "income" ? "入账账户" : "转入账户"}</label>
      <div className="mb-2">
        <AccountPicker
          accounts={toOptions}
          value={toId}
          onChange={setToId}
          allowEmpty={false}
          placeholder={kind === "expense" ? "支出分类" : kind === "income" ? "入账账户" : "转入账户"}
        />
      </div>
      <label className="text-xs text-tx-tertiary">对方</label>
      <input className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={payee} onChange={(e) => setPayee(e.target.value)} />
      <label className="text-xs text-tx-tertiary">备注</label>
      <input className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={narration} onChange={(e) => setNarration(e.target.value)} />
      <label className="text-xs text-tx-tertiary">标签</label>
      <div className="mb-3">
        <TagPicker
          value={tags}
          onChange={setTags}
          suggestions={tagCatalog.used}
          presets={tagCatalog.presets}
        />
      </div>
      {err && <p className="text-sm text-red-500 mb-2">{err}</p>}
      <div className="flex gap-2">
        {!isEdit && (
          <button
            type="button"
            onClick={saveAsTemplate}
            className="px-3 py-2 rounded-lg border border-app-border text-sm inline-flex items-center gap-1"
            title="存为模板"
          >
            <Bookmark size={14} />
          </button>
        )}
        <button type="button" disabled={saving || !amount} onClick={save} className="flex-1 py-2 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50">
          {saving ? "保存中…" : isEdit ? "更新" : "保存"}
        </button>
      </div>
    </Modal>
  );
}

function TxPanel({
  ledgerId,
  unlockToken,
  onError,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<FinanceTransaction[]>([]);
  const [q, setQ] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accountPrefix, setAccountPrefix] = useState("");
  const [payeeFilter, setPayeeFilter] = useState("");
  const [tagCatalog, setTagCatalog] = useState<{ tags: string[]; presets: string[]; used: string[] }>({
    tags: [],
    presets: [],
    used: [],
  });
  const [showTx, setShowTx] = useState(false);
  const [editTx, setEditTx] = useState<FinanceTransaction | null>(null);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    api.finance
      .listTransactions(
        ledgerId,
        {
          q: q || undefined,
          tag: tagFilter || undefined,
          from: from || undefined,
          to: to || undefined,
          accountId: accountId || undefined,
          accountPrefix: accountPrefix || undefined,
          payee: payeeFilter || undefined,
          limit: 100,
        },
        unlockToken,
      )
      .then((r) => {
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((e) => onError(e?.message || "加载失败"));
  }, [ledgerId, unlockToken, q, tagFilter, from, to, accountId, accountPrefix, payeeFilter, onError]);

  useEffect(() => {
    api.finance
      .listFinanceTags(ledgerId, unlockToken)
      .then(setTagCatalog)
      .catch(() => {});
    try {
      const saved = sessionStorage.getItem(`finance.tagFilter.${ledgerId}`);
      if (saved) {
        setTagFilter(saved);
        sessionStorage.removeItem(`finance.tagFilter.${ledgerId}`);
      }
      const drill = sessionStorage.getItem(TX_FILTER_KEY(ledgerId));
      if (drill) {
        const f = JSON.parse(drill) as StatsDrillFilter;
        if (f.from) setFrom(f.from);
        if (f.to) setTo(f.to);
        if (f.accountId) setAccountId(f.accountId);
        if (f.accountPrefix) setAccountPrefix(f.accountPrefix);
        if (f.payee) setPayeeFilter(f.payee);
        if (f.tag) setTagFilter(f.tag);
        if (f.q) setQ(f.q);
        sessionStorage.removeItem(TX_FILTER_KEY(ledgerId));
      }
    } catch {
      /* ignore */
    }
  }, [ledgerId, unlockToken]);

  useEffect(() => {
    load();
  }, [load]);

  const hasExtraFilter = !!(from || to || accountId || accountPrefix || payeeFilter);

  return (
    <div className="p-4">
      <div className="flex gap-2 mb-2">
        <input
          className="flex-1 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-sm"
          placeholder="搜索对方/备注/标签"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setEditTx(null);
            setShowTx(true);
          }}
          className="px-3 py-2 rounded-lg bg-accent-primary text-white text-sm"
        >
          <Plus size={16} />
        </button>
      </div>
      {hasExtraFilter && (
        <div className="mb-2 flex flex-wrap gap-1.5 items-center text-[11px]">
          {from && to && (
            <span className="px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600">
              {from} ~ {to}
            </span>
          )}
          {accountPrefix && (
            <span className="px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary truncate max-w-[200px]">
              账户 {accountPrefix}
            </span>
          )}
          {accountId && (
            <span className="px-2 py-0.5 rounded-full bg-accent-primary/10 text-accent-primary">指定账户</span>
          )}
          {payeeFilter && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700">对方 {payeeFilter}</span>
          )}
          <button
            type="button"
            className="text-tx-tertiary underline"
            onClick={() => {
              setFrom("");
              setTo("");
              setAccountId("");
              setAccountPrefix("");
              setPayeeFilter("");
            }}
          >
            清除筛选
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <button
          type="button"
          onClick={() => setTagFilter("")}
          className={cn(
            "px-2 py-0.5 rounded-full text-[11px] border",
            !tagFilter
              ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
              : "border-app-border text-tx-tertiary",
          )}
        >
          全部
        </button>
        {(tagCatalog.used.length ? tagCatalog.used : tagCatalog.presets.slice(0, 8)).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTagFilter(tagFilter === t ? "" : t)}
            className={cn(
              "px-2 py-0.5 rounded-full text-[11px] border",
              tagFilter === t
                ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                : "border-app-border text-tx-tertiary hover:border-accent-primary/40",
            )}
          >
            #{t}
          </button>
        ))}
      </div>
      <p className="text-xs text-tx-tertiary mb-2">
        共 {total} 笔{tagFilter ? ` · 标签 #${tagFilter}` : ""}
      </p>
      <ul className="divide-y divide-app-border rounded-xl border border-app-border overflow-hidden">
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-1 bg-app-card">
            <div className="flex-1 min-w-0">
              <TxRow tx={t} onTagClick={(tag) => setTagFilter(tag)} />
            </div>
            <button
              type="button"
              className="p-2 text-tx-tertiary hover:text-accent-primary shrink-0"
              title="编辑"
              onClick={() => {
                setEditTx(t);
                setShowTx(true);
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="p-2 text-tx-tertiary hover:text-red-500 shrink-0"
              onClick={async () => {
                if (!confirm("删除这笔交易？")) return;
                try {
                  await api.finance.deleteTransaction(ledgerId, t.id, unlockToken);
                  load();
                } catch (e: any) {
                  onError(e?.message || "删除失败");
                }
              }}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {showTx && (
        <ManualTxModal
          ledgerId={ledgerId}
          unlockToken={unlockToken}
          editTx={editTx}
          onClose={() => {
            setShowTx(false);
            setEditTx(null);
          }}
          onSaved={() => {
            setShowTx(false);
            setEditTx(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AccountsPanel({
  ledgerId,
  unlockToken,
  onError,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
}) {
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("Expenses:");
  const [type, setType] = useState("EXPENSES");

  const load = () =>
    api.finance.listAccounts(ledgerId, unlockToken).then(setAccounts).catch((e) => onError(e?.message));

  useEffect(() => {
    load();
  }, [ledgerId, unlockToken]);

  const groups = useMemo(() => {
    const g: Record<string, FinanceAccount[]> = {};
    for (const a of accounts) {
      (g[a.type] ||= []).push(a);
    }
    return g;
  }, [accounts]);

  return (
    <div className="p-4 space-y-4">
      <button type="button" onClick={() => setShow(true)} className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm">
        新建账户
      </button>
      {Object.entries(groups).map(([t, list]) => (
        <section key={t}>
          <h3 className="text-xs font-medium text-tx-tertiary mb-1">{t}</h3>
          <ul className="rounded-xl border border-app-border divide-y divide-app-border">
            {list.map((a) => (
              <li key={a.id} className="flex justify-between px-3 py-2 text-sm bg-app-card">
                <span>{a.name}</span>
                <span className="tabular-nums text-tx-secondary">¥{yuan(a.balanceMinor)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {show && (
        <Modal title="新建账户" onClose={() => setShow(false)}>
          <select className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={type} onChange={(e) => setType(e.target.value)}>
            {["ASSETS", "LIABILITIES", "INCOME", "EXPENSES", "EQUITY"].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input className="w-full mb-3 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Assets:Bank:ICBC" />
          <button
            type="button"
            className="w-full py-2 rounded-lg bg-accent-primary text-white text-sm"
            onClick={async () => {
              try {
                await api.finance.createAccount(ledgerId, { name, type }, unlockToken);
                setShow(false);
                load();
              } catch (e: any) {
                onError(e?.message || "创建失败");
              }
            }}
          >
            创建
          </button>
        </Modal>
      )}
    </div>
  );
}

function BudgetPanel({
  ledgerId,
  unlockToken,
  onError,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
}) {
  const now = new Date();
  const [ym, setYm] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  );
  const [items, setItems] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [show, setShow] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(() => {
    api.finance.listBudgets(ledgerId, ym, unlockToken).then(setItems).catch((e) => onError(e?.message));
  }, [ledgerId, ym, unlockToken, onError]);

  useEffect(() => {
    load();
    api.finance.listAccounts(ledgerId, unlockToken).then(setAccounts).catch(() => {});
  }, [load, ledgerId, unlockToken]);

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-sm text-tx-secondary">月份</label>
        <input
          type="month"
          className="px-2 py-1 rounded border border-app-border bg-app-bg text-sm"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
        />
        <button
          type="button"
          className="ml-auto px-3 py-1.5 rounded-lg border border-app-border text-sm"
          onClick={async () => {
            try {
              const res = await api.finance.copyBudgets(
                ledgerId,
                { toYearMonth: ym, overwrite: false },
                unlockToken,
              );
              setItems(res.budgets);
              alert(`已从上月复制 ${res.copied} 条${res.skipped ? `，跳过已有 ${res.skipped} 条` : ""}`);
            } catch (e: any) {
              onError(e?.message || "复制失败");
            }
          }}
        >
          从上月复制
        </button>
        <button
          type="button"
          onClick={() => setShow(true)}
          className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm"
        >
          添加预算
        </button>
      </div>
      <p className="text-xs text-tx-tertiary">
        可设「总支出」或按支出分类账户的月度上限，进度条对比当月实际支出。
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-tx-tertiary py-8 text-center">本月尚未设置预算</p>
      ) : (
        <ul className="space-y-3">
          {items.map((b) => {
            const pct = Math.min(100, Math.round((b.ratio || 0) * 100));
            const over = b.ratio > 1;
            return (
              <li key={b.id} className="rounded-xl border border-app-border bg-app-card p-3">
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium">{b.accountName || "总支出"}</span>
                  <button
                    type="button"
                    className="text-tx-tertiary hover:text-red-500"
                    onClick={async () => {
                      await api.finance.deleteBudget(ledgerId, b.id, unlockToken);
                      load();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="flex justify-between text-xs text-tx-tertiary mt-1 tabular-nums">
                  <span>
                    已用 ¥{yuan(b.spentMinor)} / 预算 ¥{yuan(b.amountMinor)}
                  </span>
                  <span className={over ? "text-rose-500" : ""}>
                    {over ? "超支" : "剩余"} ¥{yuan(Math.abs(b.remainingMinor))}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-app-hover overflow-hidden mt-2">
                  <div
                    className={cn("h-full rounded-full", over ? "bg-rose-500" : "bg-accent-primary")}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {b.note && <p className="text-xs text-tx-tertiary mt-1">{b.note}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {show && (
        <Modal title="添加预算" onClose={() => setShow(false)}>
          <label className="text-xs text-tx-tertiary">月份</label>
          <input type="month" className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={ym} onChange={(e) => setYm(e.target.value)} />
          <label className="text-xs text-tx-tertiary">范围</label>
          <select className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">总支出</option>
            {accounts.filter((a) => a.type === "EXPENSES").map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <label className="text-xs text-tx-tertiary">预算金额（元）</label>
          <input className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="5000" />
          <label className="text-xs text-tx-tertiary">备注</label>
          <input className="w-full mb-3 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            type="button"
            className="w-full py-2 rounded-lg bg-accent-primary text-white text-sm"
            onClick={async () => {
              try {
                await api.finance.saveBudget(
                  ledgerId,
                  {
                    yearMonth: ym,
                    accountId: accountId || null,
                    amountYuan: amount,
                    note: note || undefined,
                  },
                  unlockToken,
                );
                setShow(false);
                setAmount("");
                setNote("");
                setAccountId("");
                load();
              } catch (e: any) {
                onError(e?.message || "保存失败");
              }
            }}
          >
            保存
          </button>
        </Modal>
      )}
    </div>
  );
}

function RecurringPanel({
  ledgerId,
  unlockToken,
  onError,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<"monthly" | "weekly" | "interval">("monthly");
  const [day, setDay] = useState("1");
  const [amount, setAmount] = useState("");
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [payee, setPayee] = useState("");
  const [autoPost, setAutoPost] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    api.finance.listRecurring(ledgerId, unlockToken).then(setItems).catch((e) => onError(e?.message));
  }, [ledgerId, unlockToken, onError]);

  useEffect(() => {
    load();
    api.finance.listAccounts(ledgerId, unlockToken).then((list) => {
      setAccounts(list.filter((a) => a.isOpen));
      const cash =
        list.find((a) => a.name.includes("EBank:Wechat:Hubby")) ||
        list.find((a) => a.name === "Assets:Cash") ||
        list.find((a) => a.type === "ASSETS");
      const housing =
        list.find((a) => a.name.includes("Utilities:Property") || a.name.includes("MortgageInterest")) ||
        list.find((a) => a.name.includes("Housing") || a.name.includes("Rent")) ||
        list.find((a) => a.type === "EXPENSES");
      setFromId(cash?.id || "");
      setToId(housing?.id || "");
    }).catch(() => {});
  }, [load, ledgerId, unlockToken]);

  const ruleLabel = (r: any) => {
    if (r.ruleType === "monthly") return `每月 ${r.rule?.day || 1} 日`;
    if (r.ruleType === "weekly") {
      const names = ["日", "一", "二", "三", "四", "五", "六"];
      return `每周${names[r.rule?.weekday ?? r.rule?.day ?? 1]}`;
    }
    return `每 ${r.rule?.days || r.rule?.day || 1} 天`;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setShow(true)}
          className="px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm"
        >
          新建定期
        </button>
        <button
          type="button"
          disabled={running}
          className="px-3 py-1.5 rounded-lg border border-app-border text-sm inline-flex items-center gap-1"
          onClick={async () => {
            setRunning(true);
            try {
              const r = await api.finance.runRecurringDue();
              alert(`已处理：自动记账 ${r.posted}，提醒 ${r.notified}${r.errors?.length ? `\n错误：${r.errors[0]}` : ""}`);
              load();
            } catch (e: any) {
              onError(e?.message || "执行失败");
            } finally {
              setRunning(false);
            }
          }}
        >
          <RefreshCw size={14} className={running ? "animate-spin" : ""} />
          立即执行到期
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-tx-tertiary self-center">快捷：</span>
        {[
          { name: "工资", kind: "income" as const, amount: "15000", day: "10", payee: "工资" },
          { name: "房租", kind: "expense" as const, amount: "3000", day: "1", payee: "房租" },
          { name: "物业费", kind: "expense" as const, amount: "200", day: "5", payee: "物业" },
        ].map((p) => (
          <button
            key={p.name}
            type="button"
            className="px-2 py-1 rounded-full text-xs border border-app-border hover:border-accent-primary/50"
            onClick={async () => {
              const incomeAcc =
                accounts.find((a) => a.name.includes("Salary:Hubby:Base")) ||
                accounts.find((a) => a.name.startsWith("Income:Salary")) ||
                accounts.find((a) => a.type === "INCOME");
              const bank =
                accounts.find((a) => a.name.includes("Bank:CMB:Hubby") || a.name.includes("EBank:AliPay:Hubby")) ||
                accounts.find((a) => a.name.includes("Bank") || a.name.includes("AliPay")) ||
                accounts.find((a) => a.type === "ASSETS");
              const exp =
                accounts.find((a) => a.name.includes("Utilities:Property") || a.name.includes("MortgageInterest")) ||
                accounts.find((a) => a.name.includes("Housing") || a.name.includes("Rent")) ||
                accounts.find((a) => a.type === "EXPENSES");
              if (p.kind === "income") {
                if (!incomeAcc || !bank) {
                  onError("请先确保有收入与资产账户");
                  return;
                }
                try {
                  await api.finance.saveRecurring(
                    ledgerId,
                    {
                      name: p.name,
                      ruleType: "monthly",
                      rule: { day: Number(p.day) },
                      payload: {
                        kind: "income",
                        amountYuan: p.amount,
                        fromAccountId: incomeAcc.id,
                        toAccountId: bank.id,
                        payee: p.payee,
                        narration: p.name,
                      },
                      autoPost: true,
                    },
                    unlockToken,
                  );
                  load();
                } catch (e: any) {
                  onError(e?.message || "创建失败");
                }
              } else {
                if (!bank || !exp) {
                  onError("请先确保有资产与支出账户");
                  return;
                }
                try {
                  await api.finance.saveRecurring(
                    ledgerId,
                    {
                      name: p.name,
                      ruleType: "monthly",
                      rule: { day: Number(p.day) },
                      payload: {
                        kind: "expense",
                        amountYuan: p.amount,
                        fromAccountId: bank.id,
                        toAccountId: exp.id,
                        payee: p.payee,
                        narration: p.name,
                      },
                      autoPost: true,
                    },
                    unlockToken,
                  );
                  load();
                } catch (e: any) {
                  onError(e?.message || "创建失败");
                }
              }
            }}
          >
            + {p.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-tx-tertiary">
        后台每 10 分钟检查到期项。开启「自动入账」会写入交易并通知；关闭则只发提醒。快捷模板金额可再编辑。
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-tx-tertiary text-center py-8">暂无定期记账（如房租、订阅）</p>
      ) : (
        <ul className="space-y-2">
          {items.map((r) => (
            <li key={r.id} className="rounded-xl border border-app-border bg-app-card p-3 text-sm">
              <div className="flex justify-between gap-2">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-tx-tertiary mt-0.5">
                    {ruleLabel(r)} · 下次 {r.nextRunDate}
                    {r.autoPost ? " · 自动入账" : " · 仅提醒"}
                    {!r.enabled && " · 已停用"}
                  </div>
                  <div className="text-xs text-tx-secondary mt-1 tabular-nums">
                    ¥{String(r.payload?.amountYuan ?? "")} · {r.payload?.payee || r.payload?.narration || ""}
                  </div>
                </div>
                <div className="flex flex-col gap-1 items-end">
                  <button
                    type="button"
                    className="text-xs text-tx-tertiary"
                    onClick={async () => {
                      await api.finance.saveRecurring(
                        ledgerId,
                        {
                          id: r.id,
                          name: r.name,
                          enabled: !r.enabled,
                          ruleType: r.ruleType,
                          rule: r.rule,
                          payload: r.payload,
                          nextRunDate: r.nextRunDate,
                          endDate: r.endDate,
                          autoPost: r.autoPost,
                        },
                        unlockToken,
                      );
                      load();
                    }}
                  >
                    {r.enabled ? "停用" : "启用"}
                  </button>
                  <button
                    type="button"
                    className="text-red-500 p-1"
                    onClick={async () => {
                      if (!confirm("删除该定期？")) return;
                      await api.finance.deleteRecurring(ledgerId, r.id, unlockToken);
                      load();
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {show && (
        <Modal title="新建定期记账" onClose={() => setShow(false)}>
          <input
            className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg"
            placeholder="名称（如：房租 / 工资）"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex gap-1 mb-2">
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  if (k === "income") {
                    const incomeAcc = accounts.find((a) => a.type === "INCOME");
                    const bank = accounts.find((a) => a.type === "ASSETS");
                    setFromId(incomeAcc?.id || "");
                    setToId(bank?.id || "");
                  } else {
                    const cash = accounts.find((a) => a.type === "ASSETS");
                    const exp = accounts.find((a) => a.type === "EXPENSES");
                    setFromId(cash?.id || "");
                    setToId(exp?.id || "");
                  }
                }}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-xs",
                  kind === k ? "bg-accent-primary text-white" : "border border-app-border",
                )}
              >
                {k === "expense" ? "定期支出" : "定期收入"}
              </button>
            ))}
          </div>
          <div className="flex gap-1 mb-2">
            {(["monthly", "weekly", "interval"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRuleType(t)}
                className={cn(
                  "flex-1 py-1.5 rounded-lg text-xs",
                  ruleType === t ? "bg-accent-primary text-white" : "border border-app-border",
                )}
              >
                {t === "monthly" ? "每月" : t === "weekly" ? "每周" : "间隔天"}
              </button>
            ))}
          </div>
          <label className="text-xs text-tx-tertiary">
            {ruleType === "monthly" ? "每月几号 (1-28)" : ruleType === "weekly" ? "星期 (0日-6六)" : "每隔几天"}
          </label>
          <input
            className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <label className="text-xs text-tx-tertiary">金额</label>
          <input
            className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <label className="text-xs text-tx-tertiary">
            {kind === "income" ? "收入分类" : "付款账户"}
          </label>
          <select className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {accounts
              .filter((a) =>
                kind === "income"
                  ? a.type === "INCOME"
                  : a.type === "ASSETS" || a.type === "LIABILITIES",
              )
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
          <label className="text-xs text-tx-tertiary">
            {kind === "income" ? "入账账户" : "支出分类"}
          </label>
          <select className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts
              .filter((a) =>
                kind === "income"
                  ? a.type === "ASSETS" || a.type === "LIABILITIES"
                  : a.type === "EXPENSES",
              )
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
          <label className="text-xs text-tx-tertiary">对方/备注</label>
          <input className="w-full mb-2 px-3 py-2 rounded-lg border border-app-border bg-app-bg" value={payee} onChange={(e) => setPayee(e.target.value)} />
          <label className="flex items-center gap-2 text-sm mb-3">
            <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
            到期自动入账（关闭则只通知）
          </label>
          <button
            type="button"
            className="w-full py-2 rounded-lg bg-accent-primary text-white text-sm"
            onClick={async () => {
              try {
                const n = Number(day) || 1;
                const rule =
                  ruleType === "monthly"
                    ? { day: n }
                    : ruleType === "weekly"
                      ? { weekday: n }
                      : { days: n };
                await api.finance.saveRecurring(
                  ledgerId,
                  {
                    name,
                    ruleType,
                    rule,
                    payload: {
                      kind,
                      amountYuan: amount,
                      fromAccountId: fromId,
                      toAccountId: toId,
                      payee,
                      narration: name,
                    },
                    autoPost,
                  },
                  unlockToken,
                );
                setShow(false);
                setName("");
                setAmount("");
                load();
              } catch (e: any) {
                onError(e?.message || "保存失败");
              }
            }}
          >
            保存
          </button>
        </Modal>
      )}
    </div>
  );
}

function AdvicePanel({ ledgerId, unlockToken }: { ledgerId: string; unlockToken: string | null }) {
  const [insights, setInsights] = useState<FinanceInsight[]>([]);
  const [aiText, setAiText] = useState<string | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);

  useEffect(() => {
    api.finance.getAdvice(ledgerId, {}, unlockToken).then((r) => setInsights(r.insights)).catch(() => {});
  }, [ledgerId, unlockToken]);

  return (
    <div className="p-4 space-y-3">
      {insights.map((ins) => (
        <div
          key={ins.id}
          className={cn(
            "rounded-xl border p-3",
            ins.level === "warn" && "border-amber-500/40 bg-amber-500/5",
            ins.level === "good" && "border-accent-primary/40 bg-accent-primary/5",
            ins.level === "info" && "border-app-border bg-app-card",
          )}
        >
          <div className="font-medium text-sm flex justify-between">
            <span>{ins.title}</span>
            {ins.metric && <span className="text-tx-tertiary tabular-nums">{ins.metric}</span>}
          </div>
          <p className="text-sm text-tx-secondary mt-1">{ins.detail}</p>
        </div>
      ))}
      <button
        type="button"
        disabled={loadingAi}
        className="w-full py-2 rounded-lg border border-app-border text-sm"
        onClick={async () => {
          setLoadingAi(true);
          try {
            const r = await api.finance.getAdviceAi(ledgerId, {}, unlockToken);
            setAiText(r.aiText || r.message || "无 AI 输出");
            if (r.insights?.length) setInsights(r.insights);
          } catch (e: any) {
            setAiText(e?.message || "AI 调用失败");
          } finally {
            setLoadingAi(false);
          }
        }}
      >
        {loadingAi ? "生成中…" : "生成 AI 财务解读"}
      </button>
      {aiText && (
        <div className="rounded-xl border border-app-border bg-app-card p-3 text-sm whitespace-pre-wrap">
          {aiText}
        </div>
      )}
    </div>
  );
}
