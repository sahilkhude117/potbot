import { prismaClient } from "../db/prisma";
import { CREATE_INVITE_DONE_KEYBOARD, DEFAULT_GROUP_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";

export async function createInviteHandler(ctx: any) {
  try {
    const telegramGroupId = ctx.chat?.id.toString();
    
    // First, get the pot to access vault address and other details
    const pot = await prismaClient.pot.findUnique({
      where: {
        telegramGroupId: telegramGroupId,
      },
      include: {
        admin: true
      }
    });

    if (!pot) {
      await ctx.reply("❌ No pot found for this group.", {
        ...DEFAULT_GROUP_KEYBOARD
      });
      return;
    }

    // Create invite link with pot description
    let description = `🏦 Vault: ${pot.potSeed}\n`;
    description += `👤 Admin: @${ctx.from?.username || 'Admin'}\n`;
    description += `📅 Created: ${pot.createdAt.toLocaleDateString()}`;
    
    const inviteLink = await ctx.createChatInviteLink({
      name: `${pot.name} - Pot Invite`,
      member_limit: undefined, // No limit
    });

    // Try to set chat description (requires admin permission)
    try {
      if (ctx.chat?.id) {
        await ctx.telegram.setChatDescription(ctx.chat.id, description);
      }
    } catch (descError) {
      console.log("Could not set chat description:", descError);
      // Continue even if description setting fails
    }

    try {
      await prismaClient.pot.update({
        where: {
          telegramGroupId: telegramGroupId,
        },
        data : {
          inviteLink: inviteLink.invite_link
        }
      });

      let successMessage = `✅ *Successful\\!* I am promoted now 😎\n\n`;
      successMessage += `*📋 Pot Details:*\n`;
      successMessage += `*Name:* ${escapeMarkdownV2(pot.name)}\n`;
      successMessage += `*Vault:* \`${escapeMarkdownV2(pot.potSeed)}\`\n\n`;
      successMessage += `*🔗 Invite Link:*\n${escapeMarkdownV2(inviteLink.invite_link)}\n\n`;
      successMessage += `_Share this link to invite members to your pot\\!_`;

      ctx.replyWithMarkdownV2(successMessage, {
        ...DEFAULT_GROUP_KEYBOARD
      });
    } catch (e) {
      await ctx.reply("Opps! I am not admin yet 😔");
      await ctx.replyWithMarkdownV2(
    `*Please Enable Full Bot Functionality:*\n\n` +
    `_You can do this by opening the group info \\> Administrators \\> Add Admin \\> Select me and grant permissions_\n\n` + 
    `After you are done, *click the button below to test* and create the invite link\\.`, {
      ...CREATE_INVITE_DONE_KEYBOARD
    })
    }
  } catch (error) {
      console.error("Error in create_invite action:", error);
      await ctx.reply("❌ Failed to create invite link. Please make sure I have admin permissions.", {
          ...DEFAULT_GROUP_KEYBOARD
      });
  }
}