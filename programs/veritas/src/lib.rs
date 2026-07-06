pub mod consensus;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CiGK2btZHdeW1U327ZLDhTQhDhP9TB6U16oG4a21YTUG");

#[program]
pub mod veritas {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        coordinator: Pubkey,
        stake_mint: Pubkey,
        fee_bps: u16,
        tolerance_bps: u16,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(
            ctx,
            coordinator,
            stake_mint,
            fee_bps,
            tolerance_bps,
        )
    }

    pub fn register_seller(ctx: Context<RegisterSeller>, name: String) -> Result<()> {
        instructions::register_seller::handle_register_seller(ctx, name)
    }

    pub fn add_stake(ctx: Context<AddStake>, amount: u64) -> Result<()> {
        instructions::stake::handle_add_stake(ctx, amount)
    }

    pub fn withdraw_stake(ctx: Context<WithdrawStake>, amount: u64) -> Result<()> {
        instructions::stake::handle_withdraw_stake(ctx, amount)
    }

    pub fn open_request(
        ctx: Context<OpenRequest>,
        query_id: [u8; 32],
        buyer_ref: [u8; 32],
        mode: ConsensusMode,
        k: u8,
    ) -> Result<()> {
        instructions::open_request::handle_open_request(ctx, query_id, buyer_ref, mode, k)
    }

    pub fn submit_response(
        ctx: Context<SubmitResponse>,
        query_id: [u8; 32],
        seller_owner: Pubkey,
        value: Vec<u8>,
    ) -> Result<()> {
        instructions::submit_response::handle_submit_response(ctx, query_id, seller_owner, value)
    }

    pub fn finalize_consensus(
        ctx: Context<FinalizeConsensus>,
        query_id: [u8; 32],
    ) -> Result<()> {
        instructions::finalize_consensus::handle_finalize_consensus(ctx, query_id)
    }

    pub fn close_request(ctx: Context<CloseRequest>, query_id: [u8; 32]) -> Result<()> {
        instructions::close_request::handle_close_request(ctx, query_id)
    }
}
