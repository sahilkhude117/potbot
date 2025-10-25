import { Keypair, PublicKey } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { SOLANA_POT_BOT_WITH_START_KEYBOARD } from "../keyboards/keyboards";
import { addTraderOnChain } from "../solana/smartContract";
import { parseVaultAddress } from "../lib/walletManager";

export async function setTraderHandler(ctx: any) {
  try {
    const isGroup = (ctx.chat.type == "group" || ctx.chat.type == "supergroup");

    if (!isGroup) {
      return ctx.reply("⚠️ This command can only be used in group chats.");
    }

    const caller = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from.id.toString()
      }
    })

    if (!caller) {
      const keypair = Keypair.generate();
      const newUser = await prismaClient.user.create({
          data: {
              telegramUserId: ctx.from.id.toString(),
              publicKey: keypair.publicKey.toBase58(),
              privateKey: keypair.secretKey.toBase64()
          }
      })

      const pot = await prismaClient.pot.findUnique({ 
        where: { 
          telegramGroupId: ctx.chat.id.toString()
        } 
      });

      const isAdmin = pot?.adminId == newUser.id;
      const role = isAdmin ? "ADMIN" : "MEMBER";

      if (!pot) {
        return ctx.reply("This pot no longer exists.");
      }
      
      const pot_member = await prismaClient.pot_Member.create({
        data: {
          potId: pot.id,
          userId: newUser.id,
          role: role
        }
      })

      await ctx.reply(`👋 GM GM! ${ctx.from.first_name}! Glad to have you here.`,{
        ...SOLANA_POT_BOT_WITH_START_KEYBOARD
      });
    }

    const pot = await prismaClient.pot.findUnique({
      where: {
        telegramGroupId: ctx.chat.id.toString()
      },
      include: {
        members: true
      }
    });

    if (!pot) {
      return ctx.reply("⚠️ This group is not connected to any pot.");
    }

    const callerMembership = await prismaClient.pot_Member.findUnique({
      where: {
        userId_potId: {
          userId: caller?.id as string,
          potId: pot.id
        }
      }
    });

    if (!callerMembership || pot.adminId !== caller?.id) {
      return ctx.reply("⚠️ Only pot admins can manage traders.");
    }

    let targetUserId: string | undefined;
    let targetUsername: string | undefined;

    if (ctx.message.reply_to_message) {
      const repliedToUser = ctx.message.reply_to_message.from;

      if (!repliedToUser) {
        return ctx.reply("⚠️ Could not identify the user from the replied message.");
      }

      if (repliedToUser.is_bot) {
        return ctx.reply("⚠️ Bots cannot be set as traders.");
      }

      targetUserId = repliedToUser.id.toString();
      targetUsername = repliedToUser.username || repliedToUser.first_name;
    } else {
      const commandText = ctx.message.text;
      const mentionMatch = commandText.match(/@(\w+)/);

      if (!mentionMatch) {
        return ctx.reply(
          "⚠️ Please either:\n" +
          "1. Reply to a user's message and use /settrader, OR\n" +
          "2. Use /settrader @username"
        );
      }

      const username = mentionMatch[1];
    const entities = ctx.message.entities || [];
    type TelegramMessageEntity = { type: string; user?: { id: number; username?: string; first_name?: string }; };
    const mentionEntity: TelegramMessageEntity | undefined = entities.find(
      (e: TelegramMessageEntity) => e.type === "mention" || e.type === "text_mention"
    );

      if (mentionEntity && mentionEntity.type === "text_mention" && mentionEntity.user) {
        targetUserId = mentionEntity.user.id.toString();
        targetUsername = mentionEntity.user.username || mentionEntity.user.first_name;
      } else {
        const potMembersWithUsername = await prismaClient.pot_Member.findMany({
          where: {
            potId: pot.id
          },
          include: {
            user: true
          }
        })

        return ctx.reply(
          "⚠️ Username matching can be unreliable.\n\n" +
          "📝 Recommended: Reply to the user's message and use /settrader for accurate identification."
        );
      }
    }

    if (!targetUserId) {
      return ctx.reply("⚠️ Could not identify the target user.");
    }

    const targetUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: targetUserId
      }
    });

    if (!targetUser) {
      return ctx.reply(
        "⚠️ This user hasn't started the bot yet.\n" +
        "Ask them to send /start to @solana_pot_bot first."
      );
    }

    const targetMembership = await prismaClient.pot_Member.findUnique({
      where: {
        userId_potId: {
          userId: targetUser.id,
          potId: pot.id
        }
      }
    });

    if (!targetMembership) {
      return ctx.reply("⚠️ This user is not a member of this pot.");
    }

    if (targetMembership.role === "TRADER" || targetMembership.role === "ADMIN") {
      return ctx.reply(
        `⚠️ ${targetUsername} is already ${targetMembership.role === "ADMIN" ? "an admin" : "a trader"}.`
      );
    }

    // Check which mode to use (wallet or smart contract)
    const walletData = parseVaultAddress(pot.vaultAddress);

    if (walletData) {
      // ===== WALLET MODE (Active) =====
      // No on-chain transaction needed - just update database
      try {
        await prismaClient.pot_Member.update({
          where: {
            userId_potId: {
              userId: targetUser.id,
              potId: pot.id
            }
          },
          data: {
            role: "TRADER"
          }
        });

        await ctx.reply(
          `✅ ${targetUsername} is now a trader in ${pot.name}!\n\n` +
          `They can now execute trades on behalf of the pot.`
        );

        try {
          await ctx.telegram.sendMessage(
            parseInt(targetUserId),
            `🎉 Congratulations!\n\n` +
            `You've been granted trader permissions in "${pot.name}".\n\n` +
            `You can now execute trades for the pot.`
          );
        } catch (error) {
          console.log(`Could not send DM to user ${targetUserId}`);
        }
      } catch (error) {
        console.error("Error setting trader:", error);
        return ctx.reply("❌ Failed to set trader. Please try again.");
      }

    } else {
      // ===== SMART CONTRACT MODE (Fallback) =====
      try {
        // Get admin user to access their private key
        const adminUser = await prismaClient.user.findFirst({
          where: { id: pot.adminId }
        });

        if (!adminUser) {
          return ctx.reply("❌ Admin user not found.");
        }

        // Add trader on the smart contract first
        const potSeedPublicKey = new PublicKey(pot.potSeed);
        const signature = await addTraderOnChain(
          adminUser.privateKey,
          potSeedPublicKey,
          targetUser.publicKey
        );

        // If on-chain transaction succeeds, update database
        await prismaClient.pot_Member.update({
          where: {
            userId_potId: {
              userId: targetUser.id,
              potId: pot.id
            }
          },
          data: {
            role: "TRADER"
          }
        });

        await ctx.reply(
          `✅ ${targetUsername} is now a trader in ${pot.name}!\n\n` +
          `They can now execute trades on behalf of the pot.\n\n` +
          `🔗 Transaction: ${signature}`
        );

        try {
          await ctx.telegram.sendMessage(
            parseInt(targetUserId),
            `🎉 Congratulations!\n\n` +
            `You've been granted trader permissions in "${pot.name}".\n\n` +
            `You can now execute trades for the pot.\n\n` +
            `Transaction: ${signature}`
          );
        } catch (error) {
          console.log(`Could not send DM to user ${targetUserId}`);
        }
      } catch (error) {
        console.error("Error adding trader on-chain:", error);
        return ctx.reply(
          "❌ Failed to add trader on blockchain. Please try again later.\n\n" +
          "The database has not been updated."
        );
      }
    }

  } catch (error) {
    console.error("Error in settrader command:", error);
    await ctx.reply("❌ An error occurred while setting trader. Please try again.");
  }
}