import { Markup, Scenes } from "telegraf";
import { prismaClient } from "../db/prisma";
import { getTokenDecimalsWithCache } from "../solana/getTokenDecimals";
import type { BotContext, WithdrawalWizardState } from "../lib/types";
import { escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getUserPosition } from "../solana/getUserPosition";
import { CHECK_BALANCE_KEYBOARD, DEFAULT_KEYBOARD } from "../keyboards/keyboards";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { getPotPDA } from "../solana/smartContract";
import { getAccount, getAssociatedTokenAddress, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getConnection, getExplorerUrl } from "../solana/getConnection";
import { parseVaultAddress, walletDataToKeypair } from "../lib/walletManager";
import { transferSol } from "../solana/transferSol";
import { MINIMUM_SOL_RESERVE, MINIMUM_SOL_RESERVE_LAMPORTS } from "../lib/constants";

const connection = getConnection();

export const withdrawFromVaultWizard = new Scenes.WizardScene<BotContext>(
    "withdraw_from_vault_wizard",

    // 1 -> show user's pots
    async (ctx) => {
        try {
            const state = ctx.wizard.state as WithdrawalWizardState;
            const existingUser = await prismaClient.user.findFirst({
                where: {
                    telegramUserId: ctx.from?.id.toString()
                }
            });

            if (!existingUser) {
                await ctx.reply("User not found. Please register first.", {
                    ...DEFAULT_KEYBOARD
                });
                return ctx.scene.leave();
            }

            const pots = await prismaClient.pot.findMany({
                where: {
                    isGroupAdded: true,
                    inviteLink: { not: null },
                    OR: [
                        {
                            members: {
                                some: {
                                    userId: existingUser.id,
                                    shares: { gt: 0 }
                                },
                            },
                        },
                        {
                            adminId: existingUser.id,
                        },
                    ]
                },
                select: {
                    id: true,
                    name: true,
                }
            });

            if (!pots.length) {
                await ctx.reply("You don't have any shares in active pots.", {
                    ...DEFAULT_KEYBOARD
                });
                return ctx.scene.leave();
            }

            const buttons: any[][] = [];
            for (let i = 0; i < pots.length; i += 2) {
                const row = pots
                    .slice(i, i + 2)
                    .map((pot) =>
                        Markup.button.callback(
                            pot.name || `Pot ${i + 1}`,
                            `wizard_select_withdraw_pot_${pot.id}`
                        )
                    );
                buttons.push(row);
            }

            buttons.push([Markup.button.callback("Cancel", "wizard_cancel_withdrawal")]);

            await ctx.reply(
                "*Please select a pot to withdraw from:*",
                {
                    parse_mode: "MarkdownV2",
                    ...Markup.inlineKeyboard(buttons),
                }
            );

            state.userId = existingUser.id;
            return ctx.wizard.next();
        } catch (e) {
            console.error(e);
            await ctx.reply("Something went wrong while fetching your pots.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }
    },

    // 2 -> Waiting for pot selection 
    async (ctx) => {},

    async (ctx) => {
        const state = ctx.wizard.state as WithdrawalWizardState;
        const text = ('text' in (ctx.message ?? {}) ? (ctx.message as { text: string }).text : undefined)?.trim();

        if (!text) {
            return ctx.reply("❌ Please enter a valid amount or press Cancel.");
        }

        let sharesToBurn: bigint;

        if (text.endsWith("%")) {
            const percentage = parseFloat(text.slice(0, -1));
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                return ctx.reply("❌ Please enter a valid percentage between 0 and 100 (e.g., 50%)");
            }

            sharesToBurn = BigInt(Math.floor(Number(state.userShares) * (percentage / 100)));
        } else {
            const sharesInput = parseFloat(text);
            if (isNaN(sharesInput) || sharesInput <= 0) {
                return ctx.reply("❌ Please enter a valid number of shares or percentage (e.g., 1000000 or 50%)");
            }

            sharesToBurn = BigInt(Math.floor(sharesInput));
        }

        if (sharesToBurn === BigInt(0)) {
            return ctx.reply("❌ Amount too small. Please enter a larger value.");
        }

        if (sharesToBurn > state.userShares) {
            await ctx.replyWithMarkdownV2(
                `❌ *Insufficient Shares*\n\n` +
                `You're trying to withdraw ${escapeMarkdownV2(sharesToBurn.toString())} shares\\.\n` +
                `You only have ${escapeMarkdownV2(state.userShares.toString())} shares\\.\n\n` +
                `Please enter a smaller amount\\.`
            );
            return;
        }

        state.sharesToBurn = sharesToBurn;

        try {
            // Get withdrawal preview first
            const preview = await getWithdrawalPreview(state.potId, state.userId, sharesToBurn);
            const asset = preview.assetToReturn;
            const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112" 
                ? "SOL" 
                : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);

            // NOW check if pot has enough liquid balance
            const pot = await prismaClient.pot.findUnique({
                where: { id: state.potId },
                include: { admin: true }
            });

            if (!pot) {
                await ctx.reply("❌ Pot not found.");
                return ctx.scene.leave();
            }

            const walletData = parseVaultAddress(pot.vaultAddress);
            const requiredAmount = preview.assetToReturn.amount;

            if (walletData) {
                // === WALLET MODE - Check balance before showing confirmation ===
                const potWalletPubkey = new PublicKey(walletData.publicKey);
                const baseMint = new PublicKey(pot.cashOutMint);
                const isSolWithdrawal = baseMint.toBase58() === "So11111111111111111111111111111111111111112";

                if (isSolWithdrawal) {
                    // Check SOL balance
                    const vaultBalance = await connection.getBalance(potWalletPubkey);
                    const availableForWithdrawal = BigInt(vaultBalance) - BigInt(MINIMUM_SOL_RESERVE_LAMPORTS);

                    if (availableForWithdrawal < requiredAmount) {
                        const vaultBalanceReadable = vaultBalance / LAMPORTS_PER_SOL;
                        const availableReadable = Number(availableForWithdrawal) / LAMPORTS_PER_SOL;
                        const requiredReadable = Number(requiredAmount) / LAMPORTS_PER_SOL;
                        const maxWithdrawable = Math.max(0, availableReadable);

                        // Calculate maximum withdrawable shares
                        const maxWithdrawableLamports = availableForWithdrawal > 0 ? availableForWithdrawal : BigInt(0);
                        const maxSharesCanWithdraw = pot.totalShares > 0 
                            ? BigInt(Math.floor(Number(maxWithdrawableLamports) * Number(state.userShares) / Number(asset.amount)))
                            : BigInt(0);

                        await ctx.replyWithMarkdownV2(
                            `❌ *Insufficient Liquid Balance*\n\n` +
                            `The pot wallet has insufficient SOL for this withdrawal\\.\n\n` +
                            `*Total Balance:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} SOL\n` +
                            `*Reserved \\(rent \\+ fees\\):* ${escapeMarkdownV2Amount(MINIMUM_SOL_RESERVE)} SOL\n` +
                            `*Available:* ${escapeMarkdownV2Amount(maxWithdrawable)} SOL\n` +
                            `*You requested:* ${escapeMarkdownV2Amount(requiredReadable)} SOL\n\n` +
                            `💡 _A minimum of ${escapeMarkdownV2Amount(MINIMUM_SOL_RESERVE)} SOL must remain in the wallet for rent\\-exemption and transaction fees\\._\n\n` +
                            `✅ *You can withdraw up to ${escapeMarkdownV2Amount(maxWithdrawable)} SOL*\n` +
                            `   \\(≈ ${escapeMarkdownV2(maxSharesCanWithdraw.toString())} shares\\)\n\n` +
                            `🔄 _Try entering a smaller amount or ask traders to sell other assets for more liquidity\\._`,
                            Markup.inlineKeyboard([
                                [Markup.button.callback("Cancel", "wizard_cancel_withdrawal")]
                            ])
                        );
                        return; // Stay on same step - user can enter a new amount
                    }
                } else {
                    // Check SPL token balance
                    const potTokenAccount = await getAssociatedTokenAddress(
                        baseMint,
                        potWalletPubkey
                    );

                    let vaultBalance = BigInt(0);
                    try {
                        const vaultAccount = await getAccount(connection, potTokenAccount);
                        vaultBalance = vaultAccount.amount;
                    } catch (e) {
                        console.error("Vault token account not found:", e);
                    }

                    if (vaultBalance < requiredAmount) {
                        const decimals = await getTokenDecimalsWithCache(baseMint.toBase58());
                        const vaultBalanceReadable = Number(vaultBalance) / (10 ** decimals);
                        const requiredReadable = Number(requiredAmount) / (10 ** decimals);

                        // Calculate maximum withdrawable shares
                        const maxSharesCanWithdraw = pot.totalShares > 0 && asset.amount > 0
                            ? BigInt(Math.floor(Number(vaultBalance) * Number(state.userShares) / Number(asset.amount)))
                            : BigInt(0);

                        await ctx.replyWithMarkdownV2(
                            `❌ *Insufficient Liquid Balance*\n\n` +
                            `The pot wallet has insufficient ${escapeMarkdownV2(symbol)} for this withdrawal\\.\n\n` +
                            `*Available:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}\n` +
                            `*You requested:* ${escapeMarkdownV2Amount(requiredReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                            `💡 _Traders must sell other assets to increase the ${escapeMarkdownV2(symbol)} balance before you can withdraw\\._\n\n` +
                            `✅ *You can withdraw up to ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}*\n` +
                            `   \\(≈ ${escapeMarkdownV2(maxSharesCanWithdraw.toString())} shares\\)\n\n` +
                            `🔄 _Try entering a smaller amount or ask traders to rebalance the portfolio\\._`,
                            Markup.inlineKeyboard([
                                [Markup.button.callback("Cancel", "wizard_cancel_withdrawal")]
                            ])
                        );
                        return; // Stay on same step
                    }
                }
            } else {
                // === SMART CONTRACT MODE - Check balance ===
                const adminPubkey = new PublicKey(pot.admin?.publicKey || '');
                const potSeedPublicKey = new PublicKey(pot.potSeed);
                const [potPda] = getPotPDA(adminPubkey, potSeedPublicKey);
                
                const baseMint = new PublicKey(pot.cashOutMint);
                const potVaultAta = await getAssociatedTokenAddress(
                    baseMint,
                    potPda,
                    true
                );

                let vaultBalance = BigInt(0);
                try {
                    const vaultAccount = await getAccount(connection, potVaultAta);
                    vaultBalance = vaultAccount.amount;
                } catch (e) {
                    console.error("Vault account not found:", e);
                }

                if (vaultBalance < requiredAmount) {
                    const decimals = await getTokenDecimalsWithCache(baseMint.toBase58());
                    const vaultBalanceReadable = Number(vaultBalance) / (10 ** decimals);
                    const requiredReadable = Number(requiredAmount) / (10 ** decimals);

                    const isSol = baseMint.toBase58() === "So11111111111111111111111111111111111111112";
                    const symbol = isSol ? "SOL" : baseMint.toBase58().slice(0, 4) + "..." + baseMint.toBase58().slice(-4);

                    // Calculate maximum withdrawable shares
                    const maxSharesCanWithdraw = pot.totalShares > 0 && asset.amount > 0
                        ? BigInt(Math.floor(Number(vaultBalance) * Number(state.userShares) / Number(asset.amount)))
                        : BigInt(0);

                    await ctx.replyWithMarkdownV2(
                        `❌ *Insufficient Liquid Balance*\n\n` +
                        `The pot vault has insufficient ${escapeMarkdownV2(symbol)} for this withdrawal\\.\n\n` +
                        `*Available:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}\n` +
                        `*You requested:* ${escapeMarkdownV2Amount(requiredReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                        `💡 _Traders must sell other assets to increase the ${escapeMarkdownV2(symbol)} balance before you can withdraw\\._\n\n` +
                        `✅ *You can withdraw up to ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}*\n` +
                        `   \\(≈ ${escapeMarkdownV2(maxSharesCanWithdraw.toString())} shares\\)\n\n` +
                        `🔄 _Try entering a smaller amount or ask traders to rebalance the portfolio\\._`,
                        Markup.inlineKeyboard([
                            [Markup.button.callback("Cancel", "wizard_cancel_withdrawal")]
                        ])
                    );
                    return; // Stay on same step
                }
            }

            // If we reach here, balance is sufficient - show confirmation
            await ctx.replyWithMarkdownV2(
                `💰 *Withdrawal Confirmation*\n\n` +
                `*Pot:* ${escapeMarkdownV2(state.potName)}\n` +
                `*Shares to Burn:* ${escapeMarkdownV2(sharesToBurn.toString())} \\(${escapeMarkdownV2(preview.withdrawalPercentage.toFixed(2))}% of total pot\\)\n` +
                `*Estimated Value:* \\~\\$${escapeMarkdownV2Amount(preview.valueUSD)}\n\n` +
                `*You will receive:*\n` +
                `${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                `💡 _You will receive your withdrawal in the pot's base asset \\(${escapeMarkdownV2(symbol)}\\)\\._`,
                Markup.inlineKeyboard([
                    [
                        Markup.button.callback("✅ Confirm", "wizard_confirm_withdrawal"),
                        Markup.button.callback("❌ Cancel", "wizard_cancel_withdrawal")
                    ],
                ])
            );

            return ctx.wizard.next();
        } catch (error: any) {
            await ctx.reply(`❌ ${error.message}`)
            return;
        }
    },

    // 4. wait for confirmation
    async (ctx) => {},
);

withdrawFromVaultWizard.action(/wizard_select_withdraw_pot_(.+)/, async (ctx) => {
    const state = ctx.wizard.state as WithdrawalWizardState;
    const potId = ctx.match[1];

    try {
        const pot = await prismaClient.pot.findUnique({
            where: { id: potId },
            include: {
                members: {
                    where: {
                        userId: state.userId,
                        potId: potId
                    }
                }
            }
        });

        if (!pot) {
            await ctx.reply("This pot no longer exists.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }

        const member = pot.members[0];
        if (!member || member.shares === BigInt(0)) {
            await ctx.reply("You don't have any shares in this pot.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }

        state.potId = pot.id;
        state.potName = pot.name;
        state.userShares = member.shares;

        const position = await getUserPosition(potId || pot.id, state.userId);

        await ctx.replyWithMarkdownV2(
            `📊 *Your Position in ${escapeMarkdownV2(pot.name)}*\n\n` +
            `*Your Shares:* ${escapeMarkdownV2(position.shares.toString())} \\(${escapeMarkdownV2(position.sharePercentage.toFixed(2))}%\\)\n` +
            `*Current Value:* \\~\\$${escapeMarkdownV2Amount(position.valueUSD)}\n` +
            `*Share Price:* \\$${escapeMarkdownV2((position.sharePrice).toFixed(6))} per share\n\n` +
            `How much would you like to withdraw\\?\n\n` +
            `You can enter:\n` +
            `• *Percentage* \\(e\\.g\\., \`50%\` for half\\)\n` +
            `• *Exact shares* \\(e\\.g\\., \`${escapeMarkdownV2(Math.floor(Number(position.shares) / 2).toString())}\`\\)\n\n` +
            `💡 _Your withdrawal will be paid in the pot's base asset\\._`,
            Markup.inlineKeyboard([
                [Markup.button.callback("Cancel", "wizard_cancel_withdrawal")]
            ])
        );

        await ctx.answerCbQuery();
        ctx.wizard.selectStep(2);
    } catch (e) {
        console.error(e);
        await ctx.reply("Something went wrong. Please try again.", {
            ...DEFAULT_KEYBOARD
        });
        return ctx.scene.leave();
    }
});

withdrawFromVaultWizard.action("wizard_confirm_withdrawal", async (ctx) => {
    const state = ctx.wizard.state as WithdrawalWizardState;
    const { potId, userId, sharesToBurn } = state;

    try {
        await ctx.answerCbQuery("Processing withdrawal...");
        const processingMsg = await ctx.reply("⏳ Checking vault liquidity...");

        const pot = await prismaClient.pot.findUnique({
            where: { id: potId },
            include: { 
                admin: true,
                assets: true
            }
        });
        
        const user = await prismaClient.user.findUnique({
            where: { id: userId }
        });

        if (!user || !pot) {
            await ctx.deleteMessage(processingMsg.message_id);
            await ctx.reply("❌ User or pot not found.", {
                ...DEFAULT_KEYBOARD
            });
            return ctx.scene.leave();
        }

        // Check which mode to use (wallet or smart contract)
        const walletData = parseVaultAddress(pot.vaultAddress);

        if (walletData) {
            // ===== WALLET MODE (Active) =====
            await ctx.editMessageText("⏳ Processing wallet withdrawal...");

            try {
                // Get pot wallet keypair
                const potKeypair = walletDataToKeypair(walletData);
                const potWalletPubkey = new PublicKey(walletData.publicKey);

                // Get base mint from pot (cashOutMint or default to SOL)
                const baseMint = new PublicKey(pot.cashOutMint);
                const userPubkey = new PublicKey(user.publicKey);

                // Calculate required amount for withdrawal
                const preview = await getWithdrawalPreview(potId, userId, sharesToBurn);
                const requiredAmount = preview.assetToReturn.amount;

                let signature: string;
                let amountReceived: bigint;

                // Check if withdrawing SOL or SPL token
                const isSolWithdrawal = baseMint.toBase58() === "So11111111111111111111111111111111111111112";

                if (isSolWithdrawal) {
                    // SOL withdrawal
                    const vaultBalance = await connection.getBalance(potWalletPubkey);
                    
                    // Reserve for rent-exemption and transaction fees
                    // Minimum rent exemption for account (~0.00089 SOL) + transaction fee buffer (~0.001 SOL) + safety margin
                    const availableForWithdrawal = BigInt(vaultBalance) - BigInt(MINIMUM_SOL_RESERVE_LAMPORTS);
                    
                    if (availableForWithdrawal < requiredAmount) {
                        await ctx.deleteMessage(processingMsg.message_id);
                        
                        const decimals = 9; // SOL decimals
                        const vaultBalanceReadable = vaultBalance / LAMPORTS_PER_SOL;
                        const availableReadable = Number(availableForWithdrawal) / LAMPORTS_PER_SOL;
                        const requiredReadable = Number(requiredAmount) / LAMPORTS_PER_SOL;

                        // Calculate maximum withdrawable amount
                        const maxWithdrawable = Math.max(0, availableReadable);

                        await ctx.replyWithMarkdownV2(
                            `❌ *Insufficient Liquid Balance*\n\n` +
                            `The pot wallet has insufficient SOL for this withdrawal\\.\n\n` +
                            `*Total Balance:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} SOL\n` +
                            `*Reserved \\(rent \\+ fees\\):* ${escapeMarkdownV2Amount(MINIMUM_SOL_RESERVE)} SOL\n` +
                            `*Available:* ${escapeMarkdownV2Amount(maxWithdrawable)} SOL\n` +
                            `*You requested:* ${escapeMarkdownV2Amount(requiredReadable)} SOL\n\n` +
                            `💡 _A minimum of ${escapeMarkdownV2Amount(MINIMUM_SOL_RESERVE)} SOL must remain in the wallet for rent\\-exemption and transaction fees\\._\n\n` +
                            `✅ *You can withdraw up to ${escapeMarkdownV2Amount(maxWithdrawable)} SOL*\n\n` +
                            `🔄 _Try withdrawing a smaller percentage or ask traders to sell other assets for more liquidity\\._`,
                            {
                                ...CHECK_BALANCE_KEYBOARD
                            }
                        );
                        return ctx.scene.leave();
                    }

                    // Transfer SOL from pot wallet to user
                    const amountSol = Number(requiredAmount) / LAMPORTS_PER_SOL;
                    const transferResult = await transferSol(potKeypair, userPubkey, amountSol);
                    
                    if (!transferResult.success) {
                        throw new Error(transferResult.message);
                    }
                    
                    signature = transferResult.signature || '';
                    amountReceived = requiredAmount;

                } else {
                    // SPL Token withdrawal
                    const potTokenAccount = await getAssociatedTokenAddress(
                        baseMint,
                        potWalletPubkey
                    );

                    let vaultBalance = BigInt(0);
                    try {
                        const vaultAccount = await getAccount(connection, potTokenAccount);
                        vaultBalance = vaultAccount.amount;
                    } catch (e) {
                        console.error("Vault token account not found:", e);
                    }

                    if (vaultBalance < requiredAmount) {
                        await ctx.deleteMessage(processingMsg.message_id);
                        
                        const decimals = await getTokenDecimalsWithCache(baseMint.toBase58());
                        const vaultBalanceReadable = Number(vaultBalance) / (10 ** decimals);
                        const requiredReadable = Number(requiredAmount) / (10 ** decimals);
                        
                        const symbol = baseMint.toBase58().slice(0, 4) + "..." + baseMint.toBase58().slice(-4);

                        await ctx.replyWithMarkdownV2(
                            `❌ *Insufficient Liquid Balance*\n\n` +
                            `The pot wallet has insufficient ${escapeMarkdownV2(symbol)} for this withdrawal\\.\n\n` +
                            `*Required:* ${escapeMarkdownV2Amount(requiredReadable)} ${escapeMarkdownV2(symbol)}\n` +
                            `*Available:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                            `💡 _Traders must sell other assets to increase the ${escapeMarkdownV2(symbol)} balance before you can withdraw\\._\n\n` +
                            `🔄 _Try withdrawing a smaller percentage or ask traders to rebalance the portfolio\\._`,
                            {
                                ...CHECK_BALANCE_KEYBOARD
                            }
                        );
                        return ctx.scene.leave();
                    }

                    // Transfer SPL token from pot wallet to user
                    const userTokenAccount = await getAssociatedTokenAddress(
                        baseMint,
                        userPubkey
                    );

                    // Transfer tokens
                    signature = await transfer(
                        connection,
                        potKeypair, // payer
                        potTokenAccount, // source
                        userTokenAccount, // destination
                        potKeypair, // owner
                        requiredAmount
                    );
                    amountReceived = requiredAmount;
                }

                // After successful transfer, update database
                const withdrawal = await burnSharesAndWithdraw(potId, userId, sharesToBurn);

                const asset = withdrawal.assetToReturn;
                const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112"
                    ? "SOL"
                    : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);

                await ctx.deleteMessage(processingMsg.message_id);
                
                await ctx.replyWithMarkdownV2(
                    `✅ *Withdrawal Complete\\!*\n\n` +
                    `*Shares Burned:* ${escapeMarkdownV2(withdrawal.sharesBurned.toString())}\n` +
                    `*Amount Received:* ${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n` +
                    `*Value:* \\~\\$${escapeMarkdownV2Amount(withdrawal.valueUSD)}\n\n` +
                    `🔗 [View Transaction](${escapeMarkdownV2(getExplorerUrl(signature))})\n\n` +
                    `💡 _Funds have been transferred to your wallet\\._`,
                    {
                        link_preview_options: { is_disabled: true },
                        ...DEFAULT_KEYBOARD
                    }
                );

            } catch (e: any) {
                console.error("Wallet withdrawal error:", e);
                await ctx.deleteMessage(processingMsg.message_id);
                
                let errorMessage = e.message || 'Unknown error';
                
                await ctx.replyWithMarkdownV2(
                    `❌ *Withdrawal Failed*\n\n` +
                    `⚠️ ${escapeMarkdownV2(errorMessage)}\n\n` +
                    `Please try again or contact support\\.`,
                    {
                        ...DEFAULT_KEYBOARD
                    }
                );
            }

        } else {
            // ===== SMART CONTRACT MODE (Fallback) =====
            await ctx.editMessageText("⏳ Checking vault liquidity...");

            // Check liquid SOL balance on-chain before proceeding
            const adminPubkey = new PublicKey(pot.admin.publicKey);
            const potSeedPublicKey = new PublicKey(pot.potSeed);
            const [potPda] = getPotPDA(adminPubkey, potSeedPublicKey);
            
            // Get base mint from pot (cashOutMint or default to SOL)
            const baseMint = new PublicKey(pot.cashOutMint);
            const potVaultAta = await getAssociatedTokenAddress(
                baseMint,
                potPda,
                true
            );

            let vaultBalance = BigInt(0);
            try {
                const vaultAccount = await getAccount(connection, potVaultAta);
                vaultBalance = vaultAccount.amount;
            } catch (e) {
                console.error("Vault account not found:", e);
            }

            // Calculate required amount for withdrawal
            const preview = await getWithdrawalPreview(potId, userId, sharesToBurn);
            const requiredAmount = preview.assetToReturn.amount;

            if (vaultBalance < requiredAmount) {
                await ctx.deleteMessage(processingMsg.message_id);
                
                const decimals = await getTokenDecimalsWithCache(baseMint.toBase58());
                const vaultBalanceReadable = Number(vaultBalance) / (10 ** decimals);
                const requiredReadable = Number(requiredAmount) / (10 ** decimals);
                
                const symbol = baseMint.toBase58() === "So11111111111111111111111111111111111111112"
                    ? "SOL"
                    : baseMint.toBase58().slice(0, 4) + "..." + baseMint.toBase58().slice(-4);

                await ctx.replyWithMarkdownV2(
                    `❌ *Insufficient Liquid Balance*\n\n` +
                    `The pot vault has insufficient ${escapeMarkdownV2(symbol)} for this withdrawal\\.\n\n` +
                    `*Required:* ${escapeMarkdownV2Amount(requiredReadable)} ${escapeMarkdownV2(symbol)}\n` +
                    `*Available:* ${escapeMarkdownV2Amount(vaultBalanceReadable)} ${escapeMarkdownV2(symbol)}\n\n` +
                    `💡 _Traders must sell other assets to increase the ${escapeMarkdownV2(symbol)} balance before you can withdraw\\._\n\n` +
                    `🔄 _Try withdrawing a smaller percentage or ask traders to rebalance the portfolio\\._`,
                    {
                        ...CHECK_BALANCE_KEYBOARD
                    }
                );
                return ctx.scene.leave();
            }

            // Proceed with withdrawal if sufficient balance
            await ctx.editMessageText("⏳ Processing on-chain withdrawal...");

            // Import smart contract functions
            const { redeemFromPot } = await import("../solana/smartContract");

            try {
                // Call smart contract redeem function with pot seed
                const { signature, amountReceived } = await redeemFromPot(
                    user.privateKey,
                    pot.admin.publicKey,
                    potSeedPublicKey,
                    sharesToBurn,
                    baseMint
                );

                // After successful on-chain redemption, update database
                const withdrawal = await burnSharesAndWithdraw(potId, userId, sharesToBurn);

                const asset = withdrawal.assetToReturn;
                const symbol = asset.mintAddress === "So11111111111111111111111111111111111111112"
                    ? "SOL"
                    : asset.mintAddress.slice(0, 4) + "..." + asset.mintAddress.slice(-4);

                await ctx.deleteMessage(processingMsg.message_id);
                
                await ctx.replyWithMarkdownV2(
                    `✅ *Withdrawal Complete\\!*\n\n` +
                    `*Shares Burned:* ${escapeMarkdownV2(withdrawal.sharesBurned.toString())}\n` +
                    `*Amount Received:* ${escapeMarkdownV2Amount(asset.amountReadable)} ${escapeMarkdownV2(symbol)}\n` +
                    `*Value:* \\~\\$${escapeMarkdownV2Amount(withdrawal.valueUSD)}\n\n` +
                    `🔗 [View Transaction](${escapeMarkdownV2(getExplorerUrl(signature))})\n\n` +
                    `💡 _Funds have been transferred on\\-chain to your wallet\\._`,
                    {
                        link_preview_options: { is_disabled: true },
                        ...DEFAULT_KEYBOARD
                    }
                );
            } catch (e: any) {
                console.error("Withdrawal error:", e);
                await ctx.deleteMessage(processingMsg.message_id);
                
                let errorMessage = e.message || 'Unknown error';
                
                // Check if error is due to insufficient vault balance
                if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
                    errorMessage = "Insufficient liquid balance in vault. Traders need to sell other assets to increase base asset balance.";
                }
                
                await ctx.replyWithMarkdownV2(
                    `❌ *Withdrawal Failed*\n\n` +
                    `⚠️ ${escapeMarkdownV2(errorMessage)}\n\n` +
                    `Please try again or contact support\\.`,
                    {
                        ...DEFAULT_KEYBOARD
                    }
                );
            }
        }
    } catch (error: any) {
        console.error(error);
        await ctx.reply(`❌ Withdrawal failed: ${error.message}`, {
            ...DEFAULT_KEYBOARD
        });
    }

    return ctx.scene.leave();
})

withdrawFromVaultWizard.action("wizard_cancel_withdrawal", async (ctx) => {
    await ctx.reply("❌ Withdrawal cancelled.", {
        ...DEFAULT_KEYBOARD
    });
    await ctx.answerCbQuery("Cancelled");
    return ctx.scene.leave();
});

async function getWithdrawalPreview(
    potId: string,
    userId: string,
    sharesToBurn: bigint
) : Promise<{
    withdrawalPercentage: number;
    valueUSD: number;
    assetToReturn: {
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    };
}> {
    const pot = await prismaClient.pot.findUnique({
        where: { id: potId },
        include: {
            assets: true,
            members: {
                where: { userId, potId }
            }
        }
    });

    if (!pot) throw new Error("Pot not found");

    const member = pot.members[0];
    if (!member) throw new Error("You are not a member of this pot");

    if (member.shares < sharesToBurn) {
        throw new Error(
            `Insufficient shares. You have ${member.shares.toString()} shares, tried to burn ${sharesToBurn.toString()}`
        );
    }

    const withdrawalPercentage = (Number(sharesToBurn) / Number(pot.totalShares)) * 100;

    // Find the base asset (cashOutMint) in the pot's assets
    const baseAsset = pot.assets.find(a => a.mintAddress === pot.cashOutMint);
    
    if (!baseAsset) {
        throw new Error(`Base asset ${pot.cashOutMint} not found in pot. Please contact support.`);
    }

    if (baseAsset.balance === BigInt(0)) {
        throw new Error("Insufficient liquidity in the pot's base asset. Cannot process withdrawal.");
    }

    // Calculate the amount to return based on shares
    const amountToReturn = BigInt(
        Math.floor(Number(baseAsset.balance) * Number(sharesToBurn) / Number(pot.totalShares))
    );

    if (amountToReturn === BigInt(0)) {
        throw new Error("Withdrawal amount too small. Try withdrawing more shares.");
    }

    const { getTokenDecimalsWithCache } = await import("../solana/getTokenDecimals");
    const decimals = await getTokenDecimalsWithCache(baseAsset.mintAddress);
    const amountReadable = Number(amountToReturn) / (10 ** decimals);

    // Calculate approximate USD value
    const { getPriceInUSD } = await import("../solana/getPriceInUSD");
    const priceUSD = await getPriceInUSD(baseAsset.mintAddress);
    const valueUSD = amountReadable * priceUSD;

    return {
        withdrawalPercentage,
        valueUSD,
        assetToReturn: {
            mintAddress: baseAsset.mintAddress,
            amount: amountToReturn,
            amountReadable
        }
    }
}

export async function burnSharesAndWithdraw(
    potId: string,
    userId: string,
    sharesToBurn: bigint
): Promise<{
    sharesBurned: bigint;
    valueUSD: number;
    assetToReturn: {
        mintAddress: string;
        amount: bigint;
        amountReadable: number;
    };
}> {
    return await prismaClient.$transaction(async (tx) => {
        const pot = await tx.pot.findUnique({
            where: { id: potId },
            include: {
                assets: true,
                members: {
                    where: {
                        userId,
                        potId
                    }
                }
            }
        })

        if (!pot) throw new Error("Pot not found");

        const member = pot.members[0];
        if (!member) throw new Error("You are not a member of this pot");

        if (member.shares < sharesToBurn) {
            throw new Error(
                `Insufficient shares. You have ${member.shares} shares, tried to burn ${sharesToBurn}`
            );
        }

        if (pot.totalShares === BigInt(0)) {
            throw new Error("Pot has no shares");
        }

        // Find the base asset (cashOutMint) in the pot's assets
        const baseAsset = pot.assets.find(a => a.mintAddress === pot.cashOutMint);
        
        if (!baseAsset) {
            throw new Error(`Base asset ${pot.cashOutMint} not found in pot`);
        }

        if (baseAsset.balance === BigInt(0)) {
            throw new Error("Insufficient liquidity in the pot's base asset");
        }

        // Calculate the amount to return based on shares
        const amountToReturn = BigInt(
            Math.floor(Number(baseAsset.balance) * Number(sharesToBurn) / Number(pot.totalShares))
        );

        if (amountToReturn === BigInt(0)) {
            throw new Error("Withdrawal amount too small");
        }

        const decimals = await getTokenDecimalsWithCache(baseAsset.mintAddress);
        const amountReadable = Number(amountToReturn) / (10 ** decimals);

        // Calculate approximate USD value
        const { getPriceInUSD } = await import("../solana/getPriceInUSD");
        const priceUSD = await getPriceInUSD(baseAsset.mintAddress);
        const valueUSD = amountReadable * priceUSD;

        // Update the base asset balance
        await tx.asset.update({
            where: { id: baseAsset.id },
            data: {
                balance: baseAsset.balance - amountToReturn
            }
        });

        // Burn shares
        const newTotalShares = pot.totalShares - sharesToBurn;
        await tx.pot.update({
            where: { id: potId },
            data: { totalShares: newTotalShares },
        });

        const newUserShares = member.shares - sharesToBurn;
        await tx.pot_Member.update({
            where: { id: member.id },
            data: { shares: newUserShares }
        });

        // Create withdrawal record
        const withdrawal = await tx.withdrawal.create({
            data: {
                potId,
                userId,
                sharesBurned: sharesToBurn,
                amountOut: amountToReturn
            }
        });

        return {
            sharesBurned: sharesToBurn,
            valueUSD,
            assetToReturn: {
                mintAddress: baseAsset.mintAddress,
                amount: amountToReturn,
                amountReadable
            }
        };
    }, {
        isolationLevel: "Serializable",
        timeout: 30000,
    })
} 