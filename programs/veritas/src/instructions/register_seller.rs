use anchor_lang::prelude::*;

use crate::{
    constants::{MAX_NAME_LEN, REPUTATION_START, SELLER_SEED},
    error::VeritasError,
    state::{SellerAccount, SellerStatus},
};

#[derive(Accounts)]
pub struct RegisterSeller<'info> {
    /// The seller registering itself — pays rent and owns the account.
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + SellerAccount::INIT_SPACE,
        seeds = [SELLER_SEED, owner.key().as_ref()],
        bump
    )]
    pub seller: Account<'info, SellerAccount>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_seller(ctx: Context<RegisterSeller>, name: String) -> Result<()> {
    require!(name.len() <= MAX_NAME_LEN, VeritasError::NameTooLong);

    let seller = &mut ctx.accounts.seller;
    seller.owner = ctx.accounts.owner.key();
    seller.name = name;
    seller.reputation = REPUTATION_START;
    seller.served = 0;
    seller.matched = 0;
    seller.outliers = 0;
    seller.stake = 0; // token custody arrives in P1-T2b (add_stake)
    seller.status = SellerStatus::Active;
    seller.bump = ctx.bumps.seller;
    Ok(())
}
