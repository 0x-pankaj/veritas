//! Protocol constants. MUST stay in sync with `@veritas/core` PROTOCOL
//! (packages/core/src/constants.ts).

/// Max sellers per consensus purchase (accounts are fixed-size).
pub const MAX_K: usize = 7;
/// Min responses required to finalize a consensus round.
pub const MIN_RESPONSES: usize = 2;
/// Max bytes for a response value (numeric i64 LE fits; 32-byte hashes fit).
pub const MAX_RESPONSE_BYTES: usize = 64;
/// Max seller name length.
pub const MAX_NAME_LEN: usize = 32;

/// Reputation bounds and per-verdict adjustments (scaled 0..=1000).
pub const REPUTATION_START: u32 = 500;
pub const REPUTATION_MAX: u32 = 1000;
pub const REPUTATION_WIN: u32 = 10;
pub const REPUTATION_LOSS: u32 = 50;

/// Fraction of an outlier's stake slashed per lost round (basis points).
/// Slashed funds remain in custody as protocol treasury.
pub const SLASH_BPS: u64 = 1_000; // 10%

/// PDA seeds.
pub const CONFIG_SEED: &[u8] = b"config";
pub const SELLER_SEED: &[u8] = b"seller";
pub const REQUEST_SEED: &[u8] = b"vreq";
pub const STAKE_SEED: &[u8] = b"stake";
