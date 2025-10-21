import { DEFAULT_GROUP_KEYBOARD, DEFAULT_KEYBOARD } from "../keyboards/keyboards";

export async function helpHandler(ctx: any) {
  const isGroup = (ctx.chat.type === "group" || ctx.chat.type === "supergroup");
  
  if (isGroup) {
    // Group Help Message
    const groupHelpMessage = `*🤖 Pot Bot Group Commands*\n\n` +
      `*📊 Group Management*\n` +
      `/settrader \\<wallet\\_address\\> \\- Add a trader to the pot\n` +
      `/removetrader \\<wallet\\_address\\> \\- Remove a trader from the pot\n` +
      `/traders \\- View all traders in the pot\n` +
      `/traderhelp \\- Get help on trader management\n\n` +
      
      `*💰 Portfolio & Trading*\n` +
      `/portfolio \\- View the group's portfolio and positions\n` +
      `/transactions \\- View recent transactions\n` +
      `/trades \\- View recent trades\n\n` +
      
      `*ℹ️ Information*\n` +
      `/help \\- Show this help message\n\n` +
      
      `_Note: Group trading is managed collectively\\. Use the keyboard buttons for quick actions\\._`;
    
    await ctx.replyWithMarkdownV2(groupHelpMessage, {
      ...DEFAULT_GROUP_KEYBOARD
    });
  } else {
    // Individual Help Message
    const individualHelpMessage = `*🤖 Pot Bot Individual Commands*\n\n` +
      `*💰 Wallet Management*\n` +
      `/deposit \\- Deposit SOL to your wallet\n` +
      `/withdraw \\- Withdraw SOL from your wallet\n` +
      `Use keyboard buttons to:\n` +
      `  • View your balance\n` +
      `  • View your public key\n` +
      `  • View your private key \\(secure\\)\n\n` +
      
      `*📈 Trading*\n` +
      `Use keyboard buttons to:\n` +
      `  • Buy tokens with SOL\n` +
      `  • Sell tokens for SOL\n\n` +
      
      `*📊 Portfolio & Tracking*\n` +
      `/portfolio \\- View your portfolio and positions\n` +
      `/transactions \\- View recent transactions\n` +
      `/trades \\- View recent trades\n\n` +
      
      `*🔄 Copy Trading*\n` +
      `/copytrade \\- Start copy trading a wallet\n` +
      `/stopcopytrade \\- Stop copy trading\n` +
      `/copytradestatus \\- Check copy trade status\n\n` +
      
      `*ℹ️ Information*\n` +
      `/help \\- Show this help message\n\n` +
      
      `_Tip: Use the keyboard buttons below for quick access to common actions\\._`;
    
    await ctx.replyWithMarkdownV2(individualHelpMessage, {
      ...DEFAULT_KEYBOARD
    });
  }
}