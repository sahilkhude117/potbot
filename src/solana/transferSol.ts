import { 
  Keypair, 
  LAMPORTS_PER_SOL, 
  PublicKey, 
  SystemProgram, 
  TransactionMessage,
  VersionedTransaction
} from "@solana/web3.js";
import { getConnection, getExplorerUrl } from "./getConnection";

export async function transferSol(
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  amountSol: number,
  waitForConfirmation: boolean = true
): Promise<{
  success: boolean;
  signature?: string;
  explorerUrl?: string;
  message: string;
}> {
  const connection = getConnection();

  try {
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    // Create transfer instruction
    const instructions = [
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toPublicKey,
        lamports,
      }),
    ];

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();

    // Create VersionedTransaction (modern, more efficient)
    const messageV0 = new TransactionMessage({
      payerKey: fromKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([fromKeypair]);

    // Send transaction
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      maxRetries: 3,
    });

    // Wait for confirmation if requested
    if (waitForConfirmation) {
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      }, "confirmed");

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${confirmation.value.err}`);
      }
    }

    const explorerUrl = getExplorerUrl(signature);

    return {
      success: true,
      signature,
      explorerUrl,
      message: `Successfully transferred ${amountSol} SOL. View transaction: ${explorerUrl}`,
    };
  } catch (error) {
    console.error("Error transferring SOL:", error);
    return {
      success: false,
      message: `Failed to transfer SOL: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
