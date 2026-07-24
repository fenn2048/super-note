import { ArrowLeft } from "lucide-react";
import type { FinanceAccount } from "@/types";
import type { PayeeCluster } from "@/lib/finance/importClustering";
import AccountPicker from "@/components/finance/AccountPicker";
import { yuan } from "./labels";

export default function ImportClusterDetail({
  cluster,
  clusterTarget,
  clusterMethod,
  onClusterTarget,
  onClusterMethod,
  saveRuleOnApply,
  onSaveRuleOnApply,
  onBack,
  onApply,
  pickerVariant,
  expInc,
  assetsLiab,
}: {
  cluster: PayeeCluster;
  clusterTarget: string;
  clusterMethod: string;
  onClusterTarget: (id: string) => void;
  onClusterMethod: (id: string) => void;
  saveRuleOnApply: boolean;
  onSaveRuleOnApply: (v: boolean) => void;
  onBack: () => void;
  onApply: () => void;
  pickerVariant: "dropdown" | "sheet";
  expInc: FinanceAccount[];
  assetsLiab: FinanceAccount[];
}) {
  return (
    <div className="rounded-xl border border-app-border p-3 space-y-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-tx-secondary"
        onClick={onBack}
      >
        <ArrowLeft size={16} /> 返回商户列表
      </button>
      <div>
        <div className="font-medium">{cluster.displayPayee}</div>
        <div className="text-xs text-tx-tertiary">
          {cluster.count} 笔 · 合计 ¥{yuan(cluster.totalMinor)}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <AccountPicker
          accounts={expInc}
          value={clusterTarget || cluster.commonTargetId || ""}
          onChange={onClusterTarget}
          placeholder="分类账户"
          emptyLabel="分类账户"
          variant={pickerVariant}
          sheetTitle="分类账户"
        />
        <AccountPicker
          accounts={assetsLiab}
          value={clusterMethod || cluster.commonMethodId || ""}
          onChange={onClusterMethod}
          placeholder="支付账户"
          emptyLabel="支付账户"
          variant={pickerVariant}
          sheetTitle="支付账户"
        />
        <label className="text-xs flex items-center gap-2">
          <input
            type="checkbox"
            checked={saveRuleOnApply}
            onChange={(e) => onSaveRuleOnApply(e.target.checked)}
          />
          同时存为规则
        </label>
        <button
          type="button"
          className="px-3 py-2 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50"
          disabled={!clusterTarget || !clusterMethod}
          onClick={onApply}
        >
          应用到 {cluster.count} 笔
        </button>
      </div>
      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {cluster.rows.map((r) => (
          <li key={r.id} className="text-xs flex justify-between border-b border-app-border py-1">
            <span className="truncate">
              {r.draft?.date} · {r.draft?.narration || r.parsed?.item}
            </span>
            <span className="tabular-nums">
              ¥{yuan(r.draft?.amountMinor ?? r.parsed?.amountMinor)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
