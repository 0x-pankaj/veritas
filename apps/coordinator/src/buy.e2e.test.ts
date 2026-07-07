import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import { testClient } from "hono/testing";
import { Connection, Keypair } from "@solana/web3.js";
import { VeritasClient } from "@veritas/onchain";
import { inArray } from "drizzle-orm";
import { buildApp } from "./app.js";
import { closeDb, getDb } from "./db.js";
import { responses, sellers as sellersTable, settlements } from "./db/schema.js";
import { makeTestDeps, fakeAuth, fundAll, TEST_API_KEY } from "./test-helpers.js";

const DEVNET = process.env.DEVNET_KEYPAIR;
const gated = !DEVNET || !process.env.DATABASE_URL;

/** Live mock seller: verifies our credential, returns a fixed price. */
function mockSeller(price: string): Hono {
  return new Hono().post("/veritas/serve", async (c) => {
    if (c.req.header("x-veritas-coordinator") !== TEST_API_KEY) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const body = await c.req.json();
    return c.json({
      value: price,
      payload: { symbol: body.symbol, price, ts: Date.now() },
    });
  });
}

describe.skipIf(gated)("PRODUCT API e2e: /quote → /buy (devnet + mock settle)", () => {
  const servers: ServerType[] = [];
  const endpoints: string[] = [];
  const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const sellerIds: string[] = [];
  const run = `e2e-${Date.now()}`;
  const PRICES = ["50000.00", "50100.00", "55000.00"]; // index 2 = the liar
  let payer: Keypair;
  let veritasClient: VeritasClient;

  beforeAll(async () => {
    // 1. Spin up 3 live mock sellers (2 honest, 1 liar).
    for (const price of PRICES) {
      await new Promise<void>((resolveStart) => {
        const srv = serve({ fetch: mockSeller(price).fetch, port: 0 }, (info) => {
          endpoints.push(`http://127.0.0.1:${info.port}`);
          resolveStart();
        });
        servers.push(srv);
      });
    }

    // 2. Register them on-chain (Devnet) and in the DB mirror.
    payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
    const connection = new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed",
    );
    veritasClient = new VeritasClient({ connection, payer });

    await fundAll(
      connection,
      payer,
      owners.map((o) => o.publicKey),
      5_000_000,
    );

    const db = getDb();
    for (const [i, o] of owners.entries()) {
      await veritasClient.registerSeller(`${run}-${i}`, o);
      const [s] = await db
        .insert(sellersTable)
        .values({
          solanaPubkey: o.publicKey.toBase58(),
          payoutAddress: `0x${(i + 3).toString().repeat(40).slice(0, 40)}`,
          name: `${run}-${i}`,
          endpoint: endpoints[i]!,
          price: "5000", // $0.005 per call
          category: "crypto-prices",
          coverage: [`${run}/USD`], // unique symbol so only OUR sellers match
          schemaDesc: "{symbol, price, ts}",
          freshnessSec: 5,
        })
        .returning();
      sellerIds.push(s!.id);
    }
  }, 120_000);

  afterAll(async () => {
    for (const s of servers) s.close();
    const db = getDb();
    await db.delete(settlements).where(inArray(settlements.sellerId, sellerIds));
    await db.delete(responses).where(inArray(responses.sellerId, sellerIds));
    await db.delete(sellersTable).where(inArray(sellersTable.id, sellerIds));
    await closeDb();
  });

  it("full verified purchase: liar caught on-chain, only winners settle", async () => {
    const client = testClient(
      buildApp(makeTestDeps({ veritasClient: () => veritasClient })),
    );

    // ── QUOTE ──
    const quoteRes = await client.quote.$post({
      json: { category: "crypto-prices", symbol: `${run}/USD`, k: 3 },
    });
    expect(quoteRes.status).toBe(200);
    const quote = (await quoteRes.json()) as {
      quoteId: string;
      candidates: { sellerId: string; payoutAddress: string; price: string }[];
      fee: string;
      feeAddress: string;
      maxExposure: string;
    };
    expect(quote.candidates.length).toBe(3);
    // fee = 3×5000 × 2% = 300; maxExposure = 15300
    expect(quote.fee).toBe("300");
    expect(quote.maxExposure).toBe("15300");

    // ── BUY: K+1 pre-signed auths (one per candidate + fee) ──
    const auths = quote.candidates.map((cand) =>
      fakeAuth({ to: cand.payoutAddress, value: cand.price }),
    );
    auths.push(fakeAuth({ to: quote.feeAddress, value: quote.fee }));

    const buyRes = await client.buy.$post({
      json: { quoteId: quote.quoteId, authorizations: auths },
    });
    expect(buyRes.status).toBe(200);
    const result = (await buyRes.json()) as {
      queryId: string;
      data: { truth: string };
      verdict: { winners: string[]; outliers: string[]; solanaTx: string };
      finalCost: string;
    };

    // Truth = median of 50000/50100/55000; liar excluded.
    expect(result.data.truth).toBe("50100");
    expect(result.verdict.winners.length).toBe(2);
    expect(result.verdict.outliers.length).toBe(1);
    expect(result.verdict.solanaTx).toBeTruthy();
    // finalCost = 2 winners × 5000 + 300 fee = 10300 < maxExposure 15300.
    expect(result.finalCost).toBe("10300");

    // ── Async settlement lands (mock): poll /verify ──
    let settled = 0;
    for (let i = 0; i < 20 && settled < 2; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const v = await client.verify[":queryId"].$get({
        param: { queryId: result.queryId },
      });
      if (v.status !== 200) continue;
      const body = (await v.json()) as {
        status: string;
        settlements: { status: string; gatewayTx: string | null }[];
      };
      settled = body.settlements.filter(
        (s) => s.status === "PENDING" && s.gatewayTx,
      ).length;
    }
    expect(settled).toBe(2); // ONLY the two winners have settlements

    // Reused quote must be rejected (single-use).
    const replay = await client.buy.$post({
      json: { quoteId: quote.quoteId, authorizations: auths },
    });
    expect(replay.status).toBe(410);

    // Reclaim Devnet rent.
    await veritasClient.closeRequest(
      Uint8Array.from(Buffer.from(result.queryId, "hex")),
    );
  }, 120_000);
});
