import { prismaClient } from "../db/prisma";
import { showCopyTradeStatus } from "../lib/copyTradingStatus";

export async function switchModePermissionedHandler(ctx: any) {
  try {
    await ctx.answerCbQuery("Switching to Permissioned mode...");

    const existingUser = await prismaClient.user.findFirst({
      where: { telegramUserId: ctx.from?.id.toString() },
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

    if (!existingUser?.copyTrading) {
      return ctx.reply("❌ Copy trading not found.");
    }

    await prismaClient.copyTrading.update({
      where: { userId: existingUser.id },
      data: { mode: 'PERMISSIONED' }
    });

    // Refresh user data with updated mode
    const updatedUser = await prismaClient.user.findFirst({
      where: { telegramUserId: ctx.from?.id.toString() },
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

    // Show full trade status with updated mode
    await showCopyTradeStatus(ctx, updatedUser);
  } catch (error) {
    console.error("Error switching mode:", error);
    await ctx.reply("❌ Failed to switch mode.");
  }
}