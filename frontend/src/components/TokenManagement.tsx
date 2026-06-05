/**
 * TokenManagement · 个人访问令牌（Personal API Tokens）管理面板
 * ---------------------------------------------------------------------------
 * 进入路径：设置弹窗 → "个人访问令牌" tab
 *
 * 用户能在这里做：
 *   1. 列表：看自己创建过的所有 token（名称 / scopes / 过期 / 最近使用 / 状态）
 *   2. 创建：弹出表单（名称 + scope 多选 + 过期时间 30/90/365/永不）
 *   3. 一次性查看明文（创建成功后；窗口关闭后再也看不到）
 *   4. 吊销：危险操作，二次确认；吊销后行变灰，不再可用
 *
 * 设计要点：
 *   - 视觉与 SecuritySettings.tsx / SettingsModal.tsx 完全对齐
 *     （zinc 灰阶 + indigo 强调 + rounded-xl + 暗色模式 + framer-motion 进场）
 *   - 明文 token 的 UI **强迫用户先复制再关闭**（点关闭前先 confirm 二次提示）
 *   - 状态徽章语义化：active=绿 / expired=灰 / revoked=红
 *   - scope 用紧凑标签云展示（GitHub PAT 同款思路）
 *   - 空态友好：第一次进来时有"了解一下" + 直接"立即创建"双 CTA
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Key,
  Plus,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Clock,
  ShieldCheck,
  ShieldOff,
  X,
  Loader2,
  Eye,
  EyeOff,
  Info,
  RefreshCcw,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { confirm } from "@/components/ui/confirm";
import { toast } from "@/lib/toast";
import TokenUsageStats from "@/components/TokenUsageStats";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------
interface ApiTokenListItem {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string;
  revokedAt: string | null;
}

type TokenStatus = "active" | "expired" | "revoked";

/**
 * 计算 token 当前状态：
 *   - revokedAt 有值 → revoked（红）
 *   - expiresAt 有值且已过 → expired（灰）
 *   - 其它 → active（绿）
 *
 * 注意"永不过期"是 expiresAt = null，**不会**被视为 expired。
 */
function computeStatus(t: ApiTokenListItem): TokenStatus {
  if (t.revokedAt) return "revoked";
  if (t.expiresAt && Date.parse(t.expiresAt) < Date.now()) return "expired";
  return "active";
}

/** 友好相对时间："3 分钟前" / "昨天" / "—" */
function formatRelative(iso: string | null, t: (k: string, opts?: any) => string): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("tokens.timeJustNow", { defaultValue: "刚刚" });
  const min = Math.floor(sec / 60);
  if (min < 60)
    return t("tokens.timeMinAgo", { defaultValue: "{{n}} 分钟前", n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24)
    return t("tokens.timeHourAgo", { defaultValue: "{{n}} 小时前", n: hour });
  const day = Math.floor(hour / 24);
  if (day < 30) return t("tokens.timeDayAgo", { defaultValue: "{{n}} 天前", n: day });
  // 太久了直接给绝对日期
  return new Date(ts).toLocaleDateString();
}

/** 友好绝对日期："2026-05-20" 或"永不过期" */
function formatExpires(iso: string | null, t: (k: string, opts?: any) => string): string {
  if (!iso) return t("tokens.neverExpires", { defaultValue: "永不过期" });
  return new Date(iso).toLocaleDateString();
}

// 过期时间快选选项（天数 / null=永不）
const EXPIRES_PRESETS = [30, 90, 180, 365] as const;

