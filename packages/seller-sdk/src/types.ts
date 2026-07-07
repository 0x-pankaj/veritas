import type { Keypair } from "@solana/web3.js";
import type { SellerCapability, UsdcAmount } from "@veritas/core";

/** Verification modes a seller can serve (PRODUCT §2.1; "reputation" is
 *  buyer-side fallback, not a seller registration mode). */
export type SellerMode = "consensus" | "content-addressed";

/** Options for `registerSeller` (PRODUCT §3.1). */
export interface RegisterSellerOpts {
  /** Registry + on-chain display name (≤ 32 chars). */
  name: string;
  /** Seller identity on Solana; signs the on-chain registration and pays
   *  its rent (fractions of a cent of SOL). */
  solanaKeypair: Keypair;
  /** EVM address on Arc where Gateway settlement lands. */
  payoutAddress: string;
  /** Public base URL of the seller's API (the coordinator fans out to
   *  `{endpoint}/veritas/serve`). */
  endpoint: string;
  /** Price per call, USDC 6-decimal base units ("1000" = 0.001 USDC). */
  price: UsdcAmount;
  /** Defaults to "consensus". */
  mode?: SellerMode;
  /** Capability descriptor: category, coverage, schema, freshness (PRODUCT §7.3). */
  capability: SellerCapability;
  /** Coordinator base URL (VERITAS_FACILITATOR_URL). */
  coordinatorUrl: string;
  /** Solana RPC; defaults to public Devnet. */
  solanaRpc?: string;
}

/** Handle returned by `registerSeller`; passed to the middleware (P3-T2). */
export interface Seller {
  /** Coordinator DB id. */
  id: string;
  name: string;
  solanaPubkey: string;
  payoutAddress: string;
  endpoint: string;
  price: UsdcAmount;
  mode: SellerMode;
  capability: SellerCapability;
  coordinatorUrl: string;
  /** Registry reputation at registration time (baseline 500 for new sellers). */
  reputation: number;
  status: string;
  /** Signature of the on-chain register_seller tx; undefined when the
   *  SellerAccount PDA already existed (re-registration is idempotent). */
  onchainTx?: string;
  /** Kept so the middleware can sign/report without reloading the key. */
  keypair: Keypair;
}
