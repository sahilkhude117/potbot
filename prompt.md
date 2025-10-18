Data:
1. Smart Contract:
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
    - constants => use anchor_lang::prelude::*;

#[constant]
pub const POT_SEED: &[u8] = b"pot";

pub const MAX_TRADERS: usize = 10;
    - errors =>use anchor_lang::prelude::*;

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
    - instructions 
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
        - initialize_pot => use anchor_lang::prelude::*;
use crate::constants::POT_SEED;
use crate::states::{Pot, PotFees};

pub fn handler(ctx: Context<InitializePot>, fees: PotFees) -> Result<()> {
    let pot = &mut ctx.accounts.pot;
    pot.admin = ctx.accounts.admin.key();
    pot.fees = fees;
    pot.traders = Vec::new();
    pot.bump = ctx.bumps.pot;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializePot<'info> {
    #[account(
        init,
        payer = admin,
        space = Pot::SPACE,
        seeds = [POT_SEED, admin.key().as_ref()],
        bump
    )]
    pub pot: Account<'info, Pot>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
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
    - states
        - pot.rs =>  use anchor_lang::prelude::*;
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
2. Deposit Wizard: => import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { sendSol } from "../solana/sendSol";
import { getBalanceMessage } from "../solana/getBalance";
import type { BotContext, DepositWizardState } from "../lib/types";
import { getPriceInUSD } from "../solana/getPriceInUSD";
import { SOL_MINT } from "../lib/statits";
import { computePotValueInUSD } from "../solana/computePotValueInUSD";

