import { resolve } from "node:path";
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  /* rely on ambient env */
}

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
import { buildApp } from "@veritas/coordinator";
import { MockSettlementProvider } from "@veritas/coordinator/services/settlement";
import { registerSeller } from "@veritas/seller";
import { VeritasClient } from "@veritas/onchain";
import { createDemoSellerApp } from "../../apps/demo/src/sellers/seller-factory";
import { runDemo } from "../../apps/demo/src/demo/orchestrator";
import { getSeller, getVerdict, listVerdicts } from "../../apps/dashboard/src/data";

const DEVNET = process.env.DEVNET_KEYPAIR;
const gated = !DEVNET || !process.env.DATABASE_URL;

const API_KEY = "e2e-coordinator-key";
const FEE_ADDRESS = "0x00000000000000000000000000000000000000Fe";

interface RoleSpec {
  role: "honest" | "honest2" | "liar";
  payout: string;
  quote: (poisoned: boolean) => string;
  poisonable: boolean;
}

const ROLES: RoleSpec[] = [
  {
    role: "honest",
    payout: "0x4444444444444444444444444444444444444444",
    quote: () => "50000.00",
    poisonable: false,
  },
  {
    role: "honest2",
    payout: "0x5555555555555555555555555555555555555555",
    quote: () => "50100.00",
    poisonable: false,
  },
  {
    role: "liar",
    payout: "0x6666666666666666666666666666666666666666",
    quote: (poisoned) => (poisoned ? "55000.00" : "50050.00"),
    poisonable: true,
  },
];

describe.skipIf(gated)("full-flow E2E: sellers → buy → Solana verdict → settle → dashboard", () => {
  const sellerServers: Server[] = [];
  const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const sellerIds: string[] = [];
  const symbol = `E2E-${Date.now()}/USD`;
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

  it("one verified purchase catches the liar and the dashboard reflects it", async () => {
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
    const connection = new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed",
    );
    veritasClient = new VeritasClient({ connection, payer });

    // 1. Fund the three ephemeral seller identities (rent + fees).
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
    await sendAndConfirmTransaction(connection, fund, [payer], { commitment: "confirmed" });

    // 2. Boot three sellers on the @veritas/seller middleware (via the demo factory).
    const endpoints: string[] = [];
    for (const [i, spec] of ROLES.entries()) {
      const built = createDemoSellerApp({
        name: `e2e-${spec.role}`,
        keypair: owners[i]!,
        payoutAddress: spec.payout,
        price: "5000",
        coordinatorApiKey: API_KEY,
        coordinatorUrl: "http://unused-at-serve-time",
        quote: (state) => spec.quote(state.poisoned),
        poisonable: spec.poisonable,
      });
      const app = express();
      app.use(built.app);
      const server = await new Promise<Server>((res) => {
        const s = app.listen(0, () => res(s));
      });
      sellerServers.push(server);
      endpoints.push(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    }

    // 3. Serve an in-process coordinator wired to the live Devnet client.
    const app = buildApp({
      settlement: new MockSettlementProvider(),
      veritasClient: () => veritasClient,
      coordinatorApiKey: API_KEY,
      feeBps: 200,
      feeAddress: FEE_ADDRESS,
    });
    const { url: coordUrl, server: coordServer } = await new Promise<{
      url: string;
      server: ServerType;
    }>((res) => {
      const s = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => {
        res({ url: `http://127.0.0.1:${info.port}`, server: s });
      });
    });
    coordinator = coordServer;
    // The dashboard data layer is a thin coordinator client — point it here.
    process.env.VERITAS_FACILITATOR_URL = coordUrl;

    // 4. Register each seller on Devnet + the coordinator (unique symbol → isolated).
    for (const [i, spec] of ROLES.entries()) {
      const handle = await registerSeller({
        name: `e2e-${spec.role}-${Date.now() % 100000}`,
        solanaKeypair: owners[i]!,
        payoutAddress: spec.payout,
        endpoint: endpoints[i]!,
        price: "5000",
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

    // 5. One verified purchase through the agent SDK (the demo orchestrator).
    const result = await runDemo({ facilitatorUrl: coordUrl, symbol });
    queryId = result.queryId;

    expect(result.mode).toBe("live");
    expect(result.truth).toBe("50100");
    expect(result.sellers.filter((s) => s.matched)).toHaveLength(2);
    expect(result.sellers.filter((s) => !s.matched)).toHaveLength(1);
    expect(result.finalCost).toBe("10300");
    expect(result.solanaTx).toBeTruthy();
    expect(result.naive.correct).toBe(false); // naive x402 would act on the lie

    // 6. The dashboard's data layer reflects the round (same Postgres mirror).
    const verdict = await getVerdict(result.queryId);
    expect(verdict).not.toBeNull();
    expect(verdict!.query.truth).toBe("50100");
    expect(verdict!.responses).toHaveLength(3);
    expect(verdict!.responses.filter((r) => r.matched === true)).toHaveLength(2);
    expect(verdict!.settlements).toHaveLength(2); // only winners settled

    const ledger = await listVerdicts(50);
    expect(ledger.some((v) => v.id === result.queryId)).toBe(true);

    // A winning seller shows earnings + accuracy on their dashboard page.
    const winner = result.sellers.find((s) => s.matched)!;
    const sellerDetail = await getSeller(winner.sellerId);
    expect(sellerDetail).not.toBeNull();
    expect(BigInt(sellerDetail!.earnings.total)).toBe(5000n);
    expect(sellerDetail!.accuracy).toBe(100);

    // 7. Reclaim Devnet rent.
    await veritasClient.closeRequest(Uint8Array.from(Buffer.from(result.queryId, "hex")));
  });
});
