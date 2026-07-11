import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testClient } from "hono/testing";
import { eq, inArray } from "drizzle-orm";
import { buildApp } from "./app.js";
import { makeTestDeps } from "./test-helpers.js";
import { closeDb, getDb } from "./db.js";
import { sellers } from "./db/schema.js";
import { pickSellers } from "./services/registry.js";

const run = `disc-${Date.now()}`;
const mkSeller = (i: number) => ({
  solanaPubkey: `${run}-pk-${i}`.padEnd(32, "x"),
  payoutAddress: `0x${String(i).repeat(40).slice(0, 40)}`,
  name: `seller-${i}`,
  endpoint: `http://localhost:910${i}`,
  price: "1000",
  mode: "CONSENSUS" as const,
  category: "crypto-prices" as const,
  coverage: ["BTC/USD", "ETH/USD"],
  schemaDesc: "{symbol, price, ts}",
  freshnessSec: 5,
});

describe.skipIf(!process.env.DATABASE_URL)("registry + discovery", () => {
  const client = testClient(buildApp(makeTestDeps()));
  const created: string[] = [];

  beforeAll(async () => {
    const db = getDb();
    for (const i of [1, 2, 3]) {
      const res = await client.sellers.register.$post({ json: mkSeller(i) });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.reputation).toBe(500);
      created.push(body.id);
    }
    // Give seller-2 a better reputation so ranking is observable.
    await db
      .update(sellers)
      .set({ reputation: 700 })
      .where(eq(sellers.solanaPubkey, mkSeller(2).solanaPubkey));
  });

  afterAll(async () => {
    const db = getDb();
    await db.delete(sellers).where(inArray(sellers.id, created));
    await closeDb();
  });

  it("discovery filters by category+symbol and ranks by reputation", async () => {
    const res = await client.sellers.$get({
      query: { category: "crypto-prices", symbol: "BTC/USD" },
    });
    expect(res.status).toBe(200);
    const { sellers } = await res.json();
    const ours = sellers.filter((s) => s.solanaPubkey.startsWith(run));
    expect(ours.length).toBe(3);
    expect(ours[0]!.name).toBe("seller-2"); // reputation 700 ranks first
  });

  it("registration is idempotent (upsert) and validates input", async () => {
    const res = await client.sellers.register.$post({ json: mkSeller(1) });
    expect(res.status).toBe(201);

    const bad = await client.sellers.register.$post({
      json: { ...mkSeller(9), payoutAddress: "not-an-address" },
    });
    expect(bad.status).toBe(400);
  });

  it("pickSellers returns top-k by reputation", async () => {
    // Ranking only — endpoint health is covered by registry.test.ts.
    const picked = await pickSellers(getDb(), "crypto-prices", "ETH/USD", 2, {
      probe: async () => true,
    });
    const ours = picked.filter((s) => s.solanaPubkey.startsWith(run));
    expect(ours[0]!.name).toBe("seller-2");
  });
});