export const depositSolToVaultWizard = new Scenes.WizardScene<BotContext>(
    'deposit_sol_to_vault_wizard',
    
    // 1. show pots
    async (ctx) => {
        try {
            const state = ctx.wizard.state as DepositWizardState;
            const existingUser = await prismaClient.user.findFirst({
                where: {
                    telegramUserId: ctx.from?.id.toString(),
                }
            });

            if (!existingUser) {
                await ctx.reply("User not found. Please register first.");
                return ctx.scene.leave();
            }

            const pots = await prismaClient.pot.findMany({
                where: {
                    isGroupAdded: true,
                    inviteLink: { not: null },
                    OR: [
                        {
                            members: {
                                some: { userId: existingUser.id },
                            },
                        },
                        {
                            adminId: existingUser.id,
                        },
                    ],
                },
                select: { id: true, name: true}
            })

            if (!pots.length) {
                await ctx.reply("No active pots available right now.");
                return ctx.scene.leave();
            }

            const buttons: any[][] = [];
            for (let i = 0; i < pots.length; i += 2) {
                const row = pots
                    .slice(i, i + 2)
                    .map((pot) =>
                        Markup.button.callback(
                            pot.name || `Pot ${i + 1}`,
                            `wizard_select_pot_${pot.id}`
                        )
                    );
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("❌ Cancel", "wizard_cancel_deposit")]);

            await ctx.reply(
                "*Please select a pot to deposit into:*",
                {
                    parse_mode: "MarkdownV2",
                    ...Markup.inlineKeyboard(buttons),
                }
            );

            state.userId = existingUser.id;
            return ctx.wizard.next();
        } catch (err) {
            console.error(err);
            await ctx.reply("Something went wrong while fetching your pots.");
            return ctx.scene.leave();
        }
    },

    // 2 - waiting for pot selection
    async (ctx) => {
        // handled in callback
    },

    async (ctx) => {
        const state = ctx.wizard.state as DepositWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();
        const amount = parseFloat(text ?? '');

        if (isNaN(amount) || amount <= 0) {
            return ctx.reply("❌ Please enter a valid number (e.g., 0.5)");
        }

        const lamports = amount * LAMPORTS_PER_SOL;
        if (lamports < 1) {
            return ctx.reply("❌ Amount too small — must be at least 0.000000001 SOL.");
        }

        if (amount > state.userBalance) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Balance*\n\n` +
                `You're trying to deposit ${escapeMarkdownV2Amount(amount)} SOL\\.\n` +
                `You have only ${escapeMarkdownV2Amount(state.userBalance)} SOL\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        const minReserve = 0.005;
        if (amount > state.userBalance - minReserve) {
            await ctx.replyWithMarkdownV2(
                `❌ *Reserve SOL for Fees*\n\n` +
                `Keep at least ${escapeMarkdownV2Amount(minReserve)} SOL for transaction fees\\.\n\n` +
                `Maximum you can deposit: ${escapeMarkdownV2Amount(state.userBalance - minReserve)} SOL`
            );
            return;
        }

        state.amount = amount;

        await ctx.replyWithMarkdownV2(
            `💰 *Confirm Deposit*\n\n` +
            `*Pot:* ${escapeMarkdownV2(state.potName)}\n` +
            `*Amount:* ${escapeMarkdownV2Amount(amount)} SOL\n\n` +
            `Do you want to proceed?`,
            Markup.inlineKeyboard([
                [
                    Markup.button.callback("✅ Confirm", "wizard_confirm_deposit"), 
                    Markup.button.callback("❌ Cancel", "wizard_cancel_deposit")
                ],
            ])
        );

        return ctx.wizard.next();
    },

    async (ctx) => {
    },
)

depositSolToVaultWizard.action(/wizard_select_pot_(.+)/, async (ctx) => {
    const state = ctx.wizard.state as DepositWizardState;
    const potId = ctx.match[1];
    const pot = await prismaClient.pot.findUnique({ where: { id: potId }});
    if (!pot) {
        await ctx.reply("This pot no longer exists.");
        return ctx.scene.leave();
    }

    state.potId = pot.id;
    state.potName = pot.name;

    const user = await prismaClient.user.findUnique({ where: { id: state.userId } });
    if (!user) {
        await ctx.reply("❌ User not found. Please register again.");
        return ctx.scene.leave();
    }

    const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
    const { balance, empty } = await getBalanceMessage(userKeypair.publicKey.toString());

    if (empty || balance < 0.001) {
        await ctx.replyWithMarkdownV2(
            `❌ *Insufficient Balance*\n\n` +
            `You have only ${escapeMarkdownV2Amount(balance)} SOL\\.\n\n` +
            `You need at least 0\\.001 SOL for deposits\\.\n\n` +
            `_Please deposit SOL to your wallet first\\._`
        );
        return ctx.scene.leave();
    }

    state.userBalance = balance;

    await ctx.replyWithMarkdownV2(
        `💰 *Deposit to ${escapeMarkdownV2(pot.name)}*\n\n` +
        `*Your Balance:* ${escapeMarkdownV2Amount(balance)} SOL\n\n` +
        `How much SOL do you want to deposit\\?\n\n` +
        `Enter the amount in SOL \\(e\\.g\\., 0\\.5\\)`,
        Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", "wizard_cancel_deposit")]
        ])
    );

    await ctx.answerCbQuery();
    ctx.wizard.selectStep(2);
})

depositSolToVaultWizard.action("wizard_confirm_deposit", async (ctx) => {
    const state = ctx.wizard.state as DepositWizardState;
    const { potId, amount, userId } = state;

    try {
        await ctx.answerCbQuery("Processing deposit...");
        const processingMsg = await ctx.reply("⏳ Processing your deposit...");

        const pot = await prismaClient.pot.findUnique({ where: { id: potId }});
        const user = await prismaClient.user.findUnique({ where: { id: userId }});

        if (!pot || !user) {
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply("❌ Something went wrong. Please try again.");
            return ctx.scene.leave();
        }

        const fromKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const toVault = JSON.parse(pot.vaultAddress);
        const toPublicKey = new PublicKey(toVault.publicKey);

        const { message, success } = await sendSol(fromKeypair, toPublicKey, amount);

        if (success) {
            try {
                const mintedShares = await mintSharesAndDeposit(
                    potId,
                    userId,
                    BigInt(amount * LAMPORTS_PER_SOL),
                );
                const newShares = mintedShares.sharesMinted;
                const totalUserShares = mintedShares.userNewShares;
                const totalPotShares = mintedShares.newTotalShares;

                const userPercentage = ((Number(totalUserShares) / Number(totalPotShares)) * 100).toFixed(2);
                const newSharesPercentage = ((Number(newShares) / Number(totalPotShares)) * 100).toFixed(2);
                
                await ctx.deleteMessage(processingMsg.message_id);
                
                await ctx.replyWithMarkdownV2(
                    `✅ *Deposit Successful\\!*\n\n` +
                    `*Amount Deposited:* ${escapeMarkdownV2Amount(amount)} SOL\n` +
                    `*New Shares Minted:* ${escapeMarkdownV2(newShares.toString())} \\(${escapeMarkdownV2(newSharesPercentage)}%\\)\n` +
                    `*Your Total Shares:* ${escapeMarkdownV2(totalUserShares.toString())} \\(${escapeMarkdownV2(userPercentage)}%\\)\n` +
                    `*Pot Total Shares:* ${escapeMarkdownV2(totalPotShares.toString())}\n\n` +
                    `_Deposit recorded in pot ledger\\._`
                );
            } catch (e: any) {
                await ctx.deleteMessage(processingMsg.message_id);
                await ctx.reply(`❌ ${e.message}`);
            }
        } else {
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply(`❌ Deposit failed: ${message}`);
        }
    } catch (error) {
        console.error(error);
        await ctx.reply("❌ Something went wrong while processing deposit.");
    }

    return ctx.scene.leave();
})

depositSolToVaultWizard.action("wizard_cancel_deposit", async (ctx) => {
  await ctx.reply("❌ Deposit cancelled.");
  await ctx.answerCbQuery("Cancelled");
  return ctx.scene.leave();
});

export async function mintSharesAndDeposit(
    potId: string,
    userId: string,
    lamportsDeposited: bigint
): Promise<{
    sharesMinted: bigint;
    newTotalShares: bigint;
    userNewShares: bigint;
    sharePrice: number;
}> {
    return await prismaClient.$transaction(async (tx) => {
        const pot = await tx.pot.findUnique({
            where: { id: potId },
            include: {
                assets: true,
                members: {
                    where: { 
                        userId,
                        potId
                    }
                }
            }
        });

        if (!pot) throw new Error ("Pot not found");
        const isAdmin = pot?.adminId == userId;
        const role = isAdmin ? "ADMIN" : "MEMBER";

        let member = pot.members[0];
        if (!member) {
            member = await tx.pot_Member.create({
                data: {
                    potId,
                    userId,
                    role
                }
            })
        }

        const existingSolAsset = pot.assets.find(a => a.mintAddress === SOL_MINT);
        
        if (existingSolAsset) {
            const newBalance = existingSolAsset.balance + lamportsDeposited;
            await tx.asset.update({
                where: { id: existingSolAsset.id },
                data: { balance: newBalance }
            });
        } else {
            await tx.asset.create({
                data: {
                    potId,
                    mintAddress: SOL_MINT,
                    balance: lamportsDeposited,
                },
            });
        }

        const solUSD = await getPriceInUSD(SOL_MINT);

        const potValueBeforeDeposit = await computePotValueInUSD(
            pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance })),
        )

        const depositUSD = Number(lamportsDeposited) / LAMPORTS_PER_SOL * solUSD;
        const totalSharesBefore = pot.totalShares;

        let sharesToMint: bigint;
        let sharePrice: number;

        if (totalSharesBefore === BigInt(0) || potValueBeforeDeposit === 0) {
            // 1 share = $1
            sharesToMint = BigInt(Math.floor(depositUSD * 1e6));
            sharePrice = depositUSD / Number(sharesToMint);
        } else {
            const potValueBeforeDeposit = await computePotValueInUSD(
                pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance }))
            );
            
            if (potValueBeforeDeposit <= 0) {
                throw new Error("Pot has zero or negative value, cannot accept deposits");
            }

            sharePrice = potValueBeforeDeposit / Number(totalSharesBefore);

            sharesToMint = BigInt(Math.floor(depositUSD / sharePrice));
        }

        if (sharesToMint === BigInt(0)) {
            throw new Error(
                `Deposit too small: $${depositUSD.toFixed(2)} would mint 0 shares. ` +
                `Minimum deposit: $${((1 / 1e6) * (Number(totalSharesBefore) / potValueBeforeDeposit)).toFixed(6)}`
            );
        }

        const newTotalShares = totalSharesBefore + sharesToMint;
        await tx.pot.update({
            where: { id: potId },
            data: { totalShares: newTotalShares },
        });

        const newUserShares = member.shares + sharesToMint;
        await tx.pot_Member.update({
            where: { id: member.id },
            data: { shares: newUserShares },
        });

        await tx.deposit.create({
            data: {
                potId,
                userId,
                amount: lamportsDeposited,
                sharesMinted: sharesToMint,
            }
        });

        return {
            sharesMinted: sharesToMint,
            newTotalShares: newTotalShares,
            userNewShares: newUserShares,
            sharePrice: sharePrice
        };
    }, {
        isolationLevel: "Serializable",
        timeout: 30000
    });
}
export async function getPriceInUSD(mintAddress: string): Promise<number> {
  const jupiterResponse = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mintAddress}`);
  const jupiterData = await jupiterResponse.json() as Record<string, {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h: number;
  }>;
  
  if (!jupiterData[mintAddress]?.usdPrice) {
    throw new Error(`Price not found for ${mintAddress}`);
  }
  
  return Number(jupiterData[mintAddress].usdPrice);
}import { getPriceInUSD } from "./getPriceInUSD";
import { getTokenDecimalsWithCache } from "./getTokenDecimals";

