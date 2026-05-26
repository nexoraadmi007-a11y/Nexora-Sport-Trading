CREATE TABLE IF NOT EXISTS "TennisHardcourtSignal" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT,
  "league" TEXT NOT NULL,
  "match" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "selection" TEXT NOT NULL,
  "odds" DOUBLE PRECISION NOT NULL,
  "probability" DOUBLE PRECISION NOT NULL,
  "ev" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TennisHardcourtSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MlbFirst5Signal" (
  "id" TEXT NOT NULL,
  "fixtureId" TEXT,
  "league" TEXT NOT NULL,
  "match" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "selection" TEXT NOT NULL,
  "odds" DOUBLE PRECISION NOT NULL,
  "probability" DOUBLE PRECISION NOT NULL,
  "ev" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "qualityScore" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MlbFirst5Signal_pkey" PRIMARY KEY ("id")
);
