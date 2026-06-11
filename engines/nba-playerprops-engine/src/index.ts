import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class NbaPlayerPropsEngine implements MarketEngine {
  name = 'NBA Player Props Specialist';
  sport = 'nba' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'NBA Player Prop',
      marketFilter: (price) => price.market.startsWith('Player '),
      minOdds: 1.45,
      maxOdds: 2.3,
      minBookmakers: 2,
      minEv: 0.035,
      minConfidence: 63,
      minQuality: 72,
      subject: (price) => price.description,
      reason: (_fixture, price, stats) => [
        `${price.market} consensus edge`,
        `${stats.bookmakerCount} bookmaker prices`,
        `odds stability ${Math.round(stats.stability)}/100`,
        'player prop requires live market availability'
      ].join(' + ')
    });
  }
}
