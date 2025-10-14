import { Markup, Scenes, session, Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { ADD_POTBOT_TO_GROUP, CREATE_INVITE_DONE_KEYBOARD, CREATE_NEW_POT, DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD, SOLANA_POT_BOT, SOLANA_POT_BOT_WITH_START_KEYBOARD } from "./keyboards/keyboards";
import { Connection, Keypair, LAMPORTS_PER_SOL, VersionedTransaction}  from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";
import { createMockVault } from "./solana/createVault";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "./lib/utils";
import { depositSolToVaultWizard } from "./wizards/depositWizard";
import { withdrawFromVaultWizard } from "./wizards/withdrawalWizard";
import type { BotContext } from "./lib/types";
import { message } from "telegraf/filters";
import { getPriceInUSD } from "./solana/getPriceInUSD";
import { SOL_MINT } from "./lib/statits";
import { getUserPosition } from "./solana/getUserPosition";
import { buyTokenWithSolWizard } from "./wizards/buyTokenWithSolWizard";
import { buyTokenWithSolWizardGroup } from "./wizards/buyTokenWithSolGroupWizard";
import { computePotValueInUSD } from "./solana/computePotValueInUSD";
import { getTokenDecimalsWithCache } from "./solana/getTokenDecimals";

const bot = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN!)

