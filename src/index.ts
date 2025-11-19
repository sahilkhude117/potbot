import { Scenes, session, Telegraf } from "telegraf";
import { DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD,} from "./keyboards/keyboards";
import { depositSolToVaultWizard } from "./wizards/depositWizard";
import { withdrawFromVaultWizard } from "./wizards/withdrawalWizard";
import type { BotContext } from "./lib/types";
import { message } from "telegraf/filters";
import { buyTokenWithSolWizard } from "./wizards/buyTokenWithSolWizard";
import { buyTokenWithSolWizardGroup } from "./wizards/buyTokenWithSolGroupWizard";
import { sellTokenForSolWizard } from "./wizards/sellTokenForSolWizard";
import { sellTokenForSolWizardGroup } from "./wizards/sellTokenForSolGroupWizard";
import { copyTradingWizard } from "./wizards/copyTradingWizard";
import { CopyTradingService } from "./services/copyTradingService";
import { helpHandler } from "./tgHandlers/helpHandler";
import { startHandler } from "./tgHandlers/startHandler";
import { copyTradeHandler } from "./tgHandlers/copyTradeHandler";
import { portfolioHandler } from "./tgHandlers/portfolioHandler";
import { recentTransactionsHandler } from "./tgHandlers/recentTransactionsHandler";
import { recentTradesHandler } from "./tgHandlers/recentTradesHandler";
import { stopCopyTradeHandler } from "./tgHandlers/stopCopyTradeHandler";
import { copyTradeStatusHandler } from "./tgHandlers/copyTradeStatusHandler";
import { publicKeyHandler } from "./tgHandlers/publicKeyHandler";
import { privateKeyHandler } from "./tgHandlers/privateKeyHandler";
import { balanceHandler } from "./tgHandlers/balanceHandler";
import { createPotHandler } from "./tgHandlers/createPotHandler";
import { joinPotHandler, joinPotIndividualHandler } from "./tgHandlers/joinPotHandler";
import { createInviteHandler } from "./tgHandlers/createInviteHandler";
import { showPotsHandler } from "./tgHandlers/showPotsHandler";
import { newChatMemberHandler } from "./tgHandlers/newChatMemberHandler";
import { setTraderHandler } from "./tgHandlers/setTraderHandler";
import { removeTraderHandler } from "./tgHandlers/removeTraderHandler";
import { getTradersHandler } from "./tgHandlers/getTradersHandler";
import { tradersHelpHandler } from "./tgHandlers/tradersHelpHandler";
import { switchModePermissionedHandler } from "./tgHandlers/swithModePermissionedHandler";
import { switchModePermissionlessHandler } from "./tgHandlers/switchModePermissionlessHandler";

// Create HTTP server for Render health checks
const PORT = process.env.PORT || 3000;
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({ 
        status: "ok", 
        bot: "running",
        timestamp: new Date().toISOString()
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`🌐 HTTP server listening on port ${PORT}`);

const bot = new Telegraf<BotContext>(process.env.TELEGRAM_BOT_TOKEN!)

// Start copy trading service
// const copyTradingService = new CopyTradingService(bot as any);
// copyTradingService.start();

const stage = new Scenes.Stage<BotContext>([
  depositSolToVaultWizard,
  withdrawFromVaultWizard,
  buyTokenWithSolWizard,
  buyTokenWithSolWizardGroup,
  sellTokenForSolWizard,
  sellTokenForSolWizardGroup,
  copyTradingWizard
]);
bot.use(session());
bot.use(stage.middleware());

bot.start(startHandler);

bot.action("public_key", publicKeyHandler);
bot.action("private_key", privateKeyHandler);
bot.action("balance", balanceHandler);


bot.action("create_pot", createPotHandler);
bot.action("join_pot", joinPotHandler);
bot.action(/join_pot_(.+)/, joinPotIndividualHandler);
bot.action("show_pots", showPotsHandler);


bot.command('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"));
bot.action('deposit', (ctx) => ctx.scene.enter("deposit_sol_to_vault_wizard"));

bot.command('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"));
bot.action('withdraw', (ctx) => ctx.scene.enter("withdraw_from_vault_wizard"));


bot.command("settrader", setTraderHandler);
bot.command("removetrader", removeTraderHandler);
bot.command("traders", getTradersHandler);
bot.command("traderhelp", tradersHelpHandler);


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

bot.action("sell", (ctx) => ctx.scene.enter("sell_token_for_sol_wizard"));
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


bot.command('copytrade', copyTradeHandler);
bot.action('copy_trading', copyTradeHandler);

bot.command("stopcopytrade", stopCopyTradeHandler);
bot.action("stop_copy_trade", stopCopyTradeHandler);

bot.command("copytradestatus", copyTradeStatusHandler);
bot.action("copytradestatus", copyTradeStatusHandler);

bot.action("switch_mode_permissioned", switchModePermissionedHandler);
bot.action("switch_mode_permissionless", switchModePermissionlessHandler);


bot.command('transactions', recentTransactionsHandler);
bot.action("recent_transactions", recentTransactionsHandler);


bot.command('trades', recentTradesHandler);
bot.action("recent_trades", recentTradesHandler);


bot.command("portfolio", portfolioHandler);
bot.action("portfolio", async (ctx) => {
  await portfolioHandler(ctx);
  await ctx.answerCbQuery();
});

bot.command('help', helpHandler);


bot.action("create_invite", createInviteHandler);
bot.on(message('new_chat_members'), newChatMemberHandler);


bot.action("back_to_menu", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("👋 Main Menu", { ...DEFAULT_KEYBOARD });
});


bot.launch()
    .then(() => console.log("✅ Bot started successfully"))
    .catch((err) => console.error("❌ Failed to start bot:", err));

// Graceful shutdown handlers
process.once("SIGINT", () => {
  console.log("🛑 Shutting down...");
  bot.stop("SIGINT");
  server.stop();
});

process.once("SIGTERM", () => {
  console.log("🛑 Shutting down...");
  bot.stop("SIGTERM");
  server.stop();
});