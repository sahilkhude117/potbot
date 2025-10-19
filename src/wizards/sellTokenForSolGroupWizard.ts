import { Markup, Scenes } from "telegraf";
import type { BotContext, SellTokenGroupWizardState } from "../lib/types";
import { prismaClient } from "../db/prisma";
import { Keypair, LAMPORTS_PER_SOL, VersionedTransaction, PublicKey } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getUserTokenAccounts, getTokenMetadata } from "../solana/getTokenAccounts";
import { executeSwap, getQuote } from "../solana/swapAssetsWithJup";
import { getConnection } from "../solana/getConnection";
import { DEFAULT_GROUP_KEYBOARD } from "../keyboards/keyboards";

const connection = getConnection();

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

    tradeLocks.set(potId, { userId, timestamp: now });
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

export const sellTokenForSolWizardGroup = new Scenes.WizardScene<BotContext>(
    'sell_token_for_sol_wizard_group',

    async (ctx) => {
        try {
            const telegramUserId = ctx.from?.id.toString();
            const chatId = ctx.chat?.id.toString();

            if (!telegramUserId || !chatId) {
                await ctx.reply("❌ Unable to identify user or chat.", { ...DEFAULT_GROUP_KEYBOARD });
                return ctx.scene.leave();
            }

            const user = await prismaClient.user.findFirst({
                where: { telegramUserId }
            });

            if (!user) {
                await ctx.reply("❌ User not found. Please register first.", { ...DEFAULT_GROUP_KEYBOARD });
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
                await ctx.reply("❌ No pot found for this group.", { ...DEFAULT_GROUP_KEYBOARD });
                return ctx.scene.leave();
            }

            const isAdmin = pot.adminId === user.id;
            const member = pot.members[0];
            const isTrader = member && member.role === "TRADER";

            if (!isAdmin && !isTrader) {
                await ctx.reply(
                    "❌ *Access Denied*\n\n" +
                    "Only the pot admin or designated traders can sell tokens.\n\n" +
                    "_Contact the admin to be assigned as a trader._",
                    { parse_mode: "Markdown", ...DEFAULT_GROUP_KEYBOARD }
                );
                return ctx.scene.leave();
            }

            const lockStatus = isLocked(pot.id, user.id);
            if (lockStatus.locked) {
                await ctx.reply(
                    "⚠️ *Trade in Progress*\n\n" +
                    "Another trader is currently making a trade.\n\n" +
                    "_Please wait for them to complete or cancel._",
                    { ...DEFAULT_GROUP_KEYBOARD }
                );
                return ctx.scene.leave();
            }

            if (!acquireTradeLock(pot.id, user.id)) {
                await ctx.reply("❌ Failed to acquire trade lock. Please try again.", { ...DEFAULT_GROUP_KEYBOARD });
                return ctx.scene.leave();
            }

            // Validate pot data before proceeding
            if (!pot.admin?.publicKey || !pot.potSeed) {
                releaseTradeLock(pot.id, user.id);
                await ctx.reply(
                    "❌ Pot configuration is incomplete. Please contact the admin.",
                    { ...DEFAULT_GROUP_KEYBOARD }
                );
                return ctx.scene.leave();
            }

            const state = ctx.wizard.state as SellTokenGroupWizardState;
            state.userId = user.id;
            state.potId = pot.id;
            state.isAdmin = isAdmin;

            // Get pot vault PDA address to check token accounts
            const { getPotPDA } = await import("../solana/smartContract");
            
            let adminPubkey: PublicKey;
            let potSeedPublicKey: PublicKey;
            
            try {
                adminPubkey = new PublicKey(pot.admin.publicKey);
                potSeedPublicKey = new PublicKey(pot.potSeed);
            } catch (error) {
                releaseTradeLock(pot.id, user.id);
                await ctx.reply(
                    "❌ Invalid pot configuration. Please contact the admin.",
                    { ...DEFAULT_GROUP_KEYBOARD }
                );
                return ctx.scene.leave();
            }
            
            const [potPda] = getPotPDA(adminPubkey, potSeedPublicKey);

            const loadingMsg = await ctx.reply("⏳ Fetching vault tokens...");

            // Get token accounts owned by pot PDA
            const tokenAccounts = await getUserTokenAccounts(connection, potPda.toString());

            await ctx.deleteMessage(loadingMsg.message_id);

            // Filter out SOL (native mint) - can't trade SOL for SOL
            const tradableTokens = tokenAccounts.filter(token => token.mintAddress !== SOL_MINT);

            if (tradableTokens.length === 0) {
                await ctx.reply(
                    "❌ Vault has no tokens to sell.\n\n" +
                    (tokenAccounts.length > 0 
                        ? "Only SOL is available, which cannot be sold for SOL.\n\n"
                        : "") +
                    "Buy some tokens first using the Buy option.",
                    { ...DEFAULT_GROUP_KEYBOARD }
                );
                releaseTradeLock(pot.id, user.id);
                return ctx.scene.leave();
            }

            const buttons: any[][] = [];
            const fetchMetadataPromises = tradableTokens.map(async (token) => {
                const metadata = await getTokenMetadata(token.mintAddress);
                return { token, metadata };
            });

            const tokensWithMetadata = await Promise.all(fetchMetadataPromises);
            
            state.availableTokens = tokensWithMetadata.map(item => ({
                mintAddress: item.token.mintAddress,
                balance: item.token.uiAmount,
                decimals: item.token.decimals,
                symbol: item.metadata?.symbol || item.token.mintAddress.substring(0, 8)
            }));

            for (let i = 0; i < tokensWithMetadata.length; i += 2) {
                const row = [];
                
                for (let j = 0; j < 2 && i + j < tokensWithMetadata.length; j++) {
                    const item = tokensWithMetadata[i + j];
                    if (item) {
                        const { token, metadata } = item;
                        const displayName = metadata 
                            ? `${metadata.symbol} (${token.uiAmount.toFixed(2)})`
                            : `${token.mintAddress.substring(0, 6)}... (${token.uiAmount.toFixed(2)})`;
                        
                        row.push(
                            Markup.button.callback(
                                displayName,
                                `wsg_token_${i + j}`
                            )
                        );
                    }
                }
                
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("Cancel", "wizard_cancel_group_sell")]);

            await ctx.reply(
                "🔒 *Trade Lock Acquired*\n\n" +
                "*Sell Token from Vault*\n\n" +
                "🪙 *Select a token to sell:*\n\n" +
                "_Choose from vault's available tokens below_\n\n" +
                "⚠️ _The chat is now locked. Only you can complete this trade._",
                {
                    parse_mode: "Markdown",
                    ...Markup.inlineKeyboard(buttons)
                }
            );

            return ctx.wizard.next();
        } catch (error) {
            console.error("Group sell wizard init error:", error);
            await ctx.reply("❌ Something went wrong. Please try again.", { ...DEFAULT_GROUP_KEYBOARD });
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
    },

    async (ctx) => {
        const state = ctx.wizard.state as SellTokenGroupWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid amount or press Cancel.");
        }

        let quantity: number;

        if (text.endsWith("%")) {
            const percentage = parseFloat(text.slice(0, -1));
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                return ctx.reply("❌ Please enter a valid percentage between 0 and 100 (e.g., 50%)");
            }

            quantity = state.tokenBalance * (percentage / 100);
        } else {
            quantity = parseFloat(text);
            if (isNaN(quantity) || quantity <= 0) {
                return ctx.reply("❌ Please enter a valid number (e.g., 100 or 50%)");
            }
        }

        if (quantity > state.tokenBalance) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Vault Balance*\n\n` +
                `You're trying to sell ${escapeMarkdownV2Amount(quantity)} ${escapeMarkdownV2(state.tokenSymbol)}\\.\n` +
                `Vault has only ${escapeMarkdownV2Amount(state.tokenBalance)} ${escapeMarkdownV2(state.tokenSymbol)}\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        state.quantity = quantity;

        const loadingMsg = await ctx.reply("⏳ Fetching quote from Jupiter...");

        try {
            const pot = await prismaClient.pot.findUnique({
                where: { id: state.potId }
            });

            if (!pot) {
                await ctx.reply("❌ Pot not found.");
                return ctx.scene.leave();
            }

            // Get user (trader) keypair for quote
            const user = await prismaClient.user.findUnique({
                where: { id: state.userId }
            });

            if (!user) {
                await ctx.reply("❌ User not found.", { ...DEFAULT_GROUP_KEYBOARD });
                return ctx.scene.leave();
            }

            const traderKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

            const amountInSmallestUnit = Math.floor(quantity * Math.pow(10, state.tokenDecimals));

            const quoteResponse = await getQuote(
                state.tokenMint,
                SOL_MINT,
                amountInSmallestUnit,
                traderKeypair.publicKey.toString()
            );

            state.quoteData = quoteResponse;

            const inputAmount = Number(quoteResponse.inAmount) / Math.pow(10, state.tokenDecimals);
            const outputAmount = Number(quoteResponse.outAmount) / LAMPORTS_PER_SOL;
            const priceImpact = quoteResponse.priceImpactPct || "0";
            const usdValue = quoteResponse.swapUsdValue || "0";

            await ctx.deleteMessage(loadingMsg.message_id);

            await ctx.replyWithMarkdownV2(
                `💰 *Swap Quote*\n\n` +
                `*Vault Sells:* ${escapeMarkdownV2Amount(inputAmount)} ${escapeMarkdownV2(state.tokenSymbol)}\n` +
                `*Vault Receives:* ≈ ${escapeMarkdownV2Amount(outputAmount)} SOL\n` +
                `*USD Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `*Price Impact:* ${escapeMarkdownV2(priceImpact)}%\n` +
                `*Slippage Tolerance:* ${escapeMarkdownV2((quoteResponse.slippageBps / 100).toString())}%\n` +
                `🪙 *Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
                `⚠️ *This trade will be recorded and visible to all pot members\\.*\n\n` +
                `Do you want to proceed?`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Execute Trade", "wizard_confirm_group_sell"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_group_sell")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            console.error("Quote error:", error);
            await ctx.deleteMessage(loadingMsg.message_id);
            await ctx.reply(
                `❌ Failed to get quote. Possible reasons:\n\n` +
                `• Insufficient liquidity\n` +
                `• Token not tradable on Jupiter\n` +
                `• Network issues\n\n` +
                `Please try again with a different token or amount.`,
                { ...DEFAULT_GROUP_KEYBOARD }
            );
            
            releaseTradeLock(state.potId, state.userId);
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
    }
);

sellTokenForSolWizardGroup.action(/wsg_token_(\d+)/, async (ctx) => {
    const state = ctx.wizard.state as SellTokenGroupWizardState;
    const tokenIndex = parseInt(ctx.match?.[1] || "-1");

    if (tokenIndex < 0 || !state.availableTokens || tokenIndex >= state.availableTokens.length) {
        await ctx.reply("❌ Invalid token selection.", { ...DEFAULT_GROUP_KEYBOARD });
        return ctx.scene.leave();
    }

    try {
        const pot = await prismaClient.pot.findUnique({
            where: { id: state.potId },
            include: {
                members: {
                    where: {
                        userId: state.userId
                    }
                }
            }
        });

        if (!pot) {
            await ctx.reply("❌ Pot not found.");
            return ctx.scene.leave();
        }

        const member = pot.members[0];
        if (!member && pot.adminId !== state.userId) {
            await ctx.reply("❌ Access denied.");
            return ctx.scene.leave();
        }

        const selectedToken = state.availableTokens[tokenIndex];
        
        if (!selectedToken) {
            await ctx.reply("❌ Token not found.", { ...DEFAULT_GROUP_KEYBOARD });
            return ctx.scene.leave();
        }

        state.tokenMint = selectedToken.mintAddress;
        state.tokenBalance = selectedToken.balance;
        state.tokenDecimals = selectedToken.decimals;
        state.tokenSymbol = selectedToken.symbol;

        await ctx.answerCbQuery();

        await ctx.replyWithMarkdownV2(
            `✅ Token selected\\!\n\n` +
            `*Token:* ${escapeMarkdownV2(selectedToken.symbol)}\n` +
            `*Vault Balance:* ${escapeMarkdownV2Amount(selectedToken.balance)} ${escapeMarkdownV2(selectedToken.symbol)}\n\n` +
            `📊 *How much do you want to sell?*\n\n` +
            `You can enter:\n` +
            `• *Percentage* \\(e\\.g\\., \`50%\` for half\\)\n` +
                `• *Exact amount* \\(e\\.g\\., \`${escapeMarkdownV2((selectedToken.balance / 2).toFixed(2))}\`\\)`,
            Markup.inlineKeyboard([
                [Markup.button.callback("Cancel", "wizard_cancel_group_sell")]
            ])
        );        ctx.wizard.selectStep(2);
    } catch (error) {
        console.error(error);
        await ctx.reply("❌ Something went wrong. Please try again.", { ...DEFAULT_GROUP_KEYBOARD });
        return ctx.scene.leave();
    }
});

