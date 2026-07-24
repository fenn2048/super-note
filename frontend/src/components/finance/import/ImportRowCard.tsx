import { Sparkles } from "lucide-react";
import type { FinanceAccount } from "@/types";
import { cn } from "@/lib/utils";
import AccountPicker from "@/components/finance/AccountPicker";
import TagPicker from "@/components/finance/TagPicker";
import { rowStatusLabel, yuan } from "./labels";

export default function ImportRowCard({
  row: r,
  readOnly,
  isCompact,
  pickerVariant,
  expInc,
  assetsLiab,
  tagCatalog,
  onPatchAccount,
  onToggleSelected,
  onApplySamePayee,
  onForceImportRow,
  onSaveRule,
  onTagsChange,
}: {
  row: any;
  readOnly: boolean;
  isCompact: boolean;
  pickerVariant: "dropdown" | "sheet";
  expInc: FinanceAccount[];
  assetsLiab: FinanceAccount[];
  tagCatalog: { used: string[]; presets: string[] };
  onPatchAccount: (
    r: any,
    patch: { targetAccountId?: string; methodAccountId?: string },
  ) => void;
  onToggleSelected: (r: any, selected: boolean) => void;
  onApplySamePayee: (r: any) => void;
  onForceImportRow: (r: any) => void;
  onSaveRule: (r: any) => void;
  onTagsChange: (r: any, tags: string[]) => void;
}) {
  const locked = readOnly || r.status === "committed";

  return (
    <li
      className={cn(
        "rounded-lg border p-3 text-sm",
        r.status === "ready" && "border-accent-primary/40 bg-accent-primary/5",
        r.status === "needs_review" && "border-amber-500/40 bg-amber-500/5",
        r.status === "duplicate" && "border-violet-500/30 bg-violet-500/5",
        r.status === "ignored" && "border-app-border opacity-40",
        r.status === "committed" && "border-app-border opacity-60",
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

      {r.status === "duplicate" && r.draft?.dup && !readOnly && (
        <div className="mt-1.5 text-[11px] text-violet-700 dark:text-violet-300 bg-violet-500/10 rounded px-2 py-1.5 space-y-0.5">
          <div className="font-medium">疑似与账本已有交易重复</div>
          <div>
            已有：{r.draft.dup.existingSource || "未知来源"}
            {r.draft.dup.existingDate ? ` · ${r.draft.dup.existingDate}` : ""}
            {r.draft.dup.existingTime ? ` ${r.draft.dup.existingTime}` : ""}
            {r.draft.dup.existingPayee ? ` · ${r.draft.dup.existingPayee}` : ""}
            {` · ${r.draft.dup.reason} · 置信 ${((r.draft.dup.confidence || 0) * 100).toFixed(0)}%`}
          </div>
          <button type="button" className="underline" onClick={() => onForceImportRow(r)}>
            仍要导入本行
          </button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2 items-center">
        <span className="text-xs text-tx-tertiary">
          {rowStatusLabel(r.status)}
          {" · "}
          置信 {((r.confidence || 0) * 100).toFixed(0)}%
          {r.draft?.matchedRuleName && (
            <span className="ml-1 text-accent-primary">· 规则「{r.draft.matchedRuleName}」</span>
          )}
        </span>
        <div className={cn("w-[150px]", isCompact && "w-full")}>
          <AccountPicker
            accounts={expInc}
            value={r.draft?.targetAccountId || ""}
            onChange={(id) => onPatchAccount(r, { targetAccountId: id })}
            placeholder="分类账户"
            emptyLabel="分类账户"
            disabled={locked}
            variant={pickerVariant}
            sheetTitle="分类账户"
          />
        </div>
        <div className={cn("w-[150px]", isCompact && "w-full")}>
          <AccountPicker
            accounts={assetsLiab}
            value={r.draft?.methodAccountId || ""}
            onChange={(id) => onPatchAccount(r, { methodAccountId: id })}
            placeholder="支付账户"
            emptyLabel="支付账户"
            disabled={locked}
            variant={pickerVariant}
            sheetTitle="支付账户"
          />
        </div>
        {!locked && (
          <>
            <label className="text-xs flex items-center gap-1">
              <input
                type="checkbox"
                checked={
                  r.draft?.selected !== false &&
                  r.status !== "duplicate" &&
                  r.status !== "ignored"
                }
                onChange={(e) => onToggleSelected(r, e.target.checked)}
              />
              导入
            </label>
            <button
              type="button"
              className="text-xs text-violet-600"
              title="将本行分类套用到相同对方（近似匹配）"
              onClick={() => onApplySamePayee(r)}
            >
              同商户套用
            </button>
            <div className="w-full basis-full mt-1">
              <TagPicker
                value={r.draft?.tags || []}
                onChange={(tags) => onTagsChange(r, tags)}
                suggestions={tagCatalog.used}
                presets={tagCatalog.presets.slice(0, 10)}
                placeholder="标签"
              />
            </div>
            <button
              type="button"
              title="从本行生成规则"
              className="text-xs inline-flex items-center gap-0.5 text-accent-primary px-1"
              onClick={() => onSaveRule(r)}
            >
              <Sparkles size={12} /> 存为规则
            </button>
          </>
        )}
      </div>
    </li>
  );
}
