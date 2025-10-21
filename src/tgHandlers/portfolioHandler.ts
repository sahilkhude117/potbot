import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { getPriceInUSD } from "../solana/getPriceInUSD";
import { SOL_MINT } from "../lib/statits";
import { getUserPosition } from "../solana/getUserPosition";
import { computePotValueInUSD } from "../solana/computePotValueInUSD";
import { getTokenDecimalsWithCache } from "../solana/getTokenDecimals";

export async function portfolioHandler(ctx: any) {
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