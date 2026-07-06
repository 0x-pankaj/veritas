use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_K, MIN_RESPONSES, REQUEST_SEED},
    error::VeritasError,
    state::{Config, ConsensusMode, RequestStatus, VerificationRequest},
};

#[derive(Accounts)]
#[instruction(query_id: [u8; 32])]
pub struct OpenRequest<'info> {
    /// Only the coordinator authority may open requests.
    #[account(mut, address = config.coordinator @ VeritasError::Unauthorized)]
    pub coordinator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = coordinator,
        space = 8 + VerificationRequest::INIT_SPACE,
        seeds = [REQUEST_SEED, query_id.as_ref()],
        bump
    )]
    pub request: Account<'info, VerificationRequest>,
    pub system_program: Program<'info, System>,
}

pub fn handle_open_request(
    ctx: Context<OpenRequest>,
    query_id: [u8; 32],
    buyer_ref: [u8; 32],
    mode: ConsensusMode,
    k: u8,
) -> Result<()> {
    require!(
        (MIN_RESPONSES..=MAX_K).contains(&(k as usize)),
        VeritasError::InvalidK
    );

    let request = &mut ctx.accounts.request;
    request.query_id = query_id;
    request.buyer_ref = buyer_ref;
    request.mode = mode;
    request.k = k;
    request.responses = Vec::new();
    request.status = RequestStatus::Open;
    request.verdict_len = 0;
    request.verdict = [0u8; crate::constants::MAX_RESPONSE_BYTES];
    request.winners_bitmap = 0;
    request.created_slot = Clock::get()?.slot;
    request.bump = ctx.bumps.request;
    Ok(())
}
