import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.1;
const MIN_EV = 0.03;
const MIN_QUALITY = 74;

export class MlbFirst5Engine implements MarketEngine {
  name = 'MLB First 5 Innings';
  sport = 'mlb' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'mlb');
    const candidates: SignalCandidate[] = [];

    for (const fixture of fixtures) {
      const first5Prices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        /^First 5 Innings (Over|Under) \d+(\.\d+)?$/.test(price.market) &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );

      for (const price of first5Prices) {
        const line = extractLine(price.market);
        const side = price.market.includes('Under') ? 'Under' : 'Over';
        if (!line || line < 3.5 || line > 5.5) continue;

        const pitcherStability = startingPitcherStability(line, side, price.odds);
        const weatherStability = weatherStabilityScore(fixture.startsAt, context.now);
        const volatility = earlyScoringVolatility(line, side, price.odds);
        const strikeoutEnvironment = strikeoutEnvironmentScore(line, side);

        if (pitcherStability < 0.72) continue;
        if (weatherStability < 0.7) continue;
        if (volatility > 0.32) continue;
        if (strikeoutEnvironment < 0.55) continue;

        const trueProbability = clamp(0.5 + pitcherStability * 0.08 + weatherStability * 0.04 + strikeoutEnvironment * 0.04 - volatility * 0.06, 0.5, 0.67);
        const ev = trueProbability * price.odds - 1;
        const confidence = Number((pitcherStability * 4 + weatherStability * 1.6 + strikeoutEnvironment * 1.4 - volatility * 1.3).toFixed(1));
        const qualityScore = Number(clamp(pitcherStability * 36 + weatherStability * 18 + strikeoutEnvironment * 18 + Math.min(ev, 0.12) * 130 - volatility * 20, 0, 100).toFixed(1));

        if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'mlb',
          engine: this.name,
          fixture,
          bookmaker: price.bookmaker,
          market: `First 5 Innings ${side} ${line}`,
          selection: `${side} ${line}`,
          odds: price.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: [
            'First 5 validation mode',
            `pitcher stability ${(pitcherStability * 100).toFixed(0)}%`,
            `weather stability ${(weatherStability * 100).toFixed(0)}%`,
            `early volatility ${(volatility * 100).toFixed(0)}%`,
            `strikeout environment ${(strikeoutEnvironment * 100).toFixed(0)}%`
          ].join(' + ')
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 3);
  }
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function startingPitcherStability(line: number, side: string, odds: number): number {
  const lineFit = side === 'Under' ? 1 - Math.abs(line - 4.5) / 2.5 : 1 - Math.abs(line - 5) / 2.5;
  const priceFit = 1 - Math.abs(odds - 1.86) / 0.55;
  return clamp(lineFit * 0.55 + priceFit * 0.45, 0, 1);
}

function weatherStabilityScore(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 0 && hours <= 36) return 0.78;
  if (hours > 36 && hours <= 72) return 0.72;
  return 0.58;
}

function earlyScoringVolatility(line: number, side: string, odds: number): number {
  const lineRisk = side === 'Over' && line >= 5.5 ? 0.3 : side === 'Under' && line <= 3.5 ? 0.26 : 0.16;
  const priceRisk = odds > 2.05 ? 0.1 : odds < 1.68 ? 0.08 : 0.03;
  return clamp(lineRisk + priceRisk, 0, 1);
}

function strikeoutEnvironmentScore(line: number, side: string): number {
  if (side === 'Under') return line >= 4 ? 0.72 : 0.58;
  return line <= 5 ? 0.62 : 0.52;
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 86 && ev >= 0.07) return 'A+';
  if (qualityScore >= 78 && ev >= 0.045) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
