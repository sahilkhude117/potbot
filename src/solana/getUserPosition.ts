import { prismaClient } from "../db/prisma";
import { computePotValueInUSD } from "./computePotValueInUSD";

export async function getUserPosition(
    potId: string,
    userId: string
): Promise<{
    shares: bigint;
    sharePercentage: number;
    valueUSD: number;
    sharePrice: number;
}> {
    const pot = await prismaClient.pot.findUnique({
        where: { id: potId },
        include: {
            assets: true,
            members: {
                where: {
                    userId,
                    potId
                }
            }
        }
    });

    if (!pot) throw new Error("Pot not found");
    
    const member = pot.members[0];
    if (!member) {
        return { 
            shares: BigInt(0), 
            sharePercentage: 0, 
            valueUSD: 0,
            sharePrice: 0,
        };
    }

    const totalPotValueUSD = await computePotValueInUSD(
        pot.assets.map(a => ({ mintAddress: a.mintAddress, balance: a.balance }))
    );

    const sharePercentage = pot.totalShares === BigInt(0)
        ? 0
        : Number(member.shares) / Number(pot.totalShares);

    const valueUSD = totalPotValueUSD * sharePercentage;
    const sharePrice = pot.totalShares === BigInt(0)
        ? 0
        : totalPotValueUSD / Number(pot.totalShares)

    return {
        shares: member.shares,
        sharePercentage: sharePercentage * 100,
        valueUSD,
        sharePrice
    }
}