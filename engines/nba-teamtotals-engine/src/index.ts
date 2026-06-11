import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class NbaTeamTotalsEngine implements MarketEngine {
  name = 'NBA Team Totals Specialist';
  sport = 'nba' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'NBA Team Total',
      marketFilter: (price) => price.market === 'Team Total',
      minOdds: 1.45,
      maxOdds: 2.25,
      minBookmakers: 2,
      minEv: 0.03,
      minConfidence: 62,
      minQuality: 70,
      reason: (_fixture, _price, stats) => [
        'Team total market consensus',
        `${stats.bookmakerCount} bookmaker prices`,
        `market stability ${Math.round(stats.stability)}/100`,
        `probability ${(stats.selectedProbability * 100).toFixed(1)}%`
      ].join(' + ')
    });
  }
}
