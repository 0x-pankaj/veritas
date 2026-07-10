import { describe, expect, it } from "vitest";
import { mockDemoResult, runDemo } from "./orchestrator.js";

describe("demo orchestrator (mock path)", () => {
  it("mockDemoResult shows the liar caught and only winners paid", () => {
    const r = mockDemoResult();
    expect(r.truth).toBe("50100");
    const liar = r.sellers.find((s) => s.name === "sketchy-oracle")!;
    expect(liar.matched).toBe(false);
    expect(liar.settled).toBeUndefined(); // liar earns 0
    const winners = r.sellers.filter((s) => s.matched);
    expect(winners).toHaveLength(2);
    expect(winners.every((w) => w.settled === "5000")).toBe(true);
    expect(r.finalCost).toBe("10300");
  });

  it("the naive x402 path accepts the poisoned value and pays for it", () => {
    const r = mockDemoResult();
    expect(r.naive.value).toBe("55000");
    expect(r.naive.correct).toBe(false); // naive would have acted on a lie
  });

  it("runDemo({ mock: true }) returns the canned result without any infra", async () => {
    const r = await runDemo({ facilitatorUrl: "http://unused", mock: true });
    expect(r.mode).toBe("mock");
    expect(r.sellers).toHaveLength(3);
  });
});
