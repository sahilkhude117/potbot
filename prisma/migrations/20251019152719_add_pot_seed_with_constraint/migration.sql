/*
  Warnings:

  - A unique constraint covering the columns `[potSeed]` on the table `Pot` will be added. If there are existing duplicate values, this will fail.
  - Made the column `potSeed` on table `Pot` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Pot" ALTER COLUMN "potSeed" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Pot_potSeed_key" ON "Pot"("potSeed");
