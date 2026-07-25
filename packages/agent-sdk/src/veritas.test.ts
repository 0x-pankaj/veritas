import { resolve } from "node:path";
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  /* rely on ambient env */
}

import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { buildApp } from "@veritas/coordinator";
import { MockSettlementProvider } from "@veritas/coordinator/services/settlement";
import { veritasSeller } from "@veritas/seller";
import type { Seller } from "@veritas/seller";
import express from "express";
import { Connection, Keypair } from "@solana/web3.js";
import { VeritasClient } from "@veritas/onchain";
import pg from "pg";
import { Veritas } from "./veritas.js";
import { LocalEip3009Signer } from "./sign.js";

const API_KEY = "agent-sdk-test-key";
const FEE_ADDRESS = "0x00000000000000000000000000000000000000Fe";

describe("LocalEip3009Signer", () => {
  it("produces auths the mock settlement provider accepts", async () => {
    const signer = new LocalEip3009Signer(
      "0x2222222222222222222222222222222222222222",
    );
    const auth = await signer.sign({
      to: "0x1111111111111111111111111111111111111111",
      value: "5000",
      network: "eip155:5042002",
    });
    expect(auth.from).toBe(signer.address);
    const provider = new MockSettlementProvider();
    const [ok] = await provider.verifyAll([
      {
        authorization: auth,
        payTo: "0x1111111111111111111111111111111111111111",
        amount: "5000",
        network: "eip155:5042002",
      },
    ]);
    expect(ok).toBe(true);
  });
});

describe("Veritas.buy budget enforcement", () => {
  let coordinatorUrl: string;
  let server: ServerType;
  let probeTarget: Server;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const created: string[] = [];

  const skip = !process.env.DATABASE_URL;

  beforeAll(async () => {
    if (skip) return;
    // pickSellers health-probes every candidate, so the seeded endpoints must
    // answer. This listener only has to respond at all (any status = alive);
    // the quote path never fans out to it.
    const probeUrl = await new Promise<string>((res) => {
      probeTarget = express()
        .get("/veritas/402", (_req, resp) => void resp.status(402).json({}))
        .listen(0, "127.0.0.1", () => {
          const { port } = probeTarget.address() as AddressInfo;
          res(`http://127.0.0.1:${port}`);
        });
    });
    // Seed 3 cheap sellers so /quote succeeds (no Solana needed for quote).
    const run = `agent-budget-${Date.now()}`;
    for (const i of [0, 1, 2]) {
      const pk = `${run}-${i}`.padEnd(32, "x");
      created.push(pk);
      await pool.query(
        `INSERT INTO sellers (id, solana_pubkey, payout_address, name, endpoint, price, category, coverage, schema_desc, freshness_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          randomUUID(),
          pk,
          `0x${String(i + 3).repeat(40).slice(0, 40)}`,
          `${run}-${i}`,
          probeUrl,
          "5000",
          "crypto-prices",
          [`${run}/USD`],
          "{symbol, price, ts}",
          5,
        ],
      );
    }
    const app = buildApp({
      settlement: new MockSettlementProvider(),
      veritasClient: () => {
        throw new Error("Solana not used for quote-only budget test");
      },
      coordinatorApiKey: API_KEY,
      feeBps: 200,
      feeAddress: FEE_ADDRESS,
    });
    ({ url: coordinatorUrl, server } = await new Promise<{
      url: string;
      server: ServerType;
    }>((res) => {
      const s = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
        res({ url: `http://127.0.0.1:${info.port}`, server: s });
      });
    }));
    // Stash the symbol for the test.
    (globalThis as Record<string, unknown>).__budgetSymbol = `${run}/USD`;
  });

  afterAll(async () => {
    if (skip) return;
    server.close();
    probeTarget?.close();
    if (created.length) {
      await pool.query("DELETE FROM sellers WHERE solana_pubkey = ANY($1)", [created]);
    }
    await pool.end();
  });

  it.skipIf(skip)("aborts before signing when quote exceeds maxPrice", async () => {
    const symbol = (globalThis as Record<string, unknown>).__budgetSymbol as string;
    const veritas = new Veritas({
      facilitatorUrl: coordinatorUrl,
      signer: new LocalEip3009Signer(),
    });
    // maxExposure = 3×5000 + 300 fee = 15300; cap at 10000 → must abort.
    await expect(
      veritas.buy({ category: "crypto-prices", symbol, maxPrice: "10000" }),
    ).rejects.toThrow(/exceeds maxPrice/);
  });

  it.skipIf(skip)("rejects fast mode (coordinator has no single-seller route)", async () => {
    const veritas = new Veritas({
      facilitatorUrl: coordinatorUrl,
      signer: new LocalEip3009Signer(),
    });
    await expect(
      veritas.buy({
        category: "crypto-prices",
        symbol: "BTC/USD",
        mode: "fast",
        maxPrice: "100000",
      }),
    ).rejects.toThrow(/fast mode/);
  });
});

// ── Full verified purchase E2E: SDK → coordinator → mock sellers → Devnet ──
const DEVNET = process.env.DEVNET_KEYPAIR;
const e2eGated = !DEVNET || !process.env.DATABASE_URL;

