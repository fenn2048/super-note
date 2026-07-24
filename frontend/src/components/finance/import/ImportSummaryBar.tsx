import { Loader2, Upload } from "lucide-react";
import type { CommitPreviewSplit } from "@/lib/finance/commitPreview";
import { batchStatusLabel, channelLabel, yuan } from "./labels";

export default function ImportSummaryBar({
  readOnly,
  batchStatus,
  detectedChannel,
  detectConfidence,
  counts,
  commitPreview,
  residualDup,
  onlyDupResidual,
  onMarkIgnoredDuplicates,
  isCompact,
  busy,
  onFile,
}: {
  readOnly: boolean;
  batchStatus: string;
  detectedChannel: string;
  detectConfidence: number | null;
  counts: Record<string, number>;
  commitPreview: CommitPreviewSplit;
  residualDup: number;
  onlyDupResidual: boolean;
  onMarkIgnoredDuplicates: () => void;
  isCompact: boolean;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  return (
    <div className="rounded-xl border border-app-border bg-app-card p-3 text-sm space-y-2">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="font-medium text-tx-primary">
          {readOnly ? "已完成导入（只读）" : "导入预览"}
          <span className="ml-2 text-xs font-normal text-tx-tertiary">
            {batchStatusLabel(batchStatus)}
          </span>
        </div>
        {detectedChannel && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-app-hover">
            {channelLabel(detectedChannel)}
            {detectConfidence != null ? ` · 置信 ${(detectConfidence * 100).toFixed(0)}%` : ""}
          </span>
        )}
      </div>
      <div className="text-tx-secondary text-xs flex flex-wrap gap-3">
        <span>共 {counts.all}</span>
        <span className="text-accent-primary">就绪 {counts.ready}</span>
        <span className="text-amber-600">待确认 {counts.needs_review}</span>
        <span className="text-violet-600">重复 {counts.duplicate}</span>
        {(counts.committed || 0) > 0 && <span>已导入 {counts.committed}</span>}
        <span>忽略 {counts.ignored}</span>
      </div>
      {!readOnly && (
        <div className="text-tx-secondary text-xs flex flex-wrap gap-3">
          <span>
            主路径可提交{" "}
            <strong className="text-accent-primary">{commitPreview.readySelectedCount}</strong> 笔就绪
          </span>
          <span className="text-rose-500">支出 ¥{yuan(commitPreview.readyExpense)}</span>
          <span className="text-accent-primary">收入 ¥{yuan(commitPreview.readyIncome)}</span>
          {commitPreview.reviewSelectedCount > 0 && (
            <span className="text-amber-600">
              另有 {commitPreview.reviewSelectedCount} 笔待确认可一并导入
            </span>
          )}
        </div>
      )}
      {batchStatus === "partial" && residualDup > 0 && !readOnly && (
        <div className="text-[11px] text-violet-800 dark:text-violet-200 bg-violet-500/10 rounded-lg px-2.5 py-2 space-y-1">
          <p>
            仍有 {residualDup} 笔疑似重复未处理。批次保持「部分导入」：可稍后强制导入、
            <strong>忽略剩余重复</strong>，或等待批次过期（约 24h）。本地关闭导入页不会结束批次，可从「最近导入」继续。
          </p>
          {onlyDupResidual && (
            <button
              type="button"
              className="underline text-violet-700 dark:text-violet-300"
              onClick={onMarkIgnoredDuplicates}
            >
              忽略剩余重复
            </button>
          )}
        </div>
      )}
      {isCompact && (
        <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-app-border text-xs cursor-pointer mt-1">
          {busy ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
          重新选择文件
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
      )}
    </div>
  );
}
