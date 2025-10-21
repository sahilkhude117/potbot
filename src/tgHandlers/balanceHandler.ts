import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";

export async function balanceHandler(ctx: any) {
    try {
        const existingUser = await prismaClient.user.findFirst({
            where: {
                telegramUserId: ctx.from?.id.toString()
            }
        });

        if (existingUser) {
          const {empty, message} = await getBalanceMessage(existingUser.publicKey.toString());

          let balanceMessage = `*💰 Your Balance:*\n\n`;
          
          if (empty) {
            balanceMessage += `You have 0 SOL in your account\\.\n\n`;
            balanceMessage += `_Please fund your wallet to start trading\\._`;
          } else {
            balanceMessage += `${escapeMarkdownV2(message)}`;
          }

          return ctx.replyWithMarkdownV2(balanceMessage, {
              ...DEFAULT_KEYBOARD
          });
        } else {
          return ctx.reply(`Sorry! We are unable to load your Balance`, {
              ...DEFAULT_KEYBOARD
          }); 
        }
    } catch (error) {
        console.error("Error in balance action:", error);
        return ctx.reply("❌ Failed to fetch your balance. Please try again.", {
            ...DEFAULT_KEYBOARD
        });
    }
}