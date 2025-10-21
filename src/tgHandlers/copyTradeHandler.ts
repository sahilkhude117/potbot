import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "../keyboards/keyboards";
import { showCopyTradeStatus } from "../lib/copyTradingStatus";

export async function copyTradeHandler(ctx: any) {
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

    if (existingUser.copyTrading && existingUser.copyTrading.isActive) {
      return showCopyTradeStatus(ctx, existingUser);
    }

    return ctx.scene.enter("copy_trading_wizard");
  } catch (error) {
    console.error("Error in copy_trading action:", error);
    return ctx.reply("❌ Something went wrong. Please try again.", {
      ...DEFAULT_KEYBOARD
    });
  }
}