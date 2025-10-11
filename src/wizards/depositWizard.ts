import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { Keypair, PublicKey } from "@solana/web3.js";
import { sendSol } from "../solana/depositToVault";
import { getBalanceMessage } from "../solana/getBalance";
import type { BotContext, DepositWizardState } from "../lib/types";


export const depositSolToVaultWizard = new Scenes.WizardScene<BotContext>(
    'deposit_sol_to_vault_wizard',
    
    // 1. show pots
    async (ctx) => {
        const state = ctx.wizard.state as DepositWizardState;
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
                await ctx.replyWithMarkdownV2(
                    `✅ *Deposit successful\\!*\n\n${escapeMarkdownV2(message)}`
                );
            } else {
                await ctx.replyWithMarkdownV2(
                    `*\n\n${escapeMarkdownV2(message)}`
                );
            }
        } 
    } catch (error) {
        console.error(error);
        await ctx.reply("⚠️ Something went wrong while sending SOL.");
    }

    await ctx.answerCbQuery("Done ✅");
    return ctx.scene.leave();
})

depositSolToVaultWizard.action("wizard_cancel_deposit", async (ctx) => {
  await ctx.reply("❌ Deposit cancelled.");
  await ctx.answerCbQuery("Cancelled");
  return ctx.scene.leave();
});