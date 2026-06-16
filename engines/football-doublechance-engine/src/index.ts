import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';
import { buildConsensusSignals } from '@nexora/utils';

export class FootballDoubleChanceEngine implements MarketEngine {
  name = 'Football Double Chance Specialist';
  sport = 'football' as const;

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    return buildConsensusSignals(context, {
      sport: this.sport,
      engine: this.name,
      marketLabel: 'Double Chance',
      marketFilter: (price) => price.market === 'Double Chance',
      minOdds: 1.45,
      maxOdds: 1.8,
      minBookmakers: 2,
      minEv: 0.05,
      minConfidence: 85,
      minQuality: 76,
      reason: (fixture, _price, stats) => [
        'Double Chance research profile',
        `${stats.bookmakerCount} bookmaker prices`,
        `${fixture.competition?.kind || 'club'} weighting`,
        `draw risk ${drawRiskScore(fixture, stats.selectedProbability)}/100`,
        `low variance score ${Math.round(stats.stability)}/100`
      ].join(' + ')
    }).map((signal) => {
      const drawRisk = signal.fixture ? drawRiskScore(signal.fixture, signal.probability || 0) : 50;
      return {
        ...signal,
        metadata: {
          ...(signal.metadata || {}),
          drawRisk,
          researchMode: true
        }
      };
    }).filter((signal) => Number(signal.metadata?.drawRisk || 100) <= 35);
  }
}

function drawRiskScore(fixture: NonNullable<SignalCandidate['fixture']>, selectedProbability: number): number {
  const competitionRisk = fixture.competition?.tournamentMode ? 10 : 0;
  const friendlyRisk = fixture.competition?.kind === 'friendly' ? 12 : 0;
  const lowGoalRisk = selectedProbability < 0.68 ? 12 : 4;
  const conservatismRisk = fixture.competition?.kind === 'international_tournament' ? 6 : 3;
  return Math.min(100, Math.round(8 + competitionRisk + friendlyRisk + lowGoalRisk + conservatismRisk));
}
