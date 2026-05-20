import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

const MIN_ODDS = 1.35;
const MAX_ODDS = 1.85;
const MIN_TRUE_PROBABILITY = 0.68;
const MIN_EV = 0.015;
const MIN_QUALITY = 68;

export class FootballOver15Engine implements MarketEngine {
  name = 'Over 1.5 Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const candidates: SignalCandidate[] = [];

    for (const fixture of footballFixtures) {
      const prices = context.prices.filter((price) =>
        price.fixtureId === fixture.id &&
        price.market === 'Over 1.5' &&
        price.odds >= MIN_ODDS &&
        price.odds <= MAX_ODDS
      );
      if (prices.length < 2) continue;

      const best = prices.sort((a, b) => b.odds - a.odds)[0];
      const consensusProbability = impliedConsensusProbability(prices);
      const leagueBoost = leagueScoringBoost(fixture.league);
      const timingBoost = kickoffWindowBoost(fixture.startsAt, context.now);
      const trueProbability = clamp(consensusProbability + leagueBoost + timingBoost, 0.01, 0.9);
      const ev = trueProbability * best.odds - 1;
      const confidence = confidenceScore(trueProbability, prices.length, priceStability(prices), ev);
      const qualityScore = qualityScoreFor({ trueProbability, confidence, ev, priceCount: prices.length, stability: priceStability(prices) });
      if (trueProbability < MIN_TRUE_PROBABILITY || ev < MIN_EV || qualityScore < MIN_QUALITY) continue;

      candidates.push({
        sport: 'football',
        engine: this.name,
        fixture,
        market: 'Over 1.5 Goals',
        selection: 'Over 1.5',
        odds: best.odds,
        trueProbability,
        ev,
        confidence,
        qualityScore,
        tier: tierFor(qualityScore, ev),
        reason: reasonFor(fixture.league, trueProbability, prices.length, priceStability(prices))
      });
    }

    return candidates.sort((a, b) => b.qualityScore - a.qualityScore).slice(0, 8);
  }
}

function impliedConsensusProbability(prices: Array<{ odds: number }>): number {
  const averageImplied = prices.reduce((sum, price) => sum + 1 / price.odds, 0) / prices.length;
  return clamp(averageImplied, 0.01, 0.9);
}

function priceStability(prices: Array<{ odds: number }>): number {
  const odds = prices.map((price) => price.odds);
  const min = Math.min(...odds);
  const max = Math.max(...odds);
  return clamp(1 - (max - min) / max, 0, 1);
}

function leagueScoringBoost(league: string): number {
  const normalized = league.toLowerCase();
  if (normalized.includes('premier league')) return 0.04;
  if (normalized.includes('bundesliga')) return 0.04;
  if (normalized.includes('serie a')) return 0.03;
  if (normalized.includes('la liga')) return 0.025;
  if (normalized.includes('ligue 1')) return 0.015;
  return 0;
}

function kickoffWindowBoost(startsAt: Date, now: Date): number {
  const hours = (startsAt.getTime() - now.getTime()) / 36e5;
  if (hours > 0 && hours <= 12) return 0.01;
  if (hours > 12 && hours <= 36) return 0.005;
  return 0;
}

function confidenceScore(trueProbability: number, priceCount: number, stability: number, ev: number): number {
  const score = trueProbability * 6 + Math.min(priceCount, 10) * 0.12 + stability * 1.2 + Math.min(ev, 0.12) * 8;
  return Number(clamp(score, 1, 10).toFixed(1));
}

function qualityScoreFor(input: { trueProbability: number; confidence: number; ev: number; priceCount: number; stability: number }): number {
  const score = input.trueProbability * 45 +
    input.confidence * 4 +
    Math.min(input.ev, 0.12) * 120 +
    input.stability * 12 +
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
    `High Over 1.5 probability profile in ${league}`,
    `${priceCount} bookmaker prices available`,
    `market stability ${(stability * 100).toFixed(0)}%`,
    `model probability ${(trueProbability * 100).toFixed(1)}%`
  ].join(' + ');
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
