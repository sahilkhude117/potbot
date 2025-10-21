import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface TokenAccount {
    mintAddress: string;
    balance: bigint;
    decimals: number;
    uiAmount: number;
    programId: string; 
    accountAddress: string;
}

export async function getUserTokenAccounts(
    connection: Connection,
    userPublicKey: string
): Promise<TokenAccount[]> {
    try {
        const publicKey = new PublicKey(userPublicKey);
        const accounts: TokenAccount[] = [];

        const [tokenAccounts, token2022Accounts] = await Promise.all([
            connection.getParsedTokenAccountsByOwner(
                publicKey,
                { programId: TOKEN_PROGRAM_ID }
            ),
            connection.getParsedTokenAccountsByOwner(
                publicKey,
                { programId: TOKEN_2022_PROGRAM_ID }
            )
        ]);

        for (const { pubkey, account } of tokenAccounts.value) {
            const info = account.data?.parsed?.info;
            const amountStr = info?.tokenAmount?.amount ?? '0';
            const balance = BigInt(amountStr);

            if (info && balance > BigInt(0)) {
                accounts.push({
                    mintAddress: info.mint,
                    balance,
                    decimals: info.tokenAmount.decimals,
                    uiAmount: info.tokenAmount.uiAmount,
                    programId: TOKEN_PROGRAM_ID.toString(),
                    accountAddress: pubkey.toString()
                });
            }
        }

        for (const { pubkey, account } of token2022Accounts.value) {
            const info = account.data?.parsed?.info;
            const amountStr = info?.tokenAmount?.amount ?? '0';
            const balance = BigInt(amountStr);

            if (info && balance > BigInt(0)) {
                accounts.push({
                    mintAddress: info.mint,
                    balance,
                    decimals: info.tokenAmount.decimals,
                    uiAmount: info.tokenAmount.uiAmount,
                    programId: TOKEN_2022_PROGRAM_ID.toString(),
                    accountAddress: pubkey.toString()
                });
            }
        }

        return accounts;
    } catch (error) {
        console.error('Error fetching token accounts:', error);
        throw new Error('Failed to fetch token accounts');
    }
}


export async function getTokenMetadata(mintAddress: string): Promise<{
    symbol: string;
    name: string;
} | null> {
    try {
        const response = await fetch(
            `https://lite-api.jup.ag/tokens/v2/search?query=${mintAddress}`
        );
        if (response.ok) {
            const data = await response.json() as any;
            if (Array.isArray(data) && data.length > 0) {
                const token = data.find((t: any) => t.id === mintAddress) || data[0];
                return {
                    symbol: token.symbol || "UNKNOWN",
                    name: token.name || "Unknown Token"
                };
            }
        }
    } catch (error) {
        console.log(`Could not fetch metadata for ${mintAddress}`);
    }
    return null;
}

