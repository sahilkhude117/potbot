export async function tradersHelpHandler(ctx: any) {
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
}