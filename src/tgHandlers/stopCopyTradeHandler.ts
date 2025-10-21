import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";

export async function stopCopyTradeHandler(ctx: any) {
  try {
    // Answer callback query if this is triggered from a button
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }

    const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");
    
    if (isGroup) {
      return ctx.reply("⚠️ Copy Trading is only available in private chat.\n\nPlease message me directly @solana_pot_bot", {
        ...SOLANA_POT_BOT
      });
    }

    const existingUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from?.id.toString()
      },
      include: {
        copyTrading: true
      }
    });

    if (!existingUser) {
      return ctx.reply("❌ User not found. Please register first.", {
        ...DEFAULT_KEYBOARD
      });
    }

    if (!existingUser.copyTrading || !existingUser.copyTrading.isActive) {
      return ctx.reply("ℹ️ You don't have any active copy trading.", {
        ...DEFAULT_KEYBOARD
      });
    }

    const copyTrading = existingUser.copyTrading;

    await prismaClient.copyTrading.update({
      where: { userId: existingUser.id },
      data: { isActive: false }
    });

    await ctx.replyWithMarkdownV2(
      `✅ *Copy Trading Stopped*\n\n` +
      `🎯 *Trader:* \`${escapeMarkdownV2(copyTrading.targetWalletAddress.slice(0, 8))}...${escapeMarkdownV2(copyTrading.targetWalletAddress.slice(-8))}\`\n\n` +
      `The bot is no longer monitoring this trader's wallet\\.\n\n` +
      `_Use /copytrade to start copy trading again_`,
      {
        ...DEFAULT_KEYBOARD
      }
    );

  } catch (error) {
    console.error("Error stopping copy trading:", error);
    await ctx.reply("❌ Something went wrong. Please try again.", {
      ...DEFAULT_KEYBOARD
    });
  }
}