export async function computePotValueInUSD(
    assets: Array<{
        mintAddress: string;
        balance: bigint
    }>
): Promise<number> {
    let totalUSD = 0;

    for (const { mintAddress, balance } of assets) {
        if (balance === BigInt(0)) continue;

        let priceUSD = await getPriceInUSD(mintAddress);

        const decimals = await getTokenDecimalsWithCache(mintAddress);
        const balanceNumber = Number(balance) / (10 ** decimals);
        totalUSD += balanceNumber * priceUSD;
    }

    return totalUSD;
}
3. Withdraw Wizard: import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { computePotValueInUSD } from "../solana/computePotValueInUSD";
import { getTokenDecimalsWithCache } from "../solana/getTokenDecimals";
import type { BotContext, WithdrawalWizardState } from "../lib/types";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { Keypair } from "@solana/web3.js";
import { getUserPosition } from "../solana/getUserPosition";
import { transferAssets } from "../solana/transferAssets";
import { CHECK_BALANCE_KEYBOARD } from "../keyboards/keyboards";


export const withdrawFromVaultWizard = new Scenes.WizardScene<BotContext>(
    "withdraw_from_vault_wizard",

    // 1 -> show user's pots
    async (ctx) => {
        try {
            const state = ctx.wizard.state as WithdrawalWizardState;
            const existingUser = await prismaClient.user.findFirst({
                where: {
                    telegramUserId: ctx.from?.id.toString()
                }
            });

            if (!existingUser) {
                await ctx.reply("User not found. Please register first.");
                return ctx.scene.leave();
            }

            const pots = await prismaClient.pot.findMany({
                where: {
                    isGroupAdded: true,
                    inviteLink: { not: null },
                    OR: [
                        {
                            members: {
                                some: {
                                    userId: existingUser.id,
                                    shares: { gt: 0 }
                                },
                            },
                        },
                        {
                            adminId: existingUser.id,
                        },
                    ]
                },
                select: {
                    id: true,
                    name: true,
                }
            });

            if (!pots.length) {
                await ctx.reply("You don't have any shares in active pots.");
                return ctx.scene.leave();
            }

            const buttons: any[][] = [];
            for (let i = 0; i < pots.length; i += 2) {
                const row = pots
                    .slice(i, i + 2)
                    .map((pot) =>
                        Markup.button.callback(
                            pot.name || `Pot ${i + 1}`,
                            `wizard_select_withdraw_pot_${pot.id}`
                        )
                    );
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("❌ Cancel", "wizard_cancel_withdrawal")]);

            await ctx.reply(
                "*Please select a pot to withdraw from:*",
                {
                    parse_mode: "MarkdownV2",
                    ...Markup.inlineKeyboard(buttons),
                }
            );

            state.userId = existingUser.id;
            return ctx.wizard.next();
        } catch (e) {
            console.error(e);
            await ctx.reply("Something went wrong while fetching your pots.");
            return ctx.scene.leave();
        }
    },

    // 2 -> Waiting for pot selection 
    async (ctx) => {},

    async (ctx) => {
        const state = ctx.wizard.state as WithdrawalWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid amount or press Cancel.");
        }

        let sharesToBurn: bigint;

        if (text.endsWith("%")) {
            const percentage = parseFloat(text.slice(0, -1));
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                return ctx.reply("❌ Please enter a valid percentage between 0 and 100 (e.g., 50%)");
            }

            sharesToBurn = BigInt(Math.floor(Number(state.userShares) * (percentage / 100)));
        } else {
            const sharesInput = parseFloat(text);
            if (isNaN(sharesInput) || sharesInput <= 0) {
                return ctx.reply("❌ Please enter a valid number of shares or percentage (e.g., 1000000 or 50%)");
            }

            sharesToBurn = BigInt(Math.floor(sharesInput));
        }

        if (sharesToBurn === BigInt(0)) {
            return ctx.reply("❌ Amount too small. Please enter a larger value.");
        }

        if (sharesToBurn > state.userShares) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Shares*\n\n` +
                `You're trying to withdraw ${escapeMarkdownV2(sharesToBurn.toString())} shares\\.\n` +
                `You only have ${escapeMarkdownV2(state.userShares.toString())} shares\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        state.sharesToBurn = sharesToBurn;

        try {
            const preview = await getWithdrawalPreview(state.potId, state.userId, sharesToBurn);

            let assetsMessage = "*Assets you will receive:*\n\n";
            for (const asset of preview.assetsToReturn) {
                const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112" 
                    ? "SOL" 
                    : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);
                assetsMessage += `• ${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n`;
            }

            await ctx.replyWithMarkdownV2(
                `💰 *Withdrawal Confirmation*\n\n` +
                `*Pot:* ${escapeMarkdownV2(state.potName)}\n` +
                `*Shares to Burn:* ${escapeMarkdownV2(sharesToBurn.toString())} \\(${escapeMarkdownV2(preview.withdrawalPercentage.toFixed(2))}% of total pot\\)\n` +
                `*Estimated Value:* \\~\\$${escapeMarkdownV2Amount(preview.valueUSD)}\n\n` +
                assetsMessage + `\n` +
                `⚠️ _Note: You will receive a proportional share of ALL assets in the pot\\. If you want to convert to a single asset, you can do so later\\._`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Confirm", "wizard_confirm_withdrawal"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_withdrawal")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            await ctx.reply(`${error.message}`)
            return;
        }
    },

    // 4. wait for confirmation
    async (ctx) => {},
);

withdrawFromVaultWizard.action(/wizard_select_withdraw_pot_(.+)/, async (ctx) => {
    const state = ctx.wizard.state as WithdrawalWizardState;
    const potId = ctx.match[1];

    try {
        const pot = await prismaClient.pot.findUnique({
            where: { id: potId },
            include: {
                members: {
                    where: {
                        userId: state.userId,
                        potId: potId
                    }
                }
            }
        });

        if (!pot) {
            await ctx.reply("This pot no longer exists.");
            return ctx.scene.leave();
        }

        const member = pot.members[0];
        if (!member || member.shares === BigInt(0)) {
            await ctx.reply("You don't have any shares in this pot.");
            return ctx.scene.leave();
        }

        state.potId = pot.id;
        state.potName = pot.name;
        state.userShares = member.shares;

        const position = await getUserPosition(potId || pot.id, state.userId);

        await ctx.replyWithMarkdownV2(
            `📊 *Your Position in ${escapeMarkdownV2(pot.name)}*\n\n` +
            `*Your Shares:* ${escapeMarkdownV2(position.shares.toString())} \\(${escapeMarkdownV2(position.sharePercentage.toFixed(2))}%\\)\n` +
            `*Current Value:* \\~\\$${escapeMarkdownV2Amount(position.valueUSD)}\n` +
            `*Share Price:* \\$${escapeMarkdownV2((position.sharePrice).toFixed(6))} per share\n\n` +
            `How much would you like to withdraw\\?\n\n` +
            `You can enter:\n` +
            `• *Percentage* \\(e\\.g\\., \`50%\` for half\\)\n` +
            `• *Exact shares* \\(e\\.g\\., \`${escapeMarkdownV2(Math.floor(Number(position.shares) / 2).toString())}\`\\)\n\n` +
            `⚠️ _You will receive a proportional share of ALL assets, not just one asset\\._`,
            Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel", "wizard_cancel_withdrawal")]
            ])
        );

        await ctx.answerCbQuery();
        ctx.wizard.selectStep(2);
    } catch (e) {
        console.error(e);
        await ctx.reply("Something went wrong. Please try again.");
        return ctx.scene.leave();
    }
});

