import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Signed seller responses (PRODUCT §7.2 / roadmap P5-T1).
 *
 * Every seller response is signed with the seller's Solana identity key —
 * the same ed25519 keypair that owns its on-chain SellerAccount PDA. The
 * coordinator verifies the signature against the registered pubkey before a
 * response can enter consensus, stores it, and republishes it on
 * `GET /verify/:queryId`, so ANYONE can re-check that a recorded answer really
 * came from that seller. The coordinator cannot forge or alter a response
 * without invalidating the signature.
 *
 * The message binds the seller to "I answered `value` for query `queryId`":
 * query ids are single-use, so a signature can never be replayed into another
 * round, and `value` is the exact comparable submitted to consensus (the
 * payload hash in content-addressed mode).
 */

/** Canonical bytes a seller signs for one fan-out answer. */
export function responseSigMessage(queryId: string, value: string): Uint8Array {
  return utf8ToBytes(`veritas-response-v1\n${queryId}\n${value}`);
}

/**
 * Sign a fan-out answer with the seller's Solana secret key (64-byte
 * `Keypair.secretKey` or a 32-byte seed). Returns 0x-hex.
 */
export function signResponse(
  queryId: string,
  value: string,
  secretKey: Uint8Array,
): string {
  const seed = secretKey.length === 64 ? secretKey.slice(0, 32) : secretKey;
  const sig = ed25519.sign(responseSigMessage(queryId, value), seed);
  return `0x${bytesToHex(sig)}`;
}

/**
 * Verify a response signature against a base58 Solana pubkey. Never throws —
 * malformed input is simply an invalid signature.
 */
export function verifyResponseSig(
  sig: string,
  queryId: string,
  value: string,
  solanaPubkey: string,
): boolean {
  try {
    return ed25519.verify(
      hexToBytes(sig.replace(/^0x/, "")),
      responseSigMessage(queryId, value),
      base58.decode(solanaPubkey),
    );
  } catch {
    return false;
  }
}
