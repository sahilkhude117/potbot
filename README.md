Role: You are solana developer having expertise in building multiuser tg bot for trading
Task: You have create functions for set trader, remove trader, and allow trading (trading part we will do later)
Instructions: first read the current codebase and then suggest how the user flow should be like only admin can set or revoke trader but we can ask for user id from admin as he might not have it. so what we can do is may be if the person who wants to be trader asks admin or admin can reply to his chat and call set trader in this way we can get id of user such that its a user's messgae whose reploed by admin or may be something else aaproach whichever is better approach. 
first lets brainstrom on idea and then we will do implementation so dont give implementation yet.
Data:
1.index.ts => import { Markup, Scenes, session, Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { ADD_POTBOT_TO_GROUP, CREATE_INVITE_DONE_KEYBOARD, CREATE_NEW_POT, DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD, SOLANA_POT_BOT, SOLANA_POT_BOT_WITH_START_KEYBOARD } from "./keyboards/keyboards";
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction}  from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";
import { createMockVault } from "./solana/createVault";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "./lib/utils";
import { depositSolToVaultWizard } from "./wizards/depositWizard";
import { withdrawFromVaultWizard } from "./wizards/withdrawalWizard";
import type { BotContext } from "./lib/types";
import { message } from "telegraf/filters";
import { getPriceInUSD } from "./solana/getPriceInUSD";
import { SOL_MINT } from "./lib/statits";
import { getUserPosition } from "./solana/getUserPosition";
import { swap } from "./solana/swapAssetsWithJup";
import { buyTokenWithSolWizard } from "./wizards/buyTokenWithSolWizard";

const bot = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN!)

