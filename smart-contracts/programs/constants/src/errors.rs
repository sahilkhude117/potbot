use anchor_lang::prelude::*;

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
}