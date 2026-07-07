import { Connection } from "@solana/web3.js";
import type { Keypair } from "@solana/web3.js";
import { hc } from "hono/client";
import type { AppType } from "@veritas/coordinator";
import { TESTNET } from "@veritas/core";
import { VeritasClient } from "@veritas/onchain";
import type { RegisterSellerOpts, Seller, SellerMode } from "./types.js";

/** SDK mode → coordinator wire enum. */
const MODE_WIRE = {
  consensus: "CONSENSUS",
  "content-addressed": "CONTENT_ADDRESSED",
} as const satisfies Record<SellerMode, string>;

/**
 * Create the SellerAccount PDA on Solana (register_seller). Idempotent:
 * if the PDA already exists the tx is skipped and `tx` is undefined.
 * Stake (add_stake) is a separate opt-in step — not part of registration.
 */
export async function registerOnchain(opts: {
  name: string;
  solanaKeypair: Keypair;
  solanaRpc?: string;
}): Promise<{ sellerPda: string; tx?: string }> {
  const connection = new Connection(
    opts.solanaRpc ?? TESTNET.solana.rpc,
    "confirmed",
  );
  const client = new VeritasClient({ connection, payer: opts.solanaKeypair });
  const pda = client.sellerAddress(opts.solanaKeypair.publicKey);
  const existing = await connection.getAccountInfo(pda);
  if (existing) return { sellerPda: pda.toBase58() };
  const tx = await client.registerSeller(opts.name);
  return { sellerPda: pda.toBase58(), tx };
}

/**
 * Register with the coordinator's discovery registry (POST /sellers/register,
 * upsert on solanaPubkey). Typed via hono/client — coordinator API drift is
 * a compile error, not a runtime bug.
 */
export async function registerWithCoordinator(
  opts: Omit<RegisterSellerOpts, "solanaKeypair" | "solanaRpc"> & {
    solanaPubkey: string;
  },
): Promise<{ id: string; reputation: number; status: string }> {
  const api = hc<AppType>(opts.coordinatorUrl);
  const res = await api.sellers.register.$post({
    json: {
      solanaPubkey: opts.solanaPubkey,
      payoutAddress: opts.payoutAddress,
      name: opts.name,
      endpoint: opts.endpoint,
      price: opts.price,
      mode: MODE_WIRE[opts.mode ?? "consensus"],
      category: opts.capability.category,
      coverage: opts.capability.coverage,
      schemaDesc: opts.capability.schema,
      freshnessSec: opts.capability.freshnessSec,
    },
  });
  if (res.status !== 201) {
    throw new Error(
      `coordinator registration failed (${res.status}): ${await res.text()}`,
    );
  }
  const body = await res.json();
  return { id: body.id, reputation: body.reputation, status: body.status };
}

/**
 * One-time seller registration (PRODUCT §3.1): creates the SellerAccount PDA
 * on Solana, then upserts the capability descriptor into the coordinator
 * registry. Both halves are idempotent, so retrying after a partial failure
 * is safe. Returns the `Seller` handle the middleware (P3-T2) consumes.
 */
export async function registerSeller(opts: RegisterSellerOpts): Promise<Seller> {
  const solanaPubkey = opts.solanaKeypair.publicKey.toBase58();
  const onchain = await registerOnchain(opts);
  const registry = await registerWithCoordinator({ ...opts, solanaPubkey });
  const seller: Seller = {
    id: registry.id,
    name: opts.name,
    solanaPubkey,
    payoutAddress: opts.payoutAddress,
    endpoint: opts.endpoint,
    price: opts.price,
    mode: opts.mode ?? "consensus",
    capability: opts.capability,
    coordinatorUrl: opts.coordinatorUrl,
    reputation: registry.reputation,
    status: registry.status,
    keypair: opts.solanaKeypair,
  };
  if (onchain.tx !== undefined) seller.onchainTx = onchain.tx;
  return seller;
}
