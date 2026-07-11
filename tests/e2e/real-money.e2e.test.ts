import { resolve } from "node:path";
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  /* rely on ambient env */
}

import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import express from "express";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { TESTNET } from "@veritas/core";
import * as schema from "@veritas/coordinator/db/schema";
import { buildApp } from "@veritas/coordinator";
import { CircleSettlementProvider } from "@veritas/coordinator/services/settlement";
import { reconcileSettlements } from "@veritas/coordinator/services/reconcile";
import { registerSeller } from "@veritas/seller";
import { CircleEip3009Signer, CircleGatewayAdapter, Veritas } from "@veritas/agent";
import { VeritasClient } from "@veritas/onchain";
import { createDemoSellerApp } from "../../apps/demo/src/sellers/seller-factory";

const ARC_KEY = process.env.ARC_PRIVATE_KEY as `0x${string}` | undefined;
const DEVNET = process.env.DEVNET_KEYPAIR;
const gated = !ARC_KEY || !DEVNET || !process.env.DATABASE_URL;

const GATEWAY_API = process.env.GATEWAY_API_URL ?? TESTNET.circle.gatewayApi;
const API_KEY = "real-money-e2e-key";
const PRICE = "5000"; // $0.005 per seller call
const FEE = "300"; // 3 × 5000 × 200bps

/** Fresh, never-used EVM address — Gateway balance starts at exactly 0. */
const freshAddress = () => `0x${randomBytes(20).toString("hex")}`;

/**
 * Total credited USDC (base units) for a depositor on Arc: settled `balance`
 * plus `pendingBatch` (TEE-credited sub-second at settle time, moves to
 * `balance` once Gateway batch-settles on-chain).
 */
async function creditedBaseUnits(depositor: string): Promise<bigint> {
  const res = await fetch(`${GATEWAY_API}/v1/balances`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "USDC", sources: [{ domain: 26, depositor }] }),
  });
  if (!res.ok) throw new Error(`balances API ${res.status}`);
  const body = (await res.json()) as {
    balances?: { balance?: string; pendingBatch?: string }[];
  };
  const toUnits = (s: string) => {
    const [int = "0", frac = ""] = s.split(".");
    return BigInt(int) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  };
  const b = body.balances?.[0];
  return toUnits(b?.balance ?? "0") + toUnits(b?.pendingBatch ?? "0");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(
  fn: () => Promise<T | undefined>,
  { timeoutMs, everyMs, label }: { timeoutMs: number; everyMs: number; label: string },
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(everyMs);
  }
}

interface RoleSpec {
  role: "honest" | "honest2" | "liar";
  quote: string;
}
const ROLES: RoleSpec[] = [
  { role: "honest", quote: "50000.00" },
  { role: "honest2", quote: "50100.00" },
  { role: "liar", quote: "55000.00" }, // +10% — outside the 100bps tolerance
];

