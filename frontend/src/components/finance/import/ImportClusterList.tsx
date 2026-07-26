import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import type { FinanceAccount } from "@/types";
import type { PayeeCluster } from "@/lib/finance/importClustering";
import AccountPicker from "@/components/finance/AccountPicker";
import ImportRowCard from "./ImportRowCard";
import { yuan } from "./labels";

export type ImportRowCardSharedProps = Omit<ComponentProps<typeof ImportRowCard>, "row">;

export default function ImportClusterList({
  clusters,
  unclustered,
  isCompact,
  clusterTarget,
  clusterMethod,
  onClusterTarget,
  onClusterMethod,
  saveRuleOnApply,
  onSaveRuleOnApply,
  onSelectCluster,
  onApplyCluster,
  pickerVariant,
  expInc,
  assetsLiab,
  rowCardProps,
}: {
  clusters: PayeeCluster[];
  unclustered: any[];
  isCompact: boolean;
  clusterTarget: string;
  clusterMethod: string;
  onClusterTarget: (id: string) => void;
  onClusterMethod: (id: string) => void;
  saveRuleOnApply: boolean;
  onSaveRuleOnApply: (v: boolean) => void;
  onSelectCluster: (c: PayeeCluster) => void;
  onApplyCluster: (c: PayeeCluster) => void;
  pickerVariant: "dropdown" | "sheet";
  expInc: FinanceAccount[];
  assetsLiab: FinanceAccount[];
  rowCardProps: ImportRowCardSharedProps;
}) {
  return (
    <div className="rounded-xl border border-app-border p-3 space-y-2">
      <div className="text-xs font-medium text-tx-secondary">按商户聚类（{clusters.length}）</div>
      {!isCompact && (
        <div className="flex flex-wrap gap-2 items-end text-xs">
          <div className="w-[150px]">
            <AccountPicker
              accounts={expInc}
              value={clusterTarget}
              onChange={onClusterTarget}
              placeholder="分类账户"
              emptyLabel="分类"
              variant={pickerVariant}
            />
          </div>
          <div className="w-[150px]">
            <AccountPicker
              accounts={assetsLiab}
              value={clusterMethod}
              onChange={onClusterMethod}
              placeholder="支付账户"
              emptyLabel="支付"
              variant={pickerVariant}
            />
          </div>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={saveRuleOnApply}
              onChange={(e) => onSaveRuleOnApply(e.target.checked)}
            />
            存为规则
          </label>
        </div>
      )}
      <ul className="space-y-1.5">
        {clusters.map((c) => (
          <li
            key={c.key}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-app-border px-2.5 py-2 text-sm"
          >
            <button
              type="button"
              className="text-left min-w-0 flex-1"
              onClick={() => onSelectCluster(c)}
            >
              <div className="font-medium truncate">{c.displayPayee}</div>
              <div className="text-xs text-tx-tertiary">
                {c.count} 笔 · ¥{yuan(c.totalMinor)}
              </div>
            </button>
            {isCompact ? (
              <ChevronRight size={16} className="text-tx-tertiary" />
            ) : (
              <button
                type="button"
                className="shrink-0 px-2 py-1 rounded bg-accent-primary text-white text-xs disabled:opacity-50"
                disabled={!clusterTarget || !clusterMethod}
                onClick={() => onApplyCluster(c)}
              >
                套用
              </button>
            )}
          </li>
        ))}
      </ul>
      {unclustered.length > 0 && (
        <div className="pt-2 border-t border-app-border">
          <div className="text-xs text-tx-tertiary mb-1">
            无对方（{unclustered.length}）— 请逐行编辑
          </div>
          <ul className="space-y-2">
            {unclustered.map((r) => (
              <ImportRowCard key={r.id} row={r} {...rowCardProps} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
