import { Markup } from "telegraf";
import { prismaClient } from "../db/prisma";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { escapeMarkdownV2 } from "../lib/utils";

export async function joinPotHandler(ctx: any) {
  try {
    const existingUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from.id.toString()
      }
    })

    const pots = await prismaClient.pot.findMany({
      where: { 
        isGroupAdded: true, 
        inviteLink: { not: null },
        members: {
          none: { userId:  existingUser?.id }, // exclude pots where user is already a member
        },
      }, 
      select: { id: true, name: true },
    });

    if (!pots.length) {
      return ctx.reply("No active pots available right now.", {
        ...DEFAULT_KEYBOARD
      });
    }

    const buttons: any[][] = [];
    for (let i = 0; i < pots.length; i += 2) {
      const row = pots
        .slice(i, i + 2)
        .map((pot) => Markup.button.callback(pot.name || `Pot ${i + 1}`, `join_pot_${pot.id}`));
      buttons.push(row);
    }

    await ctx.reply(
      `*Here are the available pots:*`,
      {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard(buttons),
      }
    );
  } catch (error) {
      console.error("Error in join_pot action:", error);
      return ctx.reply("❌ Failed to load available pots. Please try again.", {
          ...DEFAULT_KEYBOARD
      });
  }
}


export async function joinPotIndividualHandler(ctx: any) {
  try {
    const potId = ctx.match[1];
    const pot = await prismaClient.pot.findUnique({ where: { id: potId } });
    const existingUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from.id.toString()
      }
    });
    const userId = existingUser?.id as string
    const isAdmin = pot?.adminId == userId;

    if (!pot) {
      return ctx.reply("This pot no longer exists.", {
        ...DEFAULT_KEYBOARD
      });
    }

    const role = isAdmin ? "ADMIN" : "MEMBER";

    const pot_member = await prismaClient.pot_Member.create({
      data: {
        potId: pot.id,
        userId: userId,
        role: role
      }
    })

    await ctx.replyWithMarkdownV2(
      `*GM GM\\!* \n\n` +
      `You are now a proud member of the pot *${escapeMarkdownV2(pot.name)}* \n\n` +
      `Join the Official Group from here: ${escapeMarkdownV2(pot.inviteLink as string)} \n\n` +
      `Get ready to trade, grow, and earn together with your group\\.\n\n` +
      `_Stay active — more features and rewards are coming soon\\!_`,
      {
        ...DEFAULT_KEYBOARD
      }
    );
  } catch (error) {
      console.error("Error in join_pot action:", error);
      return ctx.reply("❌ Failed to join pot. Please try again.", {
          ...DEFAULT_KEYBOARD
      });
  }
}