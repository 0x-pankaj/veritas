import { describe, expect, it } from "vitest";
import { accuracyPct, aggregateEarnings } from "./services/explorer.js";

describe("explorer aggregation helpers", () => {
  it("computes accuracy, null when no rounds", () => {
    expect(accuracyPct(8, 10)).toBe(80);
    expect(accuracyPct(3, 3)).toBe(100);
    expect(accuracyPct(0, 0)).toBeNull();
  });

  it("aggregates earnings by settlement status", () => {
    const e = aggregateEarnings([
      { amount: "5000", status: "AVAILABLE" },
      { amount: "5000", status: "PENDING" },
      { amount: "300", status: "PENDING" },
      { amount: "1", status: "FAILED" },
    ]);
    expect(e.settled).toBe("5000");
    expect(e.pending).toBe("5300");
    expect(e.total).toBe("10300");
  });
});
