use anchor_lang::prelude::*;

use crate::{constants::CONFIG_SEED, state::Config};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    coordinator: Pubkey,
    stake_mint: Pubkey,
    fee_bps: u16,
    tolerance_bps: u16,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.payer.key();
    config.coordinator = coordinator;
    config.stake_mint = stake_mint;
    config.fee_bps = fee_bps;
    config.tolerance_bps = tolerance_bps;
    config.bump = ctx.bumps.config;
    Ok(())
}