sellTokenForSolWizardGroup.action("wizard_confirm_group_sell", async (ctx) => {
    const state = ctx.wizard.state as SellTokenGroupWizardState;

    try {
        await ctx.answerCbQuery("Processing trade...");
        const processingMsg = await ctx.reply("⏳ Setting up trade authorization...");

        const pot = await prismaClient.pot.findUnique({
            where: { id: state.potId },
            include: {
                members: {
                    where: {
                        userId: state.userId
                    }
                },
                admin: true
            }
        });

        if (!pot) {
            await ctx.reply("❌ Pot not found.", { ...DEFAULT_GROUP_KEYBOARD });
            return ctx.scene.leave();
        }

        const member = pot.members[0];
        if (!member && pot.adminId !== state.userId) {
            await ctx.reply("❌ Access denied.", { ...DEFAULT_GROUP_KEYBOARD });
            return ctx.scene.leave();
        }

        // Get admin user to use admin's private key for setSwapDelegate
        const adminUser = await prismaClient.user.findUnique({
            where: { id: pot.adminId }
        });

        if (!adminUser) {
            throw new Error("Admin user not found");
        }

        // Get user (trader) details for the swap transaction
        const user = await prismaClient.user.findUnique({
            where: { id: state.userId }
        });

        if (!user) {
            throw new Error("User not found");
        }

        const traderKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const inputMint = new PublicKey(state.tokenMint);
        const delegateAmount = BigInt(state.quoteData.inAmount);

        // Import smart contract functions
        const { setSwapDelegate, revokeSwapDelegate } = await import("../solana/smartContract");

        let delegateSet = false;
        let swapSignature: string | null = null;

        try {
            // Validate pot configuration
            if (!pot.admin?.publicKey || !pot.potSeed) {
                throw new Error("Invalid pot configuration");
            }

            let potSeedPublicKey: PublicKey;
            try {
                potSeedPublicKey = new PublicKey(pot.potSeed);
            } catch (error) {
                throw new Error("Invalid pot seed");
            }

            // If admin is trading, ensure they're added as a trader on-chain
            const isAdminTrading = state.userId === pot.adminId;
            if (isAdminTrading) {
                try {
                    // Try to add admin as trader if not already added
                    const { addTraderOnChain } = await import("../solana/smartContract");
                    await ctx.editMessageText("⏳ Verifying admin trader status...");
                    await addTraderOnChain(
                        adminUser.privateKey,
                        potSeedPublicKey,
                        adminUser.publicKey
                    );
                    console.log("✅ Admin verified/added as trader");
                } catch (traderError: any) {
                    // If already a trader, this will fail - that's okay
                    if (!traderError.message?.includes("already")) {
                        console.log("Admin might already be a trader:", traderError.message);
                    }
                }
            }
            
            // Step 1: Set swap delegate (ADMIN must call this, not trader)
            await ctx.editMessageText("⏳ Step 1/3: Setting swap authorization...");
            await setSwapDelegate(
                adminUser.privateKey, // Use ADMIN's private key
                pot.admin.publicKey,
                potSeedPublicKey,
                delegateAmount,
                inputMint
            );
            delegateSet = true;
            console.log("✅ Delegate set successfully");

            // Step 2: Execute Jupiter swap (signed by trader)
            await ctx.editMessageText("⏳ Step 2/3: Executing swap on Jupiter...");
            const swapTransaction = await executeSwap(
                state.quoteData,
                traderKeypair.publicKey.toString()
            );

            const tx = VersionedTransaction.deserialize(
                Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0))
            );
            
            // Sign with TRADER's keypair (not vault)
            tx.sign([traderKeypair]);

            swapSignature = await connection.sendTransaction(tx);
            console.log(`✅ Swap executed: ${swapSignature}`);

            // Update database with trade record
            await prismaClient.trade.create({
                data: {
                    potId: state.potId,
                    traderId: member?.id || pot.adminId,
                    inMint: state.tokenMint,
                    inAmount: BigInt(state.quoteData.inAmount),
                    outMint: SOL_MINT,
                    outAmount: BigInt(state.quoteData.outAmount),
                    txSignature: swapSignature,
                    status: "COMPLETED"
                }
            });

        await prismaClient.asset.upsert({
            where: {
                potId_mintAddress: {
                    potId: state.potId,
                    mintAddress: SOL_MINT
                }
            },
            update: {
                balance: {
                    increment: BigInt(state.quoteData.outAmount)
                }
            },
            create: {
                potId: state.potId,
                mintAddress: SOL_MINT,
                balance: BigInt(state.quoteData.outAmount)
            }
        });

        await prismaClient.asset.update({
            where: {
                potId_mintAddress: {
                    potId: state.potId,
                    mintAddress: state.tokenMint
                }
            },
            data: {
                balance: {
                    decrement: BigInt(state.quoteData.inAmount)
                }
            }
        });

            // Display success message
            await ctx.deleteMessage(processingMsg.message_id);

            const inputAmount = Number(state.quoteData.inAmount) / Math.pow(10, state.tokenDecimals);
            const outputAmount = Number(state.quoteData.outAmount) / LAMPORTS_PER_SOL;
            const usdValue = state.quoteData.swapUsdValue || "0";

            await ctx.replyWithMarkdownV2(
                `✅ *Trade Executed Successfully\\!*\n\n` +
                `*Vault Sold:* ${escapeMarkdownV2Amount(inputAmount)} ${escapeMarkdownV2(state.tokenSymbol)}\n` +
                `*Vault Received:* ≈ ${escapeMarkdownV2Amount(outputAmount)} SOL\n` +
                `*Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `🔗 [View on Solana Explorer](https://explorer.solana.com/tx/${escapeMarkdownV2(swapSignature)})\n\n` +
                `_Trade recorded in pot ledger\\. Permissions revoked\\._`,
                {
                    parse_mode: "MarkdownV2",
                    link_preview_options: { is_disabled: true },
                    ...DEFAULT_GROUP_KEYBOARD
                }
            );

        } catch (swapError: any) {
            console.error("Swap execution error:", swapError);
            throw swapError;
        } finally {
            // Step 3: Always revoke delegate (CRITICAL SECURITY STEP)
            if (delegateSet) {
                try {
                    await ctx.editMessageText("⏳ Step 3/3: Revoking swap authorization...");
                    let potSeedPublicKey: PublicKey;
                    try {
                        potSeedPublicKey = new PublicKey(pot.potSeed);
                    } catch (error) {
                        throw new Error("Invalid pot seed for revoke");
                    }
                    await revokeSwapDelegate(
                        adminUser.privateKey, // Use ADMIN's private key
                        pot.admin.publicKey,
                        potSeedPublicKey,
                        inputMint
                    );
                    console.log("✅ Delegate revoked successfully");
                } catch (revokeError) {
                    console.error("🚨 CRITICAL: Failed to revoke delegate:", revokeError);
                    await ctx.reply(
                        "⚠️ *CRITICAL WARNING*\n\n" +
                        "Trade completed but could not revoke permissions\\.\n" +
                        "Please contact support immediately\\.",
                        { parse_mode: "MarkdownV2", ...DEFAULT_GROUP_KEYBOARD }
                    );
                }
            }

            // Release off-chain lock
            releaseTradeLock(state.potId, state.userId);
        }
    } catch (error: any) {
        console.error("Group swap error:", error);
        
        let errorMsg = "❌ *Trade Failed*\n\n";
        
        if (error.message?.includes("slippage")) {
            errorMsg += "⚠️ Price moved beyond slippage tolerance.\n\n";
            errorMsg += "_Try again with a different amount._";
        } else if (error.message?.includes("insufficient")) {
            errorMsg += "⚠️ Insufficient balance for transaction fees.\n\n";
            errorMsg += "_Ensure vault has enough SOL for fees._";
        } else {
            errorMsg += `⚠️ Transaction failed.\n\n`;
            errorMsg += `_${error.message?.substring(0, 100) || "Network error"}_`;
        }
        
        await ctx.reply(errorMsg, { ...DEFAULT_GROUP_KEYBOARD });
        releaseTradeLock(state.potId, state.userId);
    }

    return ctx.scene.leave();
});

sellTokenForSolWizardGroup.action("wizard_cancel_group_sell", async (ctx) => {
    const state = ctx.wizard.state as SellTokenGroupWizardState;
    
    if (state.potId && state.userId) {
        releaseTradeLock(state.potId, state.userId);
    }
    
    await ctx.reply("❌ Trade cancelled. Chat is now unlocked.", { ...DEFAULT_GROUP_KEYBOARD });
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});

sellTokenForSolWizardGroup.leave(async (ctx) => {
    const state = ctx.wizard.state as SellTokenGroupWizardState;
    if (state?.potId && state?.userId) {
        releaseTradeLock(state.potId, state.userId);
    }
});
