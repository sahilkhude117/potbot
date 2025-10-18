# PotBot - Solana Trading Pool Telegram Bot

A Telegram bot for managing collaborative trading pools (pots) on Solana with on-chain smart contract integration.

## Features

### 🏦 Pot Management
- Create and manage trading pots
- Multi-user collaboration
- On-chain pot creation and verification
- Transparent fee structure

### 👥 Role-Based Access
- **Admin**: Create pots, manage traders, full control
- **Trader**: Execute trades on behalf of the pot
- **Member**: Deposit, withdraw, view portfolio

### 💰 Portfolio Management
- Deposit SOL to pots
- Withdraw funds with automatic share calculation
- Real-time portfolio tracking
- Individual and group portfolio views
- PnL tracking and statistics

### 🔄 Trading
- Buy tokens with SOL
- Sell tokens for SOL
- Jupiter aggregator integration
- Trader permission system with on-chain verification

### 🔗 Blockchain Integration
- Solana smart contract for pot management
- On-chain trader verification
- Transaction signatures for all operations
- Secure PDA-based pot accounts

## Tech Stack

- **Bot Framework**: Telegraf (Telegram Bot API)
- **Runtime**: Bun
- **Database**: PostgreSQL with Prisma ORM
- **Blockchain**: Solana (web3.js)
- **Smart Contracts**: Anchor Framework
- **DEX Integration**: Jupiter Aggregator

## Project Structure

```
potbot/
├── src/
│   ├── index.ts              # Main bot logic
│   ├── db/
│   │   └── prisma.ts         # Database client
│   ├── keyboards/
│   │   └── keyboards.ts      # Telegram inline keyboards
│   ├── lib/
│   │   ├── types.ts          # TypeScript types
│   │   ├── utils.ts          # Utility functions
│   │   └── statits.ts        # Constants
│   ├── solana/
│   │   ├── smartContract.ts  # Smart contract integration
│   │   ├── createVault.ts    # Vault creation
│   │   ├── getBalance.ts     # Balance queries
│   │   ├── swapAssetsWithJup.ts  # Jupiter swaps
│   │   └── ...               # Other Solana utilities
│   └── wizards/
│       ├── depositWizard.ts  # Deposit flow
│       ├── withdrawalWizard.ts  # Withdrawal flow
│       ├── buyTokenWithSolWizard.ts  # Buy flow
│       └── sellTokenForSolWizard.ts  # Sell flow
├── smart-contracts/
│   ├── programs/
│   │   └── constants/
│   │       └── src/          # Rust smart contract code
│   └── tests/                # Smart contract tests
├── prisma/
│   └── schema.prisma         # Database schema
└── idl.json                  # Smart contract IDL
```

## Setup

### Prerequisites

- Bun runtime
- PostgreSQL database
- Solana CLI tools
- Anchor framework (for smart contract development)

### Installation

1. **Clone the repository**
```bash
git clone <repository-url>
cd potbot
```

2. **Install dependencies**
```bash
bun install
```

3. **Setup environment variables**
```bash
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/potbot"
TELEGRAM_BOT_TOKEN="your_telegram_bot_token"
SOLANA_RPC_URL="https://api.devnet.solana.com"
```

4. **Setup database**
```bash
bunx prisma migrate dev
bunx prisma generate
```

5. **Deploy smart contract** (for development)
```bash
cd smart-contracts
anchor build
anchor deploy
# Update PROGRAM_ID in src/solana/smartContract.ts
```

6. **Run the bot**
```bash
bun run dev
```

## Smart Contract Integration

The bot integrates with a Solana smart contract for critical operations:

- **Pot Creation**: On-chain pot initialization with PDA
- **Trader Management**: Add/remove traders with on-chain verification
- **Authorization**: Smart contract enforces admin-only operations

See [SMART_CONTRACT_INTEGRATION.md](./SMART_CONTRACT_INTEGRATION.md) for detailed documentation.

### Key Integration Points

```typescript
// Create a pot on-chain
const { signature, potPDA } = await initializePotOnChain(
  adminPrivateKey,
  performanceFeeBps,
  redemptionFeeBps
);

// Add trader to pot on-chain
const signature = await addTraderOnChain(
  adminPrivateKey,
  traderPublicKey
);

// Remove trader from pot on-chain
const signature = await removeTraderOnChain(
  adminPrivateKey,
  traderPublicKey
);
```

## Usage

### User Commands

**Private Chat Commands:**
- `/start` - Initialize bot and create wallet
- `/deposit` - Deposit SOL to a pot
- `/portfolio` - View your portfolio across all pots

**Group Chat Commands:**
- `/settrader @user` - Add trader (admin only)
- `/removetrader @user` - Remove trader (admin only)
- `/traders` - List all traders
- `/traderhelp` - Show trader command help
- `/portfolio` - View group pot portfolio

### Inline Buttons

**Private Chat:**
- 🔑 Show Public Key
- 💰 Show Balance
- 🏦 Create Pot
- 🤝 Join Pot
- 📊 My Pots
- 💸 Buy / Sell

**Group Chat:**
- 💸 Buy / Sell tokens
- 📊 Portfolio overview

## Database Schema

The bot uses Prisma ORM with the following main models:

- **User**: Telegram users with Solana wallets
- **Pot**: Trading pools with vault addresses
- **Pot_Member**: User membership and roles in pots
- **Trade**: Trade execution records
- **Deposit/Withdrawal**: Transaction history
- **Asset**: Pot asset balances

## Security Considerations

⚠️ **Important**: 
- Private keys are currently stored in the database
- **TODO**: Migrate to MPC (Multi-Party Computation) solution
- Use only on devnet/testnet for now
- Never use real funds until MPC is implemented

## Testing

### Bot Testing
```bash
bun run dev
```

### Smart Contract Testing
```bash
cd smart-contracts
anchor test
```

### Integration Testing
```bash
# Run test script
bun run src/solana/testSmartContract.ts
```

## Development Roadmap

- [x] Basic bot functionality
- [x] Pot creation and management
- [x] Trading with Jupiter
- [x] Portfolio tracking
- [x] Smart contract integration
- [ ] MPC for key management
- [ ] Multi-sig support
- [ ] Advanced trading strategies
- [ ] Governance features
- [ ] Mobile app integration

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

[Add your license here]

## Support

For issues and questions:
- Open an issue on GitHub
- Contact the development team

## Acknowledgments

- Solana Foundation
- Anchor Framework
- Jupiter Exchange
- Telegraf.js