const stage = new Scenes.Stage<BotContext>([
  depositSolToVaultWizard,
  withdrawFromVaultWizard,
  buyTokenWithSolWizard,
]);
bot.use(session());
bot.use(stage.middleware());

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
          await ctx.reply(`Welcome to the ${ctx.chat.title}`, {
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

bot.command('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"))

bot.command('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"))

bot.command("portfolio", async ctx => {
  try {
    const existingUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from.id.toString(),
      }
    });

    if (!existingUser) {
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

    const userMemberships = await prismaClient.pot_Member.findMany({
      where: {
        userId: existingUser?.id
      },
      include: {
        pot: {
          include: {
            assets: true
          }
        }
      }
    });

    if (userMemberships.length === 0) {
      await ctx.replyWithMarkdownV2(
          `📊 *Your Portfolio*\n\n` +
          `You haven't joined any pots yet\\.\n\n` + {
            ...DEFAULT_KEYBOARD
          }
      );
      return;
    }

    let totalDepositedUSD = 0;
    let totalCurrentValueUSD = 0;
    let totalWithdrawnUSD = 0;
    const potDetails: Array<{
      name: string;
      depositedUSD: number;
      withdrawnUSD: number;
      currentValueUSD: number;
      shares: bigint;
      sharePercentage: number;
      pnl: number;
      pnlPercentage: number;
      isActive: boolean;
    }> = [];

    const solPrice = await getPriceInUSD(SOL_MINT);

    for (const membership of userMemberships) {
      const pot = membership.pot;

      const deposits = await prismaClient.deposit.findMany({
        where: {
          potId: pot.id,
          userId: existingUser?.id
        }
      });

      const totalDeposited = deposits.reduce((sum, d) => sum + d.amount, BigInt(0));
      const depositedUSD = (Number(totalDeposited) / LAMPORTS_PER_SOL) * solPrice;

      const withdrawals = await prismaClient.withdrawal.findMany({
          where: {
              potId: pot.id,
              userId: existingUser?.id
          }
      });

      const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amountOut, BigInt(0));
      const withdrawnUSD = Number(totalWithdrawn) / 1e6;

      const position = await getUserPosition(pot.id, existingUser?.id || '');

      const totalValueUSD = position.valueUSD + withdrawnUSD;

      const pnl = totalValueUSD - depositedUSD;
      const pnlPercentage = depositedUSD > 0 ? (pnl / depositedUSD) * 100 : 0;

      totalDepositedUSD += depositedUSD;
      totalCurrentValueUSD += position.valueUSD;
      totalWithdrawnUSD += withdrawnUSD;

      if (depositedUSD > 0) {
        potDetails.push({
            name: pot.name,
            depositedUSD,
            withdrawnUSD,
            currentValueUSD: position.valueUSD,
            shares: position.shares,
            sharePercentage: position.sharePercentage,
            pnl,
            pnlPercentage,
            isActive: position.shares > BigInt(0)
        });
      }
    }

    if (potDetails.length === 0) {
        await ctx.replyWithMarkdownV2(
            `📊 *Your Portfolio*\n\n` +
            `You haven't made any deposits yet\\.\n\n` +
            `Use /deposit to get started\\!`
        );
        return;
    }

    const totalPnL = (totalCurrentValueUSD + totalWithdrawnUSD) - totalDepositedUSD;
    const totalPnLPercentage = totalDepositedUSD > 0 ? (totalPnL / totalDepositedUSD) * 100 : 0;
    const totalSOL = totalCurrentValueUSD / solPrice;
    const depositedSOL = totalDepositedUSD / solPrice;
    const withdrawnSOL = totalWithdrawnUSD / solPrice;

    const pnlEmoji = totalPnL >= 0 ? "🟢" : "🔴";
    const pnlSign = totalPnL >= 0 ? "\\+" : "";

    potDetails.sort((a, b) => b.pnlPercentage - a.pnlPercentage);

    let message = `📊 *Your Portfolio Summary*\n\n`;

    message += `*Total Deposited:* \\$${escapeMarkdownV2Amount(totalDepositedUSD)} \\(${escapeMarkdownV2Amount(depositedSOL)} SOL\\)\n`;
    message += `*Total Withdrawn:* \\$${escapeMarkdownV2Amount(totalWithdrawnUSD)} \\(${escapeMarkdownV2Amount(withdrawnSOL)} SOL\\)\n`;
    message += `*Current Holdings:* \\$${escapeMarkdownV2Amount(totalCurrentValueUSD)} \\(${escapeMarkdownV2Amount(totalSOL)} SOL\\)\n`;
    message += `*Total Value:* \\$${escapeMarkdownV2Amount(totalCurrentValueUSD + totalWithdrawnUSD)}\n`;
    message += `*Total P&L:* ${pnlSign}\\$${escapeMarkdownV2Amount(Math.abs(totalPnL))} \\(${pnlSign}${escapeMarkdownV2Amount(Math.abs(totalPnLPercentage))}%\\) ${pnlEmoji}\n\n`;
    
    message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
    
    // Individual pot breakdown
    message += `💼 *Your Pots Breakdown*\n\n`;

    for (let i = 0; i < potDetails.length; i++) {
        const pot = potDetails[i];
        if (!pot) continue;
        const potPnlEmoji = pot.pnl >= 0 ? "🟢" : "🔴";
        const potPnlSign = pot.pnl >= 0 ? "\\+" : "";
        const statusEmoji = pot.isActive ? "📈" : "📤"; 
        
        message += `${statusEmoji} *${i + 1}\\. ${escapeMarkdownV2(pot.name)}*\n`;
        if (pot.isActive) {
            message += `   *Your Share:* ${escapeMarkdownV2(pot.sharePercentage.toFixed(2))}% of pot\n`;
        }
        message += `   *Deposited:* \\$${escapeMarkdownV2Amount(pot.depositedUSD)}\n`;
        if (pot.withdrawnUSD > 0) {
            message += `   *Withdrawn:* \\$${escapeMarkdownV2Amount(pot.withdrawnUSD)}\n`;
        }
        message += `   *Current:* \\$${escapeMarkdownV2Amount(pot.currentValueUSD)}\n`;
        message += `   *Total Value:* \\$${escapeMarkdownV2Amount(pot.currentValueUSD + pot.withdrawnUSD)}\n`;
        message += `   *P&L:* ${potPnlSign}\\$${escapeMarkdownV2Amount(Math.abs(pot.pnl))} \\(${potPnlSign}${escapeMarkdownV2Amount(Math.abs(pot.pnlPercentage))}%\\) ${potPnlEmoji}\n`;
        
        if (i < potDetails.length - 1) {
            message += `\n`;
        }
    }

    message += `\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
        
    if (potDetails.length > 0) {
        const bestPot = potDetails[0];
        if (bestPot && bestPot.pnlPercentage > 0) {
            message += `🏆 *Best Performer:* ${escapeMarkdownV2(bestPot.name)} \\(\\+${escapeMarkdownV2Amount(bestPot.pnlPercentage)}%\\)\n\n`;
        }
    }

    const totalPots = potDetails.length;
    const activePots = potDetails.filter(p => p.isActive).length;
    const profitablePots = potDetails.filter(p => p.pnl > 0).length;
    message += `📈 *Quick Stats*\n`;
    message += `   Total Pots: ${totalPots} \\(${activePots} active\\)\n`;
    message += `   Profitable: ${profitablePots} / ${totalPots}\n`;
    if (activePots > 0) {
        const avgActivePotSize = totalCurrentValueUSD / activePots;
        message += `   Avg Active Pot: \\$${escapeMarkdownV2Amount(avgActivePotSize)}\n`;
    }
    message += `\n`;
    
    message += `_Last updated: ${escapeMarkdownV2(new Date().toLocaleString())}_`;

    await ctx.replyWithMarkdownV2(message);

  } catch (e: any) {
    console.error("Portfolio error:", e);
    await ctx.reply("Opps! Cant load your portfolio now");

  }
})

bot.action("buy", (ctx) => ctx.scene.enter("buy_token_with_sol_wizard"));

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

bot.action("private_key", async ctx => {
  const user = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString()
      }
  })

	return ctx.reply(
		`Your private key is ${user?.privateKey}`, {
            ...DEFAULT_KEYBOARD
        }
		
	);
});

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

bot.action("show_pots", async ctx => {
  try {
    const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
    });

    const pots = await prismaClient.pot.findMany({
      where: { 
        isGroupAdded: true, 
        inviteLink: { not: null },
        OR: [
            {
                members: {
                    some: { userId: existingUser?.id },
                },
            },
            {
                adminId: existingUser?.id,
            },
        ],
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
        .map((pot) => Markup.button.callback(pot.name || `Pot ${i + 1}`, `show_pot_${pot.id}`));
      buttons.push(row);
    }

    await ctx.reply(
      `*Here are the your pots:*`,
      {
        parse_mode: "MarkdownV2",
        ...Markup.inlineKeyboard(buttons),
      }
    );
  } catch (error) {
    ctx.reply("Opps! Something came up")
  }
})

bot.action(/show_pot_(.+)/, async (ctx) => {
  const potId = ctx.match[1];
  const pot = await prismaClient.pot.findUnique({ where: { id: potId } });
  const existingUser = await prismaClient.user.findFirst({
    where: {
      telegramUserId: ctx.from.id.toString()
    }
  });
  const userId = existingUser?.id as string

  if (!pot) {
    return ctx.reply("This pot no longer exists.");
  }

  await ctx.replyWithMarkdownV2(
    `*GM GM\\!* \n\n` +
    `You are now a proud member of the pot *${escapeMarkdownV2(pot.name)}* \n\n` + 
    `Insights and portfolio loading soon`
  );
});

bot.on(message('new_chat_members'), async (ctx) => {
  const newMembers = ctx.message.new_chat_members;
  for (const member of newMembers) {
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

      const isAdmin = pot?.adminId == existingUser.id;
      const role = isAdmin ? "ADMIN" : "MEMBER";

      if (!pot) {
        return ctx.reply("This pot no longer exists.");
      }

      const pot_member = await prismaClient.pot_Member.findUnique({
        where: {
          userId_potId: {
            userId: existingUser.id,
            potId: pot.id,
          }
        }
      })

      if (pot_member) {
        await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`);
      } else {
        await prismaClient.pot_Member.create({
          data: {
            potId: pot.id,
            userId: existingUser.id,
            role: role
          }
        })
        await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`);
      }
    } else {
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

      await ctx.reply(`👋 GM GM! ${member.first_name}! Glad to have you here.`,{
        ...SOLANA_POT_BOT_WITH_START_KEYBOARD
      });
    }  
  }
});














bot.command("trader", async (ctx) => {
  const isGroup = (ctx.chat.type == "group" || ctx.chat.type == "supergroup");
})

bot.launch()

console.log(`Bot Is Running`)