import type { Category } from "./constants.js";

/** Verification modes, ranked by proof strength (PRODUCT §2.1). */
export type Mode = "content-addressed" | "consensus" | "reputation";

/** Buyer-facing trust/speed dial. `fast` = single-seller reputation-routed. */
export type BuySpeed = "fast" | "verified";

/** All USDC amounts travel as strings of 6-decimal base units ("1000" = 0.001 USDC). */
export type UsdcAmount = string;

export interface SellerCapability {
  category: Category;
  /** Coverage, e.g. symbols: ["BTC/USD", "ETH/USD"]. */
  coverage: string[];
  /** Human/agent-readable description of the response schema. */
  schema: string;
  /** Max staleness in seconds. */
  freshnessSec: number;
}

export interface SellerInfo {
  id: string;
  name: string;
  solanaPubkey: string;
  /** EVM address receiving Gateway settlement. */
  payoutAddress: string;
  endpoint: string;
  price: UsdcAmount;
  capability: SellerCapability;
  reputation: number;
  served: number;
  matched: number;
  outliers: number;
  stake: UsdcAmount;
  status: "active" | "suspended";
}

/** EIP-3009 TransferWithAuthorization fields (signed against GatewayWalletBatched). */
export interface Eip3009Authorization {
  from: string;
  to: string;
  value: UsdcAmount;
  validAfter: number;
  validBefore: number;
  nonce: string;
  signature: string;
}

export interface QuoteRequest {
  category: Category;
  query: string;
  mode: BuySpeed;
  k?: number;
}

export interface QuoteLineItem {
  sellerId: string;
  payoutAddress: string;
  price: UsdcAmount;
}

export interface Quote {
  quoteId: string;
  candidates: QuoteLineItem[];
  fee: UsdcAmount;
  /** Total if every candidate wins. Actual cost is always ≤ this. */
  maxExposure: UsdcAmount;
  expiresAt: number;
}

export interface BuyRequest {
  quoteId: string;
  /** K auths (one per candidate) + 1 fee auth = K+1 total. */
  authorizations: Eip3009Authorization[];
}

export interface Verdict {
  queryId: string;
  /** Consensus truth: canonical value (numeric mode) or majority hash. */
  truth: string;
  winners: string[];
  outliers: string[];
  /** Solana transaction signature of finalize_consensus. */
  solanaTx: string;
}

export interface BuyResult {
  queryId: string;
  data: unknown;
  verdict: Verdict;
  /** What will actually be settled (winners + fee). ≤ quote.maxExposure. */
  finalCost: UsdcAmount;
}

/** Coordinator → seller fan-out wire contract (used by the seller SDK too). */
export interface FanoutRequest {
  queryId: string;
  category: Category;
  symbol: string;
}

/** Seller's answer. `value` is the canonical comparable (decimal string for
 *  numeric consensus; hex hash for content-addressed). `payload` is the full
 *  response served to the buyer. */
export interface FanoutResponse {
  value: string;
  payload?: unknown;
  /** ed25519 signature (0x-hex) of `responseSigMessage(queryId, value)` by
   *  the seller's Solana identity key. The coordinator rejects responses
   *  whose signature does not verify against the registered pubkey. */
  sig?: string;
}

export interface VerificationRequestDTO {
  queryId: string;
  mode: Mode;
  k: number;
  buyerRef: string;
  responses: { seller: string; valueOrHash: string }[];
  status: "open" | "settled" | "challenged";
  verdict?: Verdict;
}
