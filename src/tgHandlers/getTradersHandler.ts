import { prismaClient } from "../db/prisma";

export async function getTradersHandler(ctx: any) {
  try {
    const isGroup = (ctx.chat.type === "group" || ctx.chat.type === "supergroup");
    
    if (!isGroup) {
      return ctx.reply("⚠️ This command can only be used in group chats.");
    }

    const pot = await prismaClient.pot.findUnique({
      where: {
        telegramGroupId: ctx.chat.id.toString()
      },
      include: {
        members: {
          where: {
            OR: [
              { role: "TRADER" },
              { role: "ADMIN" }
            ]
          },
          include: {
            user: true
          }
        }
      }
    });

    if (!pot) {
      return ctx.reply("⚠️ This group is not connected to any pot.");
    }

    if (pot.members.length === 0) {
      return ctx.reply(
        `📊 Traders in ${pot.name}\n\n` +
        `No traders assigned yet.\n\n` +
        `Admins can use /settrader to assign traders.`
      );
    }

    const adminId = pot.adminId;
    const traders = pot.members.filter(m => m.role === "TRADER");

    let message = `📊 Traders in ${pot.name}\n\n`;

  
    message += `👑 Admins (can trade):\n`;
    const admin = await prismaClient.user.findFirst({
      where: {
        id: adminId
      }
    })
    const telegramId = admin?.telegramUserId as string;
    try {
      const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(telegramId));
      const name = chatMember.user.username 
        ? `@${chatMember.user.username}` 
        : chatMember.user.first_name;
      message += `  • ${name}\n`;
    } catch (error) {
      message += `  • User ${telegramId}\n`;
    }
    
    message += `\n`;


    if (traders.length > 0) {
      message += `🎯 Traders:\n`;
      for (const trader of traders) {
        const telegramId = trader.user.telegramUserId;
        try {
          const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(telegramId));
          const name = chatMember.user.username 
            ? `@${chatMember.user.username}` 
            : chatMember.user.first_name;
          message += `  • ${name}\n`;
        } catch (error) {
          message += `  • User ${telegramId}\n`;
        }
      }
    }

    message += `\n💡 Total: ${traders.length + 1} authorized trader(s)`;

    await ctx.reply(message);

  } catch (error) {
    console.error("Error in traders command:", error);
    await ctx.reply("❌ An error occurred while fetching traders. Please try again.");
  }
}