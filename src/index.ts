import { Markup, Scenes, session, Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { ADD_POTBOT_TO_GROUP, ADD_POTBOT_TO_GROUP_WITH_DONE, CREATE_INVITE_DONE_KEYBOARD, CREATE_NEW_POT, DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD, SOLANA_POT_BOT, SOLANA_POT_BOT_WITH_START_KEYBOARD } from "./keyboards/keyboards";
import { Keypair, LAMPORTS_PER_SOL, VersionedTransaction, PublicKey}  from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";
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
import { sellTokenForSolWizard } from "./wizards/sellTokenForSolWizard";
import { sellTokenForSolWizardGroup } from "./wizards/sellTokenForSolGroupWizard";
import { computePotValueInUSD } from "./solana/computePotValueInUSD";
import { getTokenDecimalsWithCache } from "./solana/getTokenDecimals";
import { initializePotOnChain, addTraderOnChain, removeTraderOnChain} from "./solana/smartContract";
import { getRecentTransactions, formatTransactionsMessage } from "./zerion/getRecentTransactions";

const bot = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN!)

const stage = new Scenes.Stage<BotContext>([
  depositSolToVaultWizard,
  withdrawFromVaultWizard,
  buyTokenWithSolWizard,
  buyTokenWithSolWizardGroup,
  sellTokenForSolWizard,
  sellTokenForSolWizardGroup
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

          let welcomeMessage = `*🎉 Welcome to Pot Bot\\!*\n\n`;
          welcomeMessage += `*Your Wallet Address:*\n`;
          welcomeMessage += `\`${escapeMarkdownV2(publicKey)}\`\n\n`;
          
          if (empty) {
            welcomeMessage += `*💰 Balance:*\n`;
            welcomeMessage += `Your wallet is currently empty\\.\n\n`;
            welcomeMessage += `_Please fund your wallet with SOL to start trading\\._`;
          } else {
            welcomeMessage += `*💰 Balance:*\n`;
            welcomeMessage += `${escapeMarkdownV2(message)}\n\n`;
            welcomeMessage += `_You're all set to trade on Solana\\!_`;
          }

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
        welcomeMessage += `_Please fund your wallet with SOL to start trading\\._`;

        ctx.replyWithMarkdownV2(welcomeMessage, {
            ...DEFAULT_KEYBOARD
        })
      }
    }
})

bot.command('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"))
bot.action('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"))

bot.command('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"))
bot.action('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"))

bot.command('transactions', recentTransactions);
bot.action("recent_transactions", recentTransactions);

async function recentTransactions(ctx: any) {
  try {
      const existingUser = await prismaClient.user.findFirst({
          where: {
              telegramUserId: ctx.from?.id.toString()
          }
      });

      if (!existingUser) {
          return ctx.reply("❌ User not found. Please start the bot first.", {
              ...DEFAULT_KEYBOARD
          });
      }

      const loadingMsg = await ctx.reply("🔄 Loading your recent transactions...");

      const transactions = await getRecentTransactions(
          existingUser.publicKey,
          5,
          ['solana']
      );

      await ctx.deleteMessage(loadingMsg.message_id);

      const message = formatTransactionsMessage(transactions, existingUser.publicKey, 'devnet');
      
      return ctx.replyWithMarkdownV2(message, {
          ...DEFAULT_KEYBOARD,
          link_preview_options: { is_disabled: true }
      });

  } catch (error: any) {
      console.error("Error in transactions command:", error);
      return ctx.reply(
          `❌ Failed to fetch recent transactions.\n\n` +
          `Error: ${error.message || 'Unknown error'}`,
          {
              ...DEFAULT_KEYBOARD
          }
      );
  }
}

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
    
    let welcomeMessage = `*🎉 Welcome to Pot Bot\\!*\n\n`;
    welcomeMessage += `*Your Wallet Address:*\n`;
    welcomeMessage += `\`${escapeMarkdownV2(publicKey)}\`\n\n`;
    welcomeMessage += `*💰 Balance:*\n`;
    welcomeMessage += `Your wallet is currently empty\\.\n\n`;
    welcomeMessage += `_Please fund your wallet with SOL to start trading\\._`;

    await ctx.replyWithMarkdownV2(welcomeMessage, {
      ...DEFAULT_KEYBOARD
    });
    return;
  }

  const userMemberships = await prismaClient.pot_Member.findMany({
    where: {
      userId: existingUser?.id
    },
    include:
     {
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
      vaultAddress: string;
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
            vaultAddress: pot.potSeed,
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

    message += `*💎 Key Metrics*\n\n`;
    message += `*Total Deposited:*\n\`\\$${escapeMarkdownV2Amount(totalDepositedUSD)}\`\n\n`;
    message += `*Total Withdrawn:*\n\`\\$${escapeMarkdownV2Amount(totalWithdrawnUSD)}\`\n\n`;
    message += `*Current Holdings:*\n\`\\$${escapeMarkdownV2Amount(totalCurrentValueUSD)}\`\n\n`;
    message += `*Total Value:*\n\`\\$${escapeMarkdownV2Amount(totalCurrentValueUSD + totalWithdrawnUSD)}\`\n\n`;
    message += `*All\\-Time P&L:*\n${pnlSign}\`\\$${escapeMarkdownV2Amount(Math.abs(totalPnL))}\` \\(${pnlSign}\`${escapeMarkdownV2Amount(Math.abs(totalPnLPercentage))}%\`\\) ${pnlEmoji}\n\n`;
    
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    message += `*💼 Your Pots Breakdown* \\(${potDetails.length}\\)\n\n`;

    for (let i = 0; i < potDetails.length; i++) {
        const pot = potDetails[i];
        if (!pot) continue;
        const potPnlEmoji = pot.pnl >= 0 ? "🟢" : "🔴";
        const potPnlSign = pot.pnl >= 0 ? "\\+" : "\\-";
        const statusEmoji = pot.isActive ? "📈" : "📤"; 
        
        message += `${statusEmoji} *${escapeMarkdownV2(pot.name)}* ${potPnlEmoji}\n`;
        message += `┣ Vault: \`${escapeMarkdownV2(pot.vaultAddress)}\`\n`;
        message += `┣ Deposited: \`\\$${escapeMarkdownV2Amount(pot.depositedUSD)}\`\n`;
        if (pot.withdrawnUSD > 0) {
            message += `┣ Withdrawn: \`\\$${escapeMarkdownV2Amount(pot.withdrawnUSD)}\`\n`;
        }
        message += `┣ Current: \`\\$${escapeMarkdownV2Amount(pot.currentValueUSD)}\`\n`;
        if (pot.isActive) {
            message += `┣ Share: \`${escapeMarkdownV2(pot.sharePercentage.toFixed(2))}%\`\n`;
        }
        message += `┗ P&L: ${potPnlSign}\`\\$${escapeMarkdownV2Amount(Math.abs(pot.pnl))}\` \\(${potPnlSign}\`${escapeMarkdownV2Amount(Math.abs(pot.pnlPercentage))}%\`\\)\n`;
        
        if (i < potDetails.length - 1) {
            message += `\n`;
        }
    }

    message += `\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    message += `*📈 Portfolio Statistics*\n\n`;
    const totalPots = potDetails.length;
    const activePots = potDetails.filter(p => p.isActive).length;
    const profitablePots = potDetails.filter(p => p.pnl > 0).length;
    message += `*Active Pots:* \`${activePots}\` / \`${totalPots}\`\n`;
    message += `*Profitable:* \`${profitablePots}\` / \`${totalPots}\`\n`;
    if (activePots > 0) {
        const avgActivePotSize = totalCurrentValueUSD / activePots;
        message += `*Avg Pot Value:* \`\\$${escapeMarkdownV2Amount(avgActivePotSize)}\`\n`;
    }
    
    if (potDetails.length > 0) {
        const bestPot = potDetails[0];
        if (bestPot && bestPot.pnlPercentage > 0) {
            message += `*Best Performer:* ${escapeMarkdownV2(bestPot.name)}\n  \\+\`${escapeMarkdownV2Amount(bestPot.pnlPercentage)}%\` 🏆\n`;
        }
    }
    
    message += `\n_Last updated: ${escapeMarkdownV2(new Date().toLocaleString())}_`;

  await ctx.replyWithMarkdownV2(message, {
    ...DEFAULT_KEYBOARD
  });
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

  const nonZeroAssets = sortedAssets.filter(asset => asset.balance !== BigInt(0));
  
  for (let i = 0; i < nonZeroAssets.length; i++) {
    const asset = nonZeroAssets[i];
    if (!asset) continue;
    
    const isLast = i === nonZeroAssets.length - 1;

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

    assetAllocation += `\n${emoji} *${escapeMarkdownV2(symbol)}* \\(\`${escapeMarkdownV2Amount(percentage)}%\`\\)\n`;
    assetAllocation += `┣ Balance: \`${escapeMarkdownV2Amount(balanceReadable)}\`\n`;
    assetAllocation += `${isLast ? '┗' : '┗'} Value: \`\\$${escapeMarkdownV2Amount(valueUSD)}\`\n`;
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
  
  // Add vault address right below the name
  if (pot.potSeed) {
    message += `*🏦 Vault Address:*\n\`${escapeMarkdownV2(pot.potSeed)}\`\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }
  
  message += `*💎 Key Metrics*\n\n`;
  message += `*Total Value Locked \\(TVL\\):*\n\`\\$${escapeMarkdownV2Amount(potValueUSD)}\`\n\n`;
  message += `*All\\-Time PnL:*\n${pnlSign}\`\\$${escapeMarkdownV2Amount(Math.abs(allTimePnLUSD))}\` \\(${pnlSign}\`${escapeMarkdownV2Amount(Math.abs(allTimePnLPercentage))}%\`\\) ${pnlEmoji}\n\n`;
  message += `*Tracked Deposits:*\n\`\\$${escapeMarkdownV2Amount(totalDepositsUSD)}\`\n\n`;
  message += `*Tracked Withdrawals:*\n\`\\$${escapeMarkdownV2Amount(totalWithdrawalsUSD)}\`\n\n`;
  
  if (hasUntrackedDeposits) {
    message += `_ℹ️ Note: Current balance suggests additional deposits made outside bot \\(e\\.g\\. via Phantom\\)\\. PnL may be higher than actual\\._\n\n`;
  }
  
  message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `*🪙 Asset Allocation*\n`;
  message += assetAllocation;
  
  message += `\n\n━━━━━━━━━━━━━━━━━━━━━\n\n`;
  message += `*📊 Pot Statistics*\n\n`;
  message += `*Members:* \`${pot.members.length}\`\n\n`;
  message += `*Total Shares Issued:*\n\`${escapeMarkdownV2Amount(Number(pot.totalShares))}\`\n\n`;
  message += `*Net Asset Value \\(NAV\\) per Share:*\n\`\\$${escapeMarkdownV2Amount(navPerShareUSD)}\`\n\n`;
  message += `*Inception Date:*\n\`${escapeMarkdownV2(inceptionDate)}\`\n`;

  // Try to get and delete old pinned portfolio message from the bot
  try {
    const chat = await ctx.telegram.getChat(ctx.chat.id);
    if (chat.pinned_message) {
      const pinnedMessage = chat.pinned_message;
      // Check if the pinned message is from the bot and contains "Group Portfolio"
      if (pinnedMessage.from?.id === ctx.botInfo.id && 
          pinnedMessage.text?.includes("Group Portfolio")) {
        try {
          await ctx.telegram.unpinChatMessage(ctx.chat.id, pinnedMessage.message_id);
          await ctx.telegram.deleteMessage(ctx.chat.id, pinnedMessage.message_id);
        } catch (error) {
          console.log("Could not delete/unpin old portfolio message:", error);
        }
      }
    }
  } catch (error) {
    console.log("Could not get chat info:", error);
  }

  // Send new portfolio message
  const sentMessage = await ctx.replyWithMarkdownV2(message, {
    ...DEFAULT_GROUP_KEYBOARD
  });

  // Pin the new message
  try {
    await ctx.telegram.pinChatMessage(ctx.chat.id, sentMessage.message_id, {
      disable_notification: true // Don't notify all members
    });
  } catch (error) {
    console.error("Failed to pin portfolio message:", error);
    await ctx.reply("⚠️ Could not pin the portfolio message. Please make sure I have admin rights with 'Pin Messages' permission.");
  }
}

bot.command("portfolio", handlePortfolio);

bot.action("portfolio", async (ctx) => {
  await handlePortfolio(ctx);
  await ctx.answerCbQuery();
});

bot.action("buy", (ctx) => ctx.scene.enter("buy_token_with_sol_wizard"));
bot.action("buy_token_with_solana_group", (ctx) => {
    try {
        if (ctx.chat?.type === 'private') {
            return ctx.reply("❌ This action is only available in pot group chats.", {
                ...DEFAULT_KEYBOARD
            });
        }
        return ctx.scene.enter("buy_token_with_sol_wizard_group");
    } catch (error) {
        console.error("Error in buy_token_with_solana_group action:", error);
        const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");
        return ctx.reply("❌ Failed to start buy wizard. Please try again.", {
            ...(isGroup ? DEFAULT_GROUP_KEYBOARD : DEFAULT_KEYBOARD)
        });
    }
});

bot.action("sell", (ctx) => ctx.scene.enter("sell_token_for_sol_wizard"))

bot.action("sell_token_for_solana_group", (ctx) => {
    try {
        if (ctx.chat?.type === 'private') {
            return ctx.reply("❌ This action is only available in pot group chats.", {
                ...DEFAULT_KEYBOARD
            });
        }
        return ctx.scene.enter("sell_token_for_sol_wizard_group");
    } catch (error) {
        console.error("Error in sell_token_for_solana_group action:", error);
        const isGroup = (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup");
        return ctx.reply("❌ Failed to start sell wizard. Please try again.", {
            ...(isGroup ? DEFAULT_GROUP_KEYBOARD : DEFAULT_KEYBOARD)
        });
    }
});

bot.action("public_key", async ctx => {
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
});

bot.action("private_key", async ctx => {
  try {
    const user = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.from?.id.toString()
        }
    })

    if (user) {
      let privateKeyMessage = `*🔐 Your Private Key*\n\n`;
      privateKeyMessage += `⚠️ *KEEP THIS SECRET\\!*\n\n`;
      privateKeyMessage += `\`${escapeMarkdownV2(user.privateKey)}\`\n\n`;
      privateKeyMessage += `*🚨 Security Warning:*\n`;
      privateKeyMessage += `• Never share this with anyone\n`;
      privateKeyMessage += `• Anyone with this key can access your funds\n`;
      privateKeyMessage += `• This message will auto\\-delete in 1 minute\n\n`;
      privateKeyMessage += `_Save it securely now\\!_`;

      const sentMessage = await ctx.replyWithMarkdownV2(privateKeyMessage, {
        ...DEFAULT_KEYBOARD
      });

      // Delete the message after 1 minute (60000 milliseconds)
      setTimeout(async () => {
        try {
          await ctx.deleteMessage(sentMessage.message_id);
        } catch (error) {
          console.error("Failed to delete private key message:", error);
        }
      }, 60000);

      return sentMessage;
    } else {
      return ctx.reply(`Sorry! We are unable to find your private key`, {
          ...DEFAULT_KEYBOARD
      });
    }
  } catch (error) {
      console.error("Error in private_key action:", error);
      return ctx.reply("❌ Failed to fetch your private key. Please try again.", {
          ...DEFAULT_KEYBOARD
      });
  }
});

bot.action("balance", async ctx => {
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
})

bot.action("recent_transactions", async (ctx) => {
    try {
        const existingUser = await prismaClient.user.findFirst({
            where: {
                telegramUserId: ctx.from?.id.toString()
            }
        });

        if (!existingUser) {
            return ctx.reply("❌ User not found. Please start the bot first.", {
                ...DEFAULT_KEYBOARD
            });
        }

        // Send a loading message
        await ctx.answerCbQuery("Fetching recent transactions...");
        const loadingMsg = await ctx.reply("🔄 Loading your recent transactions...");

        // Fetch recent transactions from Zerion API
        // Using Solana chain for this bot
        const transactions = await getRecentTransactions(
            existingUser.publicKey,
            5, // Get last 5 transactions
            ['solana'] // Filter for Solana chain only
        );

        // Delete loading message
        await ctx.deleteMessage(loadingMsg.message_id);

        // Format and send the transactions message
        // Use 'devnet' for development, change to 'mainnet-beta' for production
        const message = formatTransactionsMessage(transactions, existingUser.publicKey, 'devnet');
        
        return ctx.replyWithMarkdownV2(message, {
            ...DEFAULT_KEYBOARD,
            link_preview_options: { is_disabled: true }
        });

    } catch (error: any) {
        console.error("Error in recent_transactions action:", error);
        return ctx.reply(
            `❌ Failed to fetch recent transactions.\n\n` +
            `Error: ${error.message || 'Unknown error'}`,
            {
                ...DEFAULT_KEYBOARD
            }
        );
    }
});

bot.action("create_pot", async (ctx) => {
  const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
  });

  if (existingUser) {
    try {
      // Generate unique pot seed for this pot
      const { createPotSeed } = await import("./solana/createVault");
      const potSeed = createPotSeed();
      const potSeedPublicKey = new PublicKey(potSeed.publicKey);

      // Initialize pot on the smart contract
      const { signature, potPDA } = await initializePotOnChain(
        existingUser.privateKey,
        potSeedPublicKey,
        0, // performanceFeeBps 
        0  // redemptionFeeBps 
      );

      // Add admin as a trader on-chain automatically
      let adminTraderSignature = "";
      try {
        adminTraderSignature = await addTraderOnChain(
          existingUser.privateKey,
          potSeedPublicKey,
          existingUser.publicKey
        );
        console.log(`✅ Admin added as trader on-chain: ${adminTraderSignature}`);
      } catch (traderError) {
        console.error("⚠️ Failed to add admin as trader:", traderError);
        // Continue with pot creation even if this fails - admin can be added later
      }

      // Create pot in database with PDA as vault address and pot seed
      const pot = await prismaClient.pot.create({
        data: {
            name: "",
            adminId: existingUser.id,
            telegramGroupId: `telegramGroupId_${ctx.from.id}_${Date.now()}`, // Use timestamp for uniqueness
            vaultAddress: potPDA.toBase58(), // Store the on-chain PDA address
            potSeed: potSeed.publicKey, // Store the unique seed for this pot
            isGroupAdded: false
        }
      })

      await ctx.replyWithMarkdownV2(
      `*Created Pot Successfully*\\.

*Pot Id*: ${escapeMarkdownV2(pot.id)}

*On\\-Chain Vault Address \\(PDA\\)*: \`${escapeMarkdownV2(potPDA.toBase58())}\`

*Init Transaction*: 🔗 [View on Explorer](https://explorer.solana.com/tx/${escapeMarkdownV2(signature)}?cluster=devnet)${adminTraderSignature ? `\n\n*Admin Trader TX*: 🔗 [View on Explorer](https://explorer.solana.com/tx/${escapeMarkdownV2(adminTraderSignature)}?cluster=devnet)` : ''}\n\n

*Please follow these steps carefully:*

*Step 1:* *Create a new group* in Telegram manually \\(open Telegram \\> tap pencil icon \\> New Group \\> add members \\> create\\)\\.

*Step 2:* After creating the group, *click the button below* to join me in the group\\.

*Note:* You *must first create the group* before clicking the button below\\.`, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
        ...ADD_POTBOT_TO_GROUP_WITH_DONE
      }
    );
    } catch (error) {
      console.error("Error creating pot:", error);
      await ctx.reply("❌ Failed to create pot on blockchain. Please try again later.");
    }
  }
})

bot.action("join_pot", async ctx => {
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
})

bot.action(/join_pot_(.+)/, async (ctx) => {
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
});

bot.action("create_invite", async ctx => {
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
})

bot.action("show_pots", async ctx => {
  try {
    const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
    });

    if (!existingUser) {
      return ctx.reply("❌ User not found. Please start the bot first.", {
        ...DEFAULT_KEYBOARD
      });
    }

    const userMemberships = await prismaClient.pot_Member.findMany({
      where: {
        userId: existingUser.id
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
      return ctx.reply("📋 You haven't joined any pots yet.\n\nUse 'Create Pot' or 'Join Pot' to get started!", {
        ...DEFAULT_KEYBOARD
      });
    }

    const solPrice = await getPriceInUSD(SOL_MINT);
    const potSummaries: Array<{
      name: string;
      isAdmin: boolean;
      depositedUSD: number;
      currentValueUSD: number;
      withdrawnUSD: number;
      pnl: number;
      pnlPercentage: number;
    }> = [];

    for (const membership of userMemberships) {
      const pot = membership.pot;

      // Skip pots that aren't set up yet
      if (!pot.isGroupAdded || !pot.inviteLink) {
        continue;
      }

      const deposits = await prismaClient.deposit.findMany({
        where: {
          potId: pot.id,
          userId: existingUser.id
        }
      });

      const totalDeposited = deposits.reduce((sum, d) => sum + d.amount, BigInt(0));
      const depositedUSD = (Number(totalDeposited) / LAMPORTS_PER_SOL) * solPrice;

      const withdrawals = await prismaClient.withdrawal.findMany({
        where: {
          potId: pot.id,
          userId: existingUser.id
        }
      });

      const totalWithdrawn = withdrawals.reduce((sum, w) => sum + w.amountOut, BigInt(0));
      const withdrawnUSD = Number(totalWithdrawn) / 1e6;

      const position = await getUserPosition(pot.id, existingUser.id);
      const currentValueUSD = position.valueUSD;

      const totalValueUSD = currentValueUSD + withdrawnUSD;
      const pnl = totalValueUSD - depositedUSD;
      const pnlPercentage = depositedUSD > 0 ? (pnl / depositedUSD) * 100 : 0;

      potSummaries.push({
        name: pot.name || "Unnamed Pot",
        isAdmin: pot.adminId === existingUser.id,
        depositedUSD,
        currentValueUSD,
        withdrawnUSD,
        pnl,
        pnlPercentage
      });
    }

    if (potSummaries.length === 0) {
      return ctx.reply("📋 No active pots found.\n\nCreate or join a pot to get started!", {
        ...DEFAULT_KEYBOARD
      });
    }

    // Sort by PnL percentage descending
    potSummaries.sort((a, b) => b.pnlPercentage - a.pnlPercentage);

    let message = `*💼 My Pots Summary*\n\n`;

    for (let i = 0; i < potSummaries.length; i++) {
      const pot = potSummaries[i];
      if (!pot) continue;
      
      const pnlEmoji = pot.pnl >= 0 ? "🟢" : "🔴";
      const pnlSign = pot.pnl >= 0 ? "\\+" : "\\-";
      const roleLabel = pot.isAdmin ? " \\(admin\\)" : "";

      message += `*${escapeMarkdownV2(pot.name)}*${roleLabel}\n`;
      message += `┣ Deposited: \`\\$${escapeMarkdownV2Amount(pot.depositedUSD)}\`\n`;
      
      if (pot.withdrawnUSD > 0) {
        message += `┣ Withdrawn: \`\\$${escapeMarkdownV2Amount(pot.withdrawnUSD)}\`\n`;
      }
      
      message += `┣ Current Value: \`\\$${escapeMarkdownV2Amount(pot.currentValueUSD)}\`\n`;
      message += `┗ P&L: ${pnlSign}\`\\$${escapeMarkdownV2Amount(Math.abs(pot.pnl))}\` \\(${pnlSign}\`${escapeMarkdownV2Amount(Math.abs(pot.pnlPercentage))}%\`\\) ${pnlEmoji}\n`;
      
      if (i < potSummaries.length - 1) {
        message += `\n`;
      }
    }

    await ctx.replyWithMarkdownV2(message, {
      ...DEFAULT_KEYBOARD
    });

  } catch (error) {
    console.error("Error showing pots:", error);
    ctx.reply("❌ Oops! Something went wrong while fetching your pots.", {
      ...DEFAULT_KEYBOARD
    });
  }
})

bot.on(message('new_chat_members'), async (ctx) => {
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

    try {
      // Get admin user to access their private key
      const adminUser = await prismaClient.user.findFirst({
        where: { id: pot.adminId }
      });

      if (!adminUser) {
        return ctx.reply("❌ Admin user not found.");
      }

      // Remove trader from the smart contract first
      const potSeedPublicKey = new PublicKey(pot.potSeed);
      const signature = await removeTraderOnChain(
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
          role: "MEMBER"
        }
      });

      await ctx.reply(
        `❌ ${targetUsername} is no longer a trader in ${pot.name}.\n\n` +
        `They have been changed to a regular member.\n\n` +
        `🔗 Transaction: ${signature}`
      );

      try {
        await ctx.telegram.sendMessage(
          parseInt(targetUserId),
          `📢 Notice\n\n` +
          `Your trader permissions in "${pot.name}" have been revoked.\n\n` +
          `You are now a regular member.\n\n` +
          `Transaction: ${signature}`
        );
      } catch (error) {
        console.log(`Could not send DM to user ${targetUserId}`);
      }
    } catch (error) {
      console.error("Error removing trader on-chain:", error);
      return ctx.reply(
        "❌ Failed to remove trader on blockchain. Please try again later.\n\n" +
        "The database has not been updated."
      );
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