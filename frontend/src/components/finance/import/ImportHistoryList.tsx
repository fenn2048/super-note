import { cn } from "@/lib/utils";
import { batchStatusLabel, channelLabel } from "./labels";

export type ImportHistoryItem = {
  id: string;
  fileName?: string;
  channel?: string;
  status?: string;
  stats?: { total?: number };
};

export default function ImportHistoryList({
  history,
  onOpen,
}: {
  history: ImportHistoryItem[];
  onOpen: (h: ImportHistoryItem) => void;
}) {
  if (history.length === 0) return null;
  return (
    <div className="rounded-xl border border-app-border p-3">
      <div className="text-xs font-medium text-tx-secondary mb-2">最近导入</div>
      <ul className="space-y-1.5">
        {history.map((h) => (
          <li key={h.id} className="flex justify-between gap-2 text-xs">
            <button
              type="button"
              className="text-left truncate flex-1 hover:text-accent-primary"
              onClick={() => onOpen(h)}
            >
              <span className="font-medium">{h.fileName || h.id.slice(0, 8)}</span>
              <span className="text-tx-tertiary ml-1">
                {channelLabel(h.channel || "")} ·{" "}
                <span
                  className={cn(
                    h.status === "partial" && "text-amber-600",
                    h.status === "committed" && "text-accent-primary",
                  )}
                >
                  {batchStatusLabel(h.status || "")}
                </span>
              </span>
            </button>
            <span className="text-tx-tertiary shrink-0 tabular-nums">
              {h.stats?.total != null ? `${h.stats.total} 笔` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
