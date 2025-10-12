export async function getPriceInUSD(mintAddress: string): Promise<number> {
  const jupiterResponse = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mintAddress}`);
  const jupiterData = await jupiterResponse.json() as Record<string, {
    usdPrice: number;
    blockId: number;
    decimals: number;
    priceChange24h: number;
  }>;
  
  if (!jupiterData[mintAddress]?.usdPrice) {
    throw new Error(`Price not found for ${mintAddress}`);
  }
  
  return Number(jupiterData[mintAddress].usdPrice);
}