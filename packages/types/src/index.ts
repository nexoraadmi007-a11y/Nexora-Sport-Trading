export type Sport = 'football' | 'nba' | 'tennis' | 'mlb' | 'generic';

export type SignalStatus = 'draft' | 'approved' | 'sent' | 'rejected' | 'no_op';

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
  metadata?: Record<string, unknown>;
}

export interface SignalCandidate {
  sport: Sport;
  engine: string;
  fixture?: FixtureRef;
  subject?: string;
  bookmaker?: string;
  market: string;
  selection: string;
  odds?: number;
  status?: SignalStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
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
