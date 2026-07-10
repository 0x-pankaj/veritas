import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

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
