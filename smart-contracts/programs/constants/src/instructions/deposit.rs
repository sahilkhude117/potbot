use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::constants::MEMBER_SEED;
use crate::errors::PotError;
use crate::states::{MemberData, Pot};

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, PotError::ZeroDeposit);
    let pot = &mut ctx.accounts.pot;
    let member_data = &mut ctx.accounts.member_data;
    let pot_vault = &ctx.accounts.pot_vault;

    let shares_to_mint = if pot.total_shares == 0 || pot_vault.amount == 0 {
        // First depositor gets shares 1:1 with the amount
        amount
    } else {
        // Subsequent depositors get shares proportional to their contribution
        (amount as u128)
            .checked_mul(pot.total_shares as u128)
            .and_then(|res| res.checked_div(pot_vault.amount as u128))
            .and_then(|res| res.try_into().ok())
            .ok_or(PotError::CalculationOverflow)?
    };

    require!(shares_to_mint > 0, PotError::ZeroShares);

    pot.total_shares = pot.total_shares.checked_add(shares_to_mint).ok_or(PotError::CalculationOverflow)?;
    member_data.shares = member_data.shares.checked_add(shares_to_mint).ok_or(PotError::CalculationOverflow)?;

    member_data.user = ctx.accounts.user.key();
    member_data.pot = pot.key();
    member_data.bump = ctx.bumps.member_data;

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_vault.to_account_info(),
        to: ctx.accounts.pot_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = MemberData::SPACE,
        seeds = [MEMBER_SEED, pot.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub member_data: Account<'info, MemberData>,

    #[account(mut, has_one = base_mint)]
    pub pot: Account<'info, Pot>,

    pub base_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = pot
    )]
    pub pot_vault: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = base_mint,
        associated_token::authority = user
    )]
    pub user_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}