import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "../keyboards/keyboards";
import { formatTransactionsMessage, getRecentTransactions } from "../zerion";

export async function recentTransactionsHandler(ctx: any) {
  try {
      const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");
      
      if (isGroup) {
          return ctx.reply("⚠️ Recent Transactions is only available in private chat.\n\nPlease message me directly @solana_pot_bot", {
              ...SOLANA_POT_BOT
          });
      }

      const existingUser = await prismaClient.user.findFirst({
          where: {
              telegramUserId: ctx.from?.id.toString()
          }
      });

      if (!existingUser) {
          return ctx.reply("❌ User not found. Please start the bot first.", {
              ...DEFAULT_KEYBOARD
          });
      }

      const loadingMsg = await ctx.reply("🔄 Loading your recent transactions...");

      const transactions = await getRecentTransactions(
          existingUser.publicKey,
          5,
          ['solana']
      );

      await ctx.deleteMessage(loadingMsg.message_id);

      const message = formatTransactionsMessage(transactions, existingUser.publicKey);
      
      return ctx.replyWithMarkdownV2(message, {
          ...DEFAULT_KEYBOARD,
          link_preview_options: { is_disabled: true }
      });

  } catch (error: any) {
      console.error("Error in transactions command:", error);
      return ctx.reply(
          `❌ Failed to fetch recent transactions.\n\n` +
          `Error: ${error.message || 'Unknown error'}`,
          {
              ...DEFAULT_KEYBOARD
          }
      );
  }
}
