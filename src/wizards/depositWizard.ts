import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { sendSol } from "../solana/depositToVault";
import { getBalanceMessage } from "../solana/getBalance";
import type { BotContext, DepositWizardState, MintSharesInput } from "../lib/types";
import { getPriceInUSD } from "../solana/getPriceInUSD";
import { SOL_DECIMALS, SOL_MINT } from "../lib/statits";
import { getTokenDecimals } from "../solana/getTokenDecimals";

const decimalsCache = new Map<string, number>();

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

    // 3. amount
    async (ctx) => {
        const state = ctx.wizard.state as DepositWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();
        const amount = parseFloat(text ?? '');

        if (isNaN(amount) || amount <= 0) {
            return ctx.reply("❌ Please enter a valid number (e.g., 2.5)");
        }

        const lamports = amount * 1_000_000_000;
        if (lamports < 1) {
            return ctx.reply("❌ Amount too small — must be at least 0.000000001 SOL.");
            return;
        }

        const user = await prismaClient.user.findUnique({ where: { id: state.userId } });
        if (!user) {
            await ctx.reply("User not found. Please register again.");
            return ctx.scene.leave();
        }

        const fromKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const { empty, balance } = await getBalanceMessage(fromKeypair.publicKey.toString());

        if (empty || balance < amount) {
            await ctx.replyWithMarkdownV2(
            `❌ *Insufficient balance*\nYou have only ${escapeMarkdownV2Amount(balance)} SOL available\\. Please enter valid amount`
            );
            return;
        }

        state.amount = amount;

        await ctx.replyWithMarkdownV2(
            `💰 *Confirm deposit of ${escapeMarkdownV2Amount(amount)} SOL to pot:* _${escapeMarkdownV2(state.potName)}_`,
            Markup.inlineKeyboard([
                [Markup.button.callback("✅ Confirm", "wizard_confirm_deposit"), 
                Markup.button.callback("❌ Cancel", "wizard_cancel_deposit")],
            ])
        );

        return ctx.wizard.next();
    },

    // 4. wait for confirm/cancel
    async (ctx) => {
        // handled in bot.action below
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

    await ctx.reply(`How much SOL do you want to deposit into *${escapeMarkdownV2(pot.name)}*?`, {
        parse_mode: "MarkdownV2",
    });

    await ctx.answerCbQuery();
    ctx.wizard.selectStep(2);
})

depositSolToVaultWizard.action("wizard_confirm_deposit", async (ctx) => {
    const state = ctx.wizard.state as DepositWizardState;
    const { potId, amount, userId } = state;

    try {
        const pot = await prismaClient.pot.findUnique({ where: { id: potId }});
        const user = await prismaClient.user.findUnique({ where: { id: userId }});

        if (!pot || !user) {
            await ctx.reply("Something went wrong. Please try again.");
            return ctx.scene.leave();
        }

        const fromKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));
        const toVault = JSON.parse(pot.vaultAddress);
        const toPublicKey = new PublicKey(toVault.publicKey);

        const { empty, balance } = await getBalanceMessage(fromKeypair.publicKey.toString());

        if (balance < amount) {
            await ctx.replyWithMarkdownV2(
                `Oops\\! Insufficient Balance`
            );
            return ctx.scene.leave();
        } else {
            const { message, success } = await sendSol(fromKeypair, toPublicKey, amount);

            if (success) {
                const mintedShares = await mintShares(
                    potId,
                    userId,
                    BigInt(amount * LAMPORTS_PER_SOL),
                );
                const newShares = mintedShares.userNewShares;
                const totalUserShares = mintedShares.sharesMinted;
                const totalPotShares = mintedShares.newTotalShares;

                const userPercentage = ((Number(totalUserShares) / Number(totalPotShares)) * 100).toFixed(2);
                const newSharesPercentage = ((Number(newShares) / Number(totalPotShares)) * 100).toFixed(2);
                await ctx.replyWithMarkdownV2(escapeMarkdownV2(
                    `✅ *Deposit successful\\!*\n\n` +
                    `Details \n\n` + 
                    `New Shares: ${newShares} (${newSharesPercentage})\n\n` +
                    `Your Total Shares: ${totalUserShares} (${userPercentage})\n\n` +
                    `Total Shares: ${totalPotShares} \n\n` +
                    `${message}`
                ));
            } else {
                await ctx.replyWithMarkdownV2(
                    `*\n\n${escapeMarkdownV2(message)}`
                );
            }
        } 
    } catch (error) {
        console.error(error);
        await ctx.reply("⚠️ Something went wrong while sending SOL.");
        ctx.scene.leave();
    }

    await ctx.answerCbQuery("Done ✅");
    return ctx.scene.leave();
})

depositSolToVaultWizard.action("wizard_cancel_deposit", async (ctx) => {
  await ctx.reply("❌ Deposit cancelled.");
  await ctx.answerCbQuery("Cancelled");
  return ctx.scene.leave();
});


async function getTokenDecimalsWithCache(mintAddress: string): Promise<number> {
    if (mintAddress === SOL_MINT) return SOL_DECIMALS;

    if (decimalsCache.has(mintAddress)) {
        return decimalsCache.get(mintAddress) as number;
    }

    const decimals = await getTokenDecimals(mintAddress);
    decimalsCache.set(mintAddress, decimals);
    return decimals;
}

async function computePotValueInUSD(
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

export async function mintShares(
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
                    where: { userId }
                }
            }
        });

        if (!pot) throw new Error ("Pot not found");

        let member = pot.members[0];
        if (!member) {
            member = await tx.pot_Member.create({
                data: {
                    potId,
                    userId,
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

export async function getUserShareValue(
    potId: string,
    userId: string
): Promise<{
    sharePercentage: number;
    valueUSD: number;
    shares: bigint;
}> {
    const pot = await prismaClient.pot.findUnique({
        where: { id: potId },
        include: {
            assets: true,
            members: {
                where: { userId }
            }
        }
    });

    if (!pot) throw new Error("Pot not found");
    
    const member = pot.members[0];
    if (!member) {
        return { sharePercentage: 0, valueUSD: 0, shares: BigInt(0) };
    }

    const priceCache = new Map<string, number>();
    const totalPotValueUSD = await computePotValueInUSD(
        pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance })),
    );

    const sharePercentage = pot.totalShares === BigInt(0) 
        ? 0 
        : Number(member.shares) / Number(pot.totalShares);

    const valueUSD = totalPotValueUSD * sharePercentage;

    return {
        sharePercentage: sharePercentage * 100,
        valueUSD,
        shares: member.shares,
    };
}