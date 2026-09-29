-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PROPOSED', 'AWAITING_REVIEW', 'EXECUTED', 'REJECTED', 'SUPERSEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('APPROVED', 'REJECTED', 'MODIFIED', 'AUTO_EXECUTED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "generatedTick" INTEGER NOT NULL,
    "stationId" TEXT NOT NULL,
    "fuelType" TEXT NOT NULL,
    "sourceDepotId" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "riskBefore" DOUBLE PRECISION NOT NULL,
    "riskAfter" DOUBLE PRECISION NOT NULL,
    "stockoutProbBefore" DOUBLE PRECISION NOT NULL,
    "stockoutProbAfter" DOUBLE PRECISION NOT NULL,
    "forecastLiters" DOUBLE PRECISION NOT NULL,
    "confidence" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "explanation" JSONB NOT NULL,
    "alternatives" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "recommendationId" TEXT NOT NULL,
    "action" "DecisionAction" NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "tick" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationExecution" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "recommendationId" TEXT,
    "simulatorAllocationId" INTEGER,
    "request" JSONB NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "errorCode" TEXT,
    "finalStatus" TEXT,
    "createdTick" INTEGER NOT NULL,
    "arrivalTick" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "tick" INTEGER,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "serviceLevel" DOUBLE PRECISION NOT NULL,
    "servedLiters" DOUBLE PRECISION NOT NULL,
    "unmetLiters" DOUBLE PRECISION NOT NULL,
    "allocationLiters" DOUBLE PRECISION NOT NULL,
    "allocationFailures" INTEGER NOT NULL,
    "forecastMae" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "ticks" INTEGER NOT NULL,
    "seed" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recommendation_generatedTick_idx" ON "Recommendation"("generatedTick");

-- CreateIndex
CREATE INDEX "Recommendation_stationId_fuelType_idx" ON "Recommendation"("stationId", "fuelType");

-- CreateIndex
CREATE INDEX "Decision_recommendationId_idx" ON "Decision"("recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationExecution_idempotencyKey_key" ON "AllocationExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AllocationExecution_simulatorAllocationId_idx" ON "AllocationExecution"("simulatorAllocationId");

-- CreateIndex
CREATE INDEX "Incident_kind_closedAt_idx" ON "Incident"("kind", "closedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshot_tick_idx" ON "MetricSnapshot"("tick");

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationExecution" ADD CONSTRAINT "AllocationExecution_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
