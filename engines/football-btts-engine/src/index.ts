import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class FootballBttsEngine implements MarketEngine {
  name = 'Football BTTS Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'BTTS',
      marketFilter: (price) => price.market === 'BTTS',
      selectionFilter: (price) => /^yes$/i.test(price.selection),
      minOdds: 1.45,
      maxOdds: 2.35,
      minBookmakers: 2,
      minEv: 0.03,
      minConfidence: 62,
      minQuality: 70,
      reason: (fixture, _price, stats) => [
        'BTTS value profile',
        `${stats.bookmakerCount} bookmaker prices`,
        `${fixture.competition?.priorityTier || 'competition'} context`,
        `market stability ${Math.round(stats.stability)}/100`
      ].join(' + ')
    });
  }
}
