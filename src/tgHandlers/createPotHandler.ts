import { PublicKey } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { createPotSeed } from "../solana/createVault";
import { addTraderOnChain, initializePotOnChain } from "../solana/smartContract";
import { escapeMarkdownV2 } from "../lib/utils";
import { getExplorerUrl } from "../solana/getConnection";
import { ADD_POTBOT_TO_GROUP_WITH_DONE } from "../keyboards/keyboards";

 export async function createPotHandler(ctx: any) {
  const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
  });

  if (existingUser) {
    try {
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

*Init Transaction*: 🔗 [View on Explorer](${escapeMarkdownV2(getExplorerUrl(signature))})${adminTraderSignature ? `\n\n*Admin Trader TX*: 🔗 [View on Explorer](${escapeMarkdownV2(getExplorerUrl(adminTraderSignature))})` : ''}\n\n

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
}