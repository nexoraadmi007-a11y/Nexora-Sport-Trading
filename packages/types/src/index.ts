export type Sport = 'football' | 'nba';

export type SignalTier = 'A+' | 'A' | 'B';

export type SignalStatus = 'candidate' | 'approved' | 'sent' | 'rejected' | 'no_bet';

export interface FixtureRef {
  id: string;
  sport: Sport;
  league: string;
  country?: string;
  homeTeam?: string;
  awayTeam?: string;
  startsAt: Date;
}

export interface MarketPrice {
  fixtureId: string;
  market: string;
  selection: string;
  bookmaker: string;
  odds: number;
  capturedAt: Date;
}

export interface PlayerStatRef {
  playerId: string;
  playerName: string;
  team?: string;
  opponent?: string;
  gameDate: Date;
  points?: number;
  rebounds?: number;
  assists?: number;
  threePointersMade?: number;
  minutes?: number;
}

export interface SignalCandidate {
  sport: Sport;
  engine: string;
  fixture?: FixtureRef;
  subject?: string;
  bookmaker?: string;
  market: string;
  selection: string;
  odds: number;
  trueProbability: number;
  ev: number;
  confidence: number;
  qualityScore: number;
  tier: SignalTier;
  reason: string;
}

export interface EngineContext {
  fixtures: FixtureRef[];
  prices: MarketPrice[];
  playerStats: PlayerStatRef[];
  now: Date;
}

export interface MarketEngine {
  name: string;
  sport: Sport;
  generate(context: EngineContext): Promise<SignalCandidate[]>;
}