const stage = new Scenes.Stage<BotContext>([
  depositSolToVaultWizard,
  withdrawFromVaultWizard,
  buyTokenWithSolWizard,
  buyTokenWithSolWizardGroup
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

bot.action("buy_asset_with_solana_group", (ctx) => {
    if (ctx.chat?.type === 'private') {
        return ctx.reply("❌ This action is only available in pot group chats.");
    }
    return ctx.scene.enter("buy_token_with_sol_wizard_group");
});

async function handlePortfolio(ctx: any) {
  try {
    const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");

    if (isGroup) {
      await showGroupPortfolio(ctx);
    } else {
      await showPersonalPortfolio(ctx);
    }
  } catch (error: any) {
    console.error("Portfolio error:", error);
    await ctx.reply("❌ Failed to load portfolio. Please try again.");
  }
}

async function showPersonalPortfolio(ctx: any) {
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
    });
    const publicKey = keypair.publicKey.toString();
    await ctx.reply(`Welcome to the Pot Bot. Here is your public key ${publicKey} 
    You can trade on solana now. Put some SOL to trade.`, {
      ...DEFAULT_KEYBOARD
    });
    return;
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
      `You haven't joined any pots yet\\.\n\n` +
      `Use /deposit to get started\\!`
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
    const pnlSign = totalPnL >= 0 ? "\\+" : "\\-";

    potDetails.sort((a, b) => b.pnlPercentage - a.pnlPercentage);

    let message = `*📊 Your Personal Portfolio*\n\n`;
    message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;

    message += `*Key Metrics*\n\n`;
    message += `*Total Deposited:* \\$${escapeMarkdownV2Amount(totalDepositedUSD)}\n`;
    message += `*Total Withdrawn:* \\$${escapeMarkdownV2Amount(totalWithdrawnUSD)}\n`;
    message += `*Current Holdings:* \\$${escapeMarkdownV2Amount(totalCurrentValueUSD)}\n`;
    message += `*Total Value:* \\$${escapeMarkdownV2Amount(totalCurrentValueUSD + totalWithdrawnUSD)}\n`;
    message += `*All\\-Time P&L:* ${pnlSign}\\$${escapeMarkdownV2Amount(Math.abs(totalPnL))} \\(${pnlSign}${escapeMarkdownV2Amount(Math.abs(totalPnLPercentage))}%\\) ${pnlEmoji}\n\n`;
    
    message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
    
    message += `*💼 Your Pots Breakdown*\n\n`;

    for (let i = 0; i < potDetails.length; i++) {
        const pot = potDetails[i];
        if (!pot) continue;
        const potPnlEmoji = pot.pnl >= 0 ? "🟢" : "🔴";
        const potPnlSign = pot.pnl >= 0 ? "\\+" : "\\-";
        const statusEmoji = pot.isActive ? "📈" : "📤"; 
        
        message += `${statusEmoji} *${escapeMarkdownV2(pot.name)}*\n`;
        message += `> Deposited: \\$${escapeMarkdownV2Amount(pot.depositedUSD)}\n`;
        if (pot.withdrawnUSD > 0) {
            message += `> Withdrawn: \\$${escapeMarkdownV2Amount(pot.withdrawnUSD)}\n`;
        }
        message += `> Current Value: \\$${escapeMarkdownV2Amount(pot.currentValueUSD)}\n`;
        if (pot.isActive) {
            message += `> Your Share: ${escapeMarkdownV2(pot.sharePercentage.toFixed(2))}%\n`;
        }
        message += `> P&L: ${potPnlSign}\\$${escapeMarkdownV2Amount(Math.abs(pot.pnl))} \\(${potPnlSign}${escapeMarkdownV2Amount(Math.abs(pot.pnlPercentage))}%\\) ${potPnlEmoji}\n`;
        
        if (i < potDetails.length - 1) {
            message += `\n`;
        }
    }

    message += `\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
    
    message += `*Portfolio Statistics*\n\n`;
    const totalPots = potDetails.length;
    const activePots = potDetails.filter(p => p.isActive).length;
    const profitablePots = potDetails.filter(p => p.pnl > 0).length;
    message += `*Pots:* ${totalPots} total \\(${activePots} active\\)\n`;
    message += `*Profitable Pots:* ${profitablePots} / ${totalPots}\n`;
    if (activePots > 0) {
        const avgActivePotSize = totalCurrentValueUSD / activePots;
        message += `*Avg Pot Value:* \\$${escapeMarkdownV2Amount(avgActivePotSize)}\n`;
    }
    
    if (potDetails.length > 0) {
        const bestPot = potDetails[0];
        if (bestPot && bestPot.pnlPercentage > 0) {
            message += `*Best Performer:* ${escapeMarkdownV2(bestPot.name)} \\(\\+${escapeMarkdownV2Amount(bestPot.pnlPercentage)}%\\)\n`;
        }
    }
    
    message += `\n_Last updated: ${escapeMarkdownV2(new Date().toLocaleString())}_`;

  await ctx.replyWithMarkdownV2(message);
}

async function showGroupPortfolio(ctx: any) {
  const pot = await prismaClient.pot.findUnique({
    where: {
      telegramGroupId: ctx.chat.id.toString()
    },
    include: {
      assets: true,
      members: true
    }
  });

  if (!pot) {
    await ctx.reply("❌ No pot found for this group.");
    return;
  }

  const solPrice = await getPriceInUSD(SOL_MINT);

  const potValueUSD = await computePotValueInUSD(
    pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance }))
  );
  const potValueSOL = potValueUSD / solPrice;

  const deposits = await prismaClient.deposit.findMany({
    where: { potId: pot.id }
  });

  const withdrawals = await prismaClient.withdrawal.findMany({
    where: { potId: pot.id }
  });

  const totalDepositsLamports = deposits.reduce((sum, d) => sum + d.amount, BigInt(0));
  const totalWithdrawalsLamports = withdrawals.reduce((sum, w) => sum + w.amountOut, BigInt(0));
  
  const totalDepositsSOL = Number(totalDepositsLamports) / LAMPORTS_PER_SOL;
  const totalWithdrawalsSOL = Number(totalWithdrawalsLamports) / LAMPORTS_PER_SOL;

  const totalDepositsUSD = totalDepositsSOL * solPrice;
  const totalWithdrawalsUSD = totalWithdrawalsSOL * solPrice;

  const allTimePnLUSD = (potValueUSD + totalWithdrawalsUSD) - totalDepositsUSD;
  const allTimePnLSOL = allTimePnLUSD / solPrice;

  const allTimePnLPercentage = totalDepositsUSD > 0 ? (allTimePnLUSD / totalDepositsUSD) * 100 : 0;

  const pnlEmoji = allTimePnLSOL >= 0 ? "🟢" : "🔴";
  const pnlSign = allTimePnLSOL >= 0 ? "\\+" : "\\-";

  let assetAllocation = "";
  const sortedAssets = [...pot.assets].sort((a, b) => {
    const aValue = Number(b.balance);
    const bValue = Number(a.balance);
    return bValue - aValue;
  });

  for (const asset of sortedAssets) {
    if (asset.balance === BigInt(0)) continue;

    const decimals = await getTokenDecimalsWithCache(asset.mintAddress);
    const balanceReadable = Number(asset.balance) / (10 ** decimals);
    const priceUSD = await getPriceInUSD(asset.mintAddress);
    const valueUSD = balanceReadable * priceUSD;
    const valueSOL = valueUSD / solPrice;
    const percentage = potValueUSD > 0 ? (valueUSD / potValueUSD) * 100 : 0;

    let symbol = "TOKEN";
    let emoji = "🪙";
    if (asset.mintAddress === SOL_MINT) {
      symbol = "SOL";
      emoji = "🪙";
    } else if (asset.mintAddress === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") {
      symbol = "USDC";
      emoji = "💵";
    } else {
      symbol = asset.mintAddress.substring(0, 4).toUpperCase();
      emoji = "🎯";
    }

    assetAllocation += `\n${emoji} *${escapeMarkdownV2(symbol)}:*\n`;
    assetAllocation += `> Balance: \`${escapeMarkdownV2Amount(balanceReadable)}\`\n`;
    assetAllocation += `> Value: \\$${escapeMarkdownV2Amount(valueUSD)} \\(${escapeMarkdownV2Amount(percentage)}%\\)\n`;
  }

  const navPerShareUSD = pot.totalShares > BigInt(0) 
    ? potValueUSD / Number(pot.totalShares) 
    : 0;

  const inceptionDate = pot.createdAt.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });

  const solAsset = pot.assets.find(a => a.mintAddress === SOL_MINT);
  const actualSOLBalance = solAsset ? Number(solAsset.balance) / LAMPORTS_PER_SOL : 0;
  const trackedNetSOL = totalDepositsSOL - totalWithdrawalsSOL;
  const hasUntrackedDeposits = actualSOLBalance > (trackedNetSOL * 1.01); // 1% tolerance

  let message = `*📈 Group Portfolio: ${escapeMarkdownV2(pot.name || "Unnamed Pot")}*\n\n`;
  message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
  
  message += `*Key Metrics*\n\n`;
  message += `*Total Value Locked \\(TVL\\):* \\$${escapeMarkdownV2Amount(potValueUSD)}\n`;
  message += `*All\\-Time PnL:* ${pnlSign}\\$${escapeMarkdownV2Amount(Math.abs(allTimePnLUSD))} \\(${pnlSign}${escapeMarkdownV2Amount(Math.abs(allTimePnLPercentage))}%\\) ${pnlEmoji}\n`;
  message += `*Tracked Deposits:* \\$${escapeMarkdownV2Amount(totalDepositsUSD)}\n`;
  message += `*Tracked Withdrawals:* \\$${escapeMarkdownV2Amount(totalWithdrawalsUSD)}\n`;
  
  if (hasUntrackedDeposits) {
    message += `\n_ℹ️ Note: Current balance suggests additional deposits made outside bot \\(e\\.g\\. via Phantom\\)\\. PnL may be higher than actual\\._\n`;
  }
  message += `\n`;
  
  message += `\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
  message += `*Asset Allocation*`;
  message += assetAllocation;
  
  message += `\n\n\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\\-\n\n`;
  message += `*Pot Statistics*\n\n`;
  message += `*Members:* \`${pot.members.length}\`\n`;
  message += `*Total Shares Issued:* \`${escapeMarkdownV2Amount(Number(pot.totalShares))}\`\n`;
  message += `*Net Asset Value \\(NAV\\) per Share:* \\$${escapeMarkdownV2Amount(navPerShareUSD)}\n`;
  message += `*Inception Date:* \`${escapeMarkdownV2(inceptionDate)}\`\n`;

  await ctx.replyWithMarkdownV2(message);
}

