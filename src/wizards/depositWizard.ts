import { Markup, Scenes } from "telegraf";
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
        const processingMsg = await ctx.reply("⏳ Processing your on-chain deposit...");

        const pot = await prismaClient.pot.findUnique({ 
            where: { id: potId },
            include: { admin: true }
        });
        const user = await prismaClient.user.findUnique({ where: { id: userId }});

        if (!pot || !user) {
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply("❌ Something went wrong. Please try again.");
            return ctx.scene.leave();
        }

        // Import smart contract functions
        const { depositToPot } = await import("../solana/smartContract");
        
        try {
            // Call smart contract deposit function
            const { signature, sharesMinted } = await depositToPot(
                user.privateKey,
                pot.admin.publicKey,
                amount
            );

            // After successful on-chain deposit, update database
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
                `🔗 [View Transaction](https://explorer.solana.com/tx/${signature}?cluster=devnet)\n\n` +
                `_Deposit recorded on\\-chain and in database\\._`
            );
        } catch (e: any) {
            console.error("Deposit error:", e);
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply(`❌ Deposit failed: ${e.message || 'Unknown error'}`);
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
