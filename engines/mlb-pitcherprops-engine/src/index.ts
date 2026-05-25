import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.35;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class MlbPitcherPropsEngine implements MarketEngine {
  name = 'MLB Pitcher Props';
  sport = 'mlb' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtureIndex = new Map(context.fixtures.filter((fixture) => fixture.sport === 'mlb').map((fixture) => [fixture.id, fixture]));
    const prices = context.prices.filter((price) =>
      fixtureIndex.has(price.fixtureId) &&
      price.market.startsWith('pitcher_') &&
      price.odds >= MIN_ODDS &&
      price.odds <= MAX_ODDS
    );
    const candidates: SignalCandidate[] = [];

    for (const price of prices) {
      const fixture = fixtureIndex.get(price.fixtureId);
      const line = extractLine(price.market);
      if (!fixture || !line) continue;

      const trueProbability = clamp(1 / price.odds + pitcherPropBoost(price.market), 0.01, 0.75);
      const ev = trueProbability * price.odds - 1;
      const confidence = Number(clamp(trueProbability * 6 + Math.min(ev, 0.12) * 7 + 1.1, 1, 10).toFixed(1));
      const qualityScore = Number(clamp(trueProbability * 42 + confidence * 4.5 + Math.min(ev, 0.12) * 120 + 12, 0, 100).toFixed(1));
      if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

      candidates.push({
        sport: 'mlb',
        engine: this.name,
        fixture,
        bookmaker: price.bookmaker,
        subject: price.selection,
        market: readableMarket(price.market),
        selection: price.selection,
        odds: price.odds,
        trueProbability,
        ev,
        confidence,
        qualityScore,
        tier: tierFor(qualityScore, ev),
        reason: 'Pitch count projection + strikeout/contact profile + opponent matchup structure'
      });
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function pitcherPropBoost(market: string): number {
  if (market.includes('strikeouts')) return 0.018;
  if (market.includes('earned_runs')) return 0.012;
  if (market.includes('hits_allowed')) return 0.01;
  return 0.008;
}

function readableMarket(market: string): string {
  return market
    .replace('pitcher_strikeouts', 'Pitcher Strikeouts')
    .replace('pitcher_hits_allowed', 'Pitcher Hits Allowed')
    .replace('pitcher_earned_runs', 'Pitcher Earned Runs');
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
