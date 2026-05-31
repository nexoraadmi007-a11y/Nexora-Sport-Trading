import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.1;
const MIN_TRUE_PROBABILITY = 0.54;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class NbaTeamTotalsEngine implements MarketEngine {
  name = 'Team Totals';
  sport = 'nba' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const nbaFixtures = context.fixtures.filter((fixture) => fixture.sport === 'nba');
    const candidates: SignalCandidate[] = [];

    for (const fixture of nbaFixtures) {
      const totalPrices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        (isTeamTotal(price.market) || isGameTotal(price.market)) &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );
      if (totalPrices.length < 1) continue;

      for (const side of ['Over', 'Under'] as const) {
        const sidePrices = totalPrices.filter((price) => price.market.includes(` ${side} `) || price.market.startsWith(side));
        if (sidePrices.length < 1) continue;

        const best = sidePrices.sort((a, b) => b.odds - a.odds)[0];
        const point = extractPoint(best.market);
        if (!point) continue;
        const team = extractTeam(best.market);

        const consensusProbability = impliedConsensusProbability(sidePrices);
        const stability = priceStability(sidePrices);
        const timingBoost = kickoffWindowBoost(fixture.startsAt, context.now);
        const trueProbability = clamp(consensusProbability + timingBoost + nbaMarketDepthBoost(sidePrices.length), 0.01, 0.76);
        const ev = trueProbability * best.odds - 1;
        const confidence = confidenceScore(trueProbability, sidePrices.length, stability, ev);
        const qualityScore = qualityScoreFor({ trueProbability, confidence, ev, priceCount: sidePrices.length, stability });

        if (trueProbability < MIN_TRUE_PROBABILITY || ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'nba',
          engine: this.name,
          fixture,
          bookmaker: best.bookmaker,
          market: team ? `Team Total ${team} ${side} ${point}` : `Game Total Proxy ${side} ${point}`,
          selection: team ? `${team} ${side} ${point}` : `${side} ${point}`,
          odds: best.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: reasonFor(side, point, trueProbability, sidePrices.length, stability)
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function isTeamTotal(market: string): boolean {
  return /^Team Total .+ (Over|Under) \d+(\.\d+)?$/.test(market);
}

function isGameTotal(market: string): boolean {
  return /^Over \d+(\.\d+)?$/.test(market) || /^Under \d+(\.\d+)?$/.test(market);
}

function extractPoint(market: string): number | null {
  const match = market.match(/(?:Over|Under)\s+(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function extractTeam(market: string): string | null {
  const match = market.match(/^Team Total (.+) (?:Over|Under) \d+(?:\.\d+)?$/);
  return match ? match[1] : null;
}

function impliedConsensusProbability(prices: Array<{ odds: number }>): number {
  const averageImplied = prices.reduce((sum, price) => sum + 1 / price.odds, 0) / prices.length;
  return clamp(averageImplied, 0.01, 0.76);
}

function priceStability(prices: Array<{ odds: number }>): number {
  const odds = prices.map((price) => price.odds);
  const min = Math.min(...odds);
  const max = Math.max(...odds);
  return clamp(1 - (max - min) / max, 0, 1);
}

function kickoffWindowBoost(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 0 && hours <= 8) return 0.01;
  if (hours > 8 && hours <= 24) return 0.005;
  return 0;
}

function nbaMarketDepthBoost(priceCount: number): number {
  return priceCount >= 8 ? 0.008 : priceCount >= 4 ? 0.004 : 0;
}

function confidenceScore(trueProbability: number, priceCount: number, stability: number, ev: number): number {
  const score = trueProbability * 5.9 + Math.min(priceCount, 10) * 0.14 + stability * 1.3 + Math.min(ev, 0.1) * 7;
  return Number(clamp(score, 1, 10).toFixed(1));
}

function qualityScoreFor(input: { trueProbability: number; confidence: number; ev: number; priceCount: number; stability: number }): number {
  const score = input.trueProbability * 42 +
    input.confidence * 4.3 +
    Math.min(input.ev, 0.1) * 120 +
    input.stability * 14 +
    Math.min(input.priceCount, 10);
  return Number(clamp(score, 0, 100).toFixed(1));
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function reasonFor(side: string, point: number, trueProbability: number, priceCount: number, stability: number): string {
  return [
    `NBA totals ${side} ${point} market profile`,
    `${priceCount} bookmaker prices available`,
    `market stability ${(stability * 100).toFixed(0)}%`,
    `model probability ${(trueProbability * 100).toFixed(1)}%`
  ].join(' + ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
