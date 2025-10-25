import { PublicKey } from "@solana/web3.js";
import { prismaClient } from "../db/prisma";
import { createPotSeed, createPotVault } from "../solana/createVault";
import { addTraderOnChain, initializePotOnChain } from "../solana/smartContract";
import { escapeMarkdownV2 } from "../lib/utils";
import { getExplorerUrl } from "../solana/getConnection";
import { ADD_POTBOT_TO_GROUP_WITH_DONE } from "../keyboards/keyboards";
import { serializeWalletData } from "../lib/walletManager";

 export async function createPotHandler(ctx: any) {
  const existingUser = await prismaClient.user.findFirst({
      where: {
          telegramUserId: ctx.from?.id.toString(),
      }
  });

  if (existingUser) {
    try {
      // ========================================
      // WALLET MODE (Active for Testing)
      // ========================================
      // Create a direct wallet for the pot
      const potWallet = createPotVault();
      const potSeed = createPotSeed(); // Still need seed for unique identifier
      
      // Store wallet as JSON in vaultAddress field
      const vaultAddressData = serializeWalletData(potWallet);

      // Create pot in database
      const pot = await prismaClient.pot.create({
        data: {
            name: "",
            adminId: existingUser.id,
            telegramGroupId: `telegramGroupId_${ctx.from.id}_${Date.now()}`,
            vaultAddress: vaultAddressData, // JSON wallet data
            potSeed: potSeed.publicKey, // Unique seed for this pot
            isGroupAdded: false
        }
      });

      // Add creator as admin member in Pot_Member table
      await prismaClient.pot_Member.create({
        data: {
          userId: existingUser.id,
          potId: pot.id,
          role: "ADMIN",
          shares: BigInt(0)
        }
      });

      await ctx.replyWithMarkdownV2(
        `*✅ Created Pot Successfully*\\.

*Pot Id*: ${escapeMarkdownV2(pot.id)}

*Pot Wallet Address*: \`${escapeMarkdownV2(potWallet.publicKey)}\`

*Please follow these steps carefully:*

*Step 1:* *Create a new group* in Telegram manually \\(open Telegram \\> tap pencil icon \\> New Group \\> add members \\> create\\)\\.

*Step 2:* After creating the group, *click the button below* to join me in the group\\.

*Note:* You *must first create the group* before clicking the button below\\.`, {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
        ...ADD_POTBOT_TO_GROUP_WITH_DONE
      });

      // ========================================
      // SMART CONTRACT MODE (Commented for fallback)
      // ========================================
      /*
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
      }

      const pot = await prismaClient.pot.create({
        data: {
            name: "",
            adminId: existingUser.id,
            telegramGroupId: `telegramGroupId_${ctx.from.id}_${Date.now()}`,
            vaultAddress: potPDA.toBase58(),
            potSeed: potSeed.publicKey,
            isGroupAdded: false
        }
      });

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
      });
      */
    } catch (error) {
      console.error("Error creating pot:", error);
      await ctx.reply("❌ Failed to create pot. Please try again later.");
    }
  }
}