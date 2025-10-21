use anchor_lang::prelude::*;

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