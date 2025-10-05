import { Markup, Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { ADD_POTBOT_TO_GROUP, CREATE_INVITE_DONE_KEYBOARD, CREATE_NEW_POT, DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "./keyboards/keyboards";
import { Keypair } from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";
import { createMockVault } from "./solana/createVault";
import { escapeMarkdownV2 } from "./lib/utils";
import { Role } from "./generated/prisma";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

bot.start(async (ctx) => {
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
          await ctx.reply(`Hello how can i help you?`);
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

          ctx.reply(`Welcome to the Pot Bot. Here is your public key ${publicKey} 
            ${empty ? "Your wallet is empty please fund it to trade on SOL": message}`, {
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
        ctx.reply(`Welcome to the Pot Bot. Here is your public key ${publicKey} 
        You can trade on solana now. Put some SOL to trade.`, {
            ...DEFAULT_KEYBOARD
        })
      }
    }
    
})

bot.action("public_key", async ctx => {
    const existingUser = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.from?.id.toString()
        }
    });

    if (existingUser) {
      const {empty, message} = await getBalanceMessage(existingUser.publicKey.toString());

      return ctx.reply(
        `Your public key is ${existingUser?.publicKey} ${empty ? "Fund your wallet to trade" : message}`, {
                ...DEFAULT_KEYBOARD
          }   
      );
    } else {
      return ctx.reply(`Sorry! We are unable to find your publicKey`); 
    }
});

// bot.action("private_key", async ctx => {
//   const user = await prismaClient.user.findFirst({
//       where: {
//           telegramUserId: ctx.from?.id.toString()
//       }
//   })

// 	return ctx.reply(
// 		`Your private key is ${user?.privateKey}`, {
//             ...DEFAULT_KEYBOARD
//         }
		
// 	);
// });

bot.action("balance", async ctx => {
    const existingUser = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.from?.id.toString()
        }
    });

    if (existingUser) {
      const {empty, message} = await getBalanceMessage(existingUser.publicKey.toString());

      return ctx.reply(
        `${empty ? "You have 0 SOL in your account. Please fund your wallet to trade" : message}`, {
            ...DEFAULT_KEYBOARD
          }   
      );
    } else {
      return ctx.reply(`Sorry! We are unable to load your Balance`); 
    }
})

bot.action("create_pot", async (ctx) => {
  const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
  });

  if (existingUser) {
    const newVault = createMockVault();

    const pot = await prismaClient.pot.create({
      data: {
          name: "",
          adminId: existingUser.id,
          telegramGroupId: `telegramGroupId_${ctx.from.id}_${newVault.publicKey}`,
          vaultAddress: JSON.stringify(newVault),
          isGroupAdded: false
      }
    })

    await ctx.replyWithMarkdownV2(
    `*Created Pot Successfully*\\.

*Pot Id*: ${escapeMarkdownV2(pot.id)}

*Vault Id*: ${escapeMarkdownV2(pot.vaultAddress)}

*Please follow these steps carefully:*

*Step 1:* *Create a new group* in Telegram manually \\(open Telegram \\> tap pencil icon \\> New Group \\> add members \\> create\\)\\.

*Step 2:* After creating the group, *click the button below* to join me in the group\\.

*Note:* You *must first create the group* before clicking the button below\\.`, {
      ...ADD_POTBOT_TO_GROUP
    }
  );
  }
})


bot.action("join_pot", async ctx => {
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
})

bot.action(/join_pot_(.+)/, async (ctx) => {
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
    return ctx.reply("This pot no longer exists.");
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
    `_Stay active — more features and rewards are coming soon\\!_`
  );
});


bot.action("create_invite", async ctx => {
  const inviteLink = await ctx.createChatInviteLink();
  const telegramGroupId = ctx.chat?.id.toString();

  try {
    const pot = await prismaClient.pot.update({
      where: {
        telegramGroupId: telegramGroupId,
      },
      data : {
        inviteLink: inviteLink.invite_link
      }
    })

    ctx.reply(`Successful! I am the Promoted now 😎. Here is the Invite Link to add members to your pot: ${pot.inviteLink}`)
  } catch (e) {
    await ctx.reply("Opps! I am not admin yet 😔");
    await ctx.replyWithMarkdownV2(
  `*Please Enable Full Bot Functionality:*\n\n` +
  `_You can do this by opening the group info \\> Administrators \\> Add Admin \\> Select me and grant permissions_\n\n` + 
  `After you are done, *click the button below to test* and create the invite link\\.`, {
    ...CREATE_INVITE_DONE_KEYBOARD
  })
  }
})


bot.launch()

console.log(`Bot Is Running`)