bot.command("portfolio", handlePortfolio);

bot.action("portfolio", async (ctx) => {
  await handlePortfolio(ctx);
  await ctx.answerCbQuery();
});

bot.action("buy", (ctx) => ctx.scene.enter("buy_token_with_sol_wizard"));
bot.action("buy_asset_with_solana_group", (ctx) => ctx.scene.enter("buy_token_with_sol_wizard_group"));

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



bot.command("settrader", async (ctx) => {
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
      const mentionEntity = entities.find(
        e => e.type === "mention" || e.type === "text_mention"
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
      // User hasn't started bot in DM, that's okay
      console.log(`Could not send DM to user ${targetUserId}`);
    }

  } catch (error) {
    console.error("Error in settrader command:", error);
    await ctx.reply("❌ An error occurred while setting trader. Please try again.");
  }
})

bot.command("removetrader", async (ctx) => {
  try {
    const isGroup = (ctx.chat.type === "group" || ctx.chat.type === "supergroup");
    
    if (!isGroup) {
      return ctx.reply("⚠️ This command can only be used in group chats.");
    }

    // Get the current user (command caller)
    const caller = await prismaClient.user.findFirst({
      where: {
        telegramUserId: ctx.from.id.toString()
      }
    });

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
        return ctx.reply("⚠️ Bots cannot be traders.");
      }

      targetUserId = repliedToUser.id.toString();
      targetUsername = repliedToUser.username || repliedToUser.first_name;
    } else {
      const commandText = ctx.message.text;
      const mentionMatch = commandText.match(/@(\w+)/);
      
      if (!mentionMatch) {
        return ctx.reply(
          "⚠️ Please either:\n" +
          "1. Reply to a user's message and use /removetrader, OR\n" +
          "2. Use /removetrader @username"
        );
      }

      const entities = ctx.message.entities || [];
      const mentionEntity = entities.find(
        e => e.type === "mention" || e.type === "text_mention"
      );

      if (mentionEntity && mentionEntity.type === "text_mention" && mentionEntity.user) {
        targetUserId = mentionEntity.user.id.toString();
        targetUsername = mentionEntity.user.username || mentionEntity.user.first_name;
      } else {
        return ctx.reply(
          "⚠️ Username matching can be unreliable.\n\n" +
          "📝 Recommended: Reply to the user's message and use /removetrader for accurate identification."
        );
      }
    }

    if (!targetUserId) {
      return ctx.reply("⚠️ Could not identify the user.");
    }

    const targetUser = await prismaClient.user.findFirst({
      where: {
        telegramUserId: targetUserId
      }
    });

    if (!targetUser) {
      return ctx.reply("⚠️ This user is not in the system.");
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

    if (targetMembership.role !== "TRADER") {
      if (targetMembership.role === "ADMIN") {
        return ctx.reply("⚠️ Cannot remove trader status from an admin.");
      }
      return ctx.reply(`⚠️ ${targetUsername} is not a trader.`);
    }

    await prismaClient.pot_Member.update({
      where: {
        userId_potId: {
          userId: targetUser.id,
          potId: pot.id
        }
      },
      data: {
        role: "MEMBER"
      }
    });

    await ctx.reply(
      `❌ ${targetUsername} is no longer a trader in ${pot.name}.\n\n` +
      `They have been changed to a regular member.`
    );

    try {
      await ctx.telegram.sendMessage(
        parseInt(targetUserId),
        `📢 Notice\n\n` +
        `Your trader permissions in "${pot.name}" have been revoked.\n\n` +
        `You are now a regular member.`
      );
    } catch (error) {
      console.log(`Could not send DM to user ${targetUserId}`);
    }

  } catch (error) {
    console.error("Error in removetrader command:", error);
    await ctx.reply("❌ An error occurred while removing trader. Please try again.");
  }
})