withdrawFromVaultWizard.action("wizard_confirm_withdrawal", async (ctx) => {
    const state = ctx.wizard.state as WithdrawalWizardState;
    const { potId, userId, sharesToBurn } = state;

    try {
        await ctx.answerCbQuery("Processing withdrawal...");
        const processingMsg = await ctx.reply("⏳ Processing withdrawal...");

        const withdrawal = await burnSharesAndWithdraw(potId, userId, sharesToBurn);

        const user = await prismaClient.user.findUnique({
            where: {
                id: userId
            }
        })
        if (!user) {
            await ctx.reply("User not found.");
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

        const pot = await prismaClient.pot.findUnique({
            where: {
                id: potId
            }
        })
        if (!pot) {
            await ctx.reply("Pot not found.");
            return ctx.scene.leave();
        }

        const vaultData = JSON.parse(pot.vaultAddress);
        const vaultKeypair = Keypair.fromSecretKey(decodeSecretKey(vaultData.secretKey));

        const transferResults = await transferAssets(
            vaultKeypair,
            userKeypair.publicKey,
            withdrawal.assetsToReturn
        );

        let assetsMessage = "";
        for (let i = 0; i < transferResults.length; i++) {
            const result = transferResults[i];
            const asset = withdrawal.assetsToReturn[i];
            const symbol = asset?.mintAddress === "So11111111111111111111111111111111111111112"
                ? "SOL"
                : asset?.mintAddress.slice(0, 4) + "..." + asset?.mintAddress.slice(-4);

            if (result && result.success) {
                const txLink = result.txId 
                    ? `[View Transaction](https://explorer.solana.com/tx/${result.txId}?cluster=devnet)`
                    : "";
                assetsMessage += `✅ ${escapeMarkdownV2Amount(asset?.amountReadable ?? 0)} ${escapeMarkdownV2(symbol)} ${txLink}\n`;
            } else {
                assetsMessage += `❌ ${escapeMarkdownV2Amount(asset?.amountReadable ?? 0)} ${escapeMarkdownV2(symbol)} \\- Failed\n`;
            }
        }

        interface TransferResult {
            success: boolean;
            txId?: string;
            error?: string;
        }

        const successCount: number = (transferResults as TransferResult[]).filter((r: TransferResult) => r.success).length;
        const failCount = transferResults.length - successCount;

        await ctx.deleteMessage(processingMsg.message_id);

        await ctx.replyWithMarkdownV2(
            `✅ *Withdrawal Complete\\!*\n\n` +
            `*Shares Burned:* ${escapeMarkdownV2(withdrawal.sharesBurned.toString())}\n` +
            `*Total Value:* \\~\\$${escapeMarkdownV2Amount(withdrawal.valueUSD)}\n\n` +
            `*Assets Transferred:*\n${assetsMessage}\n` +
            (failCount > 0 ? `⚠️ ${failCount} transfer\\(s\\) failed\\. Please contact support\\.` : ``),
            {
                ...CHECK_BALANCE_KEYBOARD
            }
        );
    } catch (error: any) {
        console.error(error);
        await ctx.reply(`❌ Withdrawal failed: ${error.message}`);
    }

    return ctx.scene.leave();
})

withdrawFromVaultWizard.action("wizard_cancel_withdrawal", async (ctx) => {
    await ctx.reply("❌ Withdrawal cancelled.");
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});

async function getWithdrawalPreview(
    potId: string,
    userId: string,
    sharesToBurn: bigint
) : Promise<{
    withdrawalPercentage: number;
    valueUSD: number;
    assetsToReturn: Array<{
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    }>;
}> {
    const pot = await prismaClient.pot.findUnique({
        where: { id: potId },
        include: {
            assets: true,
            members: {
                where: { userId, potId }
            }
        }
    });

    if (!pot) throw new Error("Pot not found");

    const member = pot.members[0];
    if (!member) throw new Error("You are not a member of this pot");

    if (member.shares < sharesToBurn) {
        throw new Error(
            `Insufficient shares. You have ${member.shares.toString()} shares, tried to burn ${sharesToBurn.toString()}`
        );
    }

    const withdrawalPercentage = (Number(sharesToBurn) / Number(pot.totalShares)) * 100;

    const potValueUSD = await computePotValueInUSD(
        pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance }))
    );

    const valueUSD = potValueUSD * (Number(sharesToBurn) / Number(pot.totalShares));

    const { getTokenDecimalsWithCache } = await import("../solana/getTokenDecimals");
    const assetsToReturn: Array<{
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    }> = [];

    for (const asset of pot.assets) {
        if (asset.balance === BigInt(0)) continue;

        const amountToReturn = BigInt(
            Math.floor(Number(asset.balance) * Number(sharesToBurn) / Number(pot.totalShares))
        );

        if (amountToReturn === BigInt(0)) continue;

        const decimals = await getTokenDecimalsWithCache(asset.mintAddress);
        const amountReadable = Number(amountToReturn) / (10 ** decimals);

        assetsToReturn.push({
            mintAddress: asset.mintAddress,
            amount: amountToReturn,
            amountReadable
        });
    }

    return {
        withdrawalPercentage,
        valueUSD,
        assetsToReturn
    }
}

