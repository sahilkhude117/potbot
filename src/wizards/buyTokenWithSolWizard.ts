import { Markup, Scenes } from "telegraf";
import type { BotContext, BuyTokenWizardState } from "../lib/types";
import { prismaClient } from "../db/prisma";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";
import { executeSwap, getQuote, swap } from "../solana/swapAssetsWithJup";
import { getConnection, getExplorerUrl } from "../solana/getConnection";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";

const connection = getConnection();

export const buyTokenWithSolWizard = new Scenes.WizardScene<BotContext>(
    'buy_token_with_sol_wizard',

    // 1 -> ask for token mint address
    async (ctx) => {
        try {
            const existingUser = await prismaClient.user.findFirst({
                where: {
                    telegramUserId: ctx.from?.id.toString()
                }
            });

            if (!existingUser) {
                await ctx.reply("❌ User not found. Please register first.", {
                    ...DEFAULT_KEYBOARD
                });
                return ctx.scene.leave();
            }

            const state = ctx.wizard.state as BuyTokenWizardState;
            state.userId = existingUser.id;

            await ctx.replyWithMarkdownV2(
                `🪙 *Buy Token with SOL*\n\n` +
                `Please enter the *token mint address*\\.\n\n` +
                `_You can find token addresses on_ [CryptoRank](https://cryptorank.io/blockchains/solana)\n\n`,
                { 
                    parse_mode: "MarkdownV2",
                    link_preview_options: {
                        is_disabled: true
                    },
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("Cancel", "wizard_cancel_buy")]
                    ])
                }
            );

            return ctx.wizard.next();
        } catch (error) {
            console.error(error);
            await ctx.reply("Oops! Something went wrong. Please try again.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }
    },

    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid token mint address or press Cancel.");
        }

        try {
            new PublicKey(text);
        } catch (error) {
            return ctx.reply("❌ Invalid token mint address. Please enter a valid Solana address (base58 format).");
        }

        if (text === SOL_MINT) {
            return ctx.reply("❌ You cannot buy SOL with SOL. Please enter a different token mint address.");
        }

        state.tokenMint = text;

        const user = await prismaClient.user.findUnique({
            where: { id: state.userId }
        });

        if (!user) {
            await ctx.reply("❌ User not found. Please register again.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const { balance, empty } = await getBalanceMessage(userKeypair.publicKey.toString());

        if (empty || balance < 0.001) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Balance*\n\n` +
                `You have only ${escapeMarkdownV2Amount(balance)} SOL\\.\n\n` +
                `You need at least 0\\.001 SOL for trading\\.\n\n` +
                `_Please deposit SOL to your wallet first\\._`,
                {
                    ...DEFAULT_KEYBOARD
                }
            );
            return ctx.scene.leave();
        }

        state.balance = balance;

        await ctx.replyWithMarkdownV2(
            `✅ Token mint address saved\\!\n\n` +
            `📊 *How much SOL do you want to spend?*\n\n` +
            `💰 *Available:* ${escapeMarkdownV2Amount(balance)} SOL\n\n` +
            `Enter the amount in SOL \\(e\\.g\\., 0\\.5\\)`,
            Markup.inlineKeyboard([
                [Markup.button.callback("Cancel", "wizard_cancel_buy")]
            ])
        );

        return ctx.wizard.next();
    },

    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();
        const quantity = parseFloat(text ?? '');

        if (isNaN(quantity) || quantity <= 0) {
            return ctx.reply("❌ Please enter a valid number (e.g., 0.5)");
        }

        const lamports = quantity * LAMPORTS_PER_SOL;
        if (lamports < 1) {
            return ctx.reply("❌ Amount too small — must be at least 0.000000001 SOL.");
        }

        if (quantity > state.balance) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Balance*\n\n` +
                `You're trying to spend ${escapeMarkdownV2Amount(quantity)} SOL\\.\n` +
                `You have only ${escapeMarkdownV2Amount(state.balance)} SOL\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        const minReserve = 0.005;
        if (quantity > state.balance - minReserve) {
            await ctx.replyWithMarkdownV2(
                `❌ *Reserve SOL for Fees*\n\n` +
                `Keep at least ${escapeMarkdownV2Amount(minReserve)} SOL for transaction fees\\.\n\n` +
                `Maximum you can spend: ${escapeMarkdownV2Amount(state.balance - minReserve)} SOL`
            );
            return;
        }

        state.quantity = quantity;

        const user = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() }
        });

        if (!user) {
            await ctx.reply("❌ User not found. Please register again.");
            return ctx.scene.leave();
        }

        const loadingMsg = await ctx.reply("⏳ Fetching quote...");

        try {
            const quoteResponse = await getQuote(
                SOL_MINT,
                state.tokenMint,
                Number(quantity * LAMPORTS_PER_SOL),
                user.publicKey
            );

            state.quoteData =  quoteResponse;

            const inputAmount = Number(quoteResponse.inAmount) / LAMPORTS_PER_SOL;
            const outputAmount = Number(quoteResponse.outAmount);
            const priceImpact = quoteResponse.priceImpactPct || "0";
            const usdValue = quoteResponse.swapUsdValue || "0";

            const outputDecimals = 6;
            const outputAmountFormatted = outputAmount / Math.pow(10, outputDecimals);

            await ctx.deleteMessage(loadingMsg.message_id);

            await ctx.replyWithMarkdownV2(
                `💰 *Swap Quote*\n\n` +
                `*You Pay:* ${escapeMarkdownV2Amount(inputAmount)} SOL\n` +
                `*You Receive:* ≈ ${escapeMarkdownV2Amount(outputAmountFormatted)} tokens\n` +
                `*USD Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `*Price Impact:* ${escapeMarkdownV2(priceImpact)}%\n` +
                `*Slippage Tolerance:* ${escapeMarkdownV2((quoteResponse.slippageBps / 100).toString())}%\n` +
                `🪙 *Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
                `Do you want to proceed with this swap?`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Confirm", "wizard_confirm_buy"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_buy")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            console.error("Quote error:", error);
            await ctx.deleteMessage(loadingMsg.message_id);
            await ctx.reply(
                `❌ Failed to get quote. This could mean:\n\n` +
                `• Invalid token address\n` +
                `• Insufficient liquidity\n` +
                `• Token not tradable\n\n` +
                `Please try again with a different token.`,
                {
                    ...DEFAULT_KEYBOARD
                }
            );
            return ctx.scene.leave();
        }
    },

    // 4 -> wait for confirmation
    async (ctx) => {

    }
);

buyTokenWithSolWizard.action("wizard_confirm_buy", async (ctx) => {
    const state = ctx.wizard.state as BuyTokenWizardState;

    try {
        const user = await prismaClient.user.findFirst({
            where: {
                telegramUserId: ctx.from.id.toString()
            }
        })

        if (!user) {
            await ctx.reply("❌ User not found.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

        await ctx.answerCbQuery("Processing swap...");
        const processingMsg = await ctx.reply("⏳ Processing your swap...")

        try {
            const swapTransaction = await executeSwap(
                state.quoteData,
                user.publicKey
            );

            state.swapTxn = swapTransaction;

            const tx = await VersionedTransaction.deserialize(
                Uint8Array.from(atob(swapTransaction), c => c.charCodeAt(0))
            );
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);

            await ctx.deleteMessage(processingMsg.message_id);

            const inputAmount = Number(state.quoteData.inAmount) / LAMPORTS_PER_SOL;
            const outputAmount = Number(state.quoteData.outAmount);
            const usdValue = state.quoteData.swapUsdValue || "0";

            const outputDecimals = 6;
            const outputAmountFormatted = outputAmount / Math.pow(10, outputDecimals);
            await ctx.replyWithMarkdownV2(
                `✅ *Swap Successful\\!*\n\n` +
                `*Spent:* ${escapeMarkdownV2Amount(inputAmount)} SOL\n` +
                `*Received:* ≈ ${escapeMarkdownV2Amount(outputAmountFormatted)} tokens\n` +
                `*Value:* \\$${escapeMarkdownV2(parseFloat(usdValue).toFixed(4))}\n\n` +
                `*Token:* \`${escapeMarkdownV2(state.tokenMint.substring(0, 12))}\\.\\.\\.\`\n\n` +
                `🔗 [View on Solana Explorer](${escapeMarkdownV2(getExplorerUrl(signature))})\n\n` +
                `_Transaction confirmed\\!_`,
                {
                    parse_mode: "MarkdownV2",
                    link_preview_options: { is_disabled: true },
                    ...DEFAULT_KEYBOARD
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
            
            await ctx.replyWithMarkdownV2(errorMsg, {
                ...DEFAULT_KEYBOARD
            });
        }
    } catch (error) {
        console.error(error);
        await ctx.reply("⚠️ Something went wrong while processing the swap.", {
            ...DEFAULT_KEYBOARD
        });
    }

    return ctx.scene.leave();
})

buyTokenWithSolWizard.action("wizard_cancel_buy", async (ctx) => {
    await ctx.reply("❌ Swap cancelled.", {
        ...DEFAULT_KEYBOARD
    });
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});