bot.command("traders", async (ctx) => {
  try {
    const isGroup = (ctx.chat.type === "group" || ctx.chat.type === "supergroup");
    
    if (!isGroup) {
      return ctx.reply("⚠️ This command can only be used in group chats.");
    }

    const pot = await prismaClient.pot.findUnique({
      where: {
        telegramGroupId: ctx.chat.id.toString()
      },
      include: {
        members: {
          where: {
            OR: [
              { role: "TRADER" },
              { role: "ADMIN" }
            ]
          },
          include: {
            user: true
          }
        }
      }
    });

    if (!pot) {
      return ctx.reply("⚠️ This group is not connected to any pot.");
    }

    if (pot.members.length === 0) {
      return ctx.reply(
        `📊 Traders in ${pot.name}\n\n` +
        `No traders assigned yet.\n\n` +
        `Admins can use /settrader to assign traders.`
      );
    }

    const adminId = pot.adminId;
    const traders = pot.members.filter(m => m.role === "TRADER");

    let message = `📊 Traders in ${pot.name}\n\n`;

  
    message += `👑 Admins (can trade):\n`;
    const admin = await prismaClient.user.findFirst({
      where: {
        id: adminId
      }
    })
    const telegramId = admin?.telegramUserId as string;
    try {
      const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(telegramId));
      const name = chatMember.user.username 
        ? `@${chatMember.user.username}` 
        : chatMember.user.first_name;
      message += `  • ${name}\n`;
    } catch (error) {
      message += `  • User ${telegramId}\n`;
    }
    
    message += `\n`;


    if (traders.length > 0) {
      message += `🎯 Traders:\n`;
      for (const trader of traders) {
        const telegramId = trader.user.telegramUserId;
        try {
          const chatMember = await ctx.telegram.getChatMember(ctx.chat.id, parseInt(telegramId));
          const name = chatMember.user.username 
            ? `@${chatMember.user.username}` 
            : chatMember.user.first_name;
          message += `  • ${name}\n`;
        } catch (error) {
          message += `  • User ${telegramId}\n`;
        }
      }
    }

    message += `\n💡 Total: ${traders.length + 1} authorized trader(s)`;

    await ctx.reply(message);

  } catch (error) {
    console.error("Error in traders command:", error);
    await ctx.reply("❌ An error occurred while fetching traders. Please try again.");
  }
});

bot.command("traderhelp", async (ctx) => {
  const helpMessage = 
    `📚 Trader Management Commands\n\n` +
    `🔧 Admin Commands:\n` +
    `/settrader - Grant trader permissions\n` +
    `  • Reply to user's message: /settrader\n` +
    `  • Mention user: /settrader @username\n\n` +
    `/removetrader - Revoke trader permissions\n` +
    `  • Reply to user's message: /removetrader\n` +
    `  • Mention user: /removetrader @username\n\n` +
    `📊 All Users:\n` +
    `/traders - List all traders in the pot\n\n` +
    `💡 Tips:\n` +
    `• Reply method is more reliable\n` +
    `• Only admins can manage traders\n` +
    `• Admins automatically have trading permissions`;

  await ctx.reply(helpMessage);
});

bot.launch()
    .then(() => console.log("✅ Bot started successfully"))
    .catch((err) => console.error("❌ Failed to start bot:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));