import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const connection = new Connection(process.env.RPC_URL!, 'confirmed');

export async function sendSol(
    fromKeypair: Keypair, 
    to: PublicKey, 
    amount: number
) {
    try {
        const instructions = [
            SystemProgram.transfer({
                fromPubkey: fromKeypair.publicKey,
                toPubkey: to,
                lamports: amount * LAMPORTS_PER_SOL 
            }),
        ];

        const { blockhash } = await connection.getLatestBlockhash();

        const messageV0 = new TransactionMessage({
            payerKey: fromKeypair.publicKey,
            recentBlockhash: blockhash,
            instructions,
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);

        transaction.sign([fromKeypair]);

        const txId = await connection.sendTransaction(transaction);
        console.log(`https://explorer.solana.com/tx/${txId}?cluster=devnet`);
        return {
            success: true,
            message: `View Your Transaction here: https://explorer.solana.com/tx/${txId}?cluster=devnet`
        }
    } catch (error) {
        return {
            success: false,
            message: "Oops! Error Sending Sol"
        }
    }
}
