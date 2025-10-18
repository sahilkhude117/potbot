use anchor_lang::prelude::*;
use crate::constants::POT_SEED;
use crate::states::{Pot, PotFees};

pub fn handler(ctx: Context<InitializePot>, fees: PotFees, base_mint: Pubkey) -> Result<()> {
    let pot = &mut ctx.accounts.pot;
    pot.admin = ctx.accounts.admin.key();
    pot.fees = fees;
    pot.traders = Vec::new();

    pot.base_mint = base_mint;
    pot.total_shares = 0;

    pot.bump = ctx.bumps.pot;
    
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePot<'info> {
    #[account(
        init,
        payer = admin,
        space = Pot::SPACE,
        seeds = [POT_SEED, admin.key().as_ref()],
        bump
    )]
    pub pot: Account<'info, Pot>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}