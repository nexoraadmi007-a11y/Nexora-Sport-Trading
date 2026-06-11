import type { EngineContext, FixtureRef, MarketPrice, RiskLevel, SignalCandidate, SignalTier, Sport } from '@nexora/types';

export interface MarketSignalOptions {
  sport: Sport;
  engine: string;
  marketLabel: string;
  marketFilter: (price: MarketPrice) => boolean;
  selectionFilter?: (price: MarketPrice) => boolean;
  minOdds: number;
  maxOdds: number;
  minBookmakers: number;
  minEv: number;
  minConfidence: number;
  minQuality: number;
  reason: (fixture: FixtureRef, price: MarketPrice, stats: MarketStats) => string;
  subject?: (price: MarketPrice) => string | undefined;
}

export interface MarketStats {
  bookmakerCount: number;
  consensusProbability: number;
  selectedProbability: number;
  edgePercent: number;
  stability: number;
}

export function buildConsensusSignals(context: EngineContext, options: MarketSignalOptions): SignalCandidate[] {
  const fixtures = context.fixtures.filter((fixture) => fixture.sport === options.sport);
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const groups = new Map<string, MarketPrice[]>();

  for (const price of context.prices) {
    const fixture = fixtureById.get(price.fixtureId);
    if (!fixture) continue;
    if (!options.marketFilter(price)) continue;
    if (options.selectionFilter && !options.selectionFilter(price)) continue;
    if (price.odds < options.minOdds || price.odds > options.maxOdds) continue;

    const key = `${price.fixtureId}|${price.market}|${price.selection}|${price.description || ''}`;
    groups.set(key, [...(groups.get(key) || []), price]);
  }

  const signals: SignalCandidate[] = [];

  for (const prices of groups.values()) {
    const fixture = fixtureById.get(prices[0]?.fixtureId || '');
    if (!fixture) continue;

    const uniqueBookmakers = new Set(prices.map((price) => price.bookmaker));
    if (uniqueBookmakers.size < options.minBookmakers) continue;

    const best = [...prices].sort((a, b) => b.odds - a.odds)[0];
    const consensusProbability = clamp(average(prices.map((price) => 1 / price.odds)), 0.01, 0.95);
    const priorityBonus = (fixture.competition?.priorityScore || 55) / 1000;
    const selectedProbability = clamp(consensusProbability + priorityBonus, 0.01, 0.93);
    const ev = (selectedProbability * best.odds) - 1;
    const bestToAverageEdge = best.odds / average(prices.map((price) => price.odds)) - 1;
    const stability = clamp(100 - (oddsSpread(prices) * 55), 45, 96);
    const confidence = clamp(
      48 + (uniqueBookmakers.size * 3.2) + (bestToAverageEdge * 180) + ((fixture.competition?.priorityScore || 60) * 0.13) + (stability * 0.08),
      1,
      100
    );
    const qualityScore = clamp((confidence * 0.48) + (stability * 0.27) + ((fixture.competition?.priorityScore || 60) * 0.15) + (Math.max(ev, 0) * 100 * 0.1), 1, 100);

    if (ev < options.minEv || confidence < options.minConfidence || qualityScore < options.minQuality) continue;

    const stats: MarketStats = {
      bookmakerCount: uniqueBookmakers.size,
      consensusProbability,
      selectedProbability,
      edgePercent: bestToAverageEdge,
      stability
    };

    signals.push({
      sport: options.sport,
      engine: options.engine,
      fixture,
      subject: options.subject?.(best),
      bookmaker: best.bookmaker,
      market: options.marketLabel,
      selection: best.selection,
      odds: round(best.odds, 2),
      probability: round(selectedProbability, 4),
      ev: round(ev, 4),
      confidence: Math.round(confidence),
      qualityScore: Math.round(qualityScore),
      tier: tierFor(qualityScore, confidence, ev),
      riskLevel: riskFor(qualityScore, confidence, stability),
      reason: options.reason(fixture, best, stats),
      metadata: {
        bookmakerCount: uniqueBookmakers.size,
        consensusProbability: round(consensusProbability, 4),
        stability: Math.round(stability),
        sourceMarketKey: best.sourceMarketKey,
        competitionKind: fixture.competition?.kind,
        competitionPriority: fixture.competition?.priorityTier,
        tournamentMode: fixture.competition?.tournamentMode || false
      }
    });
  }

  return signals.sort(compareSignals);
}

export function compareSignals(a: SignalCandidate, b: SignalCandidate): number {
  return (b.qualityScore || 0) - (a.qualityScore || 0)
    || (b.confidence || 0) - (a.confidence || 0)
    || (b.ev || 0) - (a.ev || 0);
}

function tierFor(quality: number, confidence: number, ev: number): SignalTier {
  if (quality >= 84 && confidence >= 75 && ev >= 0.06) return 'A+';
  if (quality >= 74 && confidence >= 66 && ev >= 0.035) return 'A';
  return 'B';
}

function riskFor(quality: number, confidence: number, stability: number): RiskLevel {
  if (quality >= 82 && confidence >= 74 && stability >= 78) return 'LOW';
  if (quality >= 68 && confidence >= 62) return 'MEDIUM';
  return 'HIGH';
}

function oddsSpread(prices: MarketPrice[]): number {
  const odds = prices.map((price) => price.odds);
  const min = Math.min(...odds);
  const max = Math.max(...odds);
  return max / min - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
