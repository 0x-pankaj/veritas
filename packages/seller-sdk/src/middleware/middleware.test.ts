import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import { Keypair } from "@solana/web3.js";
import { commitment, verifyResponseSig } from "@veritas/core";
import { fanout } from "@veritas/coordinator/services/fanout";
import type { Seller } from "../types.js";
import { build402, handleServe, type SellerMiddlewareOpts } from "./core.js";
import { veritasSeller } from "./express.js";

const API_KEY = "test-coordinator-key";

function mkSeller(over: Partial<Seller> = {}): Seller {
  const keypair = Keypair.generate();
  return {
    id: "seller-1",
    name: "acme-prices",
    solanaPubkey: keypair.publicKey.toBase58(),
    payoutAddress: "0x1111111111111111111111111111111111111111",
    endpoint: "http://localhost:0",
    price: "1000",
    mode: "consensus",
    capability: {
      category: "crypto-prices",
      coverage: ["BTC/USD"],
      schema: "{symbol, price, ts}",
      freshnessSec: 5,
    },
    coordinatorUrl: "http://localhost:3001",
    reputation: 500,
    status: "ACTIVE",
    keypair,
    ...over,
  };
}

describe("handleServe", () => {
  const opts: SellerMiddlewareOpts = {
    seller: mkSeller(),
    coordinatorApiKey: API_KEY,
    serve: ({ symbol }) => ({ value: "50000", payload: { symbol, price: 50000 } }),
  };

  it("rejects a missing/wrong coordinator credential with 401", async () => {
    const req = { queryId: "q1", category: "crypto-prices", symbol: "BTC/USD" };
    expect((await handleServe(opts, undefined, req)).status).toBe(401);
    expect((await handleServe(opts, "wrong", req)).status).toBe(401);
  });

  it("rejects a malformed fan-out body with 400", async () => {
    const out = await handleServe(opts, API_KEY, { category: "nope" });
    expect(out.status).toBe(400);
  });

  it("serves value + payload for a valid credentialed request", async () => {
    const out = await handleServe(opts, API_KEY, {
      queryId: "q1",
      category: "crypto-prices",
      symbol: "BTC/USD",
    });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      value: "50000",
      payload: { symbol: "BTC/USD", price: 50000 },
    });
    expect((out.body as Record<string, unknown>).commitment).toBeUndefined();
  });

  it("signs every response with the seller's Solana identity key", async () => {
    const out = await handleServe(opts, API_KEY, {
      queryId: "q-signed",
      category: "crypto-prices",
      symbol: "BTC/USD",
    });
    const { sig, value } = out.body as { sig: string; value: string };
    expect(sig).toMatch(/^0x[0-9a-f]{128}$/);
    expect(verifyResponseSig(sig, "q-signed", value, opts.seller.solanaPubkey)).toBe(true);
    // Bound to this query and value — any change invalidates it.
    expect(verifyResponseSig(sig, "q-other", value, opts.seller.solanaPubkey)).toBe(false);
    expect(verifyResponseSig(sig, "q-signed", "50001", opts.seller.solanaPubkey)).toBe(false);
  });

  it("attaches a payload commitment in content-addressed mode", async () => {
    const caOpts: SellerMiddlewareOpts = {
      ...opts,
      seller: mkSeller({ mode: "content-addressed" }),
    };
    const out = await handleServe(caOpts, API_KEY, {
      queryId: "q1",
      category: "crypto-prices",
      symbol: "BTC/USD",
    });
    const body = out.body as { payload: unknown; commitment: string };
    expect(body.commitment).toBe(commitment(body.payload));
  });
});

describe("build402", () => {
  it("returns x402 requirements with the seller's price and payout", () => {
    const out = build402({
      seller: mkSeller(),
      coordinatorApiKey: API_KEY,
      serve: () => ({ value: "0" }),
    });
    expect(out.status).toBe(402);
    const body = out.body as {
      accepts: { maxAmountRequired: string; payTo: string; extra: unknown }[];
    };
    expect(body.accepts[0]!.maxAmountRequired).toBe("1000");
    expect(body.accepts[0]!.payTo).toBe(mkSeller().payoutAddress);
  });
});

// ── Integration: coordinator fan-out against wrapped Express sellers ──
// Boots real Express servers using the adapter and drives them through the
// coordinator's actual fan-out engine (the wrapped-endpoint acceptance path).
describe("express adapter through coordinator fan-out", () => {
  const servers: Server[] = [];

  afterAll(() => {
    for (const s of servers) s.close();
  });

  async function startSeller(
    id: string,
    payout: string,
    value: string,
  ): Promise<Seller> {
    const seller = mkSeller({ id, payoutAddress: payout, endpoint: "" });
    const app = express();
    app.use(
      veritasSeller({
        seller,
        coordinatorApiKey: API_KEY,
        serve: ({ symbol }) => ({ value, payload: { symbol, price: value } }),
      }),
    );
    const server = await new Promise<Server>((res) => {
      const s = app.listen(0, () => res(s));
    });
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    return { ...seller, endpoint: `http://127.0.0.1:${port}` };
  }

  it("collects values from wrapped sellers and drops bad-credential calls", async () => {
    const s1 = await startSeller(
      "s1",
      "0x1111111111111111111111111111111111111111",
      "50000",
    );
    const s2 = await startSeller(
      "s2",
      "0x2222222222222222222222222222222222222222",
      "50010",
    );
    const req = {
      queryId: "q-int",
      category: "crypto-prices" as const,
      symbol: "BTC/USD",
    };

    // The coordinator's fan-out uses the shared credential — both respond.
    const ok = await fanout(req, [s1 as never, s2 as never], {
      coordinatorApiKey: API_KEY,
    });
    expect(ok.map((r) => r.value).sort()).toEqual(["50000", "50010"]);
    // The coordinator accepted them, so every signature verified on ingest.
    for (const r of ok) expect(r.sig).toMatch(/^0x[0-9a-f]{128}$/);

    // Wrong credential → sellers refuse → nothing collected.
    const denied = await fanout(req, [s1 as never, s2 as never], {
      coordinatorApiKey: "wrong-key",
    });
    expect(denied).toHaveLength(0);
  });
});
