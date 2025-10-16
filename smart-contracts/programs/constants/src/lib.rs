use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod states;

use instructions::*;
use states::PotFees;

declare_id!("636NmFV9Nhr2TV49RyjJUp2kyBVbnZFMmPqQjvHeJNzU");

#[program]
pub mod solana_pot {
    use super::*;

    pub fn initialize_pot(ctx: Context<InitializePot>, fees: PotFees) -> Result<()> {
        instructions::initialize_pot::handler(ctx, fees)
    }

    pub fn add_trader(ctx: Context<AddTrader>, trader_to_add: Pubkey) -> Result<()> {
        instructions::add_trader::handler(ctx, trader_to_add)
    }

    pub fn remove_trader(ctx: Context<RemoveTrader>, trader_to_remove: Pubkey) -> Result<()> {
        instructions::remove_trader::handler(ctx, trader_to_remove)
    }
}