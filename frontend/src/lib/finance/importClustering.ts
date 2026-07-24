/**
 * 导入待确认商户聚类（PR3）
 * normalizePayee 与 backend/src/services/finance/dedup.ts 对齐
 */

export function normalizePayee(s: string | null | undefined): string {
  return (s || "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .toLowerCase();
}

export type ImportRowView = {
  id: string;
  status?: string;
  draft?: {
    payee?: string;
    narration?: string;
    date?: string;
    amountMinor?: number;
    targetAccountId?: string | null;
    methodAccountId?: string | null;
    selected?: boolean;
  } | null;
  parsed?: {
    payee?: string;
    item?: string;
    amountMinor?: number;
  } | null;
};

export type PayeeCluster = {
  key: string;
  displayPayee: string;
  rowIds: string[];
  rows: ImportRowView[];
  totalMinor: number;
  count: number;
  commonTargetId?: string;
  commonMethodId?: string;
  applyable: boolean;
};

function payeeOf(r: ImportRowView): string {
  return String(r.draft?.payee || r.parsed?.payee || "").trim();
}

function amountAbs(r: ImportRowView): number {
  return Math.abs(Number(r.draft?.amountMinor ?? r.parsed?.amountMinor ?? 0));
}

function commonId(rows: ImportRowView[], field: "targetAccountId" | "methodAccountId"): string | undefined {
  const ids = rows
    .map((r) => r.draft?.[field])
    .filter((x): x is string => !!x);
  if (!ids.length) return undefined;
  const first = ids[0];
  return ids.every((id) => id === first) ? first : undefined;
}

/**
 * 仅聚类 needs_review；空 payee 进 unclustered（不可一键套用，K14）
 */
export function clusterNeedsReview(rows: ImportRowView[]): {
  clusters: PayeeCluster[];
  unclustered: ImportRowView[];
} {
  const review = rows.filter((r) => r.status === "needs_review");
  const unclustered: ImportRowView[] = [];
  const map = new Map<string, ImportRowView[]>();

  for (const r of review) {
    const key = normalizePayee(payeeOf(r));
    if (!key) {
      unclustered.push(r);
      continue;
    }
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }

  const clusters: PayeeCluster[] = [...map.entries()].map(([key, list]) => {
    const displayPayee = payeeOf(list[0]) || key;
    return {
      key,
      displayPayee,
      rowIds: list.map((r) => r.id),
      rows: list,
      totalMinor: list.reduce((s, r) => s + amountAbs(r), 0),
      count: list.length,
      commonTargetId: commonId(list, "targetAccountId"),
      commonMethodId: commonId(list, "methodAccountId"),
      applyable: true,
    };
  });

  clusters.sort((a, b) => b.count - a.count || b.totalMinor - a.totalMinor);

  return { clusters, unclustered };
}
