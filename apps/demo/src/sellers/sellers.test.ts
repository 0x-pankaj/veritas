import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO } from "./prices.js";
import { COORDINATOR_API_KEY, startSeller, stopSeller, type RunningSeller } from "./run-seller.js";

/** Call a seller's fan-out endpoint the way the coordinator would. */
async function serve(
  url: string,
  credential = COORDINATOR_API_KEY,
): Promise<{ status: number; value?: string }> {
  const res = await fetch(`${url}/veritas/serve`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-veritas-coordinator": credential },
    body: JSON.stringify({
      queryId: "q-demo",
      category: DEMO.category,
      symbol: DEMO.symbol,
    }),
  });
  if (!res.ok) return { status: res.status };
  const body = (await res.json()) as { value: string };
  return { status: res.status, value: body.value };
}

/** True when `value` is within the coordinator's tolerance of `median`. */
function withinTolerance(value: number, median: number, bps = 100): boolean {
  return Math.abs(value - median) * 10_000 <= bps * Math.max(Math.abs(median), 1);
}

describe("demo sellers (honest + liar)", () => {
  const sellers: Record<string, RunningSeller> = {};

  beforeAll(async () => {
    sellers.honest = await startSeller("honest", 0);
    sellers.honest2 = await startSeller("honest2", 0);
    sellers.liar = await startSeller("liar", 0);
  });

  afterAll(() => {
    for (const s of Object.values(sellers)) stopSeller(s);
  });

  it("all three serve a value to a credentialed coordinator", async () => {
    for (const s of Object.values(sellers)) {
      const r = await serve(s.url);
      expect(r.status).toBe(200);
      expect(Number(r.value)).toBeGreaterThan(0);
    }
  });

  it("none serve without the coordinator credential", async () => {
    for (const s of Object.values(sellers)) {
      expect((await serve(s.url, "wrong")).status).toBe(401);
    }
  });

  it("the liar deviates: honest sellers agree, the liar is an outlier", async () => {
    const h1 = Number((await serve(sellers.honest!.url)).value);
    const h2 = Number((await serve(sellers.honest2!.url)).value);
    const liar = Number((await serve(sellers.liar!.url)).value);

    // Median of the three; the two honest sellers must fall within tolerance,
    // the poisoned liar must not — exactly what finalize_consensus checks.
    const median = [h1, h2, liar].sort((a, b) => a - b)[1]!;
    expect(withinTolerance(h1, median)).toBe(true);
    expect(withinTolerance(h2, median)).toBe(true);
    expect(withinTolerance(liar, median)).toBe(false);
  });

  it("the liar can be un-poisoned on command, then it agrees", async () => {
    const res = await fetch(`${sellers.liar!.url}/control/poison`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: false }),
    });
    expect(res.status).toBe(200);

    const h1 = Number((await serve(sellers.honest!.url)).value);
    const h2 = Number((await serve(sellers.honest2!.url)).value);
    const liar = Number((await serve(sellers.liar!.url)).value);
    const median = [h1, h2, liar].sort((a, b) => a - b)[1]!;
    expect(withinTolerance(liar, median)).toBe(true);

    // Restore poisoned state for other runs.
    await fetch(`${sellers.liar!.url}/control/poison`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: true }),
    });
  });
});
