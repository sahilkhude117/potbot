import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { Markup, Scenes } from "telegraf";
import type { BotContext, BuyTokenGroupWizardState } from "../lib/types";
import { prismaClient } from "../db/prisma";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";
import { SOL_MINT } from "../lib/statits";
import { executeSwap, getQuote } from "../solana/swapAssetsWithJup";

const connection = new Connection(process.env.MAINNET_RPC_URL!, "confirmed");

const tradeLocks = new Map<string, { userId: string, timestamp: number }>();
const LOCK_TIMEOUT = 5 * 60 * 1000;

function acquireTradeLock(potId: string, userId: string): boolean {
    const existing = tradeLocks.get(potId);
    const now = Date.now();

    if (existing && (now - existing.timestamp > LOCK_TIMEOUT)) {
        tradeLocks.delete(potId);
        return acquireTradeLock(potId, userId);
    }

    if (existing && existing.userId !== userId) {
        return false;
    }

    tradeLocks.set(potId, { userId, timestamp: now});
    return true;
}

function releaseTradeLock(potId: string, userId: string): void {
    const existing = tradeLocks.get(potId);
    if (existing && existing.userId === userId) {
        tradeLocks.delete(potId);
    }
}

function isLocked(potId: string, userId: string): { locked: boolean; lockedBy?: string } {
    const existing = tradeLocks.get(potId);
    if (!existing) return { locked: false };
    
    const now = Date.now();
    if (now - existing.timestamp > LOCK_TIMEOUT) {
        tradeLocks.delete(potId);
        return { locked: false };
    }
    
    if (existing.userId === userId) {
        return { locked: false }; 
    }
    
    return { locked: true, lockedBy: existing.userId };
}

