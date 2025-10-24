import { prismaClient } from "../db/prisma";
import { getRecentTransactions, type FormattedTransaction } from "../zerion/getRecentTransactions";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } from "@solana/web3.js";
import { decodeSecretKey, escapeMarkdownV2, escapeMarkdownV2Amount } from "../lib/utils";
import { getBalanceMessage } from "../solana/getBalance";
import { getQuote, executeSwap } from "../solana/swapAssetsWithJup";
import { SOL_MINT } from "../lib/statits";
import { getUserTokenAccounts } from "../solana/getTokenAccounts";
import { getConnection, getExplorerUrl } from "../solana/getConnection";
import { Markup, Telegraf } from "telegraf";
import { DEFAULT_KEYBOARD, COPY_TRADING_KEYBOARD } from "../keyboards/keyboards";
import { getSwapMints } from "../solana/parseTransaction";

const connection = getConnection();
const SOLANA_CHAIN_ID = "solana";
const POLL_INTERVAL = 30000; // 30 seconds
const processedTxHashes = new Set<string>();

export class CopyTradingService {
    private bot: Telegraf;
    private isRunning: boolean = false;

    constructor(bot: Telegraf) {
        this.bot = bot;
    }

    public start() {
        if (this.isRunning) {
            console.log("Copy trading service is already running");
            return;
        }

        this.isRunning = true;
        console.log("✅ Copy trading service started");
        this.monitorTrades();
    }

    public stop() {
        this.isRunning = false;
        console.log("❌ Copy trading service stopped");
    }

