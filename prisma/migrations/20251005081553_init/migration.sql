-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'TRADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('COMPLETED', 'PENDING', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegramGroupId" TEXT NOT NULL,
    "vaultAddress" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pot_Member" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "Pot_Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "inMint" TEXT NOT NULL,
    "inAmount" BIGINT NOT NULL,
    "outMint" TEXT NOT NULL,
    "outAmount" BIGINT NOT NULL,
    "txSignature" TEXT NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "potId" TEXT NOT NULL,
    "mintAddress" TEXT NOT NULL,
    "balance" BIGINT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramUserId_key" ON "User"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicKey_key" ON "User"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "Pot_telegramGroupId_key" ON "Pot"("telegramGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "Pot_vaultAddress_key" ON "Pot"("vaultAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Pot_Member_userId_potId_key" ON "Pot_Member"("userId", "potId");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_txSignature_key" ON "Trade"("txSignature");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_potId_mintAddress_key" ON "Asset"("potId", "mintAddress");

-- AddForeignKey
ALTER TABLE "Pot" ADD CONSTRAINT "Pot_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot_Member" ADD CONSTRAINT "Pot_Member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pot_Member" ADD CONSTRAINT "Pot_Member_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "Pot_Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_potId_fkey" FOREIGN KEY ("potId") REFERENCES "Pot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
