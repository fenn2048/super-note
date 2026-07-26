import { describe, expect, it } from "vitest";
import { clusterNeedsReview, normalizePayee } from "../importClustering";

describe("normalizePayee", () => {
  it("strips stars, spaces, parentheses", () => {
    expect(normalizePayee("美团*外卖 (北京)")).toBe("美团外卖");
    expect(normalizePayee("  WeChat  ")).toBe("wechat");
  });
});

describe("clusterNeedsReview", () => {
  it("groups exact normalized payee; empty to unclustered", () => {
    const rows = [
      { id: "1", status: "needs_review", draft: { payee: "美团外卖", amountMinor: -100 } },
      { id: "2", status: "needs_review", draft: { payee: "美团*外卖", amountMinor: -200 } },
      { id: "3", status: "needs_review", draft: { payee: "", amountMinor: -50 } },
      { id: "4", status: "ready", draft: { payee: "美团外卖", amountMinor: -10 } },
    ];
    const { clusters, unclustered } = clusterNeedsReview(rows);
    expect(unclustered.map((r) => r.id)).toEqual(["3"]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
    expect(clusters[0].totalMinor).toBe(300);
    expect(clusters[0].applyable).toBe(true);
  });
});
