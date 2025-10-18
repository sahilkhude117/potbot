use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::{MEMBER_SEED, POT_SEED};
use crate::errors::PotError;
use crate::states::{MemberData, Pot};

pub fn handler(ctx: Context<Redeem>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, PotError::ZeroShares);
    let pot = &mut ctx.accounts.pot;
    let member_data = &mut ctx.accounts.member_data;
    let pot_vault = &ctx.accounts.pot_vault;

    require!(member_data.shares >= shares_to_burn, PotError::InsufficientShares);

    let amount_to_return = (shares_to_burn as u128)
        .checked_mul(pot_vault.amount as u128)
        .and_then(|res| res.checked_div(pot.total_shares as u128))
        .and_then(|res| res.try_into().ok())
        .ok_or(PotError::CalculationOverflow)?;
    
    pot.total_shares = pot.total_shares.checked_sub(shares_to_burn).ok_or(PotError::CalculationOverflow)?;
    member_data.shares = member_data.shares.checked_sub(shares_to_burn).ok_or(PotError::CalculationOverflow)?;

    let admin_key = pot.admin.key();
    let seeds = &[
        POT_SEED.as_ref(),
        admin_key.as_ref(),
        &[pot.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.pot_vault.to_account_info(),
        to: ctx.accounts.user_vault.to_account_info(),
        authority: pot.to_account_info()
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, amount_to_return)?;

    Ok(())
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, pot.key().as_ref(), user.key().as_ref()],
        bump = member_data.bump,
        has_one = user,
        has_one = pot,
    )]
    pub member_data: Account<'info, MemberData>,

    #[account(
        mut,
        seeds = [POT_SEED, admin.key().as_ref()],
        bump = pot.bump
    )]
    pub pot: Account<'info, Pot>,

    pub admin: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = pot.base_mint,
        associated_token::authority = pot
    )]
    pub pot_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = pot.base_mint,
        associated_token::authority = user
    )]
    pub user_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}