use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_RESPONSE_BYTES, REQUEST_SEED, SELLER_SEED},
    error::VeritasError,
    state::{Config, ConsensusMode, RequestStatus, ResponseEntry, SellerAccount, VerificationRequest},
};

#[derive(Accounts)]
#[instruction(query_id: [u8; 32], seller_owner: Pubkey)]
pub struct SubmitResponse<'info> {
    #[account(address = config.coordinator @ VeritasError::Unauthorized)]
    pub coordinator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [REQUEST_SEED, query_id.as_ref()], bump = request.bump)]
    pub request: Account<'info, VerificationRequest>,
    /// The responding seller must be registered; existence is the check.
    #[account(seeds = [SELLER_SEED, seller_owner.as_ref()], bump = seller.bump)]
    pub seller: Account<'info, SellerAccount>,
}

pub fn handle_submit_response(
    ctx: Context<SubmitResponse>,
    _query_id: [u8; 32],
    seller_owner: Pubkey,
    value: Vec<u8>,
) -> Result<()> {
    let request = &mut ctx.accounts.request;

    require!(request.status == RequestStatus::Open, VeritasError::RequestNotOpen);
    require!(
        (request.responses.len() as u8) < request.k,
        VeritasError::TooManyResponses
    );
    require!(value.len() <= MAX_RESPONSE_BYTES, VeritasError::ValueTooLarge);
    if request.mode == ConsensusMode::Numeric {
        require!(value.len() >= 8, VeritasError::ValueTooSmallForNumeric);
    }
    require!(
        !request.responses.iter().any(|r| r.seller == seller_owner),
        VeritasError::DuplicateSeller
    );

    let mut buf = [0u8; MAX_RESPONSE_BYTES];
    buf[..value.len()].copy_from_slice(&value);
    request.responses.push(ResponseEntry {
        seller: seller_owner,
        len: value.len() as u8,
        value: buf,
    });
    Ok(())
}
