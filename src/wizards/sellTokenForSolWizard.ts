import { Markup, Scenes } from "telegraf";
import type { BotContext, SellTokenWizardState } from "../lib/types";
import { prismaClient } from "../db/prisma";
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getUserTokenAccounts, getTokenMetadata } from "../solana/getTokenAccounts";
import { executeSwap, getQuote } from "../solana/swapAssetsWithJup";

const connection = new Connection(process.env.MAINNET_RPC_URL!, 'confirmed');

export const sellTokenForSolWizard = new Scenes.WizardScene<BotContext>(
    'sell_token_for_sol_wizard',

    async (ctx) => {
        try {
            const existingUser = await prismaClient.user.findFirst({
                where: {
                    telegramUserId: ctx.from?.id.toString()
                }
            });

            if (!existingUser) {
                await ctx.reply("❌ User not found. Please register first.");
                return ctx.scene.leave();
            }

            const state = ctx.wizard.state as SellTokenWizardState;
            state.userId = existingUser.id;

            const loadingMsg = await ctx.reply("⏳ Fetching your tokens...");

            const userKeypair = Keypair.fromSecretKey(decodeSecretKey(existingUser.privateKey));
            const tokenAccounts = await getUserTokenAccounts(connection, userKeypair.publicKey.toString());

            await ctx.deleteMessage(loadingMsg.message_id);

            // Filter out SOL (native mint) - can't trade SOL for SOL
            const tradableTokens = tokenAccounts.filter(token => token.mintAddress !== SOL_MINT);

            if (tradableTokens.length === 0) {
                await ctx.reply(
                    "❌ You don't have any tokens to sell.\n\n" +
                    (tokenAccounts.length > 0 
                        ? "Only SOL is available, which cannot be sold for SOL.\n\n"
                        : "") +
                    "Buy some tokens first using the Buy option."
                );
                return ctx.scene.leave();
            }

            const buttons: any[][] = [];
            const fetchMetadataPromises = tradableTokens.map(async (token) => {
                const metadata = await getTokenMetadata(token.mintAddress);
                return { token, metadata };
            });

            const tokensWithMetadata = await Promise.all(fetchMetadataPromises);

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
                                `wizard_select_token_${token.mintAddress}`
                            )
                        );
                    }
                }
                
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("❌ Cancel", "wizard_cancel_sell")]);

            await ctx.reply(
                "🪙 *Select a token to sell:*\n\n" +
                "_Choose from your available tokens below_",
                {
                    parse_mode: "MarkdownV2",
                    ...Markup.inlineKeyboard(buttons)
                }
            );

            return ctx.wizard.next();
        } catch (error) {
            console.error(error);
            await ctx.reply("❌ Something went wrong while fetching your tokens.");
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
    },

    async (ctx) => {
        const state = ctx.wizard.state as SellTokenWizardState;
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
                `❌ *Insufficient Balance*\n\n` +
                `You're trying to sell ${escapeMarkdownV2Amount(quantity)} ${escapeMarkdownV2(state.tokenSymbol)}\\.\n` +
                `You only have ${escapeMarkdownV2Amount(state.tokenBalance)} ${escapeMarkdownV2(state.tokenSymbol)}\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        state.quantity = quantity;

        const loadingMsg = await ctx.reply("⏳ Fetching quote from Jupiter...");

        try {
            const user = await prismaClient.user.findUnique({
                where: { id: state.userId }
            });

            if (!user) {
                await ctx.reply("❌ User not found. Please register again.");
                return ctx.scene.leave();
            }

            const amountInSmallestUnit = Math.floor(quantity * Math.pow(10, state.tokenDecimals));

            const quoteResponse = await getQuote(
                state.tokenMint,
                SOL_MINT,
                amountInSmallestUnit,
                user.publicKey
            );

            state.quoteData = quoteResponse;

            const inputAmount = Number(quoteResponse.inAmount) / Math.pow(10, state.tokenDecimals);
            const outputAmount = Number(quoteResponse.outAmount) / LAMPORTS_PER_SOL;
            const priceImpact = quoteResponse.priceImpactPct || "0";
            const usdValue = quoteResponse.swapUsdValue || "0";

            await ctx.deleteMessage(loadingMsg.message_id);

            await ctx.replyWithMarkdownV2(
                `💰 *Swap Quote*\n\n` +
                `*You Sell:* ${escapeMarkdownV2Amount(inputAmount)} ${escapeMarkdownV2(state.tokenSymbol)}\n` +
                `*You Receive:* ≈ ${escapeMarkdownV2Amount(outputAmount)} SOL\n` +
                `*USD Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `*Price Impact:* ${escapeMarkdownV2(priceImpact)}%\n` +
                `*Slippage Tolerance:* ${escapeMarkdownV2((quoteResponse.slippageBps / 100).toString())}%\n` +
                `🪙 *Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
                `Do you want to proceed with this swap?`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Confirm", "wizard_confirm_sell"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_sell")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            console.error("Quote error:", error);
            await ctx.deleteMessage(loadingMsg.message_id);
            await ctx.reply(
                `❌ Failed to get quote. This could mean:\n\n` +
                `• Insufficient liquidity\n` +
                `• Token not tradable\n` +
                `• Network issues\n\n` +
                `Please try again or choose a different token.`
            );
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
    }
);

sellTokenForSolWizard.action(/wizard_select_token_(.+)/, async (ctx) => {
    const state = ctx.wizard.state as SellTokenWizardState;
    const tokenMint = ctx.match?.[1];

    if (!tokenMint) {
        await ctx.reply("❌ Invalid token selection.");
        return ctx.scene.leave();
    }

    try {
        const user = await prismaClient.user.findUnique({
            where: { id: state.userId }
        });

        if (!user) {
            await ctx.reply("❌ User not found.");
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const tokenAccounts = await getUserTokenAccounts(connection, userKeypair.publicKey.toString());

        const selectedToken = tokenAccounts.find(t => t.mintAddress === tokenMint);

        if (!selectedToken) {
            await ctx.reply("❌ Token not found in your wallet.");
            return ctx.scene.leave();
        }

        const metadata = await getTokenMetadata(tokenMint);
        const tokenSymbol = metadata?.symbol || tokenMint.substring(0, 8);

        state.tokenMint = tokenMint;
        state.tokenBalance = selectedToken.uiAmount;
        state.tokenDecimals = selectedToken.decimals;
        state.tokenSymbol = tokenSymbol;

        await ctx.answerCbQuery();

        await ctx.replyWithMarkdownV2(
            `✅ Token selected\\!\n\n` +
            `*Token:* ${escapeMarkdownV2(tokenSymbol)}\n` +
            `*Available Balance:* ${escapeMarkdownV2Amount(selectedToken.uiAmount)} ${escapeMarkdownV2(tokenSymbol)}\n\n` +
            `📊 *How much do you want to sell?*\n\n` +
            `You can enter:\n` +
            `• *Percentage* \\(e\\.g\\., \`50%\` for half\\)\n` +
            `• *Exact amount* \\(e\\.g\\., \`${escapeMarkdownV2((selectedToken.uiAmount / 2).toFixed(2))}\`\\)`,
            Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel", "wizard_cancel_sell")]
            ])
        );

        ctx.wizard.selectStep(2);
    } catch (error) {
        console.error(error);
        await ctx.reply("❌ Something went wrong. Please try again.");
        return ctx.scene.leave();
    }
});

sellTokenForSolWizard.action("wizard_confirm_sell", async (ctx) => {
    const state = ctx.wizard.state as SellTokenWizardState;

    try {
        const user = await prismaClient.user.findFirst({
            where: {
                telegramUserId: ctx.from.id.toString()
            }
        });

        if (!user) {
            await ctx.reply("❌ User not found.");
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

        await ctx.answerCbQuery("Processing swap...");
        const processingMsg = await ctx.reply("⏳ Processing your swap...");

        try {
            const swapTransaction = await executeSwap(
                state.quoteData,
                user.publicKey
            );

            const tx = VersionedTransaction.deserialize(
                Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0))
            );
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);

            await ctx.deleteMessage(processingMsg.message_id);

            const inputAmount = Number(state.quoteData.inAmount) / Math.pow(10, state.tokenDecimals);
            const outputAmount = Number(state.quoteData.outAmount) / LAMPORTS_PER_SOL;
            const usdValue = state.quoteData.swapUsdValue || "0";

            await ctx.replyWithMarkdownV2(
                `✅ *Swap Successful\\!*\n\n` +
                `*Sold:* ${escapeMarkdownV2Amount(inputAmount)} ${escapeMarkdownV2(state.tokenSymbol)}\n` +
                `*Received:* ≈ ${escapeMarkdownV2Amount(outputAmount)} SOL\n` +
                `*Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `🔗 [View on Solana Explorer](https://explorer.solana.com/tx/${escapeMarkdownV2(signature)})\n\n` +
                `_Transaction confirmed\\!_`,
                {
                    parse_mode: "MarkdownV2",
                }
            );
        } catch (error: any) {
            console.error("Swap error:", error);
            await ctx.deleteMessage(processingMsg.message_id);
            
            let errorMsg = "❌ *Swap Failed*\n\n";
            
            if (error.message?.includes("slippage")) {
                errorMsg += "⚠️ Price moved beyond slippage tolerance\\.\n\n";
                errorMsg += "_Try again or use a different amount\\._";
            } else if (error.message?.includes("insufficient")) {
                errorMsg += "⚠️ Insufficient balance for transaction fees\\.\n\n";
                errorMsg += `_You need ≈0\\.001 SOL extra for fees\\._`;
            } else {
                errorMsg += `⚠️ Transaction failed\\.\n\n`;
                errorMsg += `_${escapeMarkdownV2(error.message?.substring(0, 100) || "Network error")}_`;
            }
            
            await ctx.replyWithMarkdownV2(errorMsg);
        }
    } catch (error) {
        console.error(error);
        await ctx.reply("⚠️ Something went wrong while processing the swap.");
    }

    return ctx.scene.leave();
});

sellTokenForSolWizard.action("wizard_cancel_sell", async (ctx) => {
    await ctx.reply("❌ Sell cancelled.");
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});
