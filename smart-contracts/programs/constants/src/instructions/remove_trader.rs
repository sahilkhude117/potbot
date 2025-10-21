use anchor_lang::prelude::*;
use crate::constants::POT_SEED;
use crate::errors::PotError;
use crate::states::Pot;

pub fn handler(ctx: Context<RemoveTrader>, trader_to_remove: Pubkey) -> Result<()> {
    let pot = &mut ctx.accounts.pot;
    let initial_len = pot.traders.len();
    pot.traders.retain(|&trader| trader != trader_to_remove);
    require!(
        pot.traders.len() < initial_len,
        PotError::TraderNotFound
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RemoveTrader<'info> {
    #[account(
        mut,
        seeds = [POT_SEED, admin.key().as_ref(), pot_seed.key().as_ref()],
        bump = pot.bump,
        has_one = admin @ PotError::Unauthorized
    )]
    pub pot: Account<'info, Pot>,

    pub pot_seed: AccountInfo<'info>,

    pub admin: Signer<'info>,
}