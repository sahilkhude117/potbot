import { Keypair } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { DEFAULT_GROUP_KEYBOARD, SOLANA_POT_BOT_WITH_START_KEYBOARD } from "../keyboards/keyboards";

export async function newChatMemberHandler(ctx: any) {
  try {
    const newMembers = ctx.message.new_chat_members;
    for (const member of newMembers) {
      // Skip if the bot itself is being added
      if (member.is_bot) {
        continue;
      }

      const existingUser = await prismaClient.user.findFirst({
        where: {
          telegramUserId: member.id.toString(),
        }
      })
      
      if (existingUser) {
        const pot = await prismaClient.pot.findUnique({ 
          where: { 
            telegramGroupId: ctx.chat.id.toString()
          } 
        });

        if (!pot) {
          continue; // Skip if no pot exists for this group
        }

        const isAdmin = pot?.adminId == existingUser.id;
        const role = isAdmin ? "ADMIN" : "MEMBER";

        const pot_member = await prismaClient.pot_Member.findUnique({
          where: {
            userId_potId: {
              userId: existingUser.id,
              potId: pot.id,
            }
          }
        })

        if (pot_member) {
          await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`, {
            ...DEFAULT_GROUP_KEYBOARD
          });
        } else {
          await prismaClient.pot_Member.create({
            data: {
              potId: pot.id,
              userId: existingUser.id,
              role: role
            }
          })
          await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`, {
            ...DEFAULT_GROUP_KEYBOARD
          });
        }
      } else {
        // Create new user with the member's ID, not ctx.from.id
        const keypair = Keypair.generate();
        const newUser = await prismaClient.user.create({
            data: {
                telegramUserId: member.id.toString(), // Fixed: use member.id instead of ctx.from.id
                publicKey: keypair.publicKey.toBase58(),
                privateKey: keypair.secretKey.toBase64()
            }
        })

        const pot = await prismaClient.pot.findUnique({ 
          where: { 
            telegramGroupId: ctx.chat.id.toString()
          } 
        });

        if (!pot) {
          continue; // Skip if no pot exists for this group
        }

        const isAdmin = pot?.adminId == newUser.id;
        const role = isAdmin ? "ADMIN" : "MEMBER";
        
        await prismaClient.pot_Member.create({
          data: {
            potId: pot.id,
            userId: newUser.id,
            role: role
          }
        })

        await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`,{
          ...SOLANA_POT_BOT_WITH_START_KEYBOARD
        });
      }  
    }
  } catch (error) {
      console.error("Error handling new_chat_members:", error);
      // Don't reply with error to avoid spamming the group
  }
}