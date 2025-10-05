import { Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { DEFAULT_KEYBOARD } from "./keyboards/keyboards";
import { Keypair } from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

bot.start(async (ctx) => {
    const existingUser = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.chat.id.toString()
        }
    })

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
                telegramUserId: ctx.chat.id.toString(),
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
})

bot.action("public_key", async ctx => {
    const existingUser = await prismaClient.user.findFirst({
        where: {
            telegramUserId: ctx.chat?.id.toString()
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
          telegramUserId: ctx.chat?.id.toString()
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
            telegramUserId: ctx.chat?.id.toString()
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



bot.launch()

console.log(`Bot Is Running`)