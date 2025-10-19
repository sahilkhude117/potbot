import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { SOL_MINT } from "../lib/statits";
import { createAssociatedTokenAccountInstruction, createTransferInstruction, getAccount, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { getConnection } from "./getConnection";

const connection = getConnection();

async function getTokenProgramId(mintAddress: PublicKey): Promise<PublicKey> {
  // Fetch mint account info to determine owner program id
  const mintInfo = await connection.getAccountInfo(mintAddress);
  if (!mintInfo) throw new Error("Mint account not found");
  return mintInfo.owner;
}

export async function transferAssets(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    assets: Array<{
        mintAddress: string;
        amount: bigint;
    }>
): Promise<Array<{
    success: boolean;
    txId?: string;
    error?: string;
}>> {
    const results: Array<{ success: boolean; txId?: string; error?: string }> = [];

    for (const asset of assets) {
        try {
            if (asset.mintAddress === SOL_MINT){
                const result = await transferSOL(fromKeypair, toPublicKey, asset.amount);
                results.push(result);
            } else {
                const result = await transferSPLToken(
                    fromKeypair,
                    toPublicKey,
                    asset.mintAddress,
                    asset.amount
                );
                results.push(result);
            } 
        } catch (error: any) {
            console.error(`Failed to transfer ${asset.mintAddress}:`, error);
            results.push({ 
                success: false, 
                error: error.message || "Transfer failed" 
            });
        }
    }

    return results;
}

async function transferSOL(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    lamports: bigint
): Promise<{ success: boolean; txId?: string; error?: string }> {
    try {
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: toPublicKey,
                lamports: Number(lamports)
            }),
        ];

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        console.log(`SOL Transfer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        
        return { success: true, txId }
    } catch (error: any) {
        console.error("SOL transfer error:", error);
        return { success: false, error: error.message };
    }
}

async function transferSPLToken(
    fromKeypair: Keypair,
    toPublicKey: PublicKey,
    mintAddress: string,
    amount: bigint
): Promise<{ success: boolean; txId?: string; error?: string }> {
    try {
        const mintPubkey = new PublicKey(mintAddress);
        const tokenProgramId = await getTokenProgramId(mintPubkey);

        const sourceTokenAccount = await getAssociatedTokenAddress(
            mintPubkey,
            fromKeypair.publicKey,
            false,
            tokenProgramId
        );

        const destinationTokenAccount = await getAssociatedTokenAddress(
            mintPubkey,
            toPublicKey,
            false,
            tokenProgramId
        );

        const instructions = [];

        try {
            await getAccount(connection, destinationTokenAccount);
        } catch (e: any) {
            instructions.push(
                createAssociatedTokenAccountInstruction(
                    fromKeypair.publicKey,
                    destinationTokenAccount,
                    toPublicKey,
                    mintPubkey,
                    tokenProgramId
                )
            );
        }

        instructions.push(
            createTransferInstruction(
                sourceTokenAccount,
                destinationTokenAccount,
                fromKeypair.publicKey,
                Number(amount),
                [],
                tokenProgramId
            )
        );

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        
        console.log(`Token Transfer: https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        
        return { success: true, txId };
    } catch (error: any) {
        console.error("SPL token transfer error:", error);
        return { success: false, error: error.message };
    }
}