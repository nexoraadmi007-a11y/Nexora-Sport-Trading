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
      minOdds: 1.7,
      maxOdds: 2.0,
      minBookmakers: 2,
      minEv: 0.05,
      minConfidence: 78,
      minQuality: 80,
      reason: (_fixture, _price, stats) => [
        'First-half production consensus',
        `${stats.bookmakerCount} bookmaker prices`,
        `market stability ${Math.round(stats.stability)}/100`,
        'pace and rotation stability required'
      ].join(' + ')
    }).filter((signal) => {
      const stability = Number(signal.metadata?.stability || 0);
      const bookmakerCount = Number(signal.metadata?.bookmakerCount || 0);
      return stability >= 82 && bookmakerCount >= 3;
    }).map((signal) => ({
      ...signal,
      metadata: {
        ...(signal.metadata || {}),
        paceAgreementRequired: true,
        injuryRotationStabilityRequired: true,
        restFatigueScreenRequired: true,
        marketQualityFilter: 'odds 1.70-2.00, stability >= 82, bookmakers >= 3'
      }
    }));
  }
}
