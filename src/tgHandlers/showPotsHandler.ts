import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { SOL_MINT } from "../lib/statits";
import { getPriceInUSD } from "../solana/getPriceInUSD";
import { getUserPosition } from "../solana/getUserPosition";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";

export async function showPotsHandler(ctx: any) {
  try {
    const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
    });

    if (!existingUser) {
      return ctx.reply("❌ User not found. Please start the bot first.", {
        ...DEFAULT_KEYBOARD
      });
    }

    const userMemberships = await prismaClient.pot_Member.findMany({
      where: {
        userId: existingUser.id
      },
      include: {
        pot: {
          include: {
            assets: true
          }
        }
      }
    });

    if (userMemberships.length === 0) {
      return ctx.reply("📋 You haven't joined any pots yet.\n\nUse 'Create Pot' or 'Join Pot' to get started!", {
        ...DEFAULT_KEYBOARD
      });
    }

    const solPrice = await getPriceInUSD(SOL_MINT);
    const potSummaries: Array<{
      name: string;
      isAdmin: boolean;
      depositedUSD: number;
      currentValueUSD: number;
      withdrawnUSD: number;
      pnl: number;
      pnlPercentage: number;
    }> = [];

    for (const membership of userMemberships) {
      const pot = membership.pot;

      // Skip pots that aren't set up yet
      if (!pot.isGroupAdded || !pot.inviteLink) {
        continue;
      }

      const deposits = await prismaClient.deposit.findMany({
        where: {
          potId: pot.id,
          userId: existingUser.id
        }
      });

      const totalDeposited = deposits.reduce((sum, d) => sum + d.amount, BigInt(0));
      const depositedUSD = (Number(totalDeposited) / LAMPORTS_PER_SOL) * solPrice;

      const withdrawals = await prismaClient.withdrawal.findMany({
        where: {
          potId: pot.id,
          userId: existingUser.id
        }
      });

      const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amountOut, BigInt(0));
      const withdrawnUSD = Number(totalWithdrawn) / 1e6;

      const position = await getUserPosition(pot.id, existingUser.id);
      const currentValueUSD = position.valueUSD;

      const totalValueUSD = currentValueUSD + withdrawnUSD;
      const pnl = totalValueUSD - depositedUSD;
      const pnlPercentage = depositedUSD > 0 ? (pnl / depositedUSD) * 100 : 0;

      potSummaries.push({
        name: pot.name || "Unnamed Pot",
        isAdmin: pot.adminId === existingUser.id,
        depositedUSD,
        currentValueUSD,
        withdrawnUSD,
        pnl,
        pnlPercentage
      });
    }

    if (potSummaries.length === 0) {
      return ctx.reply("📋 No active pots found.\n\nCreate or join a pot to get started!", {
        ...DEFAULT_KEYBOARD
      });
    }

    // Sort by PnL percentage descending
    potSummaries.sort((a, b) => b.pnlPercentage - a.pnlPercentage);

    let message = `*💼 My Pots Summary*\n\n`;

    for (let i = 0; i < potSummaries.length; i++) {
      const pot = potSummaries[i];
      if (!pot) continue;
      
      const pnlEmoji = pot.pnl >= 0 ? "🟢" : "🔴";
      const pnlSign = pot.pnl >= 0 ? "\\+" : "\\-";
      const roleLabel = pot.isAdmin ? " \\(admin\\)" : "";

      message += `*${escapeMarkdownV2(pot.name)}*${roleLabel}\n`;
      message += `┣ Deposited: \`\\$${escapeMarkdownV2Amount(pot.depositedUSD)}\`\n`;
      
      if (pot.withdrawnUSD > 0) {
        message += `┣ Withdrawn: \`\\$${escapeMarkdownV2Amount(pot.withdrawnUSD)}\`\n`;
      }
      
      message += `┣ Current Value: \`\\$${escapeMarkdownV2Amount(pot.currentValueUSD)}\`\n`;
      message += `┗ P&L: ${pnlSign}\`\\$${escapeMarkdownV2Amount(Math.abs(pot.pnl))}\` \\(${pnlSign}\`${escapeMarkdownV2Amount(Math.abs(pot.pnlPercentage))}%\`\\) ${pnlEmoji}\n`;
      
      if (i < potSummaries.length - 1) {
        message += `\n`;
      }
    }

    await ctx.replyWithMarkdownV2(message, {
      ...DEFAULT_KEYBOARD
    });

  } catch (error) {
    console.error("Error showing pots:", error);
    ctx.reply("❌ Oops! Something went wrong while fetching your pots.", {
      ...DEFAULT_KEYBOARD
    });
  }
}