export async function burnSharesAndWithdraw(
    potId: string,
    userId: string,
    sharesToBurn: bigint
): Promise<{
    sharesBurned: bigint;
    valueUSD: number;
    assetsToReturn: Array<{
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    }>;
}> {
    return await prismaClient.$transaction(async (tx) => {
        const pot = await tx.pot.findUnique({
            where: { id: potId },
            include: {
                assets: true,
                members: {
                    where: {
                        userId,
                        potId
                    }
                }
            }
        })

        if (!pot) throw new Error("Pot not found");

        const member = pot.members[0];
        if (!member) throw new Error("You are not a member of this pot");

        if (member.shares < sharesToBurn) {
            throw new Error(
                `Insufficient shares. You have ${member.shares} shares, tried to burn ${sharesToBurn}`
            );
        }

        if (pot.totalShares === BigInt(0)) {
            throw new Error("Pot has no shares");
        }

        const withdrawalPercentage = Number(sharesToBurn) / Number(pot.totalShares);

        const potValueUSD = await computePotValueInUSD(
            pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance })),
        )

        const valueUSD = potValueUSD * withdrawalPercentage;

        const assetsToReturn: Array<{
            mintAddress: string;
            amount: bigint;
            amountReadable: number;
        }> = [];

        for (const asset of pot.assets) {
            if (asset.balance === BigInt(0)) continue;

            const amountToReturn = BigInt(
                Math.floor(Number(asset.balance) * withdrawalPercentage)
            );

            if (amountToReturn === BigInt(0)) continue;

            const decimals = await getTokenDecimalsWithCache(asset.mintAddress);
            const amountReadable = Number(amountToReturn) / (10 ** decimals);

            assetsToReturn.push({
                mintAddress: asset.mintAddress,
                amount: amountToReturn,
                amountReadable
            });

            await tx.asset.update({
                where: { id: asset.id },
                data: {
                    balance: asset.balance - amountToReturn
                }
            });
        }

        // burn shares
        const newTotalShares = pot.totalShares - sharesToBurn;
        await tx.pot.update({
            where: { id: potId },
            data: { totalShares: newTotalShares },
        });

        const newUserShares = member.shares - sharesToBurn;
        await tx.pot_Member.update({
            where: { id: member.id },
            data: { shares: newUserShares }
        });

        const withdrawal = await tx.withdrawal.create({
            data: {
                potId,
                userId,
                sharesBurned: sharesToBurn,
                amountOut: BigInt(Math.floor(valueUSD * 1e6))
            }
        });

        return {
            sharesBurned: sharesToBurn,
            valueUSD,
            assetsToReturn,
        };
    }, {
        isolationLevel: "Serializable",
        timeout: 30000,
    })
} import { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const connection = new Connection(process.env.RPC_URL!, 'confirmed');

async function getTokenProgramId(mintAddress: PublicKey): Promise<PublicKey> {
  // Fetch mint account info to determine owner program id
  const mintInfo = await connection.getAccountInfo(mintAddress);
  if (!mintInfo) throw new Error("Mint account not found");
  return mintInfo.owner;
}

export async function transferAssets(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    assets: Array<{
        mintAddress: string;
        amount: bigint;
    }>
): Promise<Array<{
    success: boolean;
    txId?: string;
    error?: string;
}>> {
    const results: Array<{ success: boolean; txId?: string; error?: string }> = [];

    for (const asset of assets) {
        try {
            if (asset.mintAddress === SOL_MINT){
                const result = await transferSOL(fromKeypair, toPublicKey, asset.amount);
                results.push(result);
            } else {
                const result = await transferSPLToken(
                    fromKeypair,
                    toPublicKey,
                    asset.mintAddress,
                    asset.amount
                );
                results.push(result);
            } 
        } catch (error: any) {
            console.error(`Failed to transfer ${asset.mintAddress}:`, error);
            results.push({ 
                success: false, 
                error: error.message || "Transfer failed" 
            });
        }
    }

    return results;
}

async function transferSOL(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    lamports: bigint
): Promise<{ success: boolean; txId?: string; error?: string }> {
    try {
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: toPublicKey,
                lamports: Number(lamports)
            }),
        ];

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        console.log(`SOL Transfer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        
        return { success: true, txId }
    } catch (error: any) {
        console.error("SOL transfer error:", error);
        return { success: false, error: error.message };
    }
}

async function transferSPLToken(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    mintAddress: string,
    amount: bigint
): Promise<{ success: boolean; txId?: string; error?: string }> {
    try {
        const mintPubkey = new PublicKey(mintAddress);
        const tokenProgramId = await getTokenProgramId(mintPubkey);

        const sourceTokenAccount = await getAssociatedTokenAddress(
            mintPubkey,
            fromKeypair.publicKey,
            false,
            tokenProgramId
        );

        const destinationTokenAccount = await getAssociatedTokenAddress(
            mintPubkey,
            toPublicKey,
            false,
            tokenProgramId
        );

        const instructions = [];

        try {
            await getAccount(connection, destinationTokenAccount);
        } catch (e: any) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    fromKeypair.publicKey,
                    destinationTokenAccount,
                    toPublicKey,
                    mintPubkey,
                    tokenProgramId
                )
            );
        }

        instructions.push(
            createTransferInstruction(
                sourceTokenAccount,
                destinationTokenAccount,
                fromKeypair.publicKey,
                Number(amount),
                [],
                tokenProgramId
            )
        );

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        
        console.log(`Token Transfer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        
        return { success: true, txId };
    } catch (error: any) {
        console.error("SPL token transfer error:", error);
        return { success: false, error: error.message };
    }
}import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const connection = new Connection(process.env.RPC_URL!, 'confirmed');

