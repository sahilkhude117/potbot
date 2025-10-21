import { Markup } from "telegraf";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "./utils";
import { getExplorerUrl } from "../solana/getConnection";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";

export async function showCopyTradeStatus(ctx: any, existingUser: any) {
  try {
    const ct = existingUser.copyTrading;
    const statusEmoji = ct.isActive ? "🟢" : "🔴";
    const statusText = ct.isActive ? "Active" : "Stopped";
    const modeEmoji = ct.mode === 'PERMISSIONED' ? "🔐" : "⚡";

    // Get recent 5 trades
    const recentTrades = ct.copiedTrades || [];
    
    // Calculate PnL
    let totalInvested = 0;
    let totalReceived = 0;
    
    for (const trade of recentTrades) {
      if (trade.status === 'EXECUTED') {
        totalInvested += Number(trade.inAmount);
        totalReceived += Number(trade.outAmount);
      }
    }

    const pnl = totalReceived - totalInvested;
    const pnlPercentage = totalInvested > 0 ? ((pnl / totalInvested) * 100) : 0;
    const pnlEmoji = pnl >= 0 ? "🟢" : "🔴";
    const pnlSign = pnl >= 0 ? "+" : "";

    // Trade statistics
    const totalTradesCount = recentTrades.length;
    const successfulTrades = recentTrades.filter((t: any) => t.status === 'EXECUTED').length;
    const failedTrades = recentTrades.filter((t: any) => t.status === 'FAILED').length;
    const pendingTrades = recentTrades.filter((t: any) => t.status === 'PENDING' || t.status === 'CONFIRMED').length;
    const cancelledTrades = recentTrades.filter((t: any) => t.status === 'CANCELLED').length;

    let message = `📊 *Copy Trading Status*\n\n` +
      `${statusEmoji} *Status:* ${escapeMarkdownV2(statusText)}\n\n` +
      `🎯 *Tracking Wallet:*\n\`${escapeMarkdownV2(ct.targetWalletAddress.slice(0, 8))}...${escapeMarkdownV2(ct.targetWalletAddress.slice(-8))}\`\n\n` +
      `💰 *Allocated:* ${escapeMarkdownV2Amount(Number(ct.allocatedPercentage))}%\n\n` +
      `${modeEmoji} *Mode:* ${escapeMarkdownV2(ct.mode)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (totalTradesCount > 0) {
      message += `📈 *Performance*\n\n` +
        `*P&L:* ${pnlSign}${escapeMarkdownV2Amount(Math.abs(pnl / LAMPORTS_PER_SOL))} SOL \\(${pnlSign}${escapeMarkdownV2Amount(Math.abs(pnlPercentage))}%\\) ${pnlEmoji}\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📊 *Trade Statistics*\n\n` +
        `✅ Successful: \`${successfulTrades}\`\n` +
        `❌ Failed: \`${failedTrades}\`\n` +
        `⏳ Pending: \`${pendingTrades}\`\n` +
        `🚫 Cancelled: \`${cancelledTrades}\`\n\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Show recent 5 trades
      message += `🔄 *Recent Trades \\(Last 5\\)*\n\n`;
      
      const tradesToShow = recentTrades.slice(0, 5);
      for (let i = 0; i < tradesToShow.length; i++) {
        const trade = tradesToShow[i];
        const statusIcon = trade.status === 'EXECUTED' ? '✅' : 
                          trade.status === 'FAILED' ? '❌' : 
                          trade.status === 'CANCELLED' ? '🚫' : '⏳';
        
        const inAmount = Number(trade.inAmount) / LAMPORTS_PER_SOL;
        const outAmount = trade.outAmount ? Number(trade.outAmount) / LAMPORTS_PER_SOL : 0;
        
        message += `${statusIcon} *Trade ${i + 1}*\n`;
        message += `   In: \`${escapeMarkdownV2Amount(inAmount)} SOL\`\n`;
        if (trade.status === 'EXECUTED' && outAmount > 0) {
          message += `   Out: \`${escapeMarkdownV2Amount(outAmount)} SOL\`\n`;
        }
        message += `   Status: \`${escapeMarkdownV2(trade.status)}\`\n`;
        if (trade.copiedTxHash) {
          message += `   [View TX](${escapeMarkdownV2(getExplorerUrl(trade.copiedTxHash))})\n`;
        }
        if (i < tradesToShow.length - 1) {
          message += `\n`;
        }
      }
    } else {
      message += `ℹ️ *No trades executed yet*\n\n` +
        `Waiting for the trader to make a move\\.\\.\\.\n`;
    }

    // Build action buttons based on current mode and status
    const buttons = [];
    
    if (ct.isActive) {
      // Toggle mode button
      if (ct.mode === 'PERMISSIONED') {
        buttons.push([Markup.button.callback("⚡ Switch to Permissionless", "switch_mode_permissionless")]);
      } else {
        buttons.push([Markup.button.callback("🔐 Switch to Permissioned", "switch_mode_permissioned")]);
      }
      
      // Stop button
      buttons.push([Markup.button.callback("⏸️ Stop Copy Trading", "stop_copy_trade")]);
    } else {
      // Resume button
      buttons.push([Markup.button.callback("▶️ Resume Copy Trading", "resume_copy_trade")]);
    }
    
    // Back to menu
    buttons.push([Markup.button.callback("🔙 Back to Menu", "back_to_menu")]);

    await ctx.replyWithMarkdownV2(message, {
      parse_mode: "MarkdownV2",
      link_preview_options: { is_disabled: true },
      ...Markup.inlineKeyboard(buttons)
    });

  } catch (error) {
    console.error("Error showing copy trade status:", error);
    await ctx.reply("❌ Failed to load copy trading status.", {
      ...DEFAULT_KEYBOARD
    });
  }
}