export const buyTokenWithSolWizardGroup = new Scenes.WizardScene<BotContext>(
    'buy_token_with_sol_wizard_group',

    async (ctx) => {
        try {
            const telegramUserId = ctx.from?.id.toString();
            const chatId = ctx.chat?.id.toString();

            if (!telegramUserId || !chatId) {
                await ctx.reply("❌ Unable to identify user or chat.");
                return ctx.scene.leave();
            }

            const user = await prismaClient.user.findFirst({
                where: { telegramUserId }
            });

            if (!user) {
                await ctx.reply("❌ User not found. Please register first using /start in private chat.");
                return ctx.scene.leave();
            }

            const pot = await prismaClient.pot.findFirst({
                where: { telegramGroupId: chatId },
                include: {
                    admin: true,
                    members: {
                        where: { userId: user.id },
                        include: { user: true }
                    }
                }
            });

            if (!pot) {
                await ctx.reply("❌ This group is not registered as a pot. Please create a pot first.");
                return ctx.scene.leave();
            }

            const isAdmin = pot.adminId === user.id;
            const member = pot.members[0];
            const isTrader = member && member.role === "TRADER";

            if (!isAdmin && !isTrader) {
                await ctx.reply(
                    "🚫 *Access Denied*\n\n" +
                    "Only pot admins and designated traders can execute trades.\n\n" +
                    "_Ask an admin to grant you trader permissions._",
                    { parse_mode: "Markdown" }
                );
                return ctx.scene.leave();
            }

            const lockStatus = isLocked(pot.id, user.id);
            if (lockStatus.locked) {
                await ctx.reply(
                    "⏳ *Trade in Progress*\n\n" +
                    "Another trader is currently executing a trade.\n" +
                    "Please wait until they complete their transaction.\n\n" +
                    "_This prevents conflicting transactions._",
                    { parse_mode: "Markdown" }
                );
                return ctx.scene.leave();
            }

            if (!acquireTradeLock(pot.id, user.id)) {
                await ctx.reply("❌ Failed to acquire trade lock. Please try again.");
                return ctx.scene.leave();
            }

            const vault = JSON.parse(pot.vaultAddress);
            const vaultPrivateKey = vault.secretKey;

            const vaultKeypair = Keypair.fromSecretKey(decodeSecretKey(vaultPrivateKey));
            const { balance, empty } = await getBalanceMessage(vaultKeypair.publicKey.toString());

            if (empty || balance < 0.001) {
                releaseTradeLock(pot.id, user.id);
                await ctx.replyWithMarkdownV2(
                    `❌ *Insufficient Vault Balance*\n\n` +
                    `Vault has only ${escapeMarkdownV2Amount(balance)} SOL\\.\n\n` +
                    `_Deposit more SOL to the vault first\\._`
                );
                return ctx.scene.leave();
            }

            const state = ctx.wizard.state as BuyTokenGroupWizardState;
            state.userId = user.id;
            state.potId = pot.id;
            state.vaultBalance = balance;
            state.isAdmin = isAdmin;
            state.vaultPrivateKey = vaultPrivateKey;

            await ctx.replyWithMarkdownV2(
                `🔒 *Trade Lock Acquired*\n\n` +
                `*Buy Token with Vault SOL*\n\n` +
                `*Vault Balance:* ${escapeMarkdownV2Amount(balance)} SOL\n\n` +
                `Please enter the *token mint address* you want to buy\\.\n\n` +
                `_You can find token addresses on_ [CryptoRank](https://cryptorank.io/blockchains/solana)\n\n` +
                `⚠️ _The chat is now locked\\. Only you can complete this trade\\._`,
                { 
                    parse_mode: "MarkdownV2",
                    link_preview_options: { is_disabled: true },
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Cancel Trade", "wizard_cancel_group_buy")]
                    ])
                }
            );

            return ctx.wizard.next();   
        } catch (error) {
            console.error("Group wizard init error:", error);
            await ctx.reply("❌ Something went wrong. Please try again.");
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenGroupWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid token mint address or press Cancel.");
        }

        try {
            new PublicKey(text);
        } catch (error) {
            return ctx.reply(
                "❌ Invalid token mint address.\n\n" +
                "Please enter a valid Solana address (base58 format)."
            );
        }

        if (text === SOL_MINT) {
            return ctx.reply("❌ Cannot buy SOL with SOL. Enter a different token mint address.");
        }

        state.tokenMint = text;

        await ctx.replyWithMarkdownV2(
            `✅ Token mint address saved\\!\n\n` +
            `📊 *How much SOL do you want to spend?*\n\n` +
            `💰 *Available:* ${escapeMarkdownV2Amount(state.vaultBalance)} SOL\n\n` +
            `Enter the amount in SOL \\(e\\.g\\., 0\\.5\\)`,
            Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel", "wizard_cancel_group_buy")]
            ])
        );

        return ctx.wizard.next();
    },

    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenGroupWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();
        const quantity = parseFloat(text ?? '');

        if (isNaN(quantity) || quantity <= 0) {
            return ctx.reply("❌ Please enter a valid number (e.g., 0.5)");
        }

        const lamports = quantity * LAMPORTS_PER_SOL;
        if (lamports < 1) {
            return ctx.reply("❌ Amount too small — must be at least 0.000000001 SOL.");
        }

        if (quantity > state.vaultBalance) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Vault Balance*\n\n` +
                `You're trying to spend ${escapeMarkdownV2Amount(quantity)} SOL\\.\n` +
                `Vault has only ${escapeMarkdownV2Amount(state.vaultBalance)} SOL\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        const minReserve = 0.005;
        if (quantity > state.vaultBalance - minReserve) {
            await ctx.replyWithMarkdownV2(
                `❌ *Reserve SOL for Fees*\n\n` +
                `Keep at least ${escapeMarkdownV2Amount(minReserve)} SOL for transaction fees\\.\n\n` +
                `Maximum you can spend: ${escapeMarkdownV2Amount(state.vaultBalance - minReserve)} SOL`
            );
            return;
        }

        state.quantity = quantity;

        const loadingMsg = await ctx.reply("⏳ Fetching quote from Jupiter...")

        try {
            const pot = await prismaClient.pot.findUnique({
                where: { id: state.potId }
            });

            if (!pot) {
                throw new Error("Pot not found");
            }

            const vaultKeypair = Keypair.fromSecretKey(decodeSecretKey(state.vaultPrivateKey));

            const quoteResponse = await getQuote(
                SOL_MINT,
                state.tokenMint,
                Math.floor(state.quantity * LAMPORTS_PER_SOL),
                vaultKeypair.publicKey.toString()
            )

            state.quoteData = quoteResponse;

            const inputAmount = Number(quoteResponse.inAmount) / LAMPORTS_PER_SOL;
            const outputAmount = Number(quoteResponse.outAmount);
            const priceImpact = quoteResponse.priceImpactPct || "0";
            const usdValue = quoteResponse.swapUsdValue || "0";

            const outputDecimals = 6;
            const outputAmountFormatted = outputAmount / Math.pow(10, outputDecimals);

            await ctx.deleteMessage(loadingMsg.message_id);

            await ctx.replyWithMarkdownV2(
                `💰 *Swap Quote*\n\n` +
                `*Vault Pays:* ${escapeMarkdownV2Amount(inputAmount)} SOL\n` +
                `*Vault Receives:* ≈ ${escapeMarkdownV2Amount(outputAmountFormatted)} tokens\n` +
                `*USD Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `*Price Impact:* ${escapeMarkdownV2(priceImpact)}%\n` +
                `*Slippage Tolerance:* ${escapeMarkdownV2((quoteResponse.slippageBps / 100).toString())}%\n` +
                `🪙 *Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
                `⚠️ *This trade will be recorded and visible to all pot members\\.*\n\n` +
                `Do you want to proceed?`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Execute Trade", "wizard_confirm_group_buy"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_group_buy")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            console.error("Quote error:", error);
            await ctx.deleteMessage(loadingMsg.message_id);
            await ctx.reply(
                `❌ Failed to get quote. Possible reasons:\n\n` +
                `• Invalid token address\n` +
                `• Insufficient liquidity\n` +
                `• Token not tradable on Jupiter\n\n` +
                `Please try again with a different token.`
            );
            
            // Release lock on error
            releaseTradeLock(state.potId, state.userId);
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
        // This step is just a holder for the action handlers
    }
);

buyTokenWithSolWizardGroup.action("wizard_confirm_group_buy", async (ctx) => {
    const state = ctx.wizard.state as BuyTokenGroupWizardState;

    try {
        await ctx.answerCbQuery("Processing trade...");
        const processingMsg = await ctx.reply("⏳ Executing swap on Jupiter...");

        const pot = await prismaClient.pot.findUnique({
            where: { id: state.potId },
            include: {
                members: {
                    where: {
                        userId: state.userId
                    }
                }
            }
        })

        if (!pot) {
            throw new Error("Pot not found");
        }

        const member = pot.members[0];
        if (!member && pot.adminId !== state.userId) {
            throw new Error("Unauthorized");
        }

        const vaultKeypair = Keypair.fromSecretKey(decodeSecretKey(state.vaultPrivateKey));

        const swapTransaction = await executeSwap(
            state.quoteData,
            vaultKeypair.publicKey.toString()
        );

        const tx = VersionedTransaction.deserialize(
            Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0))
        );
        tx.sign([vaultKeypair]);

        const signature = await connection.sendTransaction(tx);

        await prismaClient.trade.create({
            data: {
                potId: state.potId,
                traderId: member?.id || pot.adminId,
                inMint: SOL_MINT,
                inAmount: BigInt(Math.floor(state.quantity * LAMPORTS_PER_SOL)),
                outMint: state.tokenMint,
                outAmount: BigInt(state.quoteData.outAmount),
                txSignature: signature,
                status: "COMPLETED"
            }
        })

        await prismaClient.asset.upsert({
            where: {
                potId_mintAddress: {
                    potId: state.potId,
                    mintAddress: state.tokenMint
                }
            },
            update: {
                balance: {
                    increment: BigInt(state.quoteData.outAmount)
                }
            },
            create: {
                potId: state.potId,
                mintAddress: state.tokenMint,
                balance: BigInt(state.quoteData.outAmount)
            }
        });

        await prismaClient.asset.update({
            where: {
                potId_mintAddress: {
                    potId: state.potId,
                    mintAddress: SOL_MINT
                }
            },
            data: {
                balance: {
                    decrement: BigInt(state.quoteData.inAmount)
                }
            }
        });

        await ctx.deleteMessage(processingMsg.message_id);

        const inputAmount = Number(state.quoteData.inAmount) / LAMPORTS_PER_SOL;
        const outputAmount = Number(state.quoteData.outAmount);
        const usdValue = state.quoteData.swapUsdValue || "0";
        const outputDecimals = 6;
        const outputAmountFormatted = outputAmount / Math.pow(10, outputDecimals);

        await ctx.replyWithMarkdownV2(
            `✅ *Trade Executed Successfully\\!*\n\n` +
            `*Vault Spent:* ${escapeMarkdownV2Amount(inputAmount)} SOL\n` +
            `*Vault Received:* ≈ ${escapeMarkdownV2Amount(outputAmountFormatted)} tokens\n` +
            `*Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
            `*Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
            `🔗 [View on Solana Explorer](https://explorer.solana.com/tx/${escapeMarkdownV2(signature)})\n\n` +
            `_Trade recorded in pot ledger\\._`,
            {
                parse_mode: "MarkdownV2",
            }
        );

        // Release lock
        releaseTradeLock(state.potId, state.userId);
    } catch (error: any) {
        console.error("Group swap error:", error);
        
        let errorMsg = "❌ *Trade Failed*\n\n";
        
        if (error.message?.includes("slippage")) {
            errorMsg += "⚠️ Price moved beyond slippage tolerance\\.\n\n";
            errorMsg += "_Market conditions changed\\. Try again\\._";
        } else if (error.message?.includes("insufficient")) {
            errorMsg += "⚠️ Insufficient balance for transaction\\.\n\n";
            errorMsg += `_Vault needs more SOL for fees\\._`;
        } else {
            errorMsg += `⚠️ Transaction failed\\.\n\n`;
            errorMsg += `_${escapeMarkdownV2(error.message?.substring(0, 100) || "Network error")}_`;
        }
        
        await ctx.replyWithMarkdownV2(errorMsg);

        // Record failed trade
        try {
            const pot = await prismaClient.pot.findUnique({
                where: { id: state.potId },
                include: { members: { where: { userId: state.userId } } }
            });

            if (pot) {
                const member = pot.members[0];
                await prismaClient.trade.create({
                    data: {
                        potId: state.potId,
                        traderId: member?.id || pot.adminId,
                        inMint: SOL_MINT,
                        inAmount: BigInt(Math.floor(state.quantity * LAMPORTS_PER_SOL)),
                        outMint: state.tokenMint,
                        outAmount: BigInt(0),
                        txSignature: `failed_${Date.now()}`,
                        status: 'FAILED'
                    }
                });
            }
        } catch (dbError) {
            console.error("Failed to record failed trade:", dbError);
        }

        // Release lock
        releaseTradeLock(state.potId, state.userId);
    }

    return ctx.scene.leave();
})

buyTokenWithSolWizardGroup.action("wizard_cancel_group_buy", async (ctx) => {
    const state = ctx.wizard.state as BuyTokenGroupWizardState;
    
    // Release lock
    if (state.potId && state.userId) {
        releaseTradeLock(state.potId, state.userId);
    }
    
    await ctx.reply("❌ Trade cancelled. Chat is now unlocked.");
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});

buyTokenWithSolWizardGroup.leave(async (ctx) => {
    const state = ctx.wizard.state as BuyTokenGroupWizardState;
    if (state?.potId && state?.userId) {
        releaseTradeLock(state.potId, state.userId);
    }
});
