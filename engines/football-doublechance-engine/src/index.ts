import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.2;
const MAX_ODDS = 1.75;
const MIN_TRUE_PROBABILITY = 0.72;
const MIN_EV = 0.01;
const MIN_QUALITY = 70;

export class FootballDoubleChanceEngine implements MarketEngine {
  name = 'Double Chance Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const candidates: SignalCandidate[] = [];

    for (const fixture of footballFixtures) {
      const h2hPrices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        price.market === 'Double Chance Candidate'
      );
      if (h2hPrices.length < 6 || !fixture.homeTeam || !fixture.awayTeam) continue;

      const grouped = groupOutcomePrices(h2hPrices);
      const home = grouped.get(fixture.homeTeam);
      const away = grouped.get(fixture.awayTeam);
      const draw = grouped.get('Draw');
      if (!home || !away || !draw) continue;

      const normalized = normalizeProbabilities({
        home: impliedConsensus(home),
        draw: impliedConsensus(draw),
        away: impliedConsensus(away)
      });

      const options = [
        buildOption('1X', `${fixture.homeTeam} or Draw`, normalized.home + normalized.draw, home, draw),
        buildOption('X2', `${fixture.awayTeam} or Draw`, normalized.away + normalized.draw, away, draw),
        buildOption('12', `${fixture.homeTeam} or ${fixture.awayTeam}`, normalized.home + normalized.away, home, away)
      ];

      for (const option of options) {
        const trueProbability = clamp(option.baseProbability + stabilityBoost(option.stability) + leagueStabilityBoost(fixture.league), 0.01, 0.92);
        const ev = trueProbability * option.odds - 1;
        const confidence = confidenceScore(trueProbability, option.stability, ev, option.sourcePrices);
        const qualityScore = qualityScoreFor({ trueProbability, confidence, ev, stability: option.stability, priceCount: option.sourcePrices });
        if (option.odds < MIN_ODDS || option.odds > MAX_ODDS) continue;
        if (trueProbability < MIN_TRUE_PROBABILITY || ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'football',
          engine: this.name,
          fixture,
          market: 'Double Chance',
          selection: option.selection,
          odds: option.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: reasonFor(fixture.league, option.selection, trueProbability, option.stability)
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function groupOutcomePrices(prices: Array<{ selection: string; odds: number }>): Map<string, Array<{ odds: number }>> {
  const grouped = new Map<string, Array<{ odds: number }>>();
  for (const price of prices) {
    const current = grouped.get(price.selection) || [];
    current.push({ odds: price.odds });
    grouped.set(price.selection, current);
  }
  return grouped;
}

function impliedConsensus(prices: Array<{ odds: number }>): number {
  return prices.reduce((sum, price) => sum + 1 / price.odds, 0) / prices.length;
}

function normalizeProbabilities(input: { home: number; draw: number; away: number }) {
  const total = input.home + input.draw + input.away;
  return {
    home: input.home / total,
    draw: input.draw / total,
    away: input.away / total
  };
}

function buildOption(code: string, selection: string, baseProbability: number, a: Array<{ odds: number }>, b: Array<{ odds: number }>) {
  const fairOdds = 1 / baseProbability;
  const marginAdjustedOdds = fairOdds * 0.94;
  const stability = priceStability([...a, ...b]);
  return {
    code,
    selection,
    baseProbability,
    odds: Number(clamp(marginAdjustedOdds, 1.01, 2.2).toFixed(2)),
    stability,
    sourcePrices: a.length + b.length
  };
}

function priceStability(prices: Array<{ odds: number }>): number {
  const odds = prices.map((price) => price.odds);
  const min = Math.min(...odds);
  const max = Math.max(...odds);
  return clamp(1 - (max - min) / max, 0, 1);
}

function stabilityBoost(stability: number): number {
  return stability >= 0.9 ? 0.012 : stability >= 0.8 ? 0.006 : 0;
}

function leagueStabilityBoost(league: string): number {
  const normalized = league.toLowerCase();
  if (normalized.includes('serie a')) return 0.02;
  if (normalized.includes('la liga')) return 0.018;
  if (normalized.includes('premier league')) return 0.014;
  if (normalized.includes('bundesliga')) return 0.01;
  return 0;
}

function confidenceScore(trueProbability: number, stability: number, ev: number, sourcePrices: number): number {
  const score = trueProbability * 6.4 + stability * 1.6 + Math.min(sourcePrices, 12) * 0.08 + Math.min(ev, 0.08) * 5;
  return Number(clamp(score, 1, 10).toFixed(1));
}

function qualityScoreFor(input: { trueProbability: number; confidence: number; ev: number; stability: number; priceCount: number }): number {
  const score = input.trueProbability * 46 +
    input.confidence * 4.2 +
    Math.min(input.ev, 0.08) * 130 +
    input.stability * 12 +
    Math.min(input.priceCount, 12) * 0.75;
  return Number(clamp(score, 0, 100).toFixed(1));
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.045) return 'A+';
  if (qualityScore >= 76 && ev >= 0.03) return 'A';
  return 'B';
}

function reasonFor(league: string, selection: string, trueProbability: number, stability: number): string {
  return [
    `Stable ${selection} profile in ${league}`,
    `model probability ${(trueProbability * 100).toFixed(1)}%`,
    `market stability ${(stability * 100).toFixed(0)}%`,
    'low-variance double chance structure'
  ].join(' + ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
