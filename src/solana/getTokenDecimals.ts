import { Connection, PublicKey } from "@solana/web3.js";
import { getMint } from "@solana/spl-token";
import { SOL_DECIMALS, SOL_MINT } from "../lib/statits";

const decimalsCache = new Map<string, number>();

export async function getTokenDecimals(mintAddress: string): Promise<number> {
    const connection = new Connection(process.env.RPC_URL!);
    const mintPubkey = new PublicKey(mintAddress);
    const mintInfo = await getMint(connection, mintPubkey);
    return mintInfo.decimals;
}

export async function getTokenDecimalsWithCache(mintAddress: string): Promise<number> {
    if (mintAddress === SOL_MINT) return SOL_DECIMALS;

    if (decimalsCache.has(mintAddress)) {
        return decimalsCache.get(mintAddress) as number;
    }

    const decimals = await getTokenDecimals(mintAddress);
    decimalsCache.set(mintAddress, decimals);
    return decimals;
}