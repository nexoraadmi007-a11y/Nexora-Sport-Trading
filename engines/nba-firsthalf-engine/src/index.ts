import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class NbaFirstHalfEngine implements MarketEngine {
  name = 'NBA First Half Totals Specialist';
  sport = 'nba' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'NBA First Half Total',
      marketFilter: (price) => price.market === 'First Half Total',
      minOdds: 1.45,
      maxOdds: 2.25,
      minBookmakers: 2,
      minEv: 0.03,
      minConfidence: 62,
      minQuality: 70,
      reason: (_fixture, _price, stats) => [
        'First-half total consensus',
        `${stats.bookmakerCount} bookmaker prices`,
        `market stability ${Math.round(stats.stability)}/100`,
        'reduced-volume NBA timing model'
      ].join(' + ')
    });
  }
}