    private async monitorTrades() {
        while (this.isRunning) {
            try {
                const activeCopyTrades = await prismaClient.copyTrading.findMany({
                    where: { isActive: true },
                    include: { user: true }
                });

                for (const copyTrade of activeCopyTrades) {
                    await this.processUserCopyTrades(copyTrade);
                }

            } catch (error) {
                console.error("Error in copy trading monitor:", error);
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        }
    }

    private async processUserCopyTrades(copyTrade: any) {
        try {
            // Fetch recent transactions from target wallet
            const transactions = await getRecentTransactions(
                copyTrade.targetWalletAddress,
                5,
                [SOLANA_CHAIN_ID]
            );

            // Filter for trade transactions only
            const tradeTxs = transactions.filter(tx => 
                tx.type.toLowerCase() === 'trade' && 
                tx.status === 'confirmed' &&
                !processedTxHashes.has(tx.hash)
            );

            for (const tx of tradeTxs) {
                // Debug log: Check what Zerion is reporting
                console.log(`\n🔍 [ZERION DATA] Transaction ${tx.hash.slice(0, 8)}...${tx.hash.slice(-8)}`);
                console.log(`   Type: ${tx.type}`);
                console.log(`   Status: ${tx.status}`);
                console.log(`   Transfers from Zerion: ${tx.transfers.length}`);
                tx.transfers.forEach((t, i) => {
                    console.log(`   Transfer ${i + 1}: ${t.direction.toUpperCase()} ${t.amount} ${t.symbol}`);
                });
                
                // Mark as processed immediately to prevent duplicate processing
                processedTxHashes.add(tx.hash);

                // Check if this trade was already copied
                const existingCopy = await prismaClient.copiedTrade.findFirst({
                    where: { originalTxHash: tx.hash }
                });

                if (existingCopy) continue;

                // Process the trade
                await this.processTrade(copyTrade, tx);
            }

        } catch (error) {
            console.error(`Error processing copy trades for user ${copyTrade.userId}:`, error);
        }
    }

    private async processTrade(copyTrade: any, tx: FormattedTransaction) {
        try {
            const user = copyTrade.user;
            const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

            // Identify buy and sell tokens from the trade
            // Zerion's 'out' = what was sold (input to swap)
            // Zerion's 'in' = what was bought (output from swap)
            const sellTransfer = tx.transfers.find(t => t.direction === 'out');
            const buyTransfer = tx.transfers.find(t => t.direction === 'in');

            console.log(`\n📋 [ZERION TRANSFERS] Processing ${tx.hash.slice(0, 8)}...${tx.hash.slice(-8)}`);
            console.log(`   Sell transfer: ${sellTransfer ? `${sellTransfer.amount} ${sellTransfer.symbol} (mint: ${sellTransfer.mintAddress || 'NONE'})` : 'NOT FOUND'}`);
            console.log(`   Buy transfer: ${buyTransfer ? `${buyTransfer.amount} ${buyTransfer.symbol} (mint: ${buyTransfer.mintAddress || 'NONE'})` : 'NOT FOUND'}`);

            if (!sellTransfer || !buyTransfer) {
                console.log(`❌ [SKIP] Trade ${tx.hash.slice(0, 8)}...${tx.hash.slice(-8)} doesn't have both sell and buy transfers`);
                console.log(`   This might be a transfer, not a swap. Skipping silently.`);
                
                // Notify user about the skipped trade
                let skipReason = '';
                if (!sellTransfer && !buyTransfer) {
                    skipReason = 'This transaction appears to be incomplete or not a token swap';
                } else if (!sellTransfer) {
                    skipReason = `You don't have the token being sold in this trade to copy it`;
                } else if (!buyTransfer) {
                    skipReason = `The token being bought couldn't be identified from this trade`;
                }
                
                await this.notifyUserSkippedTrade(user, tx, skipReason);
                return;
            }

            // Normalize SOL mint address (Zerion sometimes returns System Program address)
            const normalizeSolMint = (mint: string | undefined): string | null => {
                if (!mint) return null;
                // Zerion returns "11111111111111111111111111111111" (System Program) for native SOL
                // We need to use wrapped SOL mint: "So11111111111111111111111111111111111111112"
                if (mint === '11111111111111111111111111111111') {
                    return SOL_MINT;
                }
                return mint;
            };

            // Try to extract mint addresses from Zerion API first (from implementations array)
            let inputMint: string | null = normalizeSolMint(sellTransfer.mintAddress);
            let outputMint: string | null = normalizeSolMint(buyTransfer.mintAddress);
            
            if (inputMint) {
                console.log(`✅ [ZERION MINT] Input mint from Zerion API: ${inputMint}`);
            }
            
            if (outputMint) {
                console.log(`✅ [ZERION MINT] Output mint from Zerion API: ${outputMint}`);
            }
            
            // If Zerion doesn't provide mints, fall back to on-chain parsing
            if (!inputMint || !outputMint) {
                console.log(`⚠️ [FALLBACK] Zerion didn't provide mint addresses, parsing on-chain...`);
                
                // Add a small delay to ensure transaction is available on-chain
                await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                
                const swapMints = await getSwapMints(tx.hash, copyTrade.targetWalletAddress);
                
                if (!swapMints) {
                    console.log(`❌ [SKIP] Could not extract mints from Zerion or on-chain for ${tx.hash.slice(0, 8)}...${tx.hash.slice(-8)}`);
                    console.log(`   This transaction structure is not supported. Skipping silently.`);
                    return;
                }
                
                inputMint = inputMint || swapMints.inputMint;
                outputMint = outputMint || swapMints.outputMint;
                console.log(`✅ [ON-CHAIN MINT] Parsed from transaction: ${inputMint.slice(0, 8)}... → ${outputMint.slice(0, 8)}...`);
            }

            // At this point, inputMint and outputMint are guaranteed to be non-null strings
            if (!inputMint || !outputMint) {
                console.log(`❌ [ERROR] Mints are null after extraction attempts`);
                return;
            }

            // Get user's balance and token accounts
            const { balance: userBalance } = await getBalanceMessage(userKeypair.publicKey.toString());
            const allocatedBalance = userBalance * (Number(copyTrade.allocatedPercentage) / 100);
            const tokenAccounts = await getUserTokenAccounts(connection, userKeypair.publicKey.toString());

            // Calculate proportional amount to trade
            let proportionalAmount = 0;
            let inputSymbol = sellTransfer.symbol;
            let outputSymbol = buyTransfer.symbol;

            // Determine trade direction and calculate proportional amount
            if (inputMint === SOL_MINT) {
                // Buying token with SOL
                inputSymbol = 'SOL';
                
                // Use up to 10% of allocated balance per trade
                proportionalAmount = Math.min(allocatedBalance * 0.1, allocatedBalance);
                
                console.log(`User wants to buy ${outputSymbol} with SOL`);
                
            } else if (outputMint === SOL_MINT) {
                // Selling token for SOL
                outputSymbol = 'SOL';
                
                // Find user's token by mint address
                const ownedToken = tokenAccounts.find((t: any) => 
                    t.mintAddress.toLowerCase() === inputMint.toLowerCase()
                );
                
                if (!ownedToken || ownedToken.balance === BigInt(0)) {
                    await this.notifyUserSkippedTrade(user, tx, `You don't own ${inputSymbol}`);
                    return;
                }

                // Calculate proportional sell amount based on allocation percentage
                const userTokenAmount = Number(ownedToken.balance) / Math.pow(10, ownedToken.decimals);
                proportionalAmount = userTokenAmount * (Number(copyTrade.allocatedPercentage) / 100);
                
                console.log(`User wants to sell ${proportionalAmount} ${inputSymbol} for SOL`);
                
            } else {
                // Token-to-token swap
                // Find user's input token by mint address
                const ownedInputToken = tokenAccounts.find((t: any) => 
                    t.mintAddress.toLowerCase() === inputMint.toLowerCase()
                );
                
                if (!ownedInputToken || ownedInputToken.balance === BigInt(0)) {
                    await this.notifyUserSkippedTrade(user, tx, `You don't own ${inputSymbol}`);
                    return;
                }

                // Calculate proportional swap amount based on allocation percentage
                const userTokenAmount = Number(ownedInputToken.balance) / Math.pow(10, ownedInputToken.decimals);
                proportionalAmount = userTokenAmount * (Number(copyTrade.allocatedPercentage) / 100);
                
                console.log(`User wants to swap ${proportionalAmount} ${inputSymbol} for ${outputSymbol}`);
            }

            // Check if user has enough balance for fees (always need SOL for fees)
            const minimumSOLRequired = 0.005; // Minimum SOL needed for transaction fees
            if (userBalance < minimumSOLRequired) {
                await this.notifyUserSkippedTrade(user, tx, `Insufficient SOL for transaction fees. Need at least ${minimumSOLRequired} SOL`);
                return;
            }

            // Additional check: if input is SOL, ensure we have enough SOL + fees
            if (inputMint === SOL_MINT) {
                const totalRequired = proportionalAmount + minimumSOLRequired;
                if (userBalance < totalRequired) {
                    await this.notifyUserSkippedTrade(user, tx, `Insufficient balance. Need ${totalRequired} SOL (including fees)`);
                    return;
                }
            }

            // Get the token decimals for input mint
            let inputDecimals = 9; // SOL default
            if (inputMint !== SOL_MINT) {
                const ownedToken = tokenAccounts.find((t: any) => 
                    t.mintAddress.toLowerCase() === inputMint.toLowerCase()
                );
                inputDecimals = ownedToken?.decimals || 9;
            }

            // Create pending copied trade record
            const copiedTrade = await prismaClient.copiedTrade.create({
                data: {
                    copyTradingId: copyTrade.id,
                    originalTxHash: tx.hash,
                    inMint: inputMint,
                    inAmount: BigInt(Math.floor(proportionalAmount * Math.pow(10, inputDecimals))),
                    outMint: outputMint,
                    outAmount: BigInt(0), // Will be updated after execution
                    status: 'PENDING'
                }
            });

            // Handle based on mode
            if (copyTrade.mode === 'PERMISSIONED') {
                await this.requestTradeConfirmation(user, copyTrade, tx, copiedTrade.id, {
                    inputMint,
                    outputMint,
                    amount: proportionalAmount,
                    inputSymbol,
                    outputSymbol
                });
            } else {
                await this.executeCopyTrade(user, copyTrade, tx, copiedTrade.id, {
                    inputMint,
                    outputMint,
                    amount: proportionalAmount,
                    inputSymbol,
                    outputSymbol
                });
            }

        } catch (error) {
            console.error(`Error processing trade ${tx.hash}:`, error);
        }
    }

    private async requestTradeConfirmation(
        user: any,
        copyTrade: any,
        originalTx: FormattedTransaction,
        copiedTradeId: string,
        tradeParams: { inputMint: string; outputMint: string; amount: number; inputSymbol: string; outputSymbol: string }
    ) {
        try {
            const message = 
                `🔔 *Trade Confirmation Required*\n\n` +
                `🎯 *Copying Trader:*\n\`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📊 *Trade Details:*\n` +
                `• Sell: ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)}\n` +
                `• Buy: ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `🔗 [View Original Trade](${getExplorerUrl(originalTx.hash)})\n\n` +
                `⚠️ This trade will use your allocated funds\\.\n` +
                `Do you want to proceed?`;

            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                message,
                {
                    parse_mode: "MarkdownV2",
                    link_preview_options: { is_disabled: true },
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("✅ Confirm", `confirm_copy_${copiedTradeId}`),
                            Markup.button.callback("❌ Reject", `reject_copy_${copiedTradeId}`)
                        ],
                    ])
                }
            );

            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: { status: 'CONFIRMED' }
            });

        } catch (error) {
            console.error("Error requesting trade confirmation:", error);
        }
    }

    private async executeCopyTrade(
        user: any,
        copyTrade: any,
        originalTx: FormattedTransaction,
        copiedTradeId: string,
        tradeParams: { inputMint: string; outputMint: string; amount: number; inputSymbol: string; outputSymbol: string }
    ) {
        let notificationMsg: any = null;
        
        try {
            const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

            // Notify user about trade detection
            const detectionMessage = 
                `🔔 *New Trade Detected*\n\n` +
                `🎯 *Copying Trader:*\n\`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📊 *Trade:* ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `⏳ Getting quote\\.\\.\\.`;

            notificationMsg = await this.bot.telegram.sendMessage(
                user.telegramUserId,
                detectionMessage,
                { 
                    parse_mode: "MarkdownV2",
                    ...COPY_TRADING_KEYBOARD 
                }
            );

            // Get quote
            const amountInSmallestUnit = Math.floor(
                tradeParams.amount * (tradeParams.inputMint === SOL_MINT ? LAMPORTS_PER_SOL : 1)
            );

            const quoteResponse = await getQuote(
                tradeParams.inputMint,
                tradeParams.outputMint,
                amountInSmallestUnit,
                userKeypair.publicKey.toString()
            );

            // Update message: Quote received
            const quoteMessage = 
                `🔔 *New Trade Detected*\n\n` +
                `🎯 *Copying Trader:*\n\`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📊 *Trade:* ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `✅ Quote received\n` +
                `⏳ Executing swap\\.\\.\\.`;

            await this.bot.telegram.editMessageText(
                user.telegramUserId,
                notificationMsg.message_id,
                undefined,
                quoteMessage,
                { 
                    parse_mode: "MarkdownV2",
                    ...COPY_TRADING_KEYBOARD
                }
            );

            // Execute swap
            const swapTransaction = await executeSwap(quoteResponse, userKeypair.publicKey.toString());

            // Sign and send transaction
            const txBuf = Buffer.from(swapTransaction, 'base64');
            const tx = VersionedTransaction.deserialize(txBuf);
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);
            const latestBlockhash = await connection.getLatestBlockhash();
            
            // Update message: Transaction sent
            const sentMessage = 
                `🔔 *New Trade Detected*\n\n` +
                `🎯 *Copying Trader:*\n\`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📊 *Trade:* ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `✅ Quote received\n` +
                `✅ Swap executed\n` +
                `⏳ Confirming transaction\\.\\.\\.`;

            await this.bot.telegram.editMessageText(
                user.telegramUserId,
                notificationMsg.message_id,
                undefined,
                sentMessage,
                { 
                    parse_mode: "MarkdownV2",
                    ...COPY_TRADING_KEYBOARD
                }
            );

            await connection.confirmTransaction({
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
            }, 'confirmed');

            // Update copied trade
            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: {
                    copiedTxHash: signature,
                    outAmount: BigInt(quoteResponse.outAmount),
                    status: 'EXECUTED'
                }
            });

            // Delete processing message and send success message
            await this.bot.telegram.deleteMessage(user.telegramUserId, notificationMsg.message_id);

            const successMessage = 
                `✅ *Trade Executed Successfully*\n\n` +
                `🎯 *Trader:* \`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `🔄 *Swapped:* ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `🔗 [View Your Transaction](${getExplorerUrl(signature)})\n` +
                `📊 [View Original Trade](${getExplorerUrl(originalTx.hash)})`;

            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                successMessage,
                { 
                    parse_mode: "MarkdownV2", 
                    link_preview_options: { is_disabled: true },
                    ...COPY_TRADING_KEYBOARD 
                }
            );

        } catch (error) {
            console.error("Error executing copy trade:", error);

            // Update copied trade status
            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: { status: 'FAILED' }
            });

