import { useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ImportUploadZone({
  busy,
  hasBatch,
  compact,
  channel,
  onChannelChange,
  channelDisabled,
  useAllRules,
  onUseAllRulesChange,
  importRules,
  selectedRuleIds,
  onToggleRule,
  onGoRules,
  onFile,
  showRules = true,
}: {
  busy: boolean;
  hasBatch: boolean;
  /** 有 batch 时压缩 padding */
  compact?: boolean;
  channel: string;
  onChannelChange: (v: string) => void;
  channelDisabled?: boolean;
  useAllRules: boolean;
  onUseAllRulesChange: (v: boolean) => void;
  importRules: Array<{ id: string; name: string }>;
  selectedRuleIds: string[];
  onToggleRule: (id: string, checked: boolean) => void;
  onGoRules?: () => void;
  onFile: (file: File) => void;
  showRules?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed text-center transition-colors",
        compact ? "p-3" : "p-6",
        dragOver ? "border-accent-primary bg-accent-primary/5" : "border-app-border",
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
      {!hasBatch && (
        <>
          <Upload className="w-8 h-8 mx-auto text-tx-tertiary mb-2" />
          <p className="text-sm text-tx-secondary mb-1">上传支付宝 / 微信 / 京东 / 银行账单</p>
          <p className="text-xs text-tx-tertiary mb-3">
            支持拖拽文件到此处 · CSV / Excel / PDF / 邮件 EML
          </p>
        </>
      )}
      <select
        className="mb-3 px-2 py-1.5 text-sm rounded-lg border border-app-border bg-app-bg"
        value={channel}
        onChange={(e) => onChannelChange(e.target.value)}
        disabled={channelDisabled}
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
      {!hasBatch && showRules && (
        <div className="mb-3 text-left max-w-md mx-auto space-y-2">
          <div className="flex items-center justify-between text-xs text-tx-secondary">
            <span>应用规则</span>
            <button type="button" className="text-accent-primary" onClick={() => onGoRules?.()}>
              管理规则
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={useAllRules}
              onChange={(e) => onUseAllRulesChange(e.target.checked)}
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
                      onChange={(e) => onToggleRule(r.id, e.target.checked)}
                    />
                    <span className="truncate">{r.name}</span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm cursor-pointer">
        {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
        {hasBatch ? "重新选择文件" : "选择文件"}
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
  );
}
