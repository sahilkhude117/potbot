import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getBalanceMessage } from "../solana/getBalance";
import type { BotContext, CopyTradingWizardState } from "../lib/types";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { getConnection, getExplorerUrl } from "../solana/getConnection";
import { getQuote, executeSwap } from "../solana/swapAssetsWithJup";
import { showCopyTradeStatus } from "../lib/copyTradingStatus";

const connection = getConnection();

export const copyTradingWizard = new Scenes.WizardScene<BotContext>(
    'copy_trading_wizard',

    // Step 1: Ask for target wallet address
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

            const state = ctx.wizard.state as CopyTradingWizardState;
            state.userId = existingUser.id;

            // Get user's SOL balance
            const userKeypair = Keypair.fromSecretKey(decodeSecretKey(existingUser.privateKey));
            const { balance } = await getBalanceMessage(userKeypair.publicKey.toString());
            state.userBalance = balance;

            await ctx.replyWithMarkdownV2(
                `🔄 *Start Copy Trading*\n\n` +
                `Copy successful traders' moves automatically\\!\n\n` +
                `*Enter the wallet address* of the trader you want to copy\\.\n\n` +
                `_Find top traders here:_\n` +
                `[CoinMarketCap Top Traders](https://dex.coinmarketcap.com/top-traders/all/)\n\n`,
                {
                    parse_mode: "MarkdownV2",
                    link_preview_options: {
                        is_disabled: true
                    },
                    ...Markup.inlineKeyboard([
                        [Markup.button.callback("❌ Cancel", "wizard_cancel_copy_trading")]
                    ])
                }
            );

            return ctx.wizard.next();
        } catch (error) {
            console.error("Copy trading wizard error:", error);
            await ctx.reply("❌ Something went wrong. Please try again.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }
    },

    // Step 2: Validate wallet address and ask for allocation percentage
    async (ctx) => {
        const state = ctx.wizard.state as CopyTradingWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid wallet address or press Cancel.");
        }

        // Validate Solana address
        try {
            new PublicKey(text);
        } catch (error) {
            return ctx.reply("❌ Invalid Solana wallet address. Please enter a valid address (base58 format).");
        }

        state.targetWalletAddress = text;

        await ctx.replyWithMarkdownV2(
            `✅ *Trader wallet saved\\!*\n\n` +
            `📊 *Wallet:* \`${escapeMarkdownV2(text.slice(0, 8))}...${escapeMarkdownV2(text.slice(-8))}\`\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `💰 *Your Balance:* ${escapeMarkdownV2Amount(state.userBalance)} SOL\n\n` +
            `*What percentage of your wallet do you want to allocate for copy trading?*\n\n` +
            `Enter a percentage \\(1\\-100\\)\\.\n` +
            `_Example: Enter 25 to use 25% of your balance_`,
            Markup.inlineKeyboard([
                [Markup.button.callback("❌ Cancel", "wizard_cancel_copy_trading")]
            ])
        );

        return ctx.wizard.next();
    },

    // Step 3: Validate percentage and show rules + mode selection
    async (ctx) => {
        const state = ctx.wizard.state as CopyTradingWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid percentage or press Cancel.");
        }

        const percentage = parseFloat(text);

        if (isNaN(percentage) || percentage < 1 || percentage > 100) {
            return ctx.reply("❌ Please enter a valid percentage between 1 and 100.");
        }

        state.allocatedPercentage = percentage;

        const allocatedAmount = (state.userBalance * percentage) / 100;

        await ctx.replyWithMarkdownV2(
            `✅ *Allocation Set\\!*\n\n` +
            `📊 *Allocated:* ${escapeMarkdownV2Amount(percentage)}% \\(${escapeMarkdownV2Amount(allocatedAmount)} SOL\\)\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `⚠️ *Copy Trading Rules*\n\n` +
            `🔹 *Solana Only:* Only Solana blockchain transactions will be tracked and copied\n\n` +
            `🔹 *Proportional Trades:* Trades are copied proportionally based on your allocation \\(${escapeMarkdownV2Amount(percentage)}%\\)\n\n` +
            `🔹 *Balance Check:* If you don't have enough SOL \\+ network fees, the swap will be cancelled\n\n` +
            `🔹 *Asset Ownership:* If the trader sells an asset you don't own, the bot won't execute that sell order\n\n` +
            `🔹 *Network Fees:* Keep extra SOL for transaction fees \\(\\~0\\.005 SOL per trade\\)\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `🎯 *Choose Trading Mode:*`,
            Markup.inlineKeyboard([
                [Markup.button.callback("🔐 Permissioned Mode", "wizard_mode_permissioned")],
                [Markup.button.callback("⚡ Permissionless Mode", "wizard_mode_permissionless")],
                [Markup.button.callback("❌ Cancel", "wizard_cancel_copy_trading")]
            ])
        );

        return ctx.wizard.next();
    },

    // Step 4: Wait for mode selection
    async (ctx) => {
        // This step handles the callback queries for mode selection
    }
);

// Handle Permissioned Mode selection
copyTradingWizard.action("wizard_mode_permissioned", async (ctx) => {
    const state = ctx.wizard.state as CopyTradingWizardState;
    state.mode = 'PERMISSIONED';

    try {
        await ctx.answerCbQuery();

        await ctx.replyWithMarkdownV2(
            `🔐 *Permissioned Mode Selected*\n\n` +
            `You will receive a confirmation message before every trade with trade details\\.\n\n` +
            `You can approve or reject each trade individually\\.\n\n`,
            { parse_mode: "MarkdownV2" }
        );

        // Save to database
        await prismaClient.copyTrading.upsert({
            where: { userId: state.userId },
            create: {
                userId: state.userId,
                targetWalletAddress: state.targetWalletAddress,
                allocatedPercentage: state.allocatedPercentage,
                mode: 'PERMISSIONED',
                isActive: true
            },
            update: {
                targetWalletAddress: state.targetWalletAddress,
                allocatedPercentage: state.allocatedPercentage,
                mode: 'PERMISSIONED',
                isActive: true
            }
        });

        const allocatedAmount = (state.userBalance * state.allocatedPercentage) / 100;

        await ctx.replyWithMarkdownV2(
            `✅ *Copy Trading Activated\\!*\n\n` +
            `🎯 *Trader:* \`${escapeMarkdownV2(state.targetWalletAddress)}\`\n\n` +
            `💰 *Allocated:* ${escapeMarkdownV2Amount(state.allocatedPercentage)}% \\(${escapeMarkdownV2Amount(allocatedAmount)} SOL\\)\n\n` +
            `🔐 *Mode:* Permissioned\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `The bot is now monitoring the trader's wallet\\.\n` +
            `You'll receive trade confirmations shortly\\.\n\n` +
            `_Use /copytrade to view status anytime_`,
            {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📊 View Status", "copy_trading")],
                    [Markup.button.callback("🔙 Back to Menu", "back_to_menu")]
                ])
            }
        );

    } catch (error) {
        console.error("Error activating copy trading:", error);
        await ctx.reply("❌ Failed to activate copy trading. Please try again.", {
            ...DEFAULT_KEYBOARD
        });
    }

    return ctx.scene.leave();
});

// Handle Permissionless Mode selection
copyTradingWizard.action("wizard_mode_permissionless", async (ctx) => {
    const state = ctx.wizard.state as CopyTradingWizardState;
    state.mode = 'PERMISSIONLESS';

    try {
        await ctx.answerCbQuery();

        await ctx.replyWithMarkdownV2(
            `⚡ *Permissionless Mode Selected*\n\n` +
            `Trades will be executed automatically without confirmation\\.\n\n` +
            `You will see transaction completion messages after each trade\\.\n\n`,
            { parse_mode: "MarkdownV2" }
        );

        // Save to database
        await prismaClient.copyTrading.upsert({
            where: { userId: state.userId },
            create: {
                userId: state.userId,
                targetWalletAddress: state.targetWalletAddress,
                allocatedPercentage: state.allocatedPercentage,
                mode: 'PERMISSIONLESS',
                isActive: true
            },
            update: {
                targetWalletAddress: state.targetWalletAddress,
                allocatedPercentage: state.allocatedPercentage,
                mode: 'PERMISSIONLESS',
                isActive: true
            }
        });

        const allocatedAmount = (state.userBalance * state.allocatedPercentage) / 100;

        await ctx.replyWithMarkdownV2(
            `✅ *Copy Trading Activated\\!*\n\n` +
            `🎯 *Trader:* \`${escapeMarkdownV2(state.targetWalletAddress)}\`\n\n` +
            `💰 *Allocated:* ${escapeMarkdownV2Amount(state.allocatedPercentage)}% \\(${escapeMarkdownV2Amount(allocatedAmount)} SOL\\)\n\n` +
            `⚡ *Mode:* Permissionless\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━\n\n` +
            `The bot is now monitoring the trader's wallet\\.\n` +
            `Trades will be executed automatically\\.\n\n` +
            `_Use /copytrade to view status anytime_`,
            {
                ...Markup.inlineKeyboard([
                    [Markup.button.callback("📊 View Status", "copy_trading")],
                    [Markup.button.callback("🔙 Back to Menu", "back_to_menu")]
                ])
            }
        );

    } catch (error) {
        console.error("Error activating copy trading:", error);
        await ctx.reply("❌ Failed to activate copy trading. Please try again.", {
            ...DEFAULT_KEYBOARD
        });
    }

    return ctx.scene.leave();
});

// Handle Cancel
copyTradingWizard.action("wizard_cancel_copy_trading", async (ctx) => {
    await ctx.answerCbQuery("Cancelled");
    await ctx.reply("❌ Copy trading setup cancelled.", {
        ...DEFAULT_KEYBOARD
    });
    return ctx.scene.leave();
});

// Handle copy trade confirmation
copyTradingWizard.action(/confirm_copy_(.+)/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const copiedTradeId = ctx.match?.[1];

        if (!copiedTradeId) {
            return ctx.reply("❌ Invalid trade ID.");
        }

        const copiedTrade = await prismaClient.copiedTrade.findUnique({
            where: { id: copiedTradeId },
            include: {
                copyTrading: {
                    include: { user: true }
                }
            }
        });

        if (!copiedTrade) {
            return ctx.reply("❌ Trade not found.");
        }

        const user = copiedTrade.copyTrading.user;
        const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

        // Execute the trade
        const loadingMsg = await ctx.reply("⏳ Executing trade...");

        try {
            const quoteResponse = await getQuote(
                copiedTrade.inMint,
                copiedTrade.outMint,
                Number(copiedTrade.inAmount),
                userKeypair.publicKey.toString()
            );

            const swapTransaction = await executeSwap(quoteResponse, userKeypair.publicKey.toString());

            const txBuf = Buffer.from(swapTransaction, 'base64');
            const tx = VersionedTransaction.deserialize(txBuf);
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);
            const latestBlockhash = await connection.getLatestBlockhash();
            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, 'confirmed');

            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: {
                    copiedTxHash: signature,
                    outAmount: BigInt(quoteResponse.outAmount),
                    status: 'EXECUTED'
                }
            });

            await ctx.deleteMessage(loadingMsg.message_id);

            // Get the copy trading config to determine current mode
            const copyTradingConfig = copiedTrade.copyTrading;
            
            // Build action buttons based on current mode
            const buttons = [];
            
            // Toggle mode button
            if (copyTradingConfig.mode === 'PERMISSIONED') {
                buttons.push([Markup.button.callback("⚡ Switch to Permissionless", "switch_mode_permissionless")]);
            } else {
                buttons.push([Markup.button.callback("🔐 Switch to Permissioned", "switch_mode_permissioned")]);
            }
            
            // Stop and menu buttons
            buttons.push([Markup.button.callback("⏸️ Stop Copy Trading", "stop_copy_trade")]);
            buttons.push([Markup.button.callback("🔙 Back to Menu", "back_to_menu")]);

            await ctx.replyWithMarkdownV2(
                `✅ *Trade Executed Successfully*\n\n` +
                `🔗 [View Transaction](${getExplorerUrl(signature)})`,
                {
                    link_preview_options: { is_disabled: true },
                    ...Markup.inlineKeyboard(buttons)
                }
            );

        } catch (error: any) {
            await ctx.deleteMessage(loadingMsg.message_id);

            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: {
                    status: 'FAILED',
                    failureReason: error.message
                }
            });

            await ctx.reply(`❌ Trade failed: ${error.message}`, {
                ...DEFAULT_KEYBOARD
            });
        }

    } catch (error) {
        console.error("Error confirming copy trade:", error);
        await ctx.reply("❌ Something went wrong.");
    }
});

// Handle copy trade rejection
copyTradingWizard.action(/reject_copy_(.+)/, async (ctx) => {
    try {
        await ctx.answerCbQuery("Trade rejected");
        const copiedTradeId = ctx.match?.[1];

        if (!copiedTradeId) {
            return ctx.reply("❌ Invalid trade ID.");
        }

        await prismaClient.copiedTrade.update({
            where: { id: copiedTradeId },
            data: { status: 'CANCELLED' }
        });

        await ctx.reply("❌ Trade rejected and cancelled.", {
            ...DEFAULT_KEYBOARD
        });

    } catch (error) {
        console.error("Error rejecting copy trade:", error);
        await ctx.reply("❌ Something went wrong.");
    }
});

// Handle mode switching to permissioned
copyTradingWizard.action("switch_mode_permissioned", async (ctx) => {
    try {
        await ctx.answerCbQuery("Switching to Permissioned mode...");

        const existingUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { 
                copyTrading: {
                    include: {
                        copiedTrades: {
                            orderBy: { createdAt: 'desc' },
                            take: 5
                        }
                    }
                }
            }
        });

        if (!existingUser?.copyTrading) {
            return ctx.reply("❌ Copy trading not found.");
        }

        await prismaClient.copyTrading.update({
            where: { userId: existingUser.id },
            data: { mode: 'PERMISSIONED' }
        });

        // Refresh user data with updated mode
        const updatedUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { 
                copyTrading: {
                    include: {
                        copiedTrades: {
                            orderBy: { createdAt: 'desc' },
                            take: 5
                        }
                    }
                }
            }
        });

        // Show full trade status with updated mode
        await showCopyTradeStatus(ctx, updatedUser);
    } catch (error) {
        console.error("Error switching mode:", error);
        await ctx.reply("❌ Failed to switch mode.");
    }
});

// Handle mode switching to permissionless
copyTradingWizard.action("switch_mode_permissionless", async (ctx) => {
    try {
        await ctx.answerCbQuery("Switching to Permissionless mode...");

        const existingUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { 
                copyTrading: {
                    include: {
                        copiedTrades: {
                            orderBy: { createdAt: 'desc' },
                            take: 5
                        }
                    }
                }
            }
        });

        if (!existingUser?.copyTrading) {
            return ctx.reply("❌ Copy trading not found.");
        }

        await prismaClient.copyTrading.update({
            where: { userId: existingUser.id },
            data: { mode: 'PERMISSIONLESS' }
        });

        // Refresh user data with updated mode
        const updatedUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { 
                copyTrading: {
                    include: {
                        copiedTrades: {
                            orderBy: { createdAt: 'desc' },
                            take: 5
                        }
                    }
                }
            }
        });

        // Show full trade status with updated mode
        await showCopyTradeStatus(ctx, updatedUser);
    } catch (error) {
        console.error("Error switching mode:", error);
        await ctx.reply("❌ Failed to switch mode.");
    }
});

// Handle stop copy trade
copyTradingWizard.action("stop_copy_trade", async (ctx) => {
    try {
        await ctx.answerCbQuery();

        const existingUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { copyTrading: true }
        });

        if (!existingUser?.copyTrading) {
            return ctx.reply("❌ Copy trading not found.");
        }

        const ct = existingUser.copyTrading;

        await prismaClient.copyTrading.update({
            where: { userId: existingUser.id },
            data: { isActive: false }
        });

        await ctx.replyWithMarkdownV2(
            `✅ *Copy Trading Stopped*\n\n` +
            `🎯 *Trader:* \`${escapeMarkdownV2(ct.targetWalletAddress)}\`\n\n` +
            `The bot is no longer monitoring trades\\.\n\n` +
            `_Use /copytrade to start again_`,
            { ...DEFAULT_KEYBOARD }
        );
    } catch (error) {
        console.error("Error stopping copy trading:", error);
        await ctx.reply("❌ Failed to stop copy trading.");
    }
});

// Handle resume copy trade
copyTradingWizard.action("resume_copy_trade", async (ctx) => {
    try {
        await ctx.answerCbQuery();

        const existingUser = await prismaClient.user.findFirst({
            where: { telegramUserId: ctx.from?.id.toString() },
            include: { copyTrading: true }
        });

        if (!existingUser?.copyTrading) {
            return ctx.reply("❌ Copy trading not found.");
        }

        await prismaClient.copyTrading.update({
            where: { userId: existingUser.id },
            data: { isActive: true }
        });

        await ctx.replyWithMarkdownV2(
            `✅ *Copy Trading Resumed*\n\n` +
            `The bot is now monitoring trades again\\.`,
            { ...DEFAULT_KEYBOARD }
        );
    } catch (error) {
        console.error("Error resuming copy trading:", error);
        await ctx.reply("❌ Failed to resume copy trading.");
    }
});
