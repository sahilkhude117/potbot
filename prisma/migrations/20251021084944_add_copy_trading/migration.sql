-- CreateEnum
CREATE TYPE "CopyTradingMode" AS ENUM ('PERMISSIONED', 'PERMISSIONLESS');

-- CreateEnum
CREATE TYPE "CopiedTradeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "CopyTrading" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetWalletAddress" TEXT NOT NULL,
    "allocatedPercentage" DECIMAL(65,30) NOT NULL,
    "mode" "CopyTradingMode" NOT NULL DEFAULT 'PERMISSIONED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTrading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopiedTrade" (
    "id" TEXT NOT NULL,
    "copyTradingId" TEXT NOT NULL,
    "originalTxHash" TEXT NOT NULL,
    "copiedTxHash" TEXT,
    "inMint" TEXT NOT NULL,
    "inAmount" BIGINT NOT NULL,
    "outMint" TEXT NOT NULL,
    "outAmount" BIGINT NOT NULL,
    "status" "CopiedTradeStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CopiedTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CopyTrading_userId_key" ON "CopyTrading"("userId");

-- AddForeignKey
ALTER TABLE "CopyTrading" ADD CONSTRAINT "CopyTrading_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopiedTrade" ADD CONSTRAINT "CopiedTrade_copyTradingId_fkey" FOREIGN KEY ("copyTradingId") REFERENCES "CopyTrading"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