describe.skipIf(e2eGated)("Veritas.buy verified E2E (devnet + mock settle)", () => {
  const servers: Server[] = [];
  const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const PRICES = ["50000.00", "50100.00", "55000.00"]; // index 2 = liar
  const sellerIds: string[] = [];
  const run = `agent-e2e-${Date.now()}`;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let coordinatorUrl: string;
  let coordinatorServer: ServerType;
  let veritasClient: VeritasClient;
  let payer: Keypair;

  const mkSellerHandle = (i: number, port: number): Seller => ({
    id: `pending-${i}`,
    name: `${run}-${i}`,
    solanaPubkey: owners[i]!.publicKey.toBase58(),
    payoutAddress: `0x${String(i + 3).repeat(40).slice(0, 40)}`,
    endpoint: `http://127.0.0.1:${port}`,
    price: "5000",
    mode: "consensus",
    capability: {
      category: "crypto-prices",
      coverage: [`${run}/USD`],
      schema: "{symbol, price, ts}",
      freshnessSec: 5,
    },
    coordinatorUrl: "",
    reputation: 500,
    status: "ACTIVE",
    keypair: owners[i]!,
  });

  beforeAll(async () => {
    // 1. Boot 3 mock sellers using the seller SDK middleware (dogfooding).
    for (let i = 0; i < 3; i++) {
      const price = PRICES[i]!;
      const app = express();
      const server = await new Promise<Server>((res) => {
        const s = app.listen(0, () => res(s));
      });
      const port = (server.address() as AddressInfo).port;
      app.use(
        veritasSeller({
          seller: mkSellerHandle(i, port),
          coordinatorApiKey: API_KEY,
          serve: ({ symbol }) => ({
            value: price,
            payload: { symbol, price, ts: 0 },
          }),
        }),
      );
      servers.push(server);
    }

    // 2. Register on Devnet + DB mirror.
    payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
    const connection = new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed",
    );
    veritasClient = new VeritasClient({ connection, payer });

    const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import(
      "@solana/web3.js"
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const tx = new Transaction();
        for (const o of owners) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: o.publicKey,
              lamports: 5_000_000,
            }),
          );
        }
        await sendAndConfirmTransaction(connection, tx, [payer], {
          commitment: "confirmed",
        });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
      }
    }

    for (let i = 0; i < 3; i++) {
      await veritasClient.registerSeller(`${run}-${i}`, owners[i]!);
      const sellerId = randomUUID();
      await pool.query(
        `INSERT INTO sellers (id, solana_pubkey, payout_address, name, endpoint, price, category, coverage, schema_desc, freshness_sec)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          sellerId,
          owners[i]!.publicKey.toBase58(),
          `0x${String(i + 3).repeat(40).slice(0, 40)}`,
          `${run}-${i}`,
          (servers[i]!.address() as AddressInfo).port
            ? `http://127.0.0.1:${(servers[i]!.address() as AddressInfo).port}`
            : "",
          "5000",
          "crypto-prices",
          [`${run}/USD`],
          "{symbol, price, ts}",
          5,
        ],
      );
      sellerIds.push(sellerId);
    }

    // 3. In-process coordinator wired to the live Devnet client.
    const app = buildApp({
      settlement: new MockSettlementProvider(),
      veritasClient: () => veritasClient,
      coordinatorApiKey: API_KEY,
      feeBps: 200,
      feeAddress: FEE_ADDRESS,
    });
    ({ url: coordinatorUrl, server: coordinatorServer } = await new Promise<{
      url: string;
      server: ServerType;
    }>((res) => {
      const s = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
        res({ url: `http://127.0.0.1:${info.port}`, server: s });
      });
    }));
  }, 120_000);

  afterAll(async () => {
    for (const s of servers) s.close();
    coordinatorServer?.close();
    if (sellerIds.length) {
      await pool.query("DELETE FROM settlements WHERE seller_id = ANY($1)", [sellerIds]);
      await pool.query("DELETE FROM responses WHERE seller_id = ANY($1)", [sellerIds]);
      await pool.query("DELETE FROM sellers WHERE id = ANY($1)", [sellerIds]);
    }
    await pool.end();
  });

  it("one buy() call returns verified data, the verdict, and the true cost", async () => {
    const veritas = new Veritas({
      facilitatorUrl: coordinatorUrl,
      signer: new LocalEip3009Signer("0x2222222222222222222222222222222222222222"),
    });

    const r = await veritas.buy({
      category: "crypto-prices",
      symbol: `${run}/USD`,
      mode: "verified",
      k: 3,
      maxPrice: "20000", // > maxExposure 15300
    });

    expect((r.data as { truth: string }).truth).toBe("50100");
    expect(r.verdict.truth).toBe("50100");
    expect(r.verdict.winners.length).toBe(2);
    expect(r.verdict.outliers.length).toBe(1);
    expect(r.verdict.solanaTx).toBeTruthy();
    // 2 winners × 5000 + 300 fee = 10300.
    expect(r.finalCost).toBe("10300");

    // Audit read works too.
    const audit = await veritas.verify(r.queryId);
    expect(audit.queryId).toBe(r.queryId);

    await veritasClient.closeRequest(Uint8Array.from(Buffer.from(r.queryId, "hex")));
  }, 120_000);
});
