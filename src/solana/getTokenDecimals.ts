import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";

export async function getTokenDecimals(mintAddress: string): Promise<number> {
    const connection = new Connection(process.env.RPC_URL!);
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);
    return mintInfo.decimals;
}