describe.skipIf(gated)("REAL MONEY e2e: Arc Testnet Gateway settlement, nothing mocked", () => {
  const sellerServers: Server[] = [];
  const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const payouts = ROLES.map(() => freshAddress());
  const feeAddress = freshAddress();
  const sellerIds: string[] = [];
  const symbol = `REAL-${Date.now()}/USD`;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let coordinator: ServerType | undefined;
  let veritasClient: VeritasClient;
  let queryId: string | undefined;

  afterAll(async () => {
    for (const s of sellerServers) s.close();
    coordinator?.close();
    if (queryId) {
      await pool.query("DELETE FROM settlements WHERE query_id = $1", [queryId]);
      await pool.query("DELETE FROM responses WHERE query_id = $1", [queryId]);
      await pool.query("DELETE FROM queries WHERE id = $1", [queryId]);
    }
    if (sellerIds.length) {
      await pool.query("DELETE FROM sellers WHERE id = ANY($1)", [sellerIds]);
    }
    await pool.end();
  });

  it(
    "one verified purchase moves real USDC to winners only; liar earns 0",
    async () => {
      const signer = new CircleEip3009Signer(ARC_KEY!);
      const gateway = new CircleGatewayAdapter(ARC_KEY!);
      console.log(`buyer: ${signer.address}`);

      // 0. Real buyer funding: wallet USDC (faucet) → Gateway deposit if short.
      const veritasForDeposit = new Veritas({
        facilitatorUrl: "http://unused",
        signer,
        gateway,
      });
      await veritasForDeposit.ensureDeposit("1000000"); // ≥ $1 in Gateway
      const buyerBefore = BigInt(await until(
        async () => {
          const b = await gateway.getBalance(signer.address);
          return BigInt(b) >= 1_000_000n ? b : undefined;
        },
        { timeoutMs: 180_000, everyMs: 5_000, label: "Gateway deposit to be credited" },
      ));
      console.log(`buyer Gateway available: ${buyerBefore} base units`);

      // 1. Fund the ephemeral seller Solana identities (rent + fees).
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
      const connection = new Connection(
        process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
        "confirmed",
      );
      veritasClient = new VeritasClient({ connection, payer });
      const fund = new Transaction();
      for (const o of owners) {
        fund.add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: o.publicKey,
            lamports: 20_000_000,
          }),
        );
      }
      await sendAndConfirmTransaction(connection, fund, [payer], {
        commitment: "confirmed",
      });

      // 2. Boot the three demo sellers (2 honest, 1 poisoned liar).
      const endpoints: string[] = [];
      for (const [i, spec] of ROLES.entries()) {
        const built = createDemoSellerApp({
          name: `real-${spec.role}`,
          keypair: owners[i]!,
          payoutAddress: payouts[i]!,
          price: PRICE,
          coordinatorApiKey: API_KEY,
          coordinatorUrl: "http://unused-at-serve-time",
          quote: () => spec.quote,
          poisonable: false,
        });
        const app = express();
        app.use(built.app);
        const server = await new Promise<Server>((res) => {
          const s = app.listen(0, () => res(s));
        });
        sellerServers.push(server);
        endpoints.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      }

      // 3. In-process coordinator with the REAL Circle settlement provider.
      const settlement = new CircleSettlementProvider({ gatewayApiUrl: GATEWAY_API });
      const app = buildApp({
        settlement,
        veritasClient: () => veritasClient,
        coordinatorApiKey: API_KEY,
        feeBps: 200,
        feeAddress,
      });
      const coordUrl = await new Promise<string>((res) => {
        coordinator = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
          res(`http://127.0.0.1:${info.port}`);
        });
      });

      // 4. Register sellers on Devnet + coordinator DB (unique symbol → isolated).
      for (const [i, spec] of ROLES.entries()) {
        const handle = await registerSeller({
          name: `real-${spec.role}-${Date.now() % 100000}`,
          solanaKeypair: owners[i]!,
          payoutAddress: payouts[i]!,
          endpoint: endpoints[i]!,
          price: PRICE,
          mode: "consensus",
          capability: {
            category: "crypto-prices",
            coverage: [symbol],
            schema: "{ symbol, price, ts }",
            freshnessSec: 5,
          },
          coordinatorUrl: coordUrl,
          ...(process.env.SOLANA_RPC ? { solanaRpc: process.env.SOLANA_RPC } : {}),
        });
        sellerIds.push(handle.id);
      }

      // 5. THE purchase: real auths signed, verified against the real Gateway
      //    balance, fan-out, Solana verdict, winners redeemed on Arc Testnet.
      const veritas = new Veritas({ facilitatorUrl: coordUrl, signer, gateway });
      const result = await veritas.buy({
        category: "crypto-prices",
        symbol,
        k: 3,
        maxPrice: "20000",
      });
      queryId = result.queryId;
      console.log(`queryId: ${queryId} solanaTx: ${result.verdict.solanaTx}`);

      expect((result.data as { truth: string }).truth).toBe("50100");
      expect(result.verdict.winners).toHaveLength(2);
      expect(result.verdict.outliers).toHaveLength(1);
      expect(result.verdict.solanaTx).toBeTruthy();
      expect(result.finalCost).toBe("10300"); // 2 × 5000 + 300 fee

      // 6. Real money moved: each winner is credited the exact price (TEE
      //    credit lands in pendingBatch sub-second, then moves to balance
      //    when the batch settles); the liar gets nothing; the fee lands.
      const winnerPayouts = ROLES.map((r, i) => ({ ...r, payout: payouts[i]! })).filter(
        (r) => r.role !== "liar",
      );
      for (const w of winnerPayouts) {
        const credited = await until(
          async () => {
            const b = await creditedBaseUnits(w.payout);
            return b > 0n ? b : undefined;
          },
          { timeoutMs: 120_000, everyMs: 3_000, label: `credit for ${w.role}` },
        );
        console.log(`${w.role} (${w.payout}) credited: ${credited}`);
        expect(credited.toString()).toBe(PRICE);
      }
      const feeCredited = await until(
        async () => {
          const b = await creditedBaseUnits(feeAddress);
          return b > 0n ? b : undefined;
        },
        { timeoutMs: 120_000, everyMs: 3_000, label: "fee credit" },
      );
      expect(feeCredited.toString()).toBe(FEE);

      const liarPayout = payouts[ROLES.findIndex((r) => r.role === "liar")]!;
      expect(await creditedBaseUnits(liarPayout)).toBe(0n); // liar earns 0

      // Buyer paid EXACTLY finalCost — the loser's auth was never redeemed.
      const buyerAfter = await until(
        async () => {
          const b = await gateway.getBalance(signer.address);
          return BigInt(b) < buyerBefore ? b : undefined;
        },
        { timeoutMs: 120_000, everyMs: 3_000, label: "buyer debit" },
      );
      expect(buyerBefore - BigInt(buyerAfter)).toBe(10_300n);

      // 7. Settlement rows: PENDING with a real transfer id, then reconciled
      //    to AVAILABLE once Gateway confirms the batch on Arc.
      const pendingRows = await until(
        async () => {
          const r = await pool.query(
            "SELECT status, gateway_tx FROM settlements WHERE query_id = $1",
            [queryId],
          );
          return r.rows.length === 2 ? (r.rows as { status: string; gateway_tx: string }[]) : undefined;
        },
        { timeoutMs: 60_000, everyMs: 2_000, label: "settlement rows" },
      );
      for (const row of pendingRows) {
        expect(row.gateway_tx).toBeTruthy();
        console.log(`settlement ${row.gateway_tx}: ${row.status}`);
      }

      const db = drizzle(pool, { schema });
      await until(
        async () => {
          await reconcileSettlements(db, { gatewayApiUrl: GATEWAY_API });
          const r = await pool.query(
            "SELECT status FROM settlements WHERE query_id = $1",
            [queryId],
          );
          const statuses = (r.rows as { status: string }[]).map((x) => x.status);
          expect(statuses).not.toContain("FAILED");
          return statuses.every((s) => s === "AVAILABLE") ? true : undefined;
        },
        // Gateway batch-settles on its own cadence — allow up to 20 min.
        { timeoutMs: 1_200_000, everyMs: 15_000, label: "settlements AVAILABLE" },
      );

      // 8. Reclaim Devnet rent.
      await veritasClient.closeRequest(Uint8Array.from(Buffer.from(queryId, "hex")));
    },
    1_800_000,
  );
});
