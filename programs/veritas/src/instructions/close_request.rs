use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, REQUEST_SEED},
    error::VeritasError,
    state::{Config, RequestStatus, VerificationRequest},
};

#[derive(Accounts)]
#[instruction(query_id: [u8; 32])]
pub struct CloseRequest<'info> {
    /// Rent is reclaimed to the coordinator (it paid to open the request).
    #[account(mut, address = config.coordinator @ VeritasError::Unauthorized)]
    pub coordinator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        close = coordinator,
        seeds = [REQUEST_SEED, query_id.as_ref()],
        bump = request.bump,
        constraint = request.status != RequestStatus::Open @ VeritasError::RequestNotClosed
    )]
    pub request: Account<'info, VerificationRequest>,
}

pub fn handle_close_request(_ctx: Context<CloseRequest>, _query_id: [u8; 32]) -> Result<()> {
    // The verdict survives in transaction history and the Postgres mirror.
    Ok(())
}
