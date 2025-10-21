use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Token, TokenAccount};
use crate::constants::POT_SEED;
use crate::errors::PotError;
use crate::states::Pot;

pub fn handler(ctx: Context<SetSwapDelegate>, amount: u64) -> Result<()> {
    let pot = &mut ctx.accounts.pot;
    let trader = &ctx.accounts.trader;

    require!(pot.traders.contains(&trader.key()), PotError::Unauthorized);
    require!(pot.delegate == Pubkey::default(), PotError::DelegateAlreadySet);
    require!(amount > 0, PotError::ZeroAmount);

    pot.delegate = trader.key();
    pot.delegated_amount = amount;

    // define pda signer seeds to sign the CPI
    let admin_key = pot.admin.key();
    let pot_seed_key = ctx.accounts.pot_seed.key();
    let seeds = &[
        POT_SEED.as_ref(),
        admin_key.as_ref(),
        pot_seed_key.as_ref(),
        &[pot.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Approve {
        to: ctx.accounts.pot_vault.to_account_info(),
        delegate: trader.to_account_info(),
        authority: pot.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    token::approve(cpi_ctx, amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct SetSwapDelegate<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(
        mut,
        seeds = [POT_SEED, admin.key().as_ref(), pot_seed.key().as_ref()],
        bump = pot.bump
    )]
    pub pot: Account<'info, Pot>,

    // check: admin is used for pda seed derivation and is not written to
    pub admin: AccountInfo<'info>,

    pub pot_seed: AccountInfo<'info>,

    #[account(
        mut,
        token::authority = pot,
    )]
    pub pot_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}