use anchor_lang::prelude::*;
use crate::constants::{POT_SEED, MAX_TRADERS};
use crate::errors::PotError;
use crate::states::Pot;

pub fn handler(ctx: Context<AddTrader>, trader_to_add: Pubkey) -> Result<()> {
    let pot = &mut ctx.accounts.pot;

    require!(
        pot.traders.len() < MAX_TRADERS,
        PotError::MaxTradersReached
    );
    require!(
        !pot.traders.contains(&trader_to_add),
        PotError::TraderAlreadyExists
    );

    pot.traders.push(trader_to_add);
    Ok(())
}

#[derive(Accounts)]
pub struct AddTrader<'info> {
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