You are solana engineer having expertise in building tg bots from trading. 
Your job is to 
    - create buyTokenWithSolWizard
        - ask for token mint address (ask them to collect it from https://cryptorank.io/blockchains/solana)(validate it) -> ask for quantity -> show quote (confirm/cancel) -> on confirm buy.
Instructions:
    - we already have a implementation of swap just have to make it dynamic with user inputs
    
Data:
1. index.ts => 
const stage = new Scenes.Stage<BotContext>([
  depositSolToVaultWizard,
  withdrawFromVaultWizard,
]);
bot.use(session());
bot.use(stage.middleware());


bot.command('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"))

bot.command('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"))

bot.action("buy", async (ctx) => {
  const existingUser = await prismaClient.user.findFirst({
    where: {
      telegramUserId: ctx.from.id.toString()
    }
  })
  const tokenMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const quantity = 0.00006;
  const userKeypair = Keypair.fromSecretKey(decodeSecretKey(existingUser?.privateKey as string));

  try {
    const swapTxn = await swap(SOL_MINT, tokenMint, Number(quantity) * LAMPORTS_PER_SOL, existingUser?.publicKey!);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTxn), c => c.charCodeAt(0)));
    tx.sign([userKeypair]);
    const sign = await connection.sendTransaction(tx);
    ctx.reply(`Swap successful, you can track it here https://explorer.solana.com/tx/${sign}`);
  } catch (error) {
    console.log(error);
    ctx.reply(`Error while doing a swap`);
  }
})

2. swap => import axios from "axios";

const JUP_URl = "https://lite-api.jup.ag"
const SWAP_URL = "https://lite-api.jup.ag/swap/v1/swap";

const SLIPPAGE = 5;

export async function swap(
    inputMint: string,
    outputMint: string,
    quantity: number,
    userPublicKey: string
) {
    let quoteConfig = {
        method: 'get',
        maxBodyLength: Infinity,
        url: `${JUP_URl}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${quantity}&slippageBps=${SLIPPAGE}&userPublicKey=${userPublicKey}&platformFeeBps=0&cluster=devnet`,
        headers: { 
            'Accept': 'application/json'
        }
    };

    const response = await axios.request(quoteConfig);

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: SWAP_URL,
        headers: { 
            'Content-Type': 'application/json', 
            'Accept': 'application/json'
        },
        data : {quoteResponse: response.data, payer: userPublicKey, userPublicKey: userPublicKey, cluster: "devnet"}
    };

    const swapResponse = await axios.request(config);

    return swapResponse.data.swapTransaction;
}
3. wizard example => import { Markup, Scenes } from "telegraf";
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
                try {
                    const mintedShares = await mintSharesAndDeposit(
                        potId,
                        userId,
                        BigInt(amount * LAMPORTS_PER_SOL),
                    );
                    const newShares = mintedShares.userNewShares;
                    const totalUserShares = mintedShares.sharesMinted;
                    const totalPotShares = mintedShares.newTotalShares;

                    const userPercentage = ((Number(totalUserShares) / Number(totalPotShares)) * 100).toFixed(2);
                    const newSharesPercentage = ((Number(newShares) / Number(totalPotShares)) * 100).toFixed(2);
                    await ctx.replyWithMarkdownV2(
                        `✅ *Deposit successful\\!*\n\n` +
                    escapeMarkdownV2(
                        `Details \n\n` + 
                        `New Shares: ${totalUserShares} (${userPercentage}%)\n\n` +
                        `Your Total Shares: ${newShares} (${newSharesPercentage}%) \n\n` +
                        `Total Shares: ${totalPotShares} \n\n` +
                        `${message}`
                    ));
                } catch (e: any) {
                    await ctx.replyWithMarkdownV2(
                    `${e.message}`
                    );
                }
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
