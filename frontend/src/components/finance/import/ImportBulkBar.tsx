import type { FinanceAccount } from "@/types";
import AccountPicker from "@/components/finance/AccountPicker";

export default function ImportBulkBar({
  expInc,
  assetsLiab,
  bulkTarget,
  bulkMethod,
  onBulkTarget,
  onBulkMethod,
  onApply,
  pickerVariant,
}: {
  expInc: FinanceAccount[];
  assetsLiab: FinanceAccount[];
  bulkTarget: string;
  bulkMethod: string;
  onBulkTarget: (id: string) => void;
  onBulkMethod: (id: string) => void;
  onApply: () => void;
  pickerVariant: "dropdown" | "sheet";
}) {
  return (
    <div className="flex flex-wrap gap-2 items-center text-xs">
      <span className="text-tx-tertiary">批量设置当前列表：</span>
      <div className="w-[160px]">
        <AccountPicker
          accounts={expInc}
          value={bulkTarget}
          onChange={onBulkTarget}
          placeholder="分类账户"
          emptyLabel="分类账户"
          variant={pickerVariant}
          sheetTitle="分类账户"
        />
      </div>
      <div className="w-[160px]">
        <AccountPicker
          accounts={assetsLiab}
          value={bulkMethod}
          onChange={onBulkMethod}
          placeholder="资产账户"
          emptyLabel="资产账户"
          variant={pickerVariant}
          sheetTitle="支付账户"
        />
      </div>
      <button type="button" className="px-2 py-1 rounded border border-app-border" onClick={onApply}>
        应用到当前列表
      </button>
    </div>
  );
}
