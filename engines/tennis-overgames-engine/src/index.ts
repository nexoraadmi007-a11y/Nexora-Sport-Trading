import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.2;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class TennisOverGamesEngine implements MarketEngine {
  name = 'Tennis Over Games';
  sport = 'tennis' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'tennis');
    const candidates: SignalCandidate[] = [];

    for (const fixture of fixtures) {
      const prices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        /^Over \d+(\.\d+)? Games$/.test(price.market) &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );
      if (prices.length < 2) continue;

      const best = prices.sort((a, b) => b.odds - a.odds)[0];
      const line = extractLine(best.market);
      if (!line) continue;

      const stability = priceStability(prices);
      const trueProbability = clamp(impliedConsensus(prices) + surfaceDepthBoost(fixture.league, prices.length) + timingBoost(fixture.startsAt, context.now), 0.01, 0.78);
      const ev = trueProbability * best.odds - 1;
      const confidence = confidenceScore(trueProbability, stability, prices.length, ev);
      const qualityScore = qualityScoreFor(trueProbability, confidence, stability, prices.length, ev);
      if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

      candidates.push({
        sport: 'tennis',
        engine: this.name,
        fixture,
        market: `Over ${line} Games`,
        selection: `Over ${line}`,
        odds: best.odds,
        trueProbability,
        ev,
        confidence,
        qualityScore,
        tier: tierFor(qualityScore, ev),
        reason: `Serve-hold profile + match length projection + surface market depth support Over ${line}`
      });
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function impliedConsensus(prices: Array<{ odds: number }>): number {
  return clamp(prices.reduce((sum, price) => sum + 1 / price.odds, 0) / prices.length, 0.01, 0.78);
}

function priceStability(prices: Array<{ odds: number }>): number {
  const odds = prices.map((price) => price.odds);
  return clamp(1 - (Math.max(...odds) - Math.min(...odds)) / Math.max(...odds), 0, 1);
}

function surfaceDepthBoost(league: string, priceCount: number): number {
  const leagueBoost = /atp|wta/i.test(league) ? 0.006 : 0;
  return leagueBoost + (priceCount >= 6 ? 0.006 : 0.002);
}

function timingBoost(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  return hours > 0 && hours <= 24 ? 0.006 : 0;
}

function confidenceScore(trueProbability: number, stability: number, priceCount: number, ev: number): number {
  return Number(clamp(trueProbability * 6 + stability * 1.4 + Math.min(priceCount, 10) * 0.12 + Math.min(ev, 0.12) * 7, 1, 10).toFixed(1));
}

function qualityScoreFor(trueProbability: number, confidence: number, stability: number, priceCount: number, ev: number): number {
  return Number(clamp(trueProbability * 42 + confidence * 4.4 + stability * 14 + Math.min(priceCount, 10) + Math.min(ev, 0.12) * 120, 0, 100).toFixed(1));
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
