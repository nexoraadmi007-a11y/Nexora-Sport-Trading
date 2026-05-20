import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.55;
const MAX_ODDS = 2.15;
const MIN_TRUE_PROBABILITY = 0.56;
const MIN_EV = 0.025;
const MIN_QUALITY = 70;

export class FootballBttsEngine implements MarketEngine {
  name = 'BTTS Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const candidates: SignalCandidate[] = [];

    for (const fixture of footballFixtures) {
      const prices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        price.market === 'BTTS Yes' &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );
      if (prices.length < 2) continue;

      const best = prices.sort((a, b) => b.odds - a.odds)[0];
      const consensusProbability = impliedConsensusProbability(prices);
      const leagueBoost = leagueBttsBoost(fixture.league);
      const timingBoost = kickoffWindowBoost(fixture.startsAt, context.now);
      const stability = priceStability(prices);
      const trueProbability = clamp(consensusProbability + leagueBoost + timingBoost, 0.01, 0.82);
      const ev = trueProbability * best.odds - 1;
      const confidence = confidenceScore(trueProbability, prices.length, stability, ev);
      const qualityScore = qualityScoreFor({ trueProbability, confidence, ev, priceCount: prices.length, stability });

      if (trueProbability < MIN_TRUE_PROBABILITY || ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

      candidates.push({
        sport: 'football',
        engine: this.name,
        fixture,
        market: 'BTTS',
        selection: 'Yes',
        odds: best.odds,
        trueProbability,
        ev,
        confidence,
        qualityScore,
        tier: tierFor(qualityScore, ev),
        reason: reasonFor(fixture.league, trueProbability, prices.length, stability)
      });
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function impliedConsensusProbability(prices: Array<{ odds: number }>): number {
  const averageImplied = prices.reduce((sum, price) => sum + 1 / price.odds, 0) / prices.length;
  return clamp(averageImplied, 0.01, 0.82);
}

function priceStability(prices: Array<{ odds: number }>): number {
  const odds = prices.map((price) => price.odds);
  const min = Math.min(...odds);
  const max = Math.max(...odds);
  return clamp(1 - (max - min) / max, 0, 1);
}

function leagueBttsBoost(league: string): number {
  const normalized = league.toLowerCase();
  if (normalized.includes('bundesliga')) return 0.035;
  if (normalized.includes('premier league')) return 0.025;
  if (normalized.includes('serie a')) return 0.018;
  if (normalized.includes('la liga')) return 0.015;
  if (normalized.includes('ligue 1')) return 0.01;
  return 0;
}

function kickoffWindowBoost(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 0 && hours <= 12) return 0.008;
  if (hours > 12 && hours <= 36) return 0.004;
  return 0;
}

function confidenceScore(trueProbability: number, priceCount: number, stability: number, ev: number): number {
  const score = trueProbability * 5.8 + Math.min(priceCount, 10) * 0.13 + stability * 1.25 + Math.min(ev, 0.1) * 7;
  return Number(clamp(score, 1, 10).toFixed(1));
}

function qualityScoreFor(input: { trueProbability: number; confidence: number; ev: number; priceCount: number; stability: number }): number {
  const score = input.trueProbability * 43 +
    input.confidence * 4.2 +
    Math.min(input.ev, 0.1) * 120 +
    input.stability * 13 +
    Math.min(input.priceCount, 10);
  return Number(clamp(score, 0, 100).toFixed(1));
}

function tierFor(qualityScore: number, ev: number): 'A+' | 'A' | 'B' {
  if (qualityScore >= 84 && ev >= 0.06) return 'A+';
  if (qualityScore >= 76 && ev >= 0.04) return 'A';
  return 'B';
}

function reasonFor(league: string, trueProbability: number, priceCount: number, stability: number): string {
  return [
    `BTTS market profile in ${league}`,
    `${priceCount} bookmaker prices available`,
    `market stability ${(stability * 100).toFixed(0)}%`,
    `model probability ${(trueProbability * 100).toFixed(1)}%`
  ].join(' + ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
