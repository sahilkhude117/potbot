use anchor_lang::prelude::*;
use crate::constants::MAX_TRADERS;

#[account]
#[derive(Default)]
pub struct Pot {
    pub admin: Pubkey,
    pub traders: Vec<Pubkey>,
    pub fees: PotFees,
    pub bump: u8,
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
        + 1; // bump
}