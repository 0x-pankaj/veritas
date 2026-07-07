import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { fanout, quorumMet } from "./services/fanout.js";
import type { Seller } from "./db/schema.js";

const API_KEY = "test-coordinator-key-0123456789";

function mockSeller(opts: {
  price: string;
  delayMs?: number;
  rejectBadKey?: boolean;
}): Hono {
  return new Hono().post("/veritas/serve", async (c) => {
    if (opts.rejectBadKey && c.req.header("x-veritas-coordinator") !== API_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const body = await c.req.json();
    return c.json({
      value: opts.price,
      payload: { symbol: body.symbol, price: opts.price, ts: 1 },
    });
  });
}

function sellerRow(id: string, endpoint: string): Seller {
  return {
    id,
    solanaPubkey: `pk-${id}`,
    payoutAddress: "0x1111111111111111111111111111111111111111",
    name: id,
    endpoint,
    price: "1000",
    mode: "CONSENSUS",
    category: "crypto-prices",
    coverage: ["BTC/USD"],
    schemaDesc: "s",
    freshnessSec: 5,
    reputation: 500,
    stake: "0",
    served: 0,
    matched: 0,
    outliers: 0,
    status: "ACTIVE",
    createdAt: new Date(),
  };
}

describe("fanout engine", () => {
  const servers: ServerType[] = [];
  const endpoints: string[] = [];

  beforeAll(async () => {
    const apps = [
      mockSeller({ price: "50000.00", rejectBadKey: true }), // honest, checks key
      mockSeller({ price: "50100.00" }), // honest
      mockSeller({ price: "55000.00", delayMs: 5_000 }), // too slow → dropped
    ];
    for (const app of apps) {
      await new Promise<void>((resolve) => {
        const srv = serve({ fetch: app.fetch, port: 0 }, (info) => {
          endpoints.push(`http://127.0.0.1:${info.port}`);
          resolve();
        });
        servers.push(srv);
      });
    }
  });

  afterAll(() => {
    for (const s of servers) s.close();
  });

  it("collects responses, drops the slow seller, keeps latency", async () => {
    const sellers = endpoints.map((e, i) => sellerRow(`s${i}`, e));
    const results = await fanout(
      { queryId: "q1", category: "crypto-prices", symbol: "BTC/USD" },
      sellers,
      { coordinatorApiKey: API_KEY, timeoutMs: 800 },
    );
    expect(results.length).toBe(2); // slow one dropped
    expect(results.map((r) => r.value).sort()).toEqual(["50000.00", "50100.00"]);
    for (const r of results) expect(r.latencyMs).toBeLessThan(800);
  });

  it("a seller rejecting a bad credential is dropped", async () => {
    const sellers = [sellerRow("s0", endpoints[0]!)];
    const results = await fanout(
      { queryId: "q2", category: "crypto-prices", symbol: "BTC/USD" },
      sellers,
      { coordinatorApiKey: "wrong-key", timeoutMs: 800 },
    );
    expect(results.length).toBe(0);
  });

  it("quorum math", () => {
    expect(quorumMet(2, 3)).toBe(true); // ceil(3*2/3)=2
    expect(quorumMet(1, 3)).toBe(false);
    expect(quorumMet(5, 7)).toBe(true); // ceil(7*2/3)=5
    expect(quorumMet(4, 7)).toBe(false);
  });
});
