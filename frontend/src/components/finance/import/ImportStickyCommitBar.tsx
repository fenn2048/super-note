import { Check } from "lucide-react";
import type { CommitPreviewSplit } from "@/lib/finance/commitPreview";

export default function ImportStickyCommitBar({
  commitPreview,
  residualDup,
  committing,
  onCommitReady,
  onCommitIncludeReview,
}: {
  commitPreview: CommitPreviewSplit;
  residualDup: number;
  committing: boolean;
  onCommitReady: () => void;
  onCommitIncludeReview: () => void;
}) {
  return (
    <div
      className="shrink-0 border-t border-app-border bg-app-card/95 backdrop-blur px-3 py-2 flex flex-wrap gap-2 items-center justify-between"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
    >
      <div className="text-[11px] text-tx-tertiary min-w-0">
        就绪 {commitPreview.readySelectedCount}
        {commitPreview.reviewSelectedCount > 0 && (
          <span> · 待确认 {commitPreview.reviewSelectedCount}</span>
        )}
        {residualDup > 0 && <span> · 重复 {residualDup}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {commitPreview.reviewSelectedCount > 0 && (
          <button
            type="button"
            disabled={committing}
            onClick={onCommitIncludeReview}
            className="px-3 py-2 rounded-lg border border-amber-500/50 text-amber-700 dark:text-amber-300 text-sm disabled:opacity-50"
          >
            含待确认一并导入
          </button>
        )}
        <button
          type="button"
          disabled={committing || commitPreview.readySelectedCount === 0}
          onClick={onCommitReady}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-accent-primary text-white text-sm disabled:opacity-50 min-h-[40px]"
        >
          <Check size={14} />
          {committing ? "提交中…" : `导入就绪 ${commitPreview.readySelectedCount} 笔`}
        </button>
      </div>
    </div>
  );
}
