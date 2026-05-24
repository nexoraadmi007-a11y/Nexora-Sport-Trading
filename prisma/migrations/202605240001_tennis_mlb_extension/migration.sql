CREATE TABLE "TennisMatch" (
    "id" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "surface" TEXT,
    "playerA" TEXT NOT NULL,
    "playerB" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TennisMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TennisPlayerProfile" (
    "id" TEXT NOT NULL,
    "player" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TennisPlayerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TennisSurfaceProfile" (
    "id" TEXT NOT NULL,
    "player" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TennisSurfaceProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TennisSignal" (
    "id" TEXT NOT NULL,
    "matchId" TEXT,
    "engine" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "ev" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TennisSignal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MlbGame" (
    "id" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "homeTeam" TEXT NOT NULL,
    "awayTeam" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlbGame_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MlbPitcherProfile" (
    "id" TEXT NOT NULL,
    "pitcher" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlbPitcherProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MlbTeamProfile" (
    "id" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MlbTeamProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MlbSignal" (
    "id" TEXT NOT NULL,
    "gameId" TEXT,
    "engine" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "selection" TEXT NOT NULL,
    "odds" DOUBLE PRECISION NOT NULL,
    "probability" DOUBLE PRECISION NOT NULL,
    "ev" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MlbSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TennisPlayerProfile_player_key" ON "TennisPlayerProfile"("player");
CREATE UNIQUE INDEX "TennisSurfaceProfile_player_surface_key" ON "TennisSurfaceProfile"("player", "surface");
CREATE UNIQUE INDEX "MlbPitcherProfile_pitcher_key" ON "MlbPitcherProfile"("pitcher");
CREATE UNIQUE INDEX "MlbTeamProfile_team_key" ON "MlbTeamProfile"("team");