// ---------------------------------------------------------------------------
// 主组件
// ---------------------------------------------------------------------------
export default function TokenManagement(): JSX.Element {
  const { t } = useTranslation();
  const [tokens, setTokens] = useState<ApiTokenListItem[]>([]);
  const [availableScopes, setAvailableScopes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 创建表单 / 明文展示对话框状态
  const [showCreate, setShowCreate] = useState(false);
  const [createdToken, setCreatedToken] = useState<{
    id: string;
    name: string;
    token: string;
  } | null>(null);

  /** 加载列表 */
  const reload = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      else setRefreshing(true);
      setError(null);
      try {
        const res = await api.tokens.list();
        setTokens(res.tokens);
        setAvailableScopes([...res.availableScopes]);
      } catch (e: any) {
        setError(e?.message || t("tokens.loadFail", { defaultValue: "加载失败" }));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  // 列表分组：未吊销在前，已吊销在后（后端已经按这个顺序，但前端再保险）
  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const aRevoked = a.revokedAt ? 1 : 0;
      const bRevoked = b.revokedAt ? 1 : 0;
      if (aRevoked !== bRevoked) return aRevoked - bRevoked;
      return Date.parse(b.createdAt) - Date.parse(a.createdAt);
    });
  }, [tokens]);

  /** 吊销 */
  const handleRevoke = async (token: ApiTokenListItem) => {
    const ok = await confirm({
      title: t("tokens.revokeConfirmTitle", { defaultValue: "确定吊销此令牌？" }),
      description: t("tokens.revokeConfirmDesc", {
        defaultValue:
          '使用该令牌的所有应用（含「{{name}}」）将立即失去访问权限。此操作不可撤销。',
        name: token.name,
      }),
      confirmText: t("tokens.revoke", { defaultValue: "吊销" }),
      cancelText: t("common.cancel", { defaultValue: "取消" }),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.tokens.revoke(token.id);
      toast.success(
        t("tokens.revokeSuccess", { defaultValue: '令牌「{{name}}」已吊销', name: token.name }),
      );
      await reload(true);
    } catch (e: any) {
      toast.error(e?.message || t("tokens.revokeFail", { defaultValue: "吊销失败" }));
    }
  };

  /** 创建成功 → 接管 createdToken 显示 */
  const handleCreated = (data: { id: string; name: string; token: string }) => {
    setCreatedToken(data);
    setShowCreate(false);
    void reload(true);
  };

  return (
    <div className="space-y-6 pb-2">
      {/* ============ 顶部说明 + 操作栏 ============ */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
            {t("tokens.title", { defaultValue: "个人访问令牌" })}
          </h2>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            {t("tokens.subtitle", {
              defaultValue:
                "为第三方应用（如书签同步、命令行工具）创建专属访问令牌，可随时单独吊销，无需更换密码。",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={() => void reload(true)}
            disabled={refreshing}
            className="p-2 rounded-lg text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 transition-all"
            title={t("common.refresh", { defaultValue: "刷新" })}
            aria-label={t("common.refresh", { defaultValue: "刷新" })}
          >
            {refreshing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCcw className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition-all shadow-sm hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            {t("tokens.createAction", { defaultValue: "创建令牌" })}
          </button>
        </div>
      </div>

      {/* ============ 安全提示横幅 ============ */}
      <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          {t("tokens.banner", {
            defaultValue:
              "令牌等同于密码：明文仅在创建时显示一次，请立即妥善保存。若怀疑泄漏，立刻吊销并重新创建即可。",
          })}
        </div>
      </div>

      {/* ============ 使用统计 ============ */}
      {/* 仅在至少有一个令牌的情况下显示，否则只是推广空话 */}
      {tokens.length > 0 && <TokenUsageStats />}

      {/* ============ 列表 ============ */}
      {loading ? (
        <div className="py-12 flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          {t("tokens.loading", { defaultValue: "加载中..." })}
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/5 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      ) : sortedTokens.length === 0 ? (
        <EmptyState onCreate={() => setShowCreate(true)} />
      ) : (
        <div className="space-y-2.5">
          {sortedTokens.map((tok) => (
            <TokenRow key={tok.id} token={tok} onRevoke={() => handleRevoke(tok)} />
          ))}
        </div>
      )}

      {/* ============ 创建对话框 ============ */}
      <AnimatePresence>
        {showCreate && (
          <CreateTokenDialog
            availableScopes={availableScopes}
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}
      </AnimatePresence>

      {/* ============ 明文一次性展示对话框 ============ */}
      <AnimatePresence>
        {createdToken && (
          <CreatedTokenDialog
            token={createdToken}
            onClose={() => setCreatedToken(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：空状态
// ---------------------------------------------------------------------------
function EmptyState({ onCreate }: { onCreate: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center py-12 rounded-2xl border-2 border-dashed border-zinc-200 dark:border-zinc-700"
    >
      <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center mx-auto mb-4">
        <Key className="w-6 h-6 text-indigo-600 dark:text-indigo-300" />
      </div>
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">
        {t("tokens.empty.title", { defaultValue: "还没有访问令牌" })}
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 max-w-sm mx-auto leading-relaxed">
        {t("tokens.empty.desc", {
          defaultValue:
            "创建一个令牌即可让第三方应用（如书签首页同步、CLI 工具）安全访问您的笔记，无需透露密码。",
        })}
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("tokens.empty.cta", { defaultValue: "立即创建" })}
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：单条 token 行
// ---------------------------------------------------------------------------
function TokenRow({
  token,
  onRevoke,
}: {
  token: ApiTokenListItem;
  onRevoke: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const status = computeStatus(token);
  const isFinal = status !== "active";

  // 状态徽章颜色
  const badgeStyle =
    status === "active"
      ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30"
      : status === "expired"
        ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border-zinc-300 dark:border-zinc-600"
        : "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300 border-red-200 dark:border-red-500/30";

  const statusLabel =
    status === "active"
      ? t("tokens.status.active", { defaultValue: "可用" })
      : status === "expired"
        ? t("tokens.status.expired", { defaultValue: "已过期" })
        : t("tokens.status.revoked", { defaultValue: "已吊销" });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      className={`flex items-start gap-3 p-3.5 rounded-xl border transition-colors ${
        isFinal
          ? "border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-800/30 opacity-70"
          : "border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 hover:border-indigo-200 dark:hover:border-indigo-500/30"
      }`}
    >
      {/* 图标 */}
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          status === "revoked"
            ? "bg-red-100 dark:bg-red-500/10"
            : status === "expired"
              ? "bg-zinc-100 dark:bg-zinc-800"
              : "bg-indigo-100 dark:bg-indigo-500/15"
        }`}
      >
        {status === "revoked" ? (
          <ShieldOff
            className="w-4 h-4 text-red-600 dark:text-red-300"
            aria-hidden="true"
          />
        ) : status === "expired" ? (
          <Clock
            className="w-4 h-4 text-zinc-500 dark:text-zinc-400"
            aria-hidden="true"
          />
        ) : (
          <ShieldCheck
            className="w-4 h-4 text-indigo-600 dark:text-indigo-300"
            aria-hidden="true"
          />
        )}
      </div>

      {/* 主体 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate">
            {token.name}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${badgeStyle}`}
          >
            {statusLabel}
          </span>
        </div>

        {/* scope 标签云 */}
        {token.scopes.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mb-1.5">
            {token.scopes.map((s) => (
              <span
                key={s}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700"
              >
                {s}
              </span>
            ))}
          </div>
        )}

        {/* 元信息 */}
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>
            {t("tokens.row.created", { defaultValue: "创建" })}：
            {formatRelative(token.createdAt, t)}
          </span>
          <span>
            {t("tokens.row.expires", { defaultValue: "过期" })}：
            {formatExpires(token.expiresAt, t)}
          </span>
          <span>
            {t("tokens.row.lastUsed", { defaultValue: "最近使用" })}：
            {token.lastUsedAt ? formatRelative(token.lastUsedAt, t) : "—"}
            {token.lastUsedIp ? ` · ${token.lastUsedIp}` : ""}
          </span>
          {token.revokedAt && (
            <span>
              {t("tokens.row.revokedAt", { defaultValue: "吊销于" })}：
              {formatRelative(token.revokedAt, t)}
            </span>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      {!token.revokedAt && (
        <button
          type="button"
          onClick={onRevoke}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 border border-red-200 dark:border-red-500/30 transition-colors flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {t("tokens.revoke", { defaultValue: "吊销" })}
        </button>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// 子组件：创建对话框
// ---------------------------------------------------------------------------
function CreateTokenDialog({
  availableScopes,
  onClose,
  onCreated,
}: {
  availableScopes: string[];
  onClose: () => void;
  onCreated: (data: { id: string; name: string; token: string }) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  /** null = 永不过期 */
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90);
  const [submitting, setSubmitting] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const toggleScope = (s: string) => {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const selectAllScopes = () => setScopes([...availableScopes]);
  const clearScopes = () => setScopes([]);

  const handleSubmit = async () => {
    setErrMsg(null);
    if (!name.trim()) {
      setErrMsg(t("tokens.create.errName", { defaultValue: "请填写令牌名称" }));
      return;
    }
    if (scopes.length === 0) {
      setErrMsg(
        t("tokens.create.errScopes", { defaultValue: "请至少选择一个权限范围" }),
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.tokens.create({
        name: name.trim(),
        scopes,
        expiresInDays: expiresInDays ?? undefined,
      });
      onCreated({ id: res.id, name: res.name, token: res.token });
    } catch (e: any) {
      setErrMsg(e?.message || t("tokens.create.fail", { defaultValue: "创建失败" }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell onClose={onClose} ariaTitle={t("tokens.create.title", { defaultValue: "创建访问令牌" })}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center flex-shrink-0">
          <Key className="w-5 h-5 text-indigo-600 dark:text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t("tokens.create.title", { defaultValue: "创建访问令牌" })}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
            {t("tokens.create.subtitle", {
              defaultValue: "明文令牌只会显示这一次，请在窗口关闭前完成复制。",
            })}
          </p>
        </div>
      </div>

      <div className="space-y-5">
        {/* 名称 */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {t("tokens.create.nameLabel", { defaultValue: "名称" })}
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("tokens.create.namePlaceholder", {
              defaultValue: "例如：NOWEN 书签同步",
            })}
            maxLength={64}
            className="w-full px-3 py-2 text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50/50 dark:bg-zinc-800/50 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-400 dark:focus:border-indigo-500"
            autoFocus
          />
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1">
            {t("tokens.create.nameHint", {
              defaultValue: "用于您日后识别此令牌的用途，不会泄漏给第三方。",
            })}
          </p>
        </div>

        {/* scopes */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {t("tokens.create.scopesLabel", { defaultValue: "权限范围" })}
              <span className="text-red-500 ml-0.5">*</span>
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              <button
                type="button"
                onClick={selectAllScopes}
                className="text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {t("tokens.create.selectAll", { defaultValue: "全选" })}
              </button>
              <span className="text-zinc-300 dark:text-zinc-600">|</span>
              <button
                type="button"
                onClick={clearScopes}
                className="text-zinc-500 dark:text-zinc-400 hover:underline"
              >
                {t("tokens.create.clearAll", { defaultValue: "清空" })}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {availableScopes.map((s) => {
              const checked = scopes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs transition-all text-left ${
                    checked
                      ? "border-indigo-400 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-200"
                      : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-indigo-200 dark:hover:border-indigo-500/30"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center flex-shrink-0 border ${
                      checked
                        ? "bg-indigo-600 border-indigo-600"
                        : "border-zinc-300 dark:border-zinc-600"
                    }`}
                  >
                    {checked && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                  <span className="font-mono">{s}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 过期时间 */}
        <div>
          <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
            {t("tokens.create.expiresLabel", { defaultValue: "过期时间" })}
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {EXPIRES_PRESETS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setExpiresInDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  expiresInDays === d
                    ? "border-indigo-400 dark:border-indigo-500/50 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-200"
                    : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-indigo-200 dark:hover:border-indigo-500/30"
                }`}
              >
                {t("tokens.create.daysPreset", {
                  defaultValue: "{{n}} 天",
                  n: d,
                })}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setExpiresInDays(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                expiresInDays === null
                  ? "border-amber-400 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-200"
                  : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-amber-200 dark:hover:border-amber-500/30"
              }`}
            >
              {t("tokens.neverExpires", { defaultValue: "永不过期" })}
            </button>
          </div>
          {expiresInDays === null && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {t("tokens.create.neverExpiresHint", {
                defaultValue: "永不过期的令牌请妥善保管，建议至少选择一个有限期。",
              })}
            </p>
          )}
        </div>

        {/* 错误提示 */}
        {errMsg && (
          <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {errMsg}
          </div>
        )}
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
        >
          {t("common.cancel", { defaultValue: "取消" })}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm"
        >
          {submitting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Plus className="w-4 h-4" />
          )}
          {t("tokens.create.submit", { defaultValue: "创建令牌" })}
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// 子组件：明文一次性展示
// ---------------------------------------------------------------------------
function CreatedTokenDialog({
  token,
  onClose,
}: {
  token: { id: string; name: string; token: string };
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  // 用户必须先复制一次才能关闭，防止"看一眼就关掉"再也找不回的尴尬
  const [hasInteracted, setHasInteracted] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      setHasInteracted(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success(t("tokens.created.copied", { defaultValue: "已复制到剪贴板" }));
    } catch {
      toast.error(t("tokens.created.copyFail", { defaultValue: "复制失败，请手动选中复制" }));
    }
  };

  const handleClose = async () => {
    if (!hasInteracted) {
      const ok = await confirm({
        title: t("tokens.created.closeConfirmTitle", {
          defaultValue: "确定要关闭吗？",
        }),
        description: t("tokens.created.closeConfirmDesc", {
          defaultValue: "此令牌的明文将永久无法再次查看。请确认您已妥善保存。",
        }),
        confirmText: t("tokens.created.closeAnyway", {
          defaultValue: "我已保存，关闭",
        }),
        cancelText: t("common.cancel", { defaultValue: "取消" }),
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  };

  return (
    <DialogShell onClose={handleClose} ariaTitle={t("tokens.created.title", { defaultValue: "令牌已创建" })}>
      {/* 成功标识 */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {t("tokens.created.title", { defaultValue: "令牌已创建" })}
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 truncate">
            {token.name}
          </p>
        </div>
      </div>

      {/* 关键警告 */}
      <div className="flex items-start gap-2 p-3 mb-4 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/5 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div>
          <strong className="font-semibold">
            {t("tokens.created.warning", {
              defaultValue: "这是您唯一一次能看到完整令牌的机会。",
            })}
          </strong>
          <br />
          {t("tokens.created.warningDesc", {
            defaultValue: "关闭此窗口后，明文将永久无法再次查看。请立即复制并妥善保存。",
          })}
        </div>
      </div>

      {/* 明文展示 */}
      <div className="mb-2">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
          {t("tokens.created.tokenLabel", { defaultValue: "您的访问令牌" })}
        </label>
        <div className="flex items-stretch gap-2">
          <div className="flex-1 min-w-0 relative">
            <input
              type={revealed ? "text" : "password"}
              value={token.token}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="w-full pl-3 pr-10 py-2.5 font-mono text-sm border border-zinc-200 dark:border-zinc-700 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              type="button"
              onClick={() => {
                setRevealed((v) => !v);
                setHasInteracted(true);
              }}
              tabIndex={-1}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-zinc-500 hover:bg-zinc-200/60 dark:hover:bg-zinc-700/60"
              aria-label={revealed ? "hide" : "show"}
            >
              {revealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={`inline-flex items-center gap-1.5 px-3 rounded-xl text-sm font-medium transition-all ${
              copied
                ? "bg-emerald-600 text-white"
                : "bg-indigo-600 hover:bg-indigo-700 text-white"
            }`}
          >
            {copied ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {t("tokens.created.copied", { defaultValue: "已复制" })}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                {t("tokens.created.copy", { defaultValue: "复制" })}
              </>
            )}
          </button>
        </div>
        <p className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-1.5">
          {t("tokens.created.tokenHint", {
            defaultValue: '点击输入框可全选，或直接点"复制"按钮。',
          })}
        </p>
      </div>

      {/* 底栏 */}
      <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-zinc-700 hover:bg-zinc-800 dark:bg-zinc-600 dark:hover:bg-zinc-500 transition-colors"
        >
          {hasInteracted
            ? t("tokens.created.done", { defaultValue: "完成" })
            : t("tokens.created.closeAnyway", { defaultValue: "我已保存，关闭" })}
        </button>
      </div>
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// 通用：弹窗外壳（轻量遮罩 + 卡片，与 SettingsModal 自身的弹层位置不冲突）
// ---------------------------------------------------------------------------
function DialogShell({
  onClose,
  children,
  ariaTitle,
}: {
  onClose: () => void;
  children: React.ReactNode;
  ariaTitle: string;
}): JSX.Element {
  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      // 用 z-index 比 SettingsModal 自身（一般 z-50）更高
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label={ariaTitle}
      aria-modal="true"
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl p-6"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="absolute top-3 right-3 p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <X className="w-4 h-4" />
        </button>
        {children}
      </motion.div>
    </motion.div>
  );
}
