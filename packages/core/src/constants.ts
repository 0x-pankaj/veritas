/**
 * Protocol constants. The Rust program mirrors PROTOCOL — keep them in sync
 * (see BUILD_PLAN P1-T3).
 */
export const PROTOCOL = {
  /** Max sellers per consensus purchase (Anchor accounts are fixed-size). */
  MAX_K: 7,
  /** Min sellers for a meaningful consensus round. */
  MIN_K: 3,
  /** Max bytes for a response value or hash stored on-chain. */
  MAX_RESPONSE_BYTES: 64,
  /** Default quorum = responses required / K (ceil). */
  QUORUM_RATIO: 2 / 3,
  /** EIP-3009 authorization validity window (ms). ~10 min — must never race the verdict. */
  AUTH_VALIDITY_MS: 10 * 60 * 1000,
  /** USDC decimals (all amounts are 6-decimal base units unless stated). */
  USDC_DECIMALS: 6,
} as const;

/** Circle + chain constants — TESTNET ONLY (see PRODUCT.md §10). */
export const TESTNET = {
  solana: {
    rpc: "https://api.devnet.solana.com",
    /** The Veritas program, deployed to Devnet (P1-T6). */
    veritasProgram: "CiGK2btZHdeW1U327ZLDhTQhDhP9TB6U16oG4a21YTUG",
    /** Circle Gateway Wallet program (Devnet) — NOT the Veritas program. */
    gatewayWalletProgram: "GATEwdfmYNELfp5wDmmR6noSr2vHnAfBPMm2PvCzX5vu",
    usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  arc: {
    chainName: "arcTestnet",
    gatewayDomain: 26,
    gatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
    usdc: "0x3600000000000000000000000000000000000000",
  },
  circle: {
    gatewayApi: "https://gateway-api-testnet.circle.com",
    faucet: "https://faucet.circle.com",
  },
} as const;

/** Fixed category taxonomy for seller capability descriptors (PRODUCT §7.3). */
export const CATEGORIES = [
  "crypto-prices",
  "prediction-markets",
  "sports-odds",
  "weather",
  "onchain-analytics",
] as const;
export type Category = (typeof CATEGORIES)[number];
