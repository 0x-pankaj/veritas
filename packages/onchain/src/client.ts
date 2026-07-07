import * as anchor from "@coral-xyz/anchor";
import type {
  Connection,
  Keypair,
  PublicKey} from "@solana/web3.js";
import {
  type TransactionSignature,
} from "@solana/web3.js";
import type { Veritas } from "./veritas-types.js";
import idl from "./idl/veritas.json" with { type: "json" };
import { configPda, requestPda, sellerPda, stakeCustodyPda } from "./pdas.js";

export type ConsensusModeArg = { numeric: object } | { hash: object };

export interface VeritasClientOpts {
  connection: Connection;
  /** Transaction fee payer + default signer (the coordinator, usually). */
  payer: Keypair;
  /** Override the program id baked into the IDL (e.g. a fresh deploy). */
  programId?: PublicKey;
}

/** Encode an i64 as the 8-byte LE numeric response value. */
export function encodeNumeric(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

/** Typed client for the Veritas program (registry, consensus, reputation). */
export class VeritasClient {
  readonly program: anchor.Program<Veritas>;
  readonly payer: Keypair;
  readonly programId: PublicKey;

  constructor(opts: VeritasClientOpts) {
    this.payer = opts.payer;
    const provider = new anchor.AnchorProvider(
      opts.connection,
      new anchor.Wallet(opts.payer),
      { commitment: "confirmed" },
    );
    const rawIdl = opts.programId
      ? { ...(idl as anchor.Idl), address: opts.programId.toBase58() }
      : (idl as anchor.Idl);
    this.program = new anchor.Program<Veritas>(rawIdl as Veritas, provider);
    this.programId = this.program.programId;
  }

  // ── PDAs ────────────────────────────────────────────────────────
  get configAddress(): PublicKey {
    return configPda(this.programId);
  }
  sellerAddress(owner: PublicKey): PublicKey {
    return sellerPda(this.programId, owner);
  }
  requestAddress(queryId: Uint8Array): PublicKey {
    return requestPda(this.programId, queryId);
  }
  stakeCustodyAddress(owner: PublicKey): PublicKey {
    return stakeCustodyPda(this.programId, owner);
  }

  // ── Instructions ────────────────────────────────────────────────
  async initialize(args: {
    coordinator: PublicKey;
    stakeMint: PublicKey;
    feeBps: number;
    toleranceBps: number;
  }): Promise<TransactionSignature> {
    return this.program.methods
      .initialize(args.coordinator, args.stakeMint, args.feeBps, args.toleranceBps)
      .accounts({ payer: this.payer.publicKey })
      .rpc();
  }

  /** Registers `owner` (defaults to payer) as a seller. */
  async registerSeller(name: string, owner?: Keypair): Promise<TransactionSignature> {
    const signer = owner ?? this.payer;
    return this.program.methods
      .registerSeller(name)
      .accounts({ owner: signer.publicKey })
      .signers(owner ? [owner] : [])
      .rpc();
  }

  async openRequest(args: {
    queryId: Uint8Array;
    buyerRef: Uint8Array;
    mode: ConsensusModeArg;
    k: number;
  }): Promise<TransactionSignature> {
    return this.program.methods
      .openRequest(
        Array.from(args.queryId) as number[],
        Array.from(args.buyerRef) as number[],
        args.mode as never,
        args.k,
      )
      .accounts({ coordinator: this.payer.publicKey })
      .rpc();
  }

  async submitResponse(args: {
    queryId: Uint8Array;
    sellerOwner: PublicKey;
    value: Buffer;
  }): Promise<TransactionSignature> {
    return this.program.methods
      .submitResponse(
        Array.from(args.queryId) as number[],
        args.sellerOwner,
        args.value,
      )
      .accounts({ coordinator: this.payer.publicKey })
      .rpc();
  }

  /** remaining_accounts = each responder's SellerAccount, in response order. */
  async finalizeConsensus(args: {
    queryId: Uint8Array;
    responderOwners: PublicKey[];
  }): Promise<TransactionSignature> {
    return this.program.methods
      .finalizeConsensus(Array.from(args.queryId) as number[])
      .accounts({ coordinator: this.payer.publicKey })
      .remainingAccounts(
        args.responderOwners.map((owner) => ({
          pubkey: this.sellerAddress(owner),
          isSigner: false,
          isWritable: true,
        })),
      )
      .rpc();
  }

  async closeRequest(queryId: Uint8Array): Promise<TransactionSignature> {
    return this.program.methods
      .closeRequest(Array.from(queryId) as number[])
      .accounts({ coordinator: this.payer.publicKey })
      .rpc();
  }

  // ── Reads ───────────────────────────────────────────────────────
  async getConfig() {
    return this.program.account.config.fetch(this.configAddress);
  }
  async getSeller(owner: PublicKey) {
    return this.program.account.sellerAccount.fetch(this.sellerAddress(owner));
  }
  async getRequest(queryId: Uint8Array) {
    return this.program.account.verificationRequest.fetch(this.requestAddress(queryId));
  }
}
