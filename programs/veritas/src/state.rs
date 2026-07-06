use anchor_lang::prelude::*;

use crate::constants::{MAX_K, MAX_NAME_LEN, MAX_RESPONSE_BYTES};

/// Global config singleton. Seeds: ["config"].
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Only this key may open/submit/finalize/close verification requests.
    pub coordinator: Pubkey,
    /// Mint sellers stake with (USDC). Custody token accounts use this mint.
    pub stake_mint: Pubkey,
    /// Veritas fee in basis points (informational on-chain; enforced off-chain).
    pub fee_bps: u16,
    /// Numeric consensus tolerance in basis points relative to the median.
    pub tolerance_bps: u16,
    pub bump: u8,
}

/// One registered data seller. Seeds: ["seller", owner].
#[account]
#[derive(InitSpace)]
pub struct SellerAccount {
    pub owner: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    /// 0..=1000, starts at REPUTATION_START.
    pub reputation: u32,
    pub served: u32,
    pub matched: u32,
    pub outliers: u32,
    /// USDC stake in custody (base units). Custody transfer lands in P1-T2b.
    pub stake: u64,
    pub status: SellerStatus,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum SellerStatus {
    Active,
    Suspended,
}

/// How responses are compared in `finalize_consensus`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ConsensusMode {
    /// Values are i64 little-endian in the first 8 bytes (coordinator-scaled
    /// fixed-point, e.g. micro-units). Winner = within tolerance of median.
    Numeric,
    /// Values are opaque commitments; winner = strict-majority hash.
    Hash,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum RequestStatus {
    Open,
    /// Verdict computed; winners recorded.
    Settled,
    /// Finalized without consensus (e.g. no strict majority in hash mode).
    Failed,
}

/// One seller's committed response inside a request.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct ResponseEntry {
    pub seller: Pubkey,
    pub len: u8,
    pub value: [u8; MAX_RESPONSE_BYTES],
}

impl ResponseEntry {
    pub fn bytes(&self) -> &[u8] {
        &self.value[..self.len as usize]
    }
}

/// One consensus purchase round. Seeds: ["vreq", query_id].
#[account]
#[derive(InitSpace)]
pub struct VerificationRequest {
    pub query_id: [u8; 32],
    pub buyer_ref: [u8; 32],
    pub mode: ConsensusMode,
    pub k: u8,
    #[max_len(MAX_K)]
    pub responses: Vec<ResponseEntry>,
    pub status: RequestStatus,
    /// Consensus truth (numeric i64 LE, or the majority hash). Empty until settled.
    pub verdict_len: u8,
    pub verdict: [u8; MAX_RESPONSE_BYTES],
    /// Bit i set = responses[i].seller matched consensus.
    pub winners_bitmap: u8,
    pub created_slot: u64,
    pub bump: u8,
}
