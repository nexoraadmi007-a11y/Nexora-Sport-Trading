import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.65;
const MAX_ODDS = 2.15;
const MIN_TRUE_PROBABILITY = 0.54;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class MlbGameTotalsEngine implements MarketEngine {
  name = 'MLB Game Totals';
  sport = 'mlb' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'mlb');
    const candidates: SignalCandidate[] = [];

    for (const fixture of fixtures) {
      const totalPrices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        /^MLB Total (Over|Under) \d+(\.\d+)?$/.test(price.market) &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );

      for (const side of ['Over', 'Under'] as const) {
        const sidePrices = totalPrices.filter((price) => price.market.includes(` ${side} `));
        if (sidePrices.length === 0) continue;

        const best = sidePrices.sort((a, b) => b.odds - a.odds)[0];
        const line = extractLine(best.market);
        if (!line || line < 6.5 || line > 11.5) continue;

        const implied = 1 / best.odds;
        const lineFit = totalLineFit(side, line);
        const timing = timingStability(fixture.startsAt, context.now);
        const volatility = volatilityPenalty(line, side, best.odds);
        const trueProbability = clamp(implied + lineFit * 0.035 + timing * 0.018 - volatility * 0.025, 0.48, 0.64);
        const ev = trueProbability * best.odds - 1;
        const confidence = Number(clamp(trueProbability * 6.2 + lineFit * 1.3 + timing * 0.9 - volatility * 1.2, 1, 10).toFixed(1));
        const qualityScore = Number(clamp(trueProbability * 44 + confidence * 4.4 + Math.min(ev, 0.09) * 120 + lineFit * 12 + timing * 8 - volatility * 12, 0, 100).toFixed(1));

        if (trueProbability < MIN_TRUE_PROBABILITY || ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'mlb',
          engine: this.name,
          fixture,
          bookmaker: best.bookmaker,
          market: `MLB Total ${side} ${line}`,
          selection: `${side} ${line}`,
          odds: best.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: [
            `MLB full-game ${side} ${line} odds-api market`,
            `line fit ${(lineFit * 100).toFixed(0)}%`,
            `timing stability ${(timing * 100).toFixed(0)}%`,
            `volatility ${(volatility * 100).toFixed(0)}%`
          ].join(' + ')
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 4);
  }
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function totalLineFit(side: string, line: number): number {
  const target = side === 'Over' ? 7.5 : 9.5;
  return clamp(1 - Math.abs(line - target) / 4, 0, 1);
}

function timingStability(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 0 && hours <= 12) return 0.85;
  if (hours > 12 && hours <= 36) return 0.72;
  return 0.5;
}

function volatilityPenalty(line: number, side: string, odds: number): number {
  const lineRisk = side === 'Over' && line >= 10.5 ? 0.3 : side === 'Under' && line <= 7 ? 0.28 : 0.16;
  const priceRisk = odds > 2.05 ? 0.08 : odds < 1.7 ? 0.06 : 0.03;
  return clamp(lineRisk + priceRisk, 0, 1);
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
