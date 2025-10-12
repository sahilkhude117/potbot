-- AlterTable
ALTER TABLE "Asset" ADD COLUMN     "pendingSale" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Pot" ADD COLUMN     "accruedAdminFees" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "cashOutMint" TEXT NOT NULL DEFAULT 'So11111111111111111111111111111111111111112',
ADD COLUMN     "maxRedeptionSlippageBps" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "performanceFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "redemptionFeeBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalShares" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Pot_Member" ADD COLUMN     "shares" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "sharesMinted" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharesBurned" BIGINT NOT NULL,
    "amountOut" BIGINT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionTrade" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "sellMint" TEXT NOT NULL,
    "sellAmount" BIGINT NOT NULL,
    "buyMint" TEXT NOT NULL,
    "buyAmount" BIGINT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "slippageBps" INTEGER NOT NULL DEFAULT 50,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RedemptionTrade_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deposit" ADD CONSTRAINT "Deposit_userId_potId_fkey" FOREIGN KEY ("userId", "potId") REFERENCES "Pot_Member"("userId", "potId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_userId_potId_fkey" FOREIGN KEY ("userId", "potId") REFERENCES "Pot_Member"("userId", "potId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTrade" ADD CONSTRAINT "RedemptionTrade_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RedemptionTrade" ADD CONSTRAINT "RedemptionTrade_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
