import { describe, expect, it } from "vitest";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { VeritasClient, encodeNumeric } from "./client.js";
import { configPda, requestPda, sellerPda, stakeCustodyPda } from "./pdas.js";
import idl from "./idl/veritas.json" with { type: "json" };

const PROGRAM_ID = new PublicKey((idl as { address: string }).address);

describe("pdas", () => {
  it("derives deterministic addresses", () => {
    const owner = Keypair.generate().publicKey;
    expect(configPda(PROGRAM_ID).equals(configPda(PROGRAM_ID))).toBe(true);
    expect(sellerPda(PROGRAM_ID, owner).equals(sellerPda(PROGRAM_ID, owner))).toBe(true);
    expect(stakeCustodyPda(PROGRAM_ID, owner).toBase58()).not.toBe(
      sellerPda(PROGRAM_ID, owner).toBase58(),
    );
    const qid = new Uint8Array(32).fill(1);
    expect(requestPda(PROGRAM_ID, qid).equals(requestPda(PROGRAM_ID, qid))).toBe(true);
    expect(() => requestPda(PROGRAM_ID, new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe("encodeNumeric", () => {
  it("encodes i64 LE", () => {
    const buf = encodeNumeric(50_000_000_000n);
    expect(buf.length).toBe(8);
    expect(buf.readBigInt64LE()).toBe(50_000_000_000n);
    expect(encodeNumeric(-1n).readBigInt64LE()).toBe(-1n);
  });
});

// ── Devnet integration (env-gated) ─────────────────────────────────
// Requires: DEVNET_KEYPAIR (JSON byte array) with SOL on Devnet, and the
// program deployed + initialized (P1-T6). Skipped otherwise.
const DEVNET = process.env.DEVNET_KEYPAIR;

describe.skipIf(!DEVNET)("devnet lifecycle", () => {
  it("register → open → submit×3 → finalize catches the liar", async () => {
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET!)));
    const connection = new Connection(
      process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
      "confirmed",
    );
    const client = new VeritasClient({ connection, payer });

    const config = await client.getConfig();
    expect(config.coordinator.equals(payer.publicKey)).toBe(true);

    // Three throwaway sellers, funded in one CONFIRMED tx before registering.
    const { SystemProgram, Transaction, sendAndConfirmTransaction } = await import(
      "@solana/web3.js"
    );
    const sellers = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    const fund = new Transaction();
    for (const s of sellers) {
      fund.add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: s.publicKey,
          lamports: 20_000_000,
        }),
      );
    }
    await sendAndConfirmTransaction(connection, fund, [payer], {
      commitment: "confirmed",
    });
    for (const [i, s] of sellers.entries()) {
      await client.registerSeller(`it-seller-${Date.now()}-${i}`, s);
    }

    const queryId = new Uint8Array(32);
    crypto.getRandomValues(queryId);
    await client.openRequest({
      queryId,
      buyerRef: new Uint8Array(32),
      mode: { numeric: {} },
      k: 3,
    });

    await client.submitResponse({
      queryId,
      sellerOwner: sellers[0]!.publicKey,
      value: encodeNumeric(50_000_000_000n),
    });
    await client.submitResponse({
      queryId,
      sellerOwner: sellers[1]!.publicKey,
      value: encodeNumeric(50_100_000_000n),
    });
    await client.submitResponse({
      queryId,
      sellerOwner: sellers[2]!.publicKey,
      value: encodeNumeric(55_000_000_000n), // the liar
    });

    await client.finalizeConsensus({
      queryId,
      responderOwners: sellers.map((s) => s.publicKey),
    });

    const req = await client.getRequest(queryId);
    expect(req.winnersBitmap).toBe(0b011);
    const liar = await client.getSeller(sellers[2]!.publicKey);
    expect(liar.outliers).toBe(1);
    expect(liar.reputation).toBe(450);

    // Reclaim rent.
    await client.closeRequest(queryId);
  }, 120_000);
});
