- lib.rs => use anchor_lang::prelude::*;

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
- errors.rs => use anchor_lang::prelude::*;

#[error_code]
pub enum PotError {
    #[msg("You are not authorized to perform this action.")]
    Unauthorized,
    #[msg("The maximum number of traders has been reached.")]
    MaxTradersReached,
    #[msg("This trader is already on the list.")]
    TraderAlreadyExists,
    #[msg("Trader not found in the list.")]
    TraderNotFound,
    #[msg("Deposit value should be greater than 0")]
    ZeroDeposit,
    #[msg("Shares should be greater than 0")]
    ZeroShares,
    #[msg("Calculation is overflowed")]
    CalculationOverflow,
    #[msg("You dont have enough shares to burn")]
    InsufficientShares,
    #[msg("A delegate is already set for this pot.")]
    DelegateAlreadySet,
    #[msg("Amount must be greater than zero.")]
    ZeroAmount,
    #[msg("Signer is not the current delegate.")]
    InvalidDelegate,
}
- constants.rs => use anchor_lang::prelude::*;

#[constant]
pub const POT_SEED: &[u8] = b"pot";

pub const MAX_TRADERS: usize = 10;

pub const MEMBER_SEED: &[u8] = b"member";
- states
    - member.rs => use anchor_lang::prelude::*;

#[account]
#[derive(Default)]
pub struct MemberData {
    pub pot: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
    pub bump: u8,
}

impl MemberData {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}
    - pot.rs => use anchor_lang::prelude::*;
use crate::constants::MAX_TRADERS;

#[account]
#[derive(Default)]
pub struct Pot {
    pub admin: Pubkey,
    pub traders: Vec<Pubkey>,
    pub fees: PotFees,
    pub bump: u8,
    pub base_mint: Pubkey,
    pub total_shares: u64,
    pub delegate: Pubkey,
    pub delegated_amount: u64,
    pub pot_seed: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct PotFees {
    pub performance_fee_bps: u16,
    pub redemption_fee_bps: u16,
}

impl Pot {
    pub const SPACE: usize = 8 // Anchor discriminator
        + 32 // admin pubkey
        + 4 + (MAX_TRADERS * 32) // traders vec
        + 2 + 2 // fees
        + 1 // bump
        + 32 // base_mint
        + 8 // total_shares
        + 32 // delegate
        + 8 // delagated_amount
        + 32; // pot_seed
}
- instructions
    - initialize_pot => use anchor_lang::prelude::*;
use crate::constants::POT_SEED;
use crate::states::{Pot, PotFees};

pub fn handler(ctx: Context<InitializePot>, fees: PotFees, base_mint: Pubkey) -> Result<()> {
    let pot = &mut ctx.accounts.pot;
    pot.admin = ctx.accounts.admin.key();
    pot.fees = fees;
    pot.traders = Vec::new();

    pot.base_mint = base_mint;
    pot.total_shares = 0;

    pot.pot_seed = ctx.accounts.pot_seed.key();

    pot.bump = ctx.bumps.pot;
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(fees: PotFees, base_mint: Pubkey)]
pub struct InitializePot<'info> {
    #[account(
        init,
        payer = admin,
        space = Pot::SPACE,
        seeds = [POT_SEED, admin.key().as_ref(), pot_seed.key().as_ref()],
        bump
    )]
    pub pot: Account<'info, Pot>,

    pub pot_seed: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}
    - add_trader => use anchor_lang::prelude::*;
use crate::constants::MAX_TRADERS;
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
        has_one = admin @ PotError::Unauthorized
    )]
    pub pot: Account<'info, Pot>,
    pub admin: Signer<'info>,
}
    - remove_trader => use anchor_lang::prelude::*;
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
        has_one = admin @ PotError::Unauthorized
    )]
    pub pot: Account<'info, Pot>,
    pub admin: Signer<'info>,
}
    - deposit => use anchor_lang::prelude::*;
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
    - redeem => use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::{MEMBER_SEED, POT_SEED};
use crate::errors::PotError;
use crate::states::{MemberData, Pot};

pub fn handler(ctx: Context<Redeem>, shares_to_burn: u64) -> Result<()> {
    require!(shares_to_burn > 0, PotError::ZeroShares);
    let pot = &mut ctx.accounts.pot;
    let member_data = &mut ctx.accounts.member_data;
    let pot_vault = &ctx.accounts.pot_vault;

    require!(member_data.shares >= shares_to_burn, PotError::InsufficientShares);

    let amount_to_return = (shares_to_burn as u128)
        .checked_mul(pot_vault.amount as u128)
        .and_then(|res| res.checked_div(pot.total_shares as u128))
        .and_then(|res| res.try_into().ok())
        .ok_or(PotError::CalculationOverflow)?;
    
    pot.total_shares = pot.total_shares.checked_sub(shares_to_burn).ok_or(PotError::CalculationOverflow)?;
    member_data.shares = member_data.shares.checked_sub(shares_to_burn).ok_or(PotError::CalculationOverflow)?;

    let admin_key = pot.admin.key();
    let seeds = &[
        POT_SEED.as_ref(),
        admin_key.as_ref(),
        &[pot.bump],
    ];
    let signer = &[&seeds[..]];

    let cpi_accounts = Transfer {
        from: ctx.accounts.pot_vault.to_account_info(),
        to: ctx.accounts.user_vault.to_account_info(),
        authority: pot.to_account_info()
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
    token::transfer(cpi_ctx, amount_to_return)?;

    Ok(())
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [MEMBER_SEED, pot.key().as_ref(), user.key().as_ref()],
        bump = member_data.bump,
        has_one = user,
        has_one = pot,
    )]
    pub member_data: Account<'info, MemberData>,

    #[account(
        mut,
        seeds = [POT_SEED, admin.key().as_ref()],
        bump = pot.bump
    )]
    pub pot: Account<'info, Pot>,

    pub admin: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = pot.base_mint,
        associated_token::authority = pot
    )]
    pub pot_vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::mint = pot.base_mint,
        associated_token::authority = user
    )]
    pub user_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
    - set_swap_delegate => use anchor_lang::prelude::*;
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
    let seeds = &[
        POT_SEED.as_ref(),
        admin_key.as_ref(),
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
        seeds = [POT_SEED, admin.key().as_ref()],
        bump = pot.bump
    )]
    pub pot: Account<'info, Pot>,

    // check: admin is used for pda seed derivation and is not written to
    pub admin: AccountInfo<'info>,

    #[account(
        mut,
        // This constraint ensures the token account is owned by the pot,
        // allowing any of the pot's assets to be delegated.
        token::authority = pot,
    )]
    pub pot_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}
    - revoke_swap_delegate => use anchor_lang::prelude::*;
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