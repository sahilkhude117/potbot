import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";

export async function privateKeyHandler(ctx: any) {
  try {
    const user = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.from?.id.toString()
        }
    })

    if (user) {
      let privateKeyMessage = `*🔐 Your Private Key*\n\n`;
      privateKeyMessage += `⚠️ *KEEP THIS SECRET\\!*\n\n`;
      privateKeyMessage += `\`${escapeMarkdownV2(user.privateKey)}\`\n\n`;
      privateKeyMessage += `*🚨 Security Warning:*\n`;
      privateKeyMessage += `• Never share this with anyone\n`;
      privateKeyMessage += `• Anyone with this key can access your funds\n`;
      privateKeyMessage += `• This message will auto\\-delete in 1 minute\n\n`;
      privateKeyMessage += `_Save it securely now\\!_`;

      const sentMessage = await ctx.replyWithMarkdownV2(privateKeyMessage, {
        ...DEFAULT_KEYBOARD
      });

      // Delete the message after 1 minute (60000 milliseconds)
      setTimeout(async () => {
        try {
          await ctx.deleteMessage(sentMessage.message_id);
        } catch (error) {
          console.error("Failed to delete private key message:", error);
        }
      }, 60000);

      return sentMessage;
    } else {
      return ctx.reply(`Sorry! We are unable to find your private key`, {
          ...DEFAULT_KEYBOARD
      });
    }
  } catch (error) {
      console.error("Error in private_key action:", error);
      return ctx.reply("❌ Failed to fetch your private key. Please try again.", {
          ...DEFAULT_KEYBOARD
      });
  }
}