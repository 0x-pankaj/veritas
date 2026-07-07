import { resolve } from "node:path";
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../../.env"));
} catch {
  /* no root .env — rely on the ambient environment */
}

import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { buildApp } from "@veritas/coordinator";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { VeritasClient } from "@veritas/onchain";
import pg from "pg";
import { registerSeller, registerWithCoordinator } from "./register.js";

const DATABASE_URL = process.env.DATABASE_URL;
const DEVNET = process.env.DEVNET_KEYPAIR;
const SOLANA_RPC = process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

/** In-process coordinator on an ephemeral port; registration routes only. */
async function startCoordinator(): Promise<{ url: string; server: ServerType }> {
  const app = buildApp({
    settlement: {
      verifyAll: async () => [],
      settleAll: async () => [],
    },
    veritasClient: () => {
      throw new Error("Solana client is not used by registration routes");
    },
    coordinatorApiKey: "seller-sdk-test-key",
    feeBps: 200,
    feeAddress: "0x00000000000000000000000000000000000000Fe",
  });
  return new Promise((resolvePromise) => {
    const server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
      resolvePromise({ url: `http://127.0.0.1:${info.port}`, server });
    });
  });
}

const capability = {
  category: "crypto-prices" as const,
  coverage: ["BTC/USD"],
  schema: "{symbol, price, ts}",
  freshnessSec: 5,
};

describe.skipIf(!DATABASE_URL)("seller registration", () => {
  let coordinatorUrl: string;
  let server: ServerType;
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const createdPubkeys: string[] = [];

  beforeAll(async () => {
    ({ url: coordinatorUrl, server } = await startCoordinator());
  });

  afterAll(async () => {
    server.close();
    if (createdPubkeys.length > 0) {
      await pool.query("DELETE FROM sellers WHERE solana_pubkey = ANY($1)", [
        createdPubkeys,
      ]);
    }
    await pool.end();
  });

  it("registerWithCoordinator upserts the capability descriptor", async () => {
    const solanaPubkey = `sdk-test-${Date.now()}`.padEnd(32, "x");
    createdPubkeys.push(solanaPubkey);
    const opts = {
      solanaPubkey,
      name: "sdk-seller",
      payoutAddress: "0x1111111111111111111111111111111111111111",
      endpoint: "http://localhost:9201",
      price: "1000",
      capability,
      coordinatorUrl,
    };
    const first = await registerWithCoordinator(opts);
    expect(first.reputation).toBe(500);
    expect(first.status).toBe("ACTIVE");

    // Idempotent upsert: same pubkey, updated fields, same row.
    const second = await registerWithCoordinator({ ...opts, price: "2000" });
    expect(second.id).toBe(first.id);
  });

  it("rejects invalid input with a clear error", async () => {
    await expect(
      registerWithCoordinator({
        solanaPubkey: `sdk-bad-${Date.now()}`.padEnd(32, "x"),
        name: "sdk-seller",
        payoutAddress: "not-an-address",
        endpoint: "http://localhost:9201",
        price: "1000",
        capability,
        coordinatorUrl,
      }),
    ).rejects.toThrow(/coordinator registration failed \(400\)/);
  });

  // ── Full flow: Devnet PDA + coordinator DB (env-gated, PRODUCT §3.1) ──
  describe.skipIf(!DEVNET)("registerSeller on Devnet", () => {
    it("creates the SellerAccount PDA and the registry row, idempotently", async () => {
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
      const connection = new Connection(SOLANA_RPC, "confirmed");
      const sellerKeypair = Keypair.generate();
      createdPubkeys.push(sellerKeypair.publicKey.toBase58());

      // Fund the fresh seller identity (rent + fees); retry — public Devnet
      // drops transactions.
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: payer.publicKey,
              toPubkey: sellerKeypair.publicKey,
              lamports: 20_000_000,
            }),
          );
          await sendAndConfirmTransaction(connection, tx, [payer], {
            commitment: "confirmed",
          });
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 2_000 * (i + 1)));
        }
      }
      if (lastErr) throw lastErr;

      const opts = {
        name: `sdk-seller-${Date.now() % 100_000}`,
        solanaKeypair: sellerKeypair,
        payoutAddress: "0x2222222222222222222222222222222222222222",
        endpoint: "http://localhost:9202",
        price: "1000",
        capability,
        coordinatorUrl,
        solanaRpc: SOLANA_RPC,
      };
      const seller = await registerSeller(opts);
      expect(seller.onchainTx).toBeTypeOf("string");
      expect(seller.reputation).toBe(500);
      expect(seller.solanaPubkey).toBe(sellerKeypair.publicKey.toBase58());

      // On-chain state is real.
      const client = new VeritasClient({ connection, payer: sellerKeypair });
      const onchain = await client.getSeller(sellerKeypair.publicKey);
      expect(onchain.name).toBe(opts.name);
      expect(onchain.reputation).toBe(500);

      // Re-registration: PDA exists → no tx; registry upserts → same id.
      const again = await registerSeller(opts);
      expect(again.onchainTx).toBeUndefined();
      expect(again.id).toBe(seller.id);
    }, 120_000);
  });
});
