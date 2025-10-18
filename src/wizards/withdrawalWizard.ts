import { Markup, Scenes } from "telegraf";
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

            const asset = preview.assetToReturn;
            const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112" 
                ? "SOL" 
                : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);

            await ctx.replyWithMarkdownV2(
                `💰 *Withdrawal Confirmation*\n\n` +
                `*Pot:* ${escapeMarkdownV2(state.potName)}\n` +
                `*Shares to Burn:* ${escapeMarkdownV2(sharesToBurn.toString())} \\(${escapeMarkdownV2(preview.withdrawalPercentage.toFixed(2))}% of total pot\\)\n` +
                `*Estimated Value:* \\~\\$${escapeMarkdownV2Amount(preview.valueUSD)}\n\n` +
                `*You will receive:*\n` +
                `${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                `💡 _You will receive your withdrawal in the pot's base asset \\(${escapeMarkdownV2(symbol)}\\)\\._`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Confirm", "wizard_confirm_withdrawal"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_withdrawal")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            await ctx.reply(`❌ ${error.message}`)
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
            `💡 _Your withdrawal will be paid in the pot's base asset\\._`,
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
        const processingMsg = await ctx.reply("⏳ Processing on-chain withdrawal...");

        const pot = await prismaClient.pot.findUnique({
            where: { id: potId },
            include: { admin: true }
        });
        
        const user = await prismaClient.user.findUnique({
            where: { id: userId }
        });

        if (!user || !pot) {
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply("❌ User or pot not found.");
            return ctx.scene.leave();
        }

        // Import smart contract functions
        const { redeemFromPot } = await import("../solana/smartContract");

        try {
            // Call smart contract redeem function
            const { signature, amountReceived } = await redeemFromPot(
                user.privateKey,
                pot.admin.publicKey,
                sharesToBurn
            );

            // After successful on-chain redemption, update database
            const withdrawal = await burnSharesAndWithdraw(potId, userId, sharesToBurn);

            const asset = withdrawal.assetToReturn;
            const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112"
                ? "SOL"
                : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);

            await ctx.deleteMessage(processingMsg.message_id);
            
            await ctx.replyWithMarkdownV2(
                `✅ *Withdrawal Complete\\!*\n\n` +
                `*Shares Burned:* ${escapeMarkdownV2(withdrawal.sharesBurned.toString())}\n` +
                `*Amount Received:* ${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n` +
                `*Value:* \\~\\$${escapeMarkdownV2Amount(withdrawal.valueUSD)}\n\n` +
                `🔗 [View Transaction](https://explorer.solana.com/tx/${signature}?cluster=devnet)\n\n` +
                `💡 _Funds have been transferred on\\-chain to your wallet\\._`,
                {
                    ...CHECK_BALANCE_KEYBOARD
                }
            );
        } catch (e: any) {
            console.error("Withdrawal error:", e);
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.replyWithMarkdownV2(
                `❌ *Withdrawal Failed*\n\n` +
                `⚠️ ${escapeMarkdownV2(e.message || 'Unknown error')}\n\n` +
                `Please try again or contact support\\.`,
                {
                    ...CHECK_BALANCE_KEYBOARD
                }
            );
        }
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
    assetToReturn: {
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    };
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

    // Find the base asset (cashOutMint) in the pot's assets
    const baseAsset = pot.assets.find(a => a.mintAddress === pot.cashOutMint);
    
    if (!baseAsset) {
        throw new Error(`Base asset ${pot.cashOutMint} not found in pot. Please contact support.`);
    }

    if (baseAsset.balance === BigInt(0)) {
        throw new Error("Insufficient liquidity in the pot's base asset. Cannot process withdrawal.");
    }

    // Calculate the amount to return based on shares
    const amountToReturn = BigInt(
        Math.floor(Number(baseAsset.balance) * Number(sharesToBurn) / Number(pot.totalShares))
    );

    if (amountToReturn === BigInt(0)) {
        throw new Error("Withdrawal amount too small. Try withdrawing more shares.");
    }

    const { getTokenDecimalsWithCache } = await import("../solana/getTokenDecimals");
    const decimals = await getTokenDecimalsWithCache(baseAsset.mintAddress);
    const amountReadable = Number(amountToReturn) / (10 ** decimals);

    // Calculate approximate USD value
    const { getPriceInUSD } = await import("../solana/getPriceInUSD");
    const priceUSD = await getPriceInUSD(baseAsset.mintAddress);
    const valueUSD = amountReadable * priceUSD;

    return {
        withdrawalPercentage,
        valueUSD,
        assetToReturn: {
            mintAddress: baseAsset.mintAddress,
            amount: amountToReturn,
            amountReadable
        }
    }
}

export async function burnSharesAndWithdraw(
    potId: string,
    userId: string,
    sharesToBurn: bigint
): Promise<{
    sharesBurned: bigint;
    valueUSD: number;
    assetToReturn: {
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    };
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

        // Find the base asset (cashOutMint) in the pot's assets
        const baseAsset = pot.assets.find(a => a.mintAddress === pot.cashOutMint);
        
        if (!baseAsset) {
            throw new Error(`Base asset ${pot.cashOutMint} not found in pot`);
        }

        if (baseAsset.balance === BigInt(0)) {
            throw new Error("Insufficient liquidity in the pot's base asset");
        }

        // Calculate the amount to return based on shares
        const amountToReturn = BigInt(
            Math.floor(Number(baseAsset.balance) * Number(sharesToBurn) / Number(pot.totalShares))
        );

        if (amountToReturn === BigInt(0)) {
            throw new Error("Withdrawal amount too small");
        }

        const decimals = await getTokenDecimalsWithCache(baseAsset.mintAddress);
        const amountReadable = Number(amountToReturn) / (10 ** decimals);

        // Calculate approximate USD value
        const { getPriceInUSD } = await import("../solana/getPriceInUSD");
        const priceUSD = await getPriceInUSD(baseAsset.mintAddress);
        const valueUSD = amountReadable * priceUSD;

        // Update the base asset balance
        await tx.asset.update({
            where: { id: baseAsset.id },
            data: {
                balance: baseAsset.balance - amountToReturn
            }
        });

        // Burn shares
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

        // Create withdrawal record
        const withdrawal = await tx.withdrawal.create({
            data: {
                potId,
                userId,
                sharesBurned: sharesToBurn,
                amountOut: amountToReturn
            }
        });

        return {
            sharesBurned: sharesToBurn,
            valueUSD,
            assetToReturn: {
                mintAddress: baseAsset.mintAddress,
                amount: amountToReturn,
                amountReadable
            }
        };
    }, {
        isolationLevel: "Serializable",
        timeout: 30000,
    })
} 