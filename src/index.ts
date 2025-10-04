import { Telegraf } from "telegraf";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

bot.start((ctx) => {
  ctx.reply("Swagat nahi kroge humara")
})

bot.launch()

console.log(`Bot Is Running`)