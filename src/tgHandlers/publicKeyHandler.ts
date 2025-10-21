import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";

export async function publicKeyHandler(ctx: any) {
    try {
        const existingUser = await prismaClient.user.findFirst({
            where: {
                telegramUserId: ctx.from?.id.toString()
            }
        });

        if (existingUser) {
          const {empty, message} = await getBalanceMessage(existingUser.publicKey.toString());

          let keyMessage = `*🔑 Your Wallet Address:*\n`;
          keyMessage += `\`${escapeMarkdownV2(existingUser?.publicKey)}\`\n\n`;
          
          if (empty) {
            keyMessage += `*💰 Balance:*\n`;
            keyMessage += `Your wallet is currently empty\\.\n\n`;
            keyMessage += `_Please fund your wallet with SOL to start trading\\._`;
          } else {
            keyMessage += `*💰 Balance:*\n`;
            keyMessage += `${escapeMarkdownV2(message)}`;
          }

          return ctx.replyWithMarkdownV2(keyMessage, {
              ...DEFAULT_KEYBOARD
          });
        } else {
          return ctx.reply(`Sorry! We are unable to find your publicKey`, {
              ...DEFAULT_KEYBOARD
          }); 
        }
    } catch (error) {
        console.error("Error in public_key action:", error);
        return ctx.reply("❌ Failed to fetch your public key. Please try again.", {
            ...DEFAULT_KEYBOARD
        });
    }
}