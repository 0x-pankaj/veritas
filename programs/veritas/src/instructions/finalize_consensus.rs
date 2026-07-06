use anchor_lang::prelude::*;

use crate::{
    consensus::{hash_consensus, numeric_consensus, ConsensusResult},
    constants::{CONFIG_SEED, MIN_RESPONSES, REPUTATION_LOSS, REPUTATION_MAX, REPUTATION_WIN, REQUEST_SEED},
    error::VeritasError,
    state::{Config, ConsensusMode, RequestStatus, SellerAccount, VerificationRequest},
};

#[derive(Accounts)]
#[instruction(query_id: [u8; 32])]
pub struct FinalizeConsensus<'info> {
    #[account(address = config.coordinator @ VeritasError::Unauthorized)]
    pub coordinator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [REQUEST_SEED, query_id.as_ref()], bump = request.bump)]
    pub request: Account<'info, VerificationRequest>,
    // remaining_accounts: the SellerAccount of each responder, writable,
    // in the exact order of request.responses.
}

pub fn handle_finalize_consensus(
    ctx: Context<FinalizeConsensus>,
    _query_id: [u8; 32],
) -> Result<()> {
    let request = &mut ctx.accounts.request;
    require!(request.status == RequestStatus::Open, VeritasError::RequestNotOpen);
    require!(
        request.responses.len() >= MIN_RESPONSES,
        VeritasError::NotEnoughResponses
    );
    require!(
        ctx.remaining_accounts.len() == request.responses.len(),
        VeritasError::BadRemainingAccounts
    );

    let result: ConsensusResult = match request.mode {
        ConsensusMode::Numeric => {
            numeric_consensus(&request.responses, ctx.accounts.config.tolerance_bps)
        }
        ConsensusMode::Hash => hash_consensus(&request.responses),
    };

    // Atomically update every responder's reputation alongside the verdict.
    for (i, entry) in request.responses.iter().enumerate() {
        let acc = &ctx.remaining_accounts[i];
        require!(acc.is_writable, VeritasError::BadRemainingAccounts);
        require_keys_eq!(*acc.owner, *ctx.program_id, VeritasError::BadRemainingAccounts);

        let mut data = acc.try_borrow_mut_data()?;
        let mut seller = SellerAccount::try_deserialize(&mut &data[..])?;
        // Only the coordinator can call this, and SellerAccount PDAs are unique
        // per owner — matching the stored owner pins the right account.
        require_keys_eq!(seller.owner, entry.seller, VeritasError::SellerMismatch);

        seller.served = seller.served.saturating_add(1);
        let won = result.reached && (result.winners_bitmap & (1 << i)) != 0;
        if won {
            seller.matched = seller.matched.saturating_add(1);
            seller.reputation = seller.reputation.saturating_add(REPUTATION_WIN).min(REPUTATION_MAX);
        } else {
            seller.outliers = seller.outliers.saturating_add(1);
            seller.reputation = seller.reputation.saturating_sub(REPUTATION_LOSS);
        }

        let mut cursor = std::io::Cursor::new(&mut data[..]);
        seller.try_serialize(&mut cursor)?;
    }

    request.winners_bitmap = result.winners_bitmap;
    request.verdict = result.verdict;
    request.verdict_len = result.verdict_len;
    request.status = if result.reached {
        RequestStatus::Settled
    } else {
        RequestStatus::Failed
    };
    Ok(())
}
