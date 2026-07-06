//! Deterministic consensus computation. Pure integer math — no floats.

use crate::constants::MAX_RESPONSE_BYTES;
use crate::state::ResponseEntry;

pub struct ConsensusResult {
    /// Bit i set = responses[i] matched consensus.
    pub winners_bitmap: u8,
    pub verdict: [u8; MAX_RESPONSE_BYTES],
    pub verdict_len: u8,
    /// False when no consensus exists (e.g. no strict majority in hash mode).
    pub reached: bool,
}

/// Numeric mode: values are i64 LE in the first 8 bytes (coordinator-scaled
/// fixed-point). Truth = median; winners = within `tolerance_bps` of median.
pub fn numeric_consensus(responses: &[ResponseEntry], tolerance_bps: u16) -> ConsensusResult {
    let mut values: Vec<i64> = responses
        .iter()
        .map(|r| {
            let mut b = [0u8; 8];
            b.copy_from_slice(&r.bytes()[..8]);
            i64::from_le_bytes(b)
        })
        .collect();

    let mut sorted = values.clone();
    sorted.sort_unstable();
    // Even-count median: lower-middle for determinism (avoids i64 overflow on avg).
    let median = sorted[(sorted.len() - 1) / 2];

    let mut winners_bitmap: u8 = 0;
    for (i, v) in values.iter().enumerate() {
        // |v - median| * 10_000 <= tolerance_bps * max(|median|, 1)  (i128: no overflow)
        let diff = (*v as i128 - median as i128).unsigned_abs();
        let bound = (tolerance_bps as u128) * (median.unsigned_abs().max(1) as u128);
        if diff * 10_000 <= bound {
            winners_bitmap |= 1 << i;
        }
    }

    let mut verdict = [0u8; MAX_RESPONSE_BYTES];
    verdict[..8].copy_from_slice(&median.to_le_bytes());
    values.clear();

    ConsensusResult {
        winners_bitmap,
        verdict,
        verdict_len: 8,
        reached: winners_bitmap != 0,
    }
}

/// Hash mode: winners = strict-majority identical value. No majority → failed.
pub fn hash_consensus(responses: &[ResponseEntry]) -> ConsensusResult {
    let n = responses.len();
    let mut best_idx = 0usize;
    let mut best_count = 0usize;

    for i in 0..n {
        let count = responses
            .iter()
            .filter(|r| r.bytes() == responses[i].bytes())
            .count();
        if count > best_count {
            best_count = count;
            best_idx = i;
        }
    }

    let reached = best_count * 2 > n; // strict majority
    let mut winners_bitmap: u8 = 0;
    let mut verdict = [0u8; MAX_RESPONSE_BYTES];
    let mut verdict_len = 0u8;

    if reached {
        let truth = responses[best_idx].bytes();
        for (i, r) in responses.iter().enumerate() {
            if r.bytes() == truth {
                winners_bitmap |= 1 << i;
            }
        }
        verdict[..truth.len()].copy_from_slice(truth);
        verdict_len = truth.len() as u8;
    }

    ConsensusResult {
        winners_bitmap,
        verdict,
        verdict_len,
        reached,
    }
}
