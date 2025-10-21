import { getPriceInUSD } from "./getPriceInUSD";
import { getTokenDecimalsWithCache } from "./getTokenDecimals";

export async function computePotValueInUSD(
    assets: Array<{
        mintAddress: string;
        balance: bigint
    }>
): Promise<number> {
    let totalUSD = 0;

    for (const { mintAddress, balance } of assets) {
        if (balance === BigInt(0)) continue;

        let priceUSD = await getPriceInUSD(mintAddress);

        const decimals = await getTokenDecimalsWithCache(mintAddress);
        const balanceNumber = Number(balance) / (10 ** decimals);
        totalUSD += balanceNumber * priceUSD;
    }

    return totalUSD;
}