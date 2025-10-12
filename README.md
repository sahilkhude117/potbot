
### User registration & startup / onboarding

* [ ] After creating user with new keypair, initialize pot membership list (if any) / ensure `Pot_Member` entries if admin auto-joins
* [ ] When showing “welcome / public key / balance”, also compute & show (or later) their share holdings, NAVs, etc.

### Deposit wizard & deposit logic (in `depositSolToVaultWizard`)

* [ ] Fetch `pot.totalShares` and current pot value (sum of all assets) when deposit is confirmed
* [ ] Compute `sharesToMint` using formula (if `totalShares=0`, fallback initial share price)
* [ ] Persist into DB: increment `pot.totalShares`, increment `Pot_Member.shares`, and create `Deposit` record
* [ ] After SOL transfer on chain, refresh / sync vault asset balances (call function / RPC)
* [ ] Handle error / rollback: if DB write fails or transfer fails, undo partials
* [ ] Notify user of how many shares they got, their share % in pot, etc.

### Withdrawal / redemption feature (new)

You’ll need to build a withdrawal wizard / command similar to deposit. To-dos:

* [ ] Create a `withdrawSolFromVaultWizard` scene / flow
* [ ] Let user input how many shares or what SOL equivalent they want
* [ ] Validate user has enough `Pot_Member.shares`
* [ ] Compute `valueToWithdraw = sharesBurned * (totalValue / totalShares)` in SOL equivalent
* [ ] Determine which assets to sell (non-SOL) and how much, reserving `pendingSale` amounts
* [ ] Execute internal trades (sell non-SOL → SOL) and record `RedemptionTrade` entries
* [ ] Deduct redemption fees or performance fee as per `Pot.redemptionFeeBps / performanceFeeBps`
* [ ] Burn user shares, decrement `pot.totalShares`, decrement `member.shares`
* [ ] Update asset balances and `pendingSale` fields
* [ ] Transfer SOL to user on-chain
* [ ] Record `Withdrawal` in DB with `sharesBurned`, `amountOut`, link `redemptionTrades`
* [ ] Handle partial / fail cases (if trades or transfer fail) with rollback or compensation

### Portfolio / info / metrics commands

* [ ] In `/portfolio` (or similar), fetch for each pot: user’s share count, pot.totalShares, total assets’ value, compute user’s NAV in SOL
* [ ] Show breakdown: deposit vs current value, PnL, percentage share
* [ ] Optionally show pot overall performance / composition (assets distribution)

### Pot creation / group setup / invite logic (in `index.ts`)

* [ ] After `create_pot`, auto-create a `Pot_Member` record for the admin (they must hold shares = 0 initially)
* [ ] Ensure `pot.vaultAddress` format is consistent and parsed correctly
* [ ] On `bot.start` when group chat, after updating `pot.telegramGroupId`, maybe also mint seeds / initialization (e.g. pot assets start empty)
* [ ] On `create_invite`, after updating `inviteLink`, ensure DB consistency

### Miscellaneous & utility enhancements

* [ ] Add utility to recompute / sync pot asset balances (RPC / on-chain) for all `Pot.assets`
* [ ] Add price oracle integration to value non-SOL tokens in SOL (for swap calculations)
* [ ] Add function to compute `totalValue` = sum of (asset.balance * price) for a pot
* [ ] Add slippage / price checks before internal trade execution
* [ ] Add dust / rounding logic to avoid leftover tiny remainders
* [ ] Add rollback / transaction boundaries so DB and chain actions are atomic or compensated
* [ ] Add error handling / fallback paths for trade failures, insufficient liquidity, etc.
