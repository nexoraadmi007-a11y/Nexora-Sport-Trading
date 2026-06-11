import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class FootballOver15Engine implements MarketEngine {
  name = 'Football Over 1.5 Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'Over 1.5 Goals',
      marketFilter: (price) => price.market === 'Over 1.5 Goals',
      selectionFilter: (price) => /^Over 1\.5/.test(price.selection),
      minOdds: 1.35,
      maxOdds: 2.15,
      minBookmakers: 2,
      minEv: 0.025,
      minConfidence: 60,
      minQuality: 68,
      reason: (fixture, _price, stats) => [
        `${fixture.competition?.kind === 'friendly' ? 'Friendly-adjusted' : 'Competition-aware'} Over 1.5 profile`,
        `${stats.bookmakerCount} bookmaker prices`,
        `market stability ${Math.round(stats.stability)}/100`,
        `model probability ${(stats.selectedProbability * 100).toFixed(1)}%`
      ].join(' + ')
    });
  }
}
