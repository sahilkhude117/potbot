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

    pub fn initialize_pot(ctx: Context<InitializePot>, fees: PotFees, base_mint: Pubkey) -> Result<()> {
        instructions::initialize_pot::handler(ctx, fees, base_mint)
    }

    pub fn add_trader(ctx: Context<AddTrader>, trader_to_add: Pubkey) -> Result<()> {
        instructions::add_trader::handler(ctx, trader_to_add)
    }

    pub fn remove_trader(ctx: Context<RemoveTrader>, trader_to_remove: Pubkey) -> Result<()> {
        instructions::remove_trader::handler(ctx, trader_to_remove)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn redeem(ctx: Context<Redeem>, shares_to_burn: u64) -> Result<()> {
        instructions::redeem::handler(ctx, shares_to_burn)
    }

    // authorize trader to perform a single swap.
    pub fn set_swap_delegate(ctx: Context<SetSwapDelegate>, amount: u64) -> Result<()> {
        instructions::set_swap_delegate::handler(ctx, amount)
    }

    pub fn revoke_swap_delegate(ctx: Context<RevokeSwapDelegate>) -> Result<()> {
        instructions::revoke_swap_delegate::handler(ctx)
    }
}