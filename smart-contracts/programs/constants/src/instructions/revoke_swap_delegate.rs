use anchor_lang::prelude::*;
use anchor_spl::token::{self, Revoke, Token, TokenAccount};
use crate::constants::POT_SEED;
use crate::errors::PotError;
use crate::states::Pot;

pub fn handler(ctx: Context<RevokeSwapDelegate>) -> Result<()> {
    let pot = &mut ctx.accounts.pot;

    let admin_key = pot.admin.key();
    let pot_seed_key = ctx.accounts.pot_seed.key();
    let seeds = &[
        POT_SEED.as_ref(),
        admin_key.as_ref(),
        pot_seed_key.as_ref(),
        &[pot.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = Revoke {
        source: ctx.accounts.pot_vault.to_account_info(),
        authority: pot.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

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
        seeds = [POT_SEED, admin.key().as_ref(), pot_seed.key().as_ref()],
        bump = pot.bump,
        constraint = pot.delegate == trader.key() @ PotError::InvalidDelegate
    )]
    pub pot: Account<'info, Pot>,

    pub admin: AccountInfo<'info>,
    pub pot_seed: AccountInfo<'info>,

    #[account(mut)]
    pub pot_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}