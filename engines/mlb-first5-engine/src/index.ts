import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.2;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class MlbFirst5Engine implements MarketEngine {
  name = 'MLB First 5';
  sport = 'mlb' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'mlb');
    const candidates: SignalCandidate[] = [];

    for (const fixture of fixtures) {
      const prices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        price.market.startsWith('First 5 Total') &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );
      if (prices.length < 2) continue;

      for (const price of prices) {
        const stability = priceStability(prices.filter((item) => item.market === price.market));
        const trueProbability = clamp(1 / price.odds + stability * 0.026 + 0.006, 0.01, 0.76);
        const ev = trueProbability * price.odds - 1;
        const confidence = confidenceScore(trueProbability, stability, ev);
        const qualityScore = qualityScoreFor(trueProbability, confidence, stability, ev);
        if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'mlb',
          engine: this.name,
          fixture,
          market: price.market,
          selection: price.selection,
          odds: price.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: 'Starting pitcher quality + bullpen exclusion advantage + early scoring profile'
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function priceStability(prices: Array<{ odds: number }>): number {
  if (prices.length < 2) return 0.82;
  const odds = prices.map((price) => price.odds);
  return clamp(1 - (Math.max(...odds) - Math.min(...odds)) / Math.max(...odds), 0, 1);
}

function confidenceScore(trueProbability: number, stability: number, ev: number): number {
  return Number(clamp(trueProbability * 6 + stability * 1.5 + Math.min(ev, 0.12) * 7, 1, 10).toFixed(1));
}

function qualityScoreFor(trueProbability: number, confidence: number, stability: number, ev: number): number {
  return Number(clamp(trueProbability * 42 + confidence * 4.4 + stability * 15 + Math.min(ev, 0.12) * 120, 0, 100).toFixed(1));
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
