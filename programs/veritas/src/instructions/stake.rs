use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::{
    constants::{CONFIG_SEED, SELLER_SEED, STAKE_SEED},
    error::VeritasError,
    state::{Config, SellerAccount},
};

/// Seller locks USDC stake into program custody. Custody is a per-seller
/// token account owned by the Config PDA; slashed funds stay in custody as
/// protocol treasury (ledger-tracked via `seller.stake`).
#[derive(Accounts)]
pub struct AddStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [SELLER_SEED, owner.key().as_ref()], bump = seller.bump)]
    pub seller: Account<'info, SellerAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(address = config.stake_mint @ VeritasError::WrongStakeMint)]
    pub stake_mint: Account<'info, Mint>,
    /// Seller's own token account to stake from.
    #[account(
        mut,
        constraint = owner_token.owner == owner.key() @ VeritasError::WrongTokenOwner,
        constraint = owner_token.mint == config.stake_mint @ VeritasError::WrongStakeMint,
    )]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [STAKE_SEED, owner.key().as_ref()],
        bump,
        token::mint = stake_mint,
        token::authority = config,
    )]
    pub custody: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_add_stake(ctx: Context<AddStake>, amount: u64) -> Result<()> {
    require!(amount > 0, VeritasError::ZeroAmount);

    token::transfer(
        CpiContext::new(
            token::ID,
            Transfer {
                from: ctx.accounts.owner_token.to_account_info(),
                to: ctx.accounts.custody.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;

    let seller = &mut ctx.accounts.seller;
    seller.stake = seller.stake.checked_add(amount).ok_or(VeritasError::Overflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [SELLER_SEED, owner.key().as_ref()], bump = seller.bump)]
    pub seller: Account<'info, SellerAccount>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        constraint = owner_token.owner == owner.key() @ VeritasError::WrongTokenOwner,
        constraint = owner_token.mint == config.stake_mint @ VeritasError::WrongStakeMint,
    )]
    pub owner_token: Account<'info, TokenAccount>,
    #[account(mut, seeds = [STAKE_SEED, owner.key().as_ref()], bump)]
    pub custody: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_withdraw_stake(ctx: Context<WithdrawStake>, amount: u64) -> Result<()> {
    require!(amount > 0, VeritasError::ZeroAmount);
    let seller = &mut ctx.accounts.seller;
    // A seller can only withdraw its ledger stake — slashed funds (custody
    // balance minus ledger stake) belong to the protocol treasury.
    require!(amount <= seller.stake, VeritasError::InsufficientStake);

    let bump = ctx.accounts.config.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[bump]]];
    token::transfer(
        CpiContext::new_with_signer(
            token::ID,
            Transfer {
                from: ctx.accounts.custody.to_account_info(),
                to: ctx.accounts.owner_token.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    seller.stake -= amount;
    Ok(())
}
