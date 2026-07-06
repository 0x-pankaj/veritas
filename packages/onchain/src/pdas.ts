import { PublicKey } from "@solana/web3.js";

/** PDA seeds — MUST mirror programs/veritas/src/constants.rs. */
const CONFIG_SEED = Buffer.from("config");
const SELLER_SEED = Buffer.from("seller");
const REQUEST_SEED = Buffer.from("vreq");
const STAKE_SEED = Buffer.from("stake");

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], programId)[0];
}

export function sellerPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([SELLER_SEED, owner.toBuffer()], programId)[0];
}

export function requestPda(programId: PublicKey, queryId: Uint8Array): PublicKey {
  if (queryId.length !== 32) throw new Error("queryId must be 32 bytes");
  return PublicKey.findProgramAddressSync(
    [REQUEST_SEED, Buffer.from(queryId)],
    programId,
  )[0];
}

export function stakeCustodyPda(programId: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([STAKE_SEED, owner.toBuffer()], programId)[0];
}
