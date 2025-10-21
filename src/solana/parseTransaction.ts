import { Connection, PublicKey } from "@solana/web3.js";
import { getConnection } from "./getConnection";

const connection = getConnection();

export interface ParsedTransfer {
    mint: string;
    amount: string;
    decimals: number;
    direction: 'in' | 'out';
    owner: string;
}

/**
 * Parse a transaction to extract token transfers
 * @param signature Transaction signature to parse
 * @returns Array of parsed transfers
 */
export async function parseTransaction(signature: string): Promise<ParsedTransfer[]> {
    try {
        const tx = await connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });

        if (!tx || !tx.meta) {
            console.log(`Transaction ${signature} not found or has no metadata`);
            return [];
        }

        const transfers: ParsedTransfer[] = [];

        // Get account keys (addresses involved in the transaction)
        const accountKeys = tx.transaction.message.accountKeys.map(key => {
            if (typeof key === 'string') return key;
            if ('pubkey' in key) return key.pubkey.toString();
            return '';
        });

        // Parse pre and post token balances to determine transfers
        const preTokenBalances = tx.meta.preTokenBalances || [];
        const postTokenBalances = tx.meta.postTokenBalances || [];

        // Create a map of account index to balance changes
        const balanceChanges = new Map<number, { mint: string; change: bigint; decimals: number; owner: string }>();

        // Calculate balance changes
        for (const postBalance of postTokenBalances) {
            const preBalance = preTokenBalances.find(pb => pb.accountIndex === postBalance.accountIndex);
            
            const postAmount = BigInt(postBalance.uiTokenAmount.amount);
            const preAmount = preBalance ? BigInt(preBalance.uiTokenAmount.amount) : BigInt(0);
            const change = postAmount - preAmount;

            if (change !== BigInt(0)) {
                balanceChanges.set(postBalance.accountIndex, {
                    mint: postBalance.mint,
                    change,
                    decimals: postBalance.uiTokenAmount.decimals,
                    owner: postBalance.owner || accountKeys[postBalance.accountIndex] || ''
                });
            }
        }

        // Check for accounts that had balance in pre but not in post (closed accounts)
        for (const preBalance of preTokenBalances) {
            if (!postTokenBalances.find(pb => pb.accountIndex === preBalance.accountIndex)) {
                const preAmount = BigInt(preBalance.uiTokenAmount.amount);
                if (preAmount !== BigInt(0)) {
                    balanceChanges.set(preBalance.accountIndex, {
                        mint: preBalance.mint,
                        change: -preAmount,
                        decimals: preBalance.uiTokenAmount.decimals,
                        owner: preBalance.owner || accountKeys[preBalance.accountIndex] || ''
                    });
                }
            }
        }

        // Convert balance changes to transfers
        for (const [accountIndex, { mint, change, decimals, owner }] of balanceChanges) {
            transfers.push({
                mint,
                amount: change.toString(),
                decimals,
                direction: change > BigInt(0) ? 'in' : 'out',
                owner
            });
        }

        return transfers;

    } catch (error) {
        console.error(`Error parsing transaction ${signature}:`, error);
        return [];
    }
}

/**
 * Get the mints involved in a swap transaction
 * @param signature Transaction signature
 * @param walletAddress The wallet address that performed the swap
 * @returns Object with inputMint and outputMint
 */
export async function getSwapMints(signature: string, walletAddress: string): Promise<{ inputMint: string; outputMint: string } | null> {
    try {
        const transfers = await parseTransaction(signature);
        
        if (transfers.length < 2) {
            console.log(`Transaction ${signature} doesn't have enough transfers for a swap`);
            return null;
        }

        // Filter transfers for the specific wallet
        const walletTransfers = transfers.filter(t => 
            t.owner.toLowerCase() === walletAddress.toLowerCase()
        );

        // Find the token that went out (input) and the token that came in (output)
        const outTransfer = walletTransfers.find(t => t.direction === 'out');
        const inTransfer = walletTransfers.find(t => t.direction === 'in');

        if (!outTransfer || !inTransfer) {
            console.log(`Could not determine swap direction for ${signature}`);
            return null;
        }

        return {
            inputMint: outTransfer.mint,
            outputMint: inTransfer.mint
        };

    } catch (error) {
        console.error(`Error getting swap mints for ${signature}:`, error);
        return null;
    }
}