            // Delete processing message if exists
            if (notificationMsg) {
                try {
                    await this.bot.telegram.deleteMessage(user.telegramUserId, notificationMsg.message_id);
                } catch (e) {
                    console.error("Error deleting notification message:", e);
                }
            }

            // Notify user of failure
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            let userFriendlyError = errorMessage;

            // Make error messages more user-friendly
            if (errorMessage.includes('insufficient')) {
                userFriendlyError = 'Insufficient balance or liquidity';
            } else if (errorMessage.includes('slippage')) {
                userFriendlyError = 'Price moved too much (slippage exceeded)';
            } else if (errorMessage.includes('timeout')) {
                userFriendlyError = 'Transaction timed out';
            }

            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                `❌ *Trade Execution Failed*\n\n` +
                `🎯 *Trader:* \`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📊 *Attempted:* ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `⚠️ *Reason:* ${escapeMarkdownV2(userFriendlyError)}\n\n` +
                `🔗 [View Original Trade](${getExplorerUrl(originalTx.hash)})`,
                { 
                    parse_mode: "MarkdownV2", 
                    link_preview_options: { is_disabled: true },
                    ...COPY_TRADING_KEYBOARD 
                }
            );
        }
    }

    private async notifyUserSkippedTrade(user: any, tx: FormattedTransaction, reason: string) {
        try {
            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                `⚠️ *Trade Skipped*\n\n` +
                `Reason: ${escapeMarkdownV2(reason)}\n\n` +
                `🔗 [View Original Trade](${getExplorerUrl(tx.hash)})\n\n` +
                `_The bot will continue monitoring for future trades\\._`,
                {
                    parse_mode: "MarkdownV2",
                    link_preview_options: { is_disabled: true },
                    ...COPY_TRADING_KEYBOARD
                }
            );
        } catch (error) {
            console.error("Error notifying user about skipped trade:", error);
        }
    }

    private async notifyUserTransactionParsingFailed(user: any, copyTrade: any, tx: FormattedTransaction) {
        console.log(`⚠️ Skipping transaction ${tx.hash} for user ${user.telegramUserId}: Unable to parse swap mints`);
        console.log(`   Trader: ${copyTrade.targetWalletAddress}`);
        console.log(`   Reason: Transaction parsing failed (not enough transfers, no metadata, or incompatible structure)`);
        
        try {
            // Notify user about the skipped transaction
            const message = 
                `⚠️ *Trade Skipped*\n\n` +
                `🎯 *Trader:* \`${escapeMarkdownV2(copyTrade.targetWalletAddress)}\`\n\n` +
                `📋 *Reason:* Unable to process this transaction\n\n` +
                `*Possible causes:*\n` +
                `• Transaction not yet finalized on\\-chain\n` +
                `• Non\\-standard swap structure\n` +
                `• Not a token swap transaction\n\n` +
                `🔗 [View Transaction](${getExplorerUrl(tx.hash)})\n\n` +
                `_The bot will continue monitoring for other trades\\._`;

            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                message,
                { 
                    parse_mode: "MarkdownV2", 
                    link_preview_options: { is_disabled: true },
                    ...COPY_TRADING_KEYBOARD 
                }
            );
        } catch (error) {
            console.error("Error notifying user about transaction parsing failure:", error);
        }
    }
}