export async function sendSol(
    fromKeypair: Keypair, 
    to: PublicKey, 
    amount: number
) {
    try {
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: to,
                lamports: amount * LAMPORTS_PER_SOL 
            }),
        ];

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);

        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        console.log(`https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        return {
            success: true,
            message: `View Your Transaction here: https://explorer.solana.com/tx/${txId}?cluster=devnet`
        }
    } catch (error) {
        return {
            success: false,
            message: "Oops! Error Sending Sol"
        }
    }
}
import { prismaClient } from "../db/prisma";
import { computePotValueInUSD } from "./computePotValueInUSD";

export async function getUserPosition(
    potId: string,
    userId: string
): Promise<{
    shares: bigint;
    sharePercentage: number;
    valueUSD: number;
    sharePrice: number;
}> {
    const pot = await prismaClient.pot.findUnique({
        where: { id: potId },
        include: {
            assets: true,
            members: {
                where: {
                    userId,
                    potId
                }
            }
        }
    });

    if (!pot) throw new Error("Pot not found");
    
    const member = pot.members[0];
    if (!member) {
        return { 
            shares: BigInt(0), 
            sharePercentage: 0, 
            valueUSD: 0,
            sharePrice: 0,
        };
    }

    const totalPotValueUSD = await computePotValueInUSD(
        pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance }))
    );

    const sharePercentage = pot.totalShares === BigInt(0)
        ? 0
        : Number(member.shares) / Number(pot.totalShares);

    const valueUSD = totalPotValueUSD * sharePercentage;
    const sharePrice = pot.totalShares === BigInt(0)
        ? 0
        : totalPotValueUSD / Number(pot.totalShares)

    return {
        shares: member.shares,
        sharePercentage: sharePercentage * 100,
        valueUSD,
        sharePrice
    }
}