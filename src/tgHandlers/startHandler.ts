import { Keypair } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { CREATE_INVITE_DONE_KEYBOARD, CREATE_NEW_POT, DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";

export async function startHandler(ctx: any) {
    const isGroup = (ctx.chat.type == "group" || ctx.chat.type == "supergroup");
    const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from.id.toString()
      }
    })
    
    if (isGroup) {
      const userId = existingUser?.id;
      const groupId = ctx.chat.id.toString();

      const pot = await prismaClient.pot.findFirst({
        where: {
          adminId: userId,
          isGroupAdded: false
        }
      });

      const potWithTelegramGroup = await prismaClient.pot.findFirst({
        where: {
          telegramGroupId: groupId
        }
      })

      if (pot) {
        const isPotAdded = potWithTelegramGroup;

        if (isPotAdded) {
          await ctx.reply(`The pot is already attached group: ${ctx.chat.title}`, {
            ...SOLANA_POT_BOT
          });
        } else {
          await prismaClient.pot.update({
            where: { id: pot.id },
            data: { 
              name: ctx.chat.title,
              telegramGroupId: groupId,
              isGroupAdded: true
            }
          });

          await ctx.reply(`${ctx.chat.title} successfully connected to Pot!`);
          await ctx.replyWithMarkdownV2(
  `*Next Steps to Enable Full Bot Functionality:*\n\n` +
  `1\\. *Make me an administrator* in the group with following permissions\\:\n` +
  `\\- Manage messages\n` +
  `\\- Delete messages\n` +
  `\\- Invite users via link\n` +
  `\\- Pin messages\n` +
  `\\- Change group info\n\n` +
  `3\\. After promotion, I will be able to help you moderate and run the Pot smoothly\\.\n\n` +
  `_You can do this by opening the group info \\> Administrators \\> Add Admin \\> Select me and grant permissions_\n\n` +
   `After you are done, *click the button below to test* and create the invite link\\.`, {
    ...CREATE_INVITE_DONE_KEYBOARD
   } 
);
        }
      } else if (potWithTelegramGroup) {
        const hasInviteLink = !!potWithTelegramGroup.inviteLink;
        if (hasInviteLink) {
          await ctx.reply(`Welcome to the ${ctx.chat.title}\n\nType /help to see all available commands.`, {
              ...DEFAULT_GROUP_KEYBOARD
          })

        } else {
          await ctx.replyWithMarkdownV2(
  `*Hey\\! Looks like I am still just a member 😔 Please Enable Full Bot Functionality:*\n\n` +
  `1\\. *Make me an administrator* in the group with following permissions\\:\n` +
  `\\- Manage messages\n` +
  `\\- Delete messages\n` +
  `\\- Invite users via link\n` +
  `\\- Pin messages\n` +
  `\\- Change group info\n\n` +
  `3\\. After promotion, I will be able to help you moderate and run the Pot smoothly\\.\n\n` +
  `_You can do this by opening the group info \\> Administrators \\> Add Admin \\> Select me and grant permissions_\n\n` + 
  `After you are done, *click the button below to test* and create the invite link\\.`, {
    ...CREATE_INVITE_DONE_KEYBOARD
  }
);
        }    
      } else {
        await ctx.reply(`The group is not attached to any pot`, {
            ...CREATE_NEW_POT
          });
      }
    } else {
      if (existingUser) {
          const publicKey = existingUser.publicKey;
          const { empty, message } = await getBalanceMessage(existingUser.publicKey.toString());

          let welcomeMessage = `*🎉 Welcome to Pot Bot\\!*\n\n`;
          welcomeMessage += `*Your Wallet Address:*\n`;
          welcomeMessage += `\`${escapeMarkdownV2(publicKey)}\`\n\n`;
          
          if (empty) {
            welcomeMessage += `*💰 Balance:*\n`;
            welcomeMessage += `Your wallet is currently empty\\.\n\n`;
            welcomeMessage += `_Please fund your wallet with SOL to start trading\\._\n\n`;
          } else {
            welcomeMessage += `*💰 Balance:*\n`;
            welcomeMessage += `${escapeMarkdownV2(message)}\n\n`;
            welcomeMessage += `_You're all set to trade on Solana\\!_\n\n`;
          }

          welcomeMessage += `Type /help to see all available commands\\.`;

          ctx.replyWithMarkdownV2(welcomeMessage, {
              ...DEFAULT_KEYBOARD
          })
      } else {
        const keypair = Keypair.generate();
        await prismaClient.user.create({
            data: {
                telegramUserId: ctx.from.id.toString(),
                publicKey: keypair.publicKey.toBase58(),
                privateKey: keypair.secretKey.toBase64()
            }
        })
        const publicKey = keypair.publicKey.toString();
        
        let welcomeMessage = `*🎉 Welcome to Pot Bot\\!*\n\n`;
        welcomeMessage += `*Your Wallet Address:*\n`;
        welcomeMessage += `\`${escapeMarkdownV2(publicKey)}\`\n\n`;
        welcomeMessage += `*💰 Balance:*\n`;
        welcomeMessage += `Your wallet is currently empty\\.\n\n`;
        welcomeMessage += `_Please fund your wallet with SOL to start trading\\._\n\n`;
        welcomeMessage += `Type /help to see all available commands\\.`;

        ctx.replyWithMarkdownV2(welcomeMessage, {
            ...DEFAULT_KEYBOARD
        })
      }
    }
}