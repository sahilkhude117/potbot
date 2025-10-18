use anchor_lang::prelude::*;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};
use crate::errors::PotError;
use crate::states::Pot;

pub fn handler(ctx: Context<RevokeSwapDelegate>) -> Result<()> {
    let pot = &mut ctx.accounts.pot;

    let cpi_accounts = Revoke {
        source: ctx.accounts.pot_vault.to_account_info(),
        authority: pot.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

    token::revoke(cpi_ctx)?;

    pot.delegate = Pubkey::default();
    pot.delegated_amount = 0;

    Ok(())
}

#[derive(Accounts)]
pub struct RevokeSwapDelegate<'info> {
    pub trader: Signer<'info>,

    #[account(
        mut,
        has_one = admin,
        constraint = pot.delegate == trader.key() @ PotError::InvalidDelegate
    )]
    pub pot: Account<'info, Pot>,

    pub admin: AccountInfo<'info>,

    #[account(mut)]
    pub pot_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}