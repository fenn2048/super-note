import { BottomSheet } from "@/components/common/BottomSheet";
/**
 * 导入规则管理（对齐 beancount-web ImportRuleDrawer）
 * - 基础匹配：对方/类型/商品/分类/支付方式/标签 + AND/OR + 完全匹配
 * - 金额时间：min/max/精确金额、日内时间段
 * - 平台扩展：单号等
 * - 动作：目标账户、支付账户、支付方式映射、打上标签、忽略
 */
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { FinanceAccount } from "@/types";
import { cn } from "@/lib/utils";

export type FlatRule = {
  id?: string;
  name: string;
  priority?: number;
  enabled?: boolean;
  peer?: string;
  type?: string;
  item?: string;
  category?: string;
  method?: string;
  /** 匹配条件：标签（多值分隔，与 peer 等一致） */
  matchTags?: string;
  fullMatch?: boolean;
  separator?: string;
  logic?: "AND" | "OR";
  minPrice?: number | "";
  maxPrice?: number | "";
  price?: number | "";
  time?: string;
  timestampRange?: string;
  tradeNo?: string;
  orderNo?: string;
  transactionId?: string;
  transactionCode?: string;
  targetAccountId?: string;
  methodAccountId?: string;
  defaultPlusAccountId?: string;
  defaultMinusAccountId?: string;
  methodMappings?: Array<{ method: string; accountId: string }>;
  /** 动作：命中后写入的标签 */
  tags?: string[];
  ignore?: boolean;
  match?: any;
  action?: any;
};

const emptyRule = (): FlatRule => ({
  name: "",
  enabled: true,
  peer: "",
  type: "",
  item: "",
  category: "",
  method: "",
  matchTags: "",
  fullMatch: false,
  separator: ",",
  logic: "AND",
  minPrice: "",
  maxPrice: "",
  price: "",
  time: "",
  tradeNo: "",
  orderNo: "",
  transactionId: "",
  transactionCode: "",
  targetAccountId: "",
  methodAccountId: "",
  defaultPlusAccountId: "",
  defaultMinusAccountId: "",
  methodMappings: [],
  tags: [],
  ignore: false,
});

function summarizeMatch(r: FlatRule): string {
  const parts: string[] = [];
  if (r.peer) parts.push(`对方:${r.peer}`);
  if (r.item) parts.push(`商品:${r.item}`);
  if (r.category) parts.push(`分类:${r.category}`);
  if (r.method) parts.push(`支付:${r.method}`);
  if (r.type) parts.push(`类型:${r.type}`);
  if (r.matchTags) parts.push(`标签含:${r.matchTags}`);
  if (r.minPrice || r.maxPrice || r.price) {
    parts.push(
      `金额:${r.price || `${r.minPrice || "*"}~${r.maxPrice || "*"}`}`,
    );
  }
  if (r.ignore) parts.push("忽略");
  return parts.join(" · ") || "（未设匹配条件）";
}

export default function RulesPanel({
  ledgerId,
  unlockToken,
  onError,
}: {
  ledgerId: string;
  unlockToken: string | null;
  onError: (s: string) => void;
}) {
  const [rules, setRules] = useState<FlatRule[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [editing, setEditing] = useState<FlatRule | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () =>
    api.finance
      .listImportRules(ledgerId, unlockToken)
      .then((list) => setRules(list as FlatRule[]))
      .catch((e) => onError(e?.message || "加载规则失败"));

  useEffect(() => {
    load();
    api.finance.listAccounts(ledgerId, unlockToken).then(setAccounts).catch(() => {});
  }, [ledgerId, unlockToken]);

  const normalizeRule = (r: FlatRule): FlatRule => ({
    ...emptyRule(),
    ...r,
    // 兼容 match.tags（嵌套）与 matchTags（扁平）
    matchTags:
      r.matchTags ||
      (typeof r.match?.tags === "string" ? r.match.tags : "") ||
      "",
  });

  const openNew = () => setEditing(emptyRule());
  const openEdit = (r: FlatRule) => setEditing(normalizeRule(r));
  const openCopy = (r: FlatRule) =>
    setEditing({
      ...normalizeRule(r),
      id: undefined,
      name: `${r.name || "规则"} (复制)`,
    });

  const save = async () => {
    if (!editing?.name?.trim()) {
      onError("请填写规则名称");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...editing,
        minPrice: editing.minPrice === "" ? undefined : Number(editing.minPrice),
        maxPrice: editing.maxPrice === "" ? undefined : Number(editing.maxPrice),
        price: editing.price === "" ? undefined : Number(editing.price),
      };
      await api.finance.saveImportRule(ledgerId, payload, unlockToken);
      setEditing(null);
      load();
    } catch (e: any) {
      onError(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...rules];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setRules(next);
    try {
      await api.finance.reorderImportRules(
        ledgerId,
        next.map((r) => r.id!).filter(Boolean),
        unlockToken,
      );
      load();
    } catch (e: any) {
      onError(e?.message || "排序失败");
      load();
    }
  };

  const expenseIncome = accounts.filter(
    (a) => a.type === "EXPENSES" || a.type === "INCOME",
  );
  const assetsLiab = accounts.filter(
    (a) => a.type === "ASSETS" || a.type === "LIABILITIES",
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={openNew}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent-primary text-white text-sm"
        >
          <Plus size={14} /> 添加规则
        </button>
        <p className="text-xs text-tx-tertiary flex-1">
          优先级从上到下递减；导入时可选择启用哪些规则。支持对方/金额/时间/支付方式等多条件。
        </p>
      </div>

      {rules.length === 0 && !editing && (
        <p className="text-sm text-tx-tertiary text-center py-10">
          还没有规则。添加后导入账单可自动分类。
        </p>
      )}
      {rules.length > 0 && (
        <ul className="space-y-2">
          {rules.map((r, idx) => (
            <li
              key={r.id}
              className={cn(
                "rounded-xl border border-app-border bg-app-card p-3 text-sm",
                r.enabled === false && "opacity-50",
              )}
            >
              <div className="flex gap-2 items-start">
                <div className="flex flex-col gap-0.5 pt-0.5">
                  <button
                    type="button"
                    className="p-0.5 text-tx-tertiary hover:text-tx-primary disabled:opacity-30"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    title="提高优先级"
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    type="button"
                    className="p-0.5 text-tx-tertiary hover:text-tx-primary disabled:opacity-30"
                    disabled={idx === rules.length - 1}
                    onClick={() => move(idx, 1)}
                    title="降低优先级"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium flex flex-wrap items-center gap-2">
                    <span>{r.name}</span>
                    {r.ignore && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-elevated text-tx-tertiary">
                        忽略
                      </span>
                    )}
                    {r.fullMatch && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-warning/15 text-accent-warning">
                        完全匹配
                      </span>
                    )}
                    <span className="text-[10px] text-tx-tertiary">
                      P{r.priority ?? 0} · {r.logic || "AND"}
                    </span>
                  </div>
                  <div className="text-xs text-tx-tertiary mt-1 truncate">
                    {summarizeMatch(r)}
                  </div>
                  <div className="text-xs text-tx-secondary mt-0.5 truncate">
                    →{" "}
                    {r.targetAccountId
                      ? accounts.find((a) => a.id === r.targetAccountId)?.name ||
                        r.targetAccountId
                      : "默认分类"}
                    {r.methodAccountId
                      ? ` · 支付 ${
                          accounts.find((a) => a.id === r.methodAccountId)?.name ||
                          r.methodAccountId
                        }`
                      : ""}
                    {r.methodMappings?.length
                      ? ` · ${r.methodMappings.length} 条支付映射`
                      : ""}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    className="p-1.5 text-tx-tertiary hover:text-tx-primary"
                    title="复制"
                    onClick={() => openCopy(r)}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 text-tx-tertiary hover:text-accent-primary"
                    title="编辑"
                    onClick={() => openEdit(r)}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    className="p-1.5 text-tx-tertiary hover:text-accent-danger"
                    title="删除"
                    onClick={async () => {
                      if (!r.id || !confirm(`删除规则「${r.name}」？`)) return;
                      await api.finance.deleteImportRule(ledgerId, r.id, unlockToken);
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

      {editing && (
        <RuleEditorModal
          rule={editing}
          accounts={accounts}
          expenseIncome={expenseIncome}
          assetsLiab={assetsLiab}
          allRules={rules}
          saving={saving}
          onChange={setEditing}
          onClose={() => setEditing(null)}
          onSave={save}
          onCopyFrom={(id) => {
            const src = rules.find((r) => r.id === id);
            if (src) openCopy(src);
          }}
        />
      )}
    </div>
  );
}

function RuleEditorModal({
  rule,
  accounts,
  expenseIncome,
  assetsLiab,
  allRules,
  saving,
  onChange,
  onClose,
  onSave,
  onCopyFrom,
}: {
  rule: FlatRule;
  accounts: FinanceAccount[];
  expenseIncome: FinanceAccount[];
  assetsLiab: FinanceAccount[];
  allRules: FlatRule[];
  saving: boolean;
  onChange: (r: FlatRule) => void;
  onClose: () => void;
  onSave: () => void;
  onCopyFrom: (id: string) => void;
}) {
  const set = <K extends keyof FlatRule>(k: K, v: FlatRule[K]) =>
    onChange({ ...rule, [k]: v });

  const mappings = rule.methodMappings || [];

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={rule.id ? "编辑规则" : "添加规则"}
      maxHeight="min(92dvh, 100%)"
      zClassName="z-modal"
      className="sm:max-w-xl sm:mx-auto"
    >
      <div className="px-4 pb-4">
        {!rule.id && allRules.length > 0 && (
          <label className="block mb-3">
            <span className="text-xs text-tx-tertiary">从已有规则复制模板</span>
            <select
              className="w-full mt-1 px-3 py-2 rounded-lg border border-app-border bg-app-bg text-sm"
              defaultValue=""
              onChange={(e) => e.target.value && onCopyFrom(e.target.value)}
            >
              <option value="">选择模板…</option>
              {allRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <Field label="规则名称 *">
          <input
            className="field"
            value={rule.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="例如：肯德基自动分类"
          />
        </Field>

        <Field label="基础匹配逻辑">
          <select
            className="field"
            value={rule.logic || "AND"}
            onChange={(e) => set("logic", e.target.value as "AND" | "OR")}
          >
            <option value="AND">AND（所有已填条件都要命中）</option>
            <option value="OR">OR（任一已填条件命中即可）</option>
          </select>
        </Field>

        <Section title="基础匹配条件">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="交易对方 / 商户">
              <input
                className="field"
                value={rule.peer || ""}
                onChange={(e) => set("peer", e.target.value)}
                placeholder="多值用逗号分隔"
              />
            </Field>
            <Field label="交易类型">
              <input
                className="field"
                value={rule.type || ""}
                onChange={(e) => set("type", e.target.value)}
                placeholder="如：消费、转账"
              />
            </Field>
            <Field label="商品 / 服务描述">
              <input
                className="field"
                value={rule.item || ""}
                onChange={(e) => set("item", e.target.value)}
              />
            </Field>
            <Field label="账单原始分类">
              <input
                className="field"
                value={rule.category || ""}
                onChange={(e) => set("category", e.target.value)}
              />
            </Field>
            <Field label="支付方式">
              <input
                className="field"
                value={rule.method || ""}
                onChange={(e) => set("method", e.target.value)}
                placeholder="如：花呗、零钱"
              />
            </Field>
            <Field label="明细标签包含">
              <input
                className="field"
                value={rule.matchTags || ""}
                onChange={(e) => set("matchTags", e.target.value)}
                placeholder="如：旅游 — 明细标签含此文字即命中"
              />
            </Field>
            <Field label="多值分隔符">
              <input
                className="field"
                value={rule.separator || ","}
                onChange={(e) => set("separator", e.target.value)}
              />
            </Field>
          </div>
          <p className="text-[11px] text-tx-tertiary mt-1">
            若明细上的标签（如 #旅游）包含你填的文字则命中；多个关键词用分隔符，满足任一即可。下方「打上标签」是命中后写入，不是匹配条件。
          </p>
          <label className="flex items-center gap-2 text-sm mt-2">
            <input
              type="checkbox"
              checked={!!rule.fullMatch}
              onChange={(e) => set("fullMatch", e.target.checked)}
            />
            完全匹配模式（关闭则为包含匹配）
          </label>
        </Section>

        <Section title="金额与时间">
          <div className="grid grid-cols-3 gap-2">
            <Field label="最低金额">
              <input
                type="number"
                step="0.01"
                className="field"
                value={rule.minPrice ?? ""}
                onChange={(e) =>
                  set("minPrice", e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </Field>
            <Field label="最高金额">
              <input
                type="number"
                step="0.01"
                className="field"
                value={rule.maxPrice ?? ""}
                onChange={(e) =>
                  set("maxPrice", e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </Field>
            <Field label="精确金额">
              <input
                type="number"
                step="0.01"
                className="field"
                value={rule.price ?? ""}
                onChange={(e) =>
                  set("price", e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </Field>
          </div>
          <Field label="日内时间段 (HH:MM-HH:MM)">
            <input
              className="field"
              value={rule.time || ""}
              onChange={(e) => set("time", e.target.value)}
              placeholder="08:00-12:00"
            />
          </Field>
        </Section>

        <Section title="平台扩展（可选）">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="交易单号 / 流水号">
              <input
                className="field"
                value={rule.tradeNo || ""}
                onChange={(e) => set("tradeNo", e.target.value)}
              />
            </Field>
            <Field label="商家订单号">
              <input
                className="field"
                value={rule.orderNo || ""}
                onChange={(e) => set("orderNo", e.target.value)}
              />
            </Field>
            <Field label="微信交易单号">
              <input
                className="field"
                value={rule.transactionId || ""}
                onChange={(e) => set("transactionId", e.target.value)}
              />
            </Field>
            <Field label="银行交易代码">
              <input
                className="field"
                value={rule.transactionCode || ""}
                onChange={(e) => set("transactionCode", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section title="账户映射（执行动作）">
          <Field label="目标账户 (支出/收入分类)">
            <select
              className="field"
              value={rule.targetAccountId || ""}
              onChange={(e) => set("targetAccountId", e.target.value)}
            >
              <option value="">不指定（用默认）</option>
              {expenseIncome.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="默认支付/资产账户">
            <select
              className="field"
              value={rule.methodAccountId || ""}
              onChange={(e) => set("methodAccountId", e.target.value)}
            >
              <option value="">不指定（用渠道默认）</option>
              {assetsLiab.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-2">
            <div className="text-xs text-tx-tertiary mb-1">精准支付方式映射</div>
            {mappings.map((m, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <input
                  className="field flex-1"
                  placeholder="关键字如：零钱"
                  value={m.method}
                  onChange={(e) => {
                    const next = [...mappings];
                    next[i] = { ...next[i], method: e.target.value };
                    set("methodMappings", next);
                  }}
                />
                <select
                  className="field flex-1"
                  value={m.accountId}
                  onChange={(e) => {
                    const next = [...mappings];
                    next[i] = { ...next[i], accountId: e.target.value };
                    set("methodMappings", next);
                  }}
                >
                  <option value="">账户</option>
                  {assetsLiab.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="p-1 text-accent-danger"
                  onClick={() =>
                    set(
                      "methodMappings",
                      mappings.filter((_, j) => j !== i),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="w-full py-1.5 rounded-lg border border-dashed border-app-border text-xs text-tx-secondary"
              onClick={() =>
                set("methodMappings", [...mappings, { method: "", accountId: "" }])
              }
            >
              + 添加支付方式映射
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 mt-2">
            <Field label="默认收入账户">
              <select
                className="field"
                value={rule.defaultPlusAccountId || ""}
                onChange={(e) => set("defaultPlusAccountId", e.target.value)}
              >
                <option value="">—</option>
                {accounts
                  .filter((a) => a.type === "INCOME")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="默认支出账户">
              <select
                className="field"
                value={rule.defaultMinusAccountId || ""}
                onChange={(e) => set("defaultMinusAccountId", e.target.value)}
              >
                <option value="">—</option>
                {accounts
                  .filter((a) => a.type === "EXPENSES")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="其他">
          <Field label="打上标签（命中后写入，逗号分隔）">
            <input
              className="field"
              value={(rule.tags || []).join(",")}
              onChange={(e) =>
                set(
                  "tags",
                  e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
              placeholder="餐饮,订阅"
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!rule.ignore}
              onChange={(e) => set("ignore", e.target.checked)}
            />
            忽略匹配到的交易（不导入）
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={rule.enabled !== false}
              onChange={(e) => set("enabled", e.target.checked)}
            />
            启用此规则
          </label>
          <Field label="优先级（越大越优先，可留空自动）">
            <input
              type="number"
              className="field"
              value={rule.priority ?? ""}
              onChange={(e) =>
                set(
                  "priority",
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </Field>
        </Section>

        <div
          className="flex justify-end gap-2 mt-4 sticky bottom-0 pt-2 border-t border-app-border -mx-4 px-4"
          style={{ backgroundColor: "var(--color-elevated-solid, var(--color-elevated))" }}
        >
          <button type="button" className="px-3 py-1.5 text-sm text-tx-secondary" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onSave}
            className="px-4 py-1.5 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        <style>{`
        .field {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.5rem;
          border: 1px solid var(--color-border);
          background: var(--color-bg);
          color: var(--color-text-primary);
          font-size: 0.875rem;
        }
        .field:focus {
          outline: 2px solid color-mix(in srgb, var(--color-accent-primary) 45%, transparent);
          outline-offset: 0;
          border-color: var(--color-accent-primary);
        }
      `}</style>
      </div>
    </BottomSheet>
  );
}


function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-xs font-semibold text-tx-tertiary uppercase tracking-wide mb-2 border-b border-app-border pb-1">
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-2">
      <span className="text-xs text-tx-tertiary">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
