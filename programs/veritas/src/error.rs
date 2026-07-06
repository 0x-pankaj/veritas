use anchor_lang::prelude::*;

#[error_code]
pub enum VeritasError {
    #[msg("Signer is not the coordinator authority")]
    Unauthorized,
    #[msg("k must be between MIN_RESPONSES and MAX_K")]
    InvalidK,
    #[msg("Request is not open")]
    RequestNotOpen,
    #[msg("Request is not settled or failed")]
    RequestNotClosed,
    #[msg("Seller already submitted a response for this request")]
    DuplicateSeller,
    #[msg("Request already has k responses")]
    TooManyResponses,
    #[msg("Response value exceeds MAX_RESPONSE_BYTES")]
    ValueTooLarge,
    #[msg("Numeric response must be at least 8 bytes (i64 LE)")]
    ValueTooSmallForNumeric,
    #[msg("Fewer responses than MIN_RESPONSES; cannot finalize")]
    NotEnoughResponses,
    #[msg("Seller account does not match the response entry")]
    SellerMismatch,
    #[msg("remaining_accounts must contain each responding seller, in order")]
    BadRemainingAccounts,
    #[msg("Name exceeds MAX_NAME_LEN")]
    NameTooLong,
    #[msg("Token account mint does not match config.stake_mint")]
    WrongStakeMint,
    #[msg("Token account is not owned by the signer")]
    WrongTokenOwner,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Withdrawal exceeds ledger stake")]
    InsufficientStake,
    #[msg("Arithmetic overflow")]
    Overflow,
}
