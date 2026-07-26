import { cn } from "@/lib/utils";
import type { FilterKey } from "./labels";
import { filterChipLabel } from "./labels";

const FILTERS: FilterKey[] = [
  "needs_review",
  "ready",
  "duplicate",
  "ignored",
  "committed",
  "all",
];

export default function ImportFilterChips({
  filter,
  onFilterChange,
  counts,
  search,
  onSearchChange,
  readOnly,
  residualDup,
  onSelectReadyAndReview,
  onForceDuplicates,
  onMarkIgnoredDuplicates,
}: {
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  counts: Record<string, number>;
  search: string;
  onSearchChange: (v: string) => void;
  readOnly: boolean;
  residualDup: number;
  onSelectReadyAndReview: () => void;
  onForceDuplicates: () => void;
  onMarkIgnoredDuplicates: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 items-center">
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          onClick={() => onFilterChange(f)}
          className={cn(
            "px-2 py-1 rounded text-xs border",
            filter === f
              ? "border-accent-primary text-accent-primary"
              : "border-app-border text-tx-tertiary",
          )}
        >
          {filterChipLabel(f, counts)}
        </button>
      ))}
      <input
        className="px-2 py-1 rounded text-xs border border-app-border bg-app-bg w-28"
        placeholder="搜对方/商品"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
      {!readOnly && (
        <>
          <button
            type="button"
            className="px-2 py-1 rounded text-xs border border-app-border"
            onClick={onSelectReadyAndReview}
          >
            勾选就绪+待确认
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded text-xs border border-violet-500/40 text-violet-600"
            onClick={onForceDuplicates}
          >
            强制导入重复
          </button>
          {residualDup > 0 && (
            <button
              type="button"
              className="px-2 py-1 rounded text-xs border border-app-border text-tx-secondary"
              onClick={onMarkIgnoredDuplicates}
            >
              忽略剩余重复
            </button>
          )}
        </>
      )}
    </div>
  );
}
