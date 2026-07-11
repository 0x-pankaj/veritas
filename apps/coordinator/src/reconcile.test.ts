import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reconcileSettlements } from "./services/reconcile.js";
import type { Db } from "./db.js";

/**
 * Locks the Gateway transfer-status → settlement-row mapping using the exact
 * status vocabulary observed live on Arc Testnet (P2-T6b):
 * received/batched stay PENDING, confirmed/completed → AVAILABLE,
 * failed → FAILED. The transfers API itself is exercised for real by
 * tests/e2e/real-money.e2e.test.ts.
 */
describe("reconcileSettlements", () => {
  const rows = [
    { id: "s1", status: "PENDING", gatewayTx: "t-received" },
    { id: "s2", status: "PENDING", gatewayTx: "t-batched" },
    { id: "s3", status: "PENDING", gatewayTx: "t-confirmed" },
    { id: "s4", status: "PENDING", gatewayTx: "t-completed" },
    { id: "s5", status: "PENDING", gatewayTx: "t-failed" },
    { id: "s6", status: "PENDING", gatewayTx: null },
  ];
  const updates: { id: string; status: string }[] = [];

  /** Minimal Db stub covering the two query shapes reconcile uses. */
  const db = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
    update: () => ({
      set: (v: { status: string }) => ({
        where: async (cond: unknown) => {
          // drizzle eq(settlements.id, row.id) — recover the id via closure order
          void cond;
          updates.push({ id: pendingIds.shift()!, status: v.status });
        },
      }),
    }),
  } as unknown as Db;
  let pendingIds: string[] = [];

  beforeEach(() => {
    updates.length = 0;
    pendingIds = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const status = String(url).split("/t-")[1]; // received | batched | ...
        return {
          ok: true,
          json: async () => ({ id: `t-${status}`, status }),
        } as Response;
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps live Gateway statuses to row statuses truthfully", async () => {
    // ids that will receive updates, in row order: confirmed, completed, failed
    pendingIds = ["s3", "s4", "s5"];
    const result = await reconcileSettlements(db, {
      gatewayApiUrl: "https://gateway.test",
    });

    expect(result.checked).toBe(6);
    expect(result.updated).toBe(3); // only terminal/batched-onchain states move
    expect(updates).toEqual([
      { id: "s3", status: "AVAILABLE" },
      { id: "s4", status: "AVAILABLE" },
      { id: "s5", status: "FAILED" },
    ]);
    // received/batched/null-tx rows were NOT updated — no false AVAILABLE.
  });

  it("tolerates transfers API failures (retries next tick)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await reconcileSettlements(db, {
      gatewayApiUrl: "https://gateway.test",
    });
    expect(result.updated).toBe(0);
  });
});
