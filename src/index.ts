import { Telegraf } from "telegraf";
import { prismaClient } from "./db/prisma";
import { ADD_POTBOT_TO_GROUP, CREATE_NEW_POT, DEFAULT_KEYBOARD, SOLANA_POT_BOT } from "./keyboards/keyboards";
import { Keypair } from "@solana/web3.js";
import { getBalanceMessage } from "./solana/getBalance";
import { createMockVault } from "./solana/createVault";
import { escapeMarkdownV2 } from "./lib/utils";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

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
        }
      } else if (potWithTelegramGroup) {
        await ctx.reply(`Hello how can i help you?`);
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

// bot.action("private_key", async ctx => {
//   const user = await prismaClient.user.findFirst({
//       where: {
//           telegramUserId: ctx.from?.id.toString()
//       }
//   })

// 	return ctx.reply(
// 		`Your private key is ${user?.privateKey}`, {
//             ...DEFAULT_KEYBOARD
//         }
		
// 	);
// });

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
          telegramGroupId: `telegramGroupId_${ctx.from.id}`,
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
  // show pots
  // let user join one
})



bot.launch()

console.log(`Bot Is Running`)