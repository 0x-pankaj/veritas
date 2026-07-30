import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import { keccak256 } from "@veritas/core";
import { privateKeyToAccount } from "viem/accounts";

/** Persisted demo identities so re-runs reuse the same SellerAccount PDAs. */
const KEYS_DIR = resolve(import.meta.dirname, "../../.keys");

/**
 * Load a demo seller's Solana identity. Priority:
 *   1. env `DEMO_<ROLE>_KEYPAIR` (JSON byte array)
 *   2. `apps/demo/.keys/<role>.json` (gitignored)
 *   3. generate + persist to (2)
 */
export function loadOrCreateKeypair(role: string): Keypair {
  const env = process.env[`DEMO_${role.toUpperCase()}_KEYPAIR`];
  if (env) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env)));

  const file = resolve(KEYS_DIR, `${role}.json`);
  if (existsSync(file)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(readFileSync(file, "utf8")) as number[]),
    );
  }

  const kp = Keypair.generate();
  mkdirSync(KEYS_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

/**
 * A seller's REAL Arc payout address, derived from its Solana identity:
 * EVM privkey = keccak256(ed25519 seed), address = its EOA. One key file
 * yields both identities, so whoever holds the seller's Solana key also
 * controls (and can withdraw) its settled USDC — no placeholder burn
 * addresses, and reviewers can watch the balance move on Circle's Gateway
 * balances API. Overridable per role with `DEMO_<ROLE>_PAYOUT`.
 */
export function payoutAddressFor(role: string, keypair: Keypair): `0x${string}` {
  const env = process.env[`DEMO_${role.toUpperCase()}_PAYOUT`];
  if (env) return env as `0x${string}`;
  const evmPriv = keccak256(keypair.secretKey.slice(0, 32)) as `0x${string}`;
  return privateKeyToAccount(evmPriv).address;
}
