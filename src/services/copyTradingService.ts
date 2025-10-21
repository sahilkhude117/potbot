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
import { DEFAULT_KEYBOARD } from "../keyboards/keyboards";
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
            const inTransfer = tx.transfers.find(t => t.direction === 'out');
            const outTransfer = tx.transfers.find(t => t.direction === 'in');

            if (!inTransfer || !outTransfer) {
                console.log(`Trade ${tx.hash} doesn't have clear in/out transfers`);
                return;
            }

            // Get actual mint addresses from the original transaction on-chain
            const swapMints = await getSwapMints(tx.hash, copyTrade.targetWalletAddress);
            
            if (!swapMints) {
                console.log(`Could not parse mints from transaction ${tx.hash}`);
                return;
            }

            // Get user's balance and token accounts
            const { balance: userBalance } = await getBalanceMessage(userKeypair.publicKey.toString());
            const allocatedBalance = userBalance * (Number(copyTrade.allocatedPercentage) / 100);
            const tokenAccounts = await getUserTokenAccounts(connection, userKeypair.publicKey.toString());

            // Calculate proportional amount to trade
            let proportionalAmount = 0;
            let inputMint = swapMints.inputMint;
            let outputMint = swapMints.outputMint;
            let inputSymbol = inTransfer.symbol;
            let outputSymbol = outTransfer.symbol;

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
                `🎯 *Copying Trader:*\n\`${escapeMarkdownV2(copyTrade.targetWalletAddress.slice(0, 8))}...${escapeMarkdownV2(copyTrade.targetWalletAddress.slice(-8))}\`\n\n` +
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
                    ...Markup.inlineKeyboard([
                        [
                            Markup.button.callback("✅ Confirm", `confirm_copy_${copiedTradeId}`),
                            Markup.button.callback("❌ Reject", `reject_copy_${copiedTradeId}`)
                        ],
                        [Markup.button.callback("⏸️ Stop Copy Trading", "stop_copy_trade")]
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
        try {
            const userKeypair = Keypair.fromSecretKey(decodeSecretKey(user.privateKey));

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

            // Execute swap
            const swapTransaction = await executeSwap(quoteResponse, userKeypair.publicKey.toString());

            // Sign and send transaction
            const txBuf = Buffer.from(swapTransaction, 'base64');
            const tx = VersionedTransaction.deserialize(txBuf);
            tx.sign([userKeypair]);

            const signature = await connection.sendTransaction(tx);
            const latestBlockhash = await connection.getLatestBlockhash();
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

            // Notify user
            const successMessage = 
                `✅ *Trade Executed Successfully*\n\n` +
                `🔄 Swapped: ${escapeMarkdownV2Amount(tradeParams.amount)} ${escapeMarkdownV2(tradeParams.inputSymbol)} → ${escapeMarkdownV2(tradeParams.outputSymbol)}\n\n` +
                `🔗 [View Transaction](${getExplorerUrl(signature)})\n` +
                `📊 [View Original](${getExplorerUrl(originalTx.hash)})`;

            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                successMessage,
                { parse_mode: "MarkdownV2", ...DEFAULT_KEYBOARD }
            );

        } catch (error) {
            console.error("Error executing copy trade:", error);

            // Update copied trade status
            await prismaClient.copiedTrade.update({
                where: { id: copiedTradeId },
                data: { status: 'FAILED' }
            });

            // Notify user
            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                `❌ *Trade Execution Failed*\n\n` +
                `Error: ${escapeMarkdownV2(error instanceof Error ? error.message : 'Unknown error')}`,
                { parse_mode: "MarkdownV2", ...DEFAULT_KEYBOARD }
            );
        }
    }

    private async notifyUserSkippedTrade(user: any, tx: FormattedTransaction, reason: string) {
        try {
            await this.bot.telegram.sendMessage(
                user.telegramUserId,
                `⚠️ *Trade Skipped*\n\n` +
                `Reason: ${escapeMarkdownV2(reason)}\n\n` +
                `🔗 [View Original Trade](${getExplorerUrl(tx.hash)})`,
                {
                    parse_mode: "MarkdownV2"
                }
            );
        } catch (error) {
            console.error("Error notifying user about skipped trade:", error);
        }
    }
}
