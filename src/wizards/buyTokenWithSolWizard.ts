import { Markup, Scenes } from "telegraf";
import type { BotContext, BuyTokenWizardState } from "../lib/types";
import { prismaClient } from "../db/prisma";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";
import { swap } from "../solana/swapAssetsWithJup";

const connection = new Connection(process.env.MAINNET_RPC_URL!, 'confirmed');

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
                await ctx.reply("❌ User not found. Please register first.");
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
                    }
                }
            );

            return ctx.wizard.next();
        } catch (error) {
            console.error(error);
            await ctx.reply("Oops! Something went wrong. Please try again.");
            return ctx.scene.leave();
        }
    },

    // 2 -> validate token mint and ask for qty
    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid token mint address.");
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

        await ctx.replyWithMarkdownV2(
            `✅ Token mint address saved\\!\n\n` +
            `📊 *How much SOL do you want to spend?*\n\n` +
            `Enter the amount in SOL \\(e\\.g\\., 0\\.1\\)\n\n`
        );

        return ctx.wizard.next();
    },

    // 3 -> get qty and show quote
    async (ctx) => {
        const state = ctx.wizard.state as BuyTokenWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();
        const quantity = parseFloat(text ?? '');

        if (isNaN(quantity) || quantity <= 0) {
            return ctx.reply("❌ Please enter a valid number (e.g., 0.1)");
        }

        const lamports = quantity * LAMPORTS_PER_SOL;
        if (lamports < 1) {
            return ctx.reply("❌ Amount too small — must be at least 0.000000001 SOL.");
        }

        const user = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() }
        });

        if (!user) {
            await ctx.reply("❌ User not found. Please register again.");
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const { empty, balance } = await getBalanceMessage(userKeypair.publicKey.toString());

        if (empty || balance < quantity) {
             await ctx.replyWithMarkdownV2(
                `❌ *Insufficient balance*\n\nYou have only ${escapeMarkdownV2Amount(balance)} SOL available\\.\n\nPlease enter a valid amount\\.`
            );
            return;
        }

        state.quantity = quantity;

        const loadingMsg = await ctx.reply("⏳ Fetching quote...");

        try {
            const swapTxn = await swap(
                SOL_MINT,
                state.tokenMint,
                Number(quantity * LAMPORTS_PER_SOL),
                user.publicKey
            );

            state.quoteData = swapTxn;

            await ctx.deleteMessage(loadingMsg.message_id);

            await ctx.replyWithMarkdownV2(
                `💰 *Swap Quote*\n\n` +
                `📤 *You Pay:* ${escapeMarkdownV2Amount(quantity)} SOL\n` +
                `📥 *Token Mint:* \`${escapeMarkdownV2(state.tokenMint)}\`\n\n` +
                `⚠️ *Slippage:* 5%\n\n` +
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
                `Please try again with a different token.`
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
            await ctx.reply("❌ User not found.");
            return ctx.scene.leave();
        }

        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

        await ctx.answerCbQuery("Processing swap...");
        const processingMsg = await ctx.reply("⏳ Processing your swap...")

        try {
            const tx = await VersionedTransaction.deserialize(
                Uint8Array.from(atob(state.quoteData), c => c.charCodeAt(0))
            );
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);

            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.replyWithMarkdownV2(
                `✅ *Swap Successful\\!*\n\n` +
                `🔗 [View Transaction](https://explorer.solana.com/tx/${escapeMarkdownV2(signature)})\n\n` +
                `💰 Spent: ${escapeMarkdownV2Amount(state.quantity)} SOL\n` +
                `🪙 Token: \`${escapeMarkdownV2(state.tokenMint)}\``,
                { 
                    link_preview_options: {
                        is_disabled: true
                    }
                }
            );
        } catch (error: any) {
            console.error("Swap error:", error);
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply(
                `❌ Swap failed. Possible reasons:\n\n` +
                `• Network congestion\n` +
                `• Price changed significantly\n` +
                `• Insufficient balance for fees\n\n` +
                `Please try again.`
            );
        }
    } catch (error) {
        console.error(error);
        await ctx.reply("⚠️ Something went wrong while processing the swap.");
    }

    return ctx.scene.leave();
})

buyTokenWithSolWizard.action("wizard_cancel_buy", async (ctx) => {
    await ctx.reply("❌ Swap cancelled.");
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});