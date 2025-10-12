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

    // 3: ask withdraw amount
    async (ctx) => {
        const state = ctx.wizard.state as WithdrawalWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid amount.");
        }

        let sharesToBurn: bigint;

        if (text.endsWith("%")) {
            const percentage = parseFloat(text.slice(0, -1));
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                return ctx.reply("❌ Please enter a valid percentage between 0 and 100 (e.g., 50%)");
            }

            const member = await prismaClient.pot_Member.findUnique({
                where: {
                    userId_potId: {
                        userId: state.userId,
                        potId: state.potId
                    }
                }
            });

            if (!member) {
                await ctx.reply("You are not a member of this pot.");
                return ctx.scene.leave();
            }

            sharesToBurn = BigInt(Math.floor(Number(member.shares) * (percentage / 100)));
        } else {
            const sharesInput = parseFloat(text);
            if (isNaN(sharesInput) || sharesInput <= 0) {
                return ctx.reply("❌ Please enter a valid number of shares or percentage (e.g., 1000000 or 50%)");
            }

            sharesToBurn = BigInt(Math.floor(sharesInput));
        }

        if (sharesToBurn === BigInt(0)) {
            return ctx.reply("❌ Amount too small. Please enter a larger value.")
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
            `⚠️ _You will receive a proportional share of ALL assets, not just one asset\\._`
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
        await ctx.reply("Processing withdrawal....");

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

    await ctx.answerCbQuery("Done");
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
} 