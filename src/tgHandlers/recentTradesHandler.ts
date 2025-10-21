import { prismaClient } from "../db/prisma";
import { DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";
import { getExplorerUrl } from "../solana/getConnection";
import { getRecentTransactions } from "../zerion";
import { formatAmount, getTypeEmoji } from "../zerion/getRecentTransactions";

export async function recentTradesHandler(ctx: any) {
  try {
      // Check if in group chat
      const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");
      
      if (!isGroup) {
          return ctx.reply("⚠️ Recent Trades is only available in group chats.", {
              ...DEFAULT_KEYBOARD
          });
      }

      // Get the pot associated with this group
      const pot = await prismaClient.pot.findUnique({
          where: {
              telegramGroupId: ctx.chat.id.toString()
          }
      });

      if (!pot) {
          return ctx.reply("❌ No pot found for this group.");
      }

      // Get the admin user to access the vault public key
      const adminUser = await prismaClient.user.findFirst({
          where: {
              id: pot.adminId
          }
      });

      if (!adminUser) {
          return ctx.reply("❌ Admin user not found.");
      }

      const loadingMsg = await ctx.reply("🔄 Loading recent trades for this pot...");

      const transactions = await getRecentTransactions(
          pot.potSeed, 
          5,
          ['solana']
      );

      await ctx.deleteMessage(loadingMsg.message_id);

      let message = `*🔄 Recent Trades for ${escapeMarkdownV2(pot.name || "Pot")}*\n\n`;
      message += `Vault: \`${escapeMarkdownV2(pot.potSeed)}\`\n\n`;
      message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (transactions.length === 0) {
          message += `No trades found for this pot yet\\.`;
      } else {
          transactions.forEach((tx, index) => {
              const typeEmoji = getTypeEmoji(tx.type);
              const statusEmoji = tx.status === 'confirmed' ? '✅' : '⏳';
              
              message += `${typeEmoji} *${escapeMarkdownV2(tx.type.toUpperCase())}* ${statusEmoji}\n`;
              
              if (tx.transfers.length > 0) {
                  message += `┣ Transfers:\n`;
                  
                  const isTrade = tx.type.toLowerCase() === 'trade';
                  
                  tx.transfers.forEach((transfer, i) => {
                      const prefix = '┣';
                      
                      let displaySymbol = transfer.symbol;
                      if (transfer.symbol === '???' || transfer.symbol === 'Unknown' || !transfer.symbol) {
                          displaySymbol = 'Unknown';
                      }

                      if (isTrade) {
                          const directionLabel = transfer.direction === 'in' ? 'IN' : 'OUT';
                          message += `${prefix}   ${escapeMarkdownV2(directionLabel)}: ${escapeMarkdownV2(formatAmount(transfer.amount))} ${escapeMarkdownV2(displaySymbol)} `;
                      } else {
                          const directionEmoji = transfer.direction === 'in' ? '📥' : '📤';
                          message += `${prefix}   ${directionEmoji} ${escapeMarkdownV2(formatAmount(transfer.amount))} ${escapeMarkdownV2(displaySymbol)} `;
                      }
                      
                      message += `\\(\`\\$${escapeMarkdownV2(formatAmount(transfer.valueUSD))}\`\\)\n`;
                  });
              }

              message += `┣ 🔗 [View Transaction](${getExplorerUrl(tx.hash)})\n`;
              message += `┗ Date: \`${escapeMarkdownV2(tx.date)}\`\n`;
              
              if (index < transactions.length - 1) {
                  message += `\n`;
              }
          });
      }
      
      return ctx.replyWithMarkdownV2(message, {
          ...DEFAULT_GROUP_KEYBOARD,
          link_preview_options: { is_disabled: true }
      });

  } catch (error: any) {
      console.error("Error in recent trades:", error);
      return ctx.reply(
          `❌ Failed to fetch recent trades.\n\n` +
          `Error: ${error.message || 'Unknown error'}`,
          {
              ...DEFAULT_GROUP_KEYBOARD
          }
      );
  }
}