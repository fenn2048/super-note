export default function ImportResultBanner({
  message,
  onClose,
  onGoTx,
  onGoStats,
}: {
  message: string;
  onClose: () => void;
  onGoTx?: () => void;
  onGoStats?: () => void;
}) {
  return (
    <div className="rounded-xl border border-accent-primary/40 bg-accent-primary/10 px-3 py-2 text-sm flex flex-wrap gap-2 items-center justify-between">
      <span>{message}</span>
      <div className="flex gap-2">
        {onGoTx && (
          <button
            type="button"
            className="text-accent-primary text-xs underline"
            onClick={onGoTx}
          >
            查看明细
          </button>
        )}
        {onGoStats && (
          <button
            type="button"
            className="text-accent-primary text-xs underline"
            onClick={onGoStats}
          >
            查看统计
          </button>
        )}
        <button type="button" className="text-tx-tertiary text-xs" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
