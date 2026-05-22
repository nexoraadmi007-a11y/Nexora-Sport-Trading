import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.25;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

const PROP_MARKETS = new Map([
  ['player_points', 'points'],
  ['player_rebounds', 'rebounds'],
  ['player_assists', 'assists'],
  ['player_threes', 'threePointersMade']
] as const);

export class NbaPlayerPropsEngine implements MarketEngine {
  name = 'Player Props';
  sport = 'nba' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    if (context.playerStats.length === 0) return [];

    const candidates: SignalCandidate[] = [];
    const playerIndex = new Map(context.playerStats.map((stat) => [normalizeName(stat.playerName), stat]));
    const fixtureIndex = new Map(context.fixtures.map((fixture) => [fixture.id, fixture]));
    const propPrices = context.prices.filter((price) =>
      [...PROP_MARKETS.keys()].some((key) => price.market.startsWith(key)) &&
      price.odds >= MIN_ODDS &&
      price.odds <= MAX_ODDS
    );

    for (const price of propPrices) {
      const stat = playerIndex.get(normalizeName(price.selection));
      if (!stat) continue;

      const marketKey = [...PROP_MARKETS.keys()].find((key) => price.market.startsWith(key));
      if (!marketKey) continue;
      const statKey = PROP_MARKETS.get(marketKey);
      const line = extractLine(price.market);
      const recentValue = statKey ? stat[statKey] : undefined;
      if (!line || recentValue === undefined) continue;

      const side = price.market.toLowerCase().includes('under') ? 'Under' : 'Over';
      const trueProbability = probabilityFromRecentValue(side, Number(recentValue), line);
      const ev = trueProbability * price.odds - 1;
      const confidence = confidenceScore(trueProbability, stat.minutes || 0, ev);
      const qualityScore = qualityScoreFor(trueProbability, confidence, ev, stat.minutes || 0);
      if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

      candidates.push({
        sport: 'nba',
        engine: this.name,
        fixture: fixtureIndex.get(price.fixtureId),
        subject: stat.playerName,
        market: readableMarket(marketKey, side, line),
        selection: price.selection,
        odds: price.odds,
        trueProbability,
        ev,
        confidence,
        qualityScore,
        tier: tierFor(qualityScore, ev),
        reason: reasonFor(stat.playerName, side, line, Number(recentValue), confidence)
      });
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function probabilityFromRecentValue(side: string, recentValue: number, line: number): number {
  const edge = side === 'Over' ? recentValue - line : line - recentValue;
  return clamp(0.5 + edge * 0.035, 0.38, 0.74);
}

function confidenceScore(trueProbability: number, minutes: number, ev: number): number {
  const minuteScore = minutes >= 30 ? 1.3 : minutes >= 24 ? 0.8 : 0.2;
  const score = trueProbability * 6 + minuteScore + Math.min(ev, 0.1) * 7;
  return Number(clamp(score, 1, 10).toFixed(1));
}

function qualityScoreFor(trueProbability: number, confidence: number, ev: number, minutes: number): number {
  const score = trueProbability * 42 +
    confidence * 4.5 +
    Math.min(ev, 0.1) * 120 +
    Math.min(minutes, 36) * 0.45;
  return Number(clamp(score, 0, 100).toFixed(1));
}

function readableMarket(marketKey: string, side: string, line: number): string {
  const labels: Record<string, string> = {
    player_points: 'Points',
    player_rebounds: 'Rebounds',
    player_assists: 'Assists',
    player_threes: '3PM'
  };
  return `${side} ${line} ${labels[marketKey] || marketKey}`;
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function reasonFor(player: string, side: string, line: number, recentValue: number, confidence: number): string {
  return [
    `${player} recent stat profile supports ${side} ${line}`,
    `latest final stat ${recentValue}`,
    `confidence ${confidence}/10`
  ].join(' + ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
