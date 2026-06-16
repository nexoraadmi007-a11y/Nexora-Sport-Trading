export type Sport = 'football' | 'nba' | 'generic';

export type SignalStatus = 'draft' | 'approved' | 'sent' | 'rejected' | 'no_op';
export type SignalTier = 'A+' | 'A' | 'B';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type EngineOperationalStatus = 'PRODUCTION' | 'SHADOW' | 'DISABLED';
export type FootballCompetitionKind = 'club' | 'international_tournament' | 'qualification' | 'friendly' | 'unknown';
export type FootballPriorityTier =
  | 'tier_1_club'
  | 'uefa_club'
  | 'world_cup'
  | 'euro'
  | 'copa_america'
  | 'afcon'
  | 'qualification'
  | 'nations_league'
  | 'friendly'
  | 'other';

export interface CompetitionContext {
  kind: FootballCompetitionKind;
  priorityTier: FootballPriorityTier;
  tournamentMode: boolean;
  priorityScore: number;
}

export interface FixtureRef {
  id: string;
  sport: Sport;
  league: string;
  sportKey?: string;
  country?: string;
  homeTeam?: string;
  awayTeam?: string;
  startsAt: Date;
  competition?: CompetitionContext;
}

export interface MarketPrice {
  fixtureId: string;
  market: string;
  selection: string;
  bookmaker: string;
  odds: number;
  point?: number;
  sourceMarketKey?: string;
  description?: string;
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
  probability?: number;
  ev?: number;
  confidence?: number;
  qualityScore?: number;
  tier?: SignalTier;
  riskLevel?: RiskLevel;
  engineStatus?: EngineOperationalStatus;
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
