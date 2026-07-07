-- CreateEnum
CREATE TYPE "SellerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "VerifyMode" AS ENUM ('CONSENSUS', 'CONTENT_ADDRESSED', 'REPUTATION');

-- CreateEnum
CREATE TYPE "QueryStatus" AS ENUM ('QUOTED', 'FANOUT', 'SETTLED_ONCHAIN', 'FAILED', 'DONE');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'AVAILABLE', 'FAILED');

-- CreateTable
CREATE TABLE "sellers" (
    "id" TEXT NOT NULL,
    "solanaPubkey" TEXT NOT NULL,
    "payoutAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "mode" "VerifyMode" NOT NULL DEFAULT 'CONSENSUS',
    "category" TEXT NOT NULL,
    "coverage" TEXT[],
    "schemaDesc" TEXT NOT NULL,
    "freshnessSec" INTEGER NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 500,
    "stake" TEXT NOT NULL DEFAULT '0',
    "served" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "outliers" INTEGER NOT NULL DEFAULT 0,
    "status" "SellerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sellers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queries" (
    "id" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "mode" "VerifyMode" NOT NULL,
    "k" INTEGER NOT NULL,
    "maxPrice" TEXT,
    "feeAmount" TEXT NOT NULL DEFAULT '0',
    "truth" TEXT,
    "cost" TEXT,
    "status" "QueryStatus" NOT NULL DEFAULT 'QUOTED',
    "solanaReqPda" TEXT,
    "solanaTx" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "responses" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "valueOrHash" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "matched" BOOLEAN,

    CONSTRAINT "responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "queryId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "gatewayTx" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sellers_solanaPubkey_key" ON "sellers"("solanaPubkey");

-- CreateIndex
CREATE INDEX "sellers_category_status_idx" ON "sellers"("category", "status");

-- CreateIndex
CREATE INDEX "queries_status_createdAt_idx" ON "queries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "responses_queryId_sellerId_key" ON "responses"("queryId", "sellerId");

-- CreateIndex
CREATE INDEX "settlements_status_idx" ON "settlements"("status");

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responses" ADD CONSTRAINT "responses_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_queryId_fkey" FOREIGN KEY ("queryId") REFERENCES "queries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
