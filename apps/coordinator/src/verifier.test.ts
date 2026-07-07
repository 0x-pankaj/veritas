import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(import.meta.dirname, "../../../.env") });

import { afterAll, describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { VeritasClient } from "@veritas/onchain";
import { eq, inArray } from "drizzle-orm";
import { fundAll } from "./test-helpers.js";
import { closeDb, getDb } from "./db.js";
import { queries, responses, sellers as sellersTable, type Seller } from "./db/schema.js";
import { runNumericRound } from "./services/verifier.js";
import type { FanoutResult } from "./services/fanout.js";

const DEVNET = process.env.DEVNET_KEYPAIR;
const gated = !DEVNET || !process.env.DATABASE_URL;

describe.skipIf(gated)("solana writer (devnet)", () => {
  afterAll(closeDb);

  it(
    "runs a full numeric round on-chain and mirrors to Postgres",
    async () => {
      const db = getDb();
      const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
      const connection = new Connection(
        process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
        "confirmed",
      );
      const client = new VeritasClient({ connection, payer });

      // 3 throwaway sellers: minimal funding (rent+fees), on-chain + DB rows.
      const owners = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
      await fundAll(
        connection,
        payer,
        owners.map((o) => o.publicKey),
        5_000_000,
      );

      const run = `vr-${Date.now()}`;
      const sellers: Seller[] = [];
      for (const [i, o] of owners.entries()) {
        await client.registerSeller(`${run}-${i}`, o);
        const [row] = await db
          .insert(sellersTable)
          .values({
            solanaPubkey: o.publicKey.toBase58(),
            payoutAddress: "0x1111111111111111111111111111111111111111",
            name: `${run}-${i}`,
            endpoint: `http://localhost:91${i}0`,
            price: "5000",
            category: "crypto-prices",
            coverage: ["BTC/USD"],
            schemaDesc: "s",
            freshnessSec: 5,
          })
          .returning();
        sellers.push(row!);
      }

      // Synthetic fan-out results — two honest, one liar.
      const values = ["50000.00", "50100.00", "55000.00"];
      const results: FanoutResult[] = sellers.map((seller, i) => ({
        seller,
        value: values[i]!,
        payload: { price: values[i] },
        latencyMs: 10,
      }));

      const queryIdHex = Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString("hex");
      await db.insert(queries).values({
        id: queryIdHex,
        buyer: "0x2222222222222222222222222222222222222222",
        mode: "CONSENSUS",
        k: 3,
        status: "FANOUT",
      });
      await db.insert(responses).values(
        results.map((r) => ({
          queryId: queryIdHex,
          sellerId: r.seller.id,
          valueOrHash: r.value,
          latencyMs: r.latencyMs,
        })),
      );

      const verdict = await runNumericRound({ client, db, queryIdHex, results });

      expect(verdict.truth).toBe("50100");
      expect(verdict.winners.map((w) => w.value).sort()).toEqual([
        "50000.00",
        "50100.00",
      ]);
      expect(verdict.outliers[0]!.value).toBe("55000.00");

      // Postgres mirror reflects the on-chain outcome.
      const [q] = await db.select().from(queries).where(eq(queries.id, queryIdHex));
      expect(q?.status).toBe("SETTLED_ONCHAIN");
      expect(q?.truth).toBe("50100");
      expect(q?.solanaTx).toBe(verdict.solanaTx);
      const [liar] = await db
        .select()
        .from(sellersTable)
        .where(eq(sellersTable.id, sellers[2]!.id));
      expect(liar?.reputation).toBe(450);
      expect(liar?.outliers).toBe(1);

      // Reclaim request rent; clean DB rows.
      await client.closeRequest(
        Uint8Array.from(Buffer.from(queryIdHex, "hex")),
      );
      await db.delete(responses).where(eq(responses.queryId, queryIdHex));
      await db.delete(queries).where(eq(queries.id, queryIdHex));
      await db
        .delete(sellersTable)
        .where(inArray(sellersTable.id, sellers.map((s) => s.id)));
    },
    120_000,
  );
});
