use anchor_lang::prelude::*;
use anchor_spl::token::{self, Approve, Token, TokenAccount};
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

    let cpi_accounts = Approve {
        to: ctx.accounts.pot_vault.to_account_info(),
        delegate: trader.to_account_info(),
        authority: pot.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::approve(cpi_ctx, amount)?;

    Ok(())
}

#[derive(Accounts)]
pub struct SetSwapDelegate<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,

    #[account(mut, has_one = admin)]
    pub pot: Account<'info, Pot>,

    pub admin: AccountInfo<'info>,

    #[account(mut)]
    pub pot_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}