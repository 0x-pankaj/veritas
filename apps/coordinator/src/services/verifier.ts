import { decimalToMicro, microToDecimal } from "@veritas/core";
import { VeritasClient, encodeNumeric } from "@veritas/onchain";
import { PublicKey } from "@solana/web3.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { FanoutResult } from "./fanout.js";

export interface RoundVerdict {
  queryId: string;
  truth: string; // decimal string (numeric) — canonical consensus value
  winners: FanoutResult[];
  outliers: FanoutResult[];
  solanaTx: string;
  requestPda: string;
}

/** hex string (64 chars) → 32-byte array. */
export function queryIdBytes(queryIdHex: string): Uint8Array {
  const hex = queryIdHex.replace(/^0x/, "");
  if (hex.length !== 64) throw new Error("queryId must be 32 bytes hex");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/**
 * Persist a numeric verification round on Solana (BUILD_PLAN P2-T5):
 * open → submit each response → finalize → read the on-chain verdict.
 * Then mirror verdict + reputation into Postgres.
 * Idempotent per queryId: an already-open/settled request is not re-opened.
 */
export async function runNumericRound(args: {
  client: VeritasClient;
  db: PrismaClient;
  queryIdHex: string;
  buyerRef?: Uint8Array;
  results: FanoutResult[];
}): Promise<RoundVerdict> {
  const { client, db, results } = args;
  const qid = queryIdBytes(args.queryIdHex);

  // Idempotency: skip open if the request already exists on-chain.
  let exists = false;
  try {
    await client.getRequest(qid);
    exists = true;
  } catch {
    /* not found — fresh round */
  }
  if (!exists) {
    await client.openRequest({
      queryId: qid,
      buyerRef: args.buyerRef ?? new Uint8Array(32),
      mode: { numeric: {} },
      k: results.length,
    });
  }

  for (const r of results) {
    await client.submitResponse({
      queryId: qid,
      sellerOwner: new PublicKey(r.seller.solanaPubkey),
      value: encodeNumeric(decimalToMicro(r.value)),
    });
  }

  const solanaTx = await client.finalizeConsensus({
    queryId: qid,
    responderOwners: results.map((r) => new PublicKey(r.seller.solanaPubkey)),
  });

  const onchain = await client.getRequest(qid);
  const truthMicro = Buffer.from(onchain.verdict.slice(0, 8)).readBigInt64LE();
  const truth = microToDecimal(truthMicro);
  const bitmap: number = onchain.winnersBitmap;

  const winners: FanoutResult[] = [];
  const outliers: FanoutResult[] = [];
  results.forEach((r, i) => ((bitmap >> i) & 1 ? winners : outliers).push(r));

  // ── Mirror to Postgres ────────────────────────────────────────────
  const requestPda = client.requestAddress(qid).toBase58();
  await db.query.update({
    where: { id: args.queryIdHex },
    data: {
      truth,
      status: winners.length > 0 ? "SETTLED_ONCHAIN" : "FAILED",
      solanaReqPda: requestPda,
      solanaTx,
    },
  });
  for (const r of results) {
    const matched = winners.includes(r);
    await db.response.update({
      where: { queryId_sellerId: { queryId: args.queryIdHex, sellerId: r.seller.id } },
      data: { matched },
    });
    // Reputation mirror: read back the on-chain truth.
    const onchainSeller = await client.getSeller(new PublicKey(r.seller.solanaPubkey));
    await db.seller.update({
      where: { id: r.seller.id },
      data: {
        reputation: onchainSeller.reputation,
        served: onchainSeller.served,
        matched: onchainSeller.matched,
        outliers: onchainSeller.outliers,
      },
    });
  }

  return { queryId: args.queryIdHex, truth, winners, outliers, solanaTx, requestPda };
}
