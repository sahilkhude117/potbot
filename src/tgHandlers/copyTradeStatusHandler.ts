import { Markup } from "telegraf";
import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "../keyboards/keyboards";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";

export async function copyTradeStatusHandler(ctx: any) {
  try {
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

    if (!existingUser) {
      return ctx.reply("❌ User not found. Please register first.", {
        ...DEFAULT_KEYBOARD
      });
    }

    if (!existingUser.copyTrading) {
      return ctx.replyWithMarkdownV2(
        `ℹ️ *No Copy Trading Setup*\n\n` +
        `You haven't set up copy trading yet\\.\n\n` +
        `_Use /copytrade to get started\\!_`,
        {
          ...DEFAULT_KEYBOARD
        }
      );
    }

    const ct = existingUser.copyTrading;
    const statusEmoji = ct.isActive ? "🟢" : "🔴";
    const statusText = ct.isActive ? "Active" : "Stopped";
    const modeEmoji = ct.mode === 'PERMISSIONED' ? "🔐" : "⚡";

    const totalTrades = ct.copiedTrades.length;
    const successfulTrades = ct.copiedTrades.filter(t => t.status === 'EXECUTED').length;
    const failedTrades = ct.copiedTrades.filter(t => t.status === 'FAILED').length;
    const pendingTrades = ct.copiedTrades.filter(t => t.status === 'PENDING' || t.status === 'CONFIRMED').length;

    let message = `📊 *Copy Trading Status*\n\n` +
      `${statusEmoji} *Status:* ${escapeMarkdownV2(statusText)}\n\n` +
      `🎯 *Trader:* \`${escapeMarkdownV2(ct.targetWalletAddress)}\`\n\n` +
      `💰 *Allocated:* ${escapeMarkdownV2Amount(Number(ct.allocatedPercentage))}%\n\n` +
      `${modeEmoji} *Mode:* ${escapeMarkdownV2(ct.mode)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (totalTrades > 0) {
      message += `📈 *Trade Statistics*\n\n` +
        `✅ Successful: ${successfulTrades}\n` +
        `❌ Failed: ${failedTrades}\n` +
        `⏳ Pending: ${pendingTrades}\n\n`;
    } else {
      message += `ℹ️ No trades copied yet\\.\n\n`;
    }

    const buttons = [];
    
    if (ct.isActive) {
      buttons.push([Markup.button.callback("⏸️ Stop Copy Trading", "stop_copy_trade")]);
      if (ct.mode === 'PERMISSIONED') {
        buttons.push([Markup.button.callback("⚡ Switch to Permissionless", "switch_mode_permissionless")]);
      } else {
        buttons.push([Markup.button.callback("🔐 Switch to Permissioned", "switch_mode_permissioned")]);
      }
    } else {
      buttons.push([Markup.button.callback("▶️ Resume Copy Trading", "resume_copy_trade")]);
    }

    buttons.push([Markup.button.callback("🔙 Back to Menu", "back_to_menu")]);

    await ctx.replyWithMarkdownV2(message, Markup.inlineKeyboard(buttons));

  } catch (error) {
    console.error("Error checking copy trading status:", error);
    await ctx.reply("❌ Something went wrong. Please try again.", {
      ...DEFAULT_KEYBOARD
    });
  }
}