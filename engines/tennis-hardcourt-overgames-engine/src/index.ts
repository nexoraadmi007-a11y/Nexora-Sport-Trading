import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_LINE = 21.5;
const MAX_LINE = 24.5;
const MIN_ODDS = 1.65;
const MAX_ODDS = 2.1;
const MIN_EV = 0.03;
const MIN_QUALITY = 74;

export class TennisHardcourtOverGamesEngine implements MarketEngine {
  name = 'ATP Over Games';
  sport = 'tennis' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'tennis');
    const candidates: SignalCandidate[] = [];

    for (const fixture of fixtures) {
      if (!isHardCourt(fixture.league, fixture.country)) continue;
      const overPrices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        /^Over \d+(\.\d+)? Games$/.test(price.market) &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );

      for (const price of overPrices) {
        const line = extractLine(price.market);
        if (!line || line < MIN_LINE || line > MAX_LINE) continue;

        const competitiveness = competitivenessScore(price.odds, line);
        const dominanceRisk = dominanceRiskScore(price.odds, line);
        const tieBreakProfile = tieBreakProbability(line, price.odds);
        const fatigueConfidence = fatigueConfidenceScore(fixture.startsAt, context.now);

        if (competitiveness < 0.72) continue;
        if (dominanceRisk > 0.28) continue;
        if (tieBreakProfile < 0.52) continue;
        if (fatigueConfidence < 0.7) continue;

        const trueProbability = clamp(0.5 + competitiveness * 0.08 + tieBreakProfile * 0.06 - dominanceRisk * 0.05, 0.5, 0.68);
        const ev = trueProbability * price.odds - 1;
        const confidence = Number((competitiveness * 4.2 + tieBreakProfile * 2.5 + fatigueConfidence * 1.4 - dominanceRisk * 1.5).toFixed(1));
        const qualityScore = Number(clamp(competitiveness * 38 + tieBreakProfile * 24 + fatigueConfidence * 18 + Math.min(ev, 0.12) * 130 - dominanceRisk * 18, 0, 100).toFixed(1));

        if (ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

        candidates.push({
          sport: 'tennis',
          engine: this.name,
          fixture,
          bookmaker: price.bookmaker,
          market: `Over ${line} Games`,
          selection: `Over ${line}`,
          odds: price.odds,
          trueProbability,
          ev,
          confidence,
          qualityScore,
          tier: tierFor(qualityScore, ev),
          reason: [
            'ATP hard-court over-games validation',
            `competitiveness ${(competitiveness * 100).toFixed(0)}%`,
            `dominance risk ${(dominanceRisk * 100).toFixed(0)}%`,
            `tie-break profile ${(tieBreakProfile * 100).toFixed(0)}%`,
            'validation mode'
          ].join(' + ')
        });
      }
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 3);
  }
}

function isHardCourt(league: string, country?: string): boolean {
  const label = `${league} ${country || ''}`.toLowerCase();
  if (label.includes('clay') || label.includes('french')) return false;
  if (label.includes('grass') || label.includes('wimbledon')) return false;
  return label.includes('hard') || label.includes('australian') || label.includes('us open') || label.includes('indian wells') || label.includes('miami');
}

function extractLine(market: string): number | null {
  const match = market.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function competitivenessScore(odds: number, line: number): number {
  const oddsBalance = 1 - Math.abs(odds - 1.86) / 0.55;
  const lineBalance = 1 - Math.abs(line - 22.5) / 4;
  return clamp(oddsBalance * 0.6 + lineBalance * 0.4, 0, 1);
}

function dominanceRiskScore(odds: number, line: number): number {
  const lowLineRisk = line < 21.5 ? 0.35 : 0;
  const priceRisk = odds < 1.68 ? 0.22 : odds > 2.08 ? 0.16 : 0.08;
  return clamp(lowLineRisk + priceRisk, 0, 1);
}

function tieBreakProbability(line: number, odds: number): number {
  return clamp(0.46 + (line - 21.5) * 0.045 + (odds >= 1.75 && odds <= 2.02 ? 0.08 : 0), 0, 1);
}

function fatigueConfidenceScore(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 2 && hours <= 72) return 0.82;
  if (hours > 72) return 0.74;
  return 0.55;
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 86 && ev >= 0.07) return 'A+';
  if (qualityScore >= 78 && ev >= 0.045) return 'A';
  return 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
