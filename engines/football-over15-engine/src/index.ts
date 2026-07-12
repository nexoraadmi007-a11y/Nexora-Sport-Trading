import type { EngineContext, FixtureRef, MarketEngine, MarketPrice, SignalCandidate, SignalTier } from '@nexora/types';

interface Over15PriceGroup {
  fixture: FixtureRef;
  prices: MarketPrice[];
  fixturePrices: MarketPrice[];
}

interface LayerScores {
  teamForm: number;
  xgValidation: number;
  shotQuality: number;
  tacticalCompatibility: number;
  motivation: number;
  squadAvailability: number;
  scheduleFatigue: number;
  marketValidation: number;
  clvProtection: number;
  consensus: number;
  leagueReliability: number;
  attackingDna: number;
}

interface ModelProbabilities {
  poisson: number;
  xgProjection: number;
  teamForm: number;
  tactical: number;
  historicalPattern: number;
}

interface Over15Assessment {
  best: MarketPrice;
  bookmakerCount: number;
  averageOdds: number;
  oddsSpread: number;
  marketProbability: number;
  modelProbability: number;
  projectedXg: number;
  ev: number;
  confidence: number;
  qualityScore: number;
  stability: number;
  tier: SignalTier;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  layerScores: LayerScores;
  modelProbabilities: ModelProbabilities;
  consensusAgreement: number;
  rejectReason?: string;
}

export interface Over15Diagnostics {
  fixturesChecked: number;
  over15MarketsFound: number;
  approved: number;
  rejected: number;
  rejectionReasons: Record<string, number>;
  strongestNearMiss?: {
    match: string;
    reason: string;
    odds?: number;
    projectedXg?: number;
    ev?: number;
    confidence?: number;
    qualityScore?: number;
    consensusAgreement?: number;
  };
}

export class FootballOver15Engine implements MarketEngine {
  name = 'Football Over 1.5 Specialist';
  sport = 'football' as const;
  private diagnostics: Over15Diagnostics = emptyDiagnostics();

  async generate(context: EngineContext): Promise<SignalCandidate[]> {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const rawOver15MarketCount = context.prices.filter((price) =>
      footballFixtures.some((fixture) => fixture.id === price.fixtureId) &&
      price.market === 'Over 1.5 Goals' &&
      /^Over 1\.5/i.test(price.selection)
    ).length;
    const groups = buildOver15Groups(context);
    const groupedFixtureIds = new Set(groups.map((group) => group.fixture.id));
    const assessments = groups.map((group) => ({ group, assessment: assessOver15(group) }));
    const missingOver15MarketCount = footballFixtures.filter((fixture) => !groupedFixtureIds.has(fixture.id)).length;
    const approvedAssessments = assessments.filter(({ assessment }) => !assessment.rejectReason);

    this.diagnostics = buildDiagnostics(
      footballFixtures.length,
      rawOver15MarketCount,
      missingOver15MarketCount,
      assessments
    );

    return approvedAssessments
      .map(({ group, assessment }) => toSignal(group.fixture, assessment))
      .sort(compareOver15Signals)
      .slice(0, Number(process.env.OVER15_MAX_SIGNALS_PER_SCAN || 2));
  }

  getDiagnostics(): Over15Diagnostics {
    return this.diagnostics;
  }
}

function emptyDiagnostics(): Over15Diagnostics {
  return {
    fixturesChecked: 0,
    over15MarketsFound: 0,
    approved: 0,
    rejected: 0,
    rejectionReasons: {}
  };
}

function buildDiagnostics(
  fixturesChecked: number,
  over15MarketsFound: number,
  missingOver15MarketCount: number,
  assessments: Array<{ group: Over15PriceGroup; assessment: Over15Assessment }>
): Over15Diagnostics {
  const rejectionReasons: Record<string, number> = {};
  if (missingOver15MarketCount > 0) {
    rejectionReasons['no Over 1.5 market found'] = missingOver15MarketCount;
  }

  for (const { assessment } of assessments) {
    if (!assessment.rejectReason) continue;
    rejectionReasons[assessment.rejectReason] = (rejectionReasons[assessment.rejectReason] || 0) + 1;
  }

  const nearMiss = assessments
    .filter(({ assessment }) => assessment.rejectReason)
    .sort((a, b) => b.assessment.qualityScore - a.assessment.qualityScore)[0];

  return {
    fixturesChecked,
    over15MarketsFound,
    approved: assessments.filter(({ assessment }) => !assessment.rejectReason).length,
    rejected: missingOver15MarketCount + assessments.filter(({ assessment }) => assessment.rejectReason).length,
    rejectionReasons,
    strongestNearMiss: nearMiss
      ? {
          match: matchLabel(nearMiss.group.fixture),
          reason: nearMiss.assessment.rejectReason || 'rejected',
          odds: round(nearMiss.assessment.best.odds, 2),
          projectedXg: round(nearMiss.assessment.projectedXg, 2),
          ev: round(nearMiss.assessment.ev, 4),
          confidence: Math.round(nearMiss.assessment.confidence),
          qualityScore: Math.round(nearMiss.assessment.qualityScore),
          consensusAgreement: nearMiss.assessment.consensusAgreement
        }
      : undefined
  };
}

function matchLabel(fixture: FixtureRef): string {
  if (fixture.homeTeam && fixture.awayTeam) return `${fixture.homeTeam} vs ${fixture.awayTeam}`;
  return fixture.league;
}

function buildOver15Groups(context: EngineContext): Over15PriceGroup[] {
  const fixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const pricesByFixture = new Map<string, MarketPrice[]>();

  for (const price of context.prices) {
    if (!fixtureById.has(price.fixtureId)) continue;
    pricesByFixture.set(price.fixtureId, [...(pricesByFixture.get(price.fixtureId) || []), price]);
  }

  const groups: Over15PriceGroup[] = [];

  for (const [fixtureId, fixturePrices] of pricesByFixture) {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) continue;

    const prices = fixturePrices.filter((price) =>
      price.market === 'Over 1.5 Goals' &&
      /^Over 1\.5/i.test(price.selection)
    );

    if (prices.length > 0) {
      groups.push({ fixture, prices, fixturePrices });
    }
  }

  return groups;
}

function assessOver15(group: Over15PriceGroup): Over15Assessment {
  const { fixture, prices, fixturePrices } = group;
  const minOdds = Number(process.env.OVER15_MIN_ODDS || 1.35);
  const maxOdds = Number(process.env.OVER15_MAX_ODDS || 2.05);
  const eligiblePrices = prices.filter((price) => price.odds >= minOdds && price.odds <= maxOdds);
  const scoringPrices = eligiblePrices.length > 0 ? eligiblePrices : prices;
  const best = [...scoringPrices].sort((a, b) => b.odds - a.odds)[0];
  const bookmakerCount = new Set(prices.map((price) => price.bookmaker)).size;
  const averageOdds = average(scoringPrices.map((price) => price.odds));
  const oddsSpreadValue = oddsSpread(scoringPrices);
  const stability = clamp(100 - (oddsSpreadValue * 70), 35, 98);
  const marketProbability = clamp(average(scoringPrices.map((price) => 1 / price.odds)), 0.45, 0.88);
  const over25Probability = marketProbabilityFor(fixturePrices, 'Over 2.5 Goals', /^Over 2\.5/i);
  const bttsProbability = marketProbabilityFor(fixturePrices, 'BTTS', /^yes$/i);
  const matchBalance = balanceScore(fixturePrices);
  const projectedXg = projectedGoals(marketProbability, over25Probability, bttsProbability);
  const leagueReliability = leagueReliabilityScore(fixture);
  const layerScores: LayerScores = {
    teamForm: teamFormProxy(marketProbability, over25Probability, bttsProbability),
    xgValidation: xgScore(projectedXg),
    shotQuality: shotQualityProxy(over25Probability, bttsProbability, marketProbability),
    tacticalCompatibility: tacticalScore(fixture, matchBalance, marketProbability, over25Probability, bttsProbability),
    motivation: motivationScore(fixture),
    squadAvailability: squadAvailabilityProxy(bookmakerCount, stability),
    scheduleFatigue: scheduleFatigueScore(fixture),
    marketValidation: marketValidationScore(best.odds, averageOdds, bookmakerCount, stability),
    clvProtection: clvProtectionScore(best.odds, averageOdds, stability),
    consensus: 0,
    leagueReliability,
    attackingDna: attackingDnaScore(fixture, marketProbability, over25Probability, bttsProbability)
  };

  const modelProbabilities: ModelProbabilities = {
    poisson: poissonOver15(projectedXg),
    xgProjection: clamp((marketProbability * 0.45) + (xgScore(projectedXg) / 100 * 0.55), 0.01, 0.92),
    teamForm: clamp(layerScores.teamForm / 100, 0.01, 0.92),
    tactical: clamp(layerScores.tacticalCompatibility / 100, 0.01, 0.92),
    historicalPattern: clamp(((leagueReliability * 0.55) + (layerScores.attackingDna * 0.45)) / 100, 0.01, 0.92)
  };
  const modelProbability = clamp(average(Object.values(modelProbabilities)), 0.01, 0.92);
  const consensusAgreement = Object.values(modelProbabilities)
    .filter((probability) => probability >= Number(process.env.OVER15_MODEL_AGREEMENT_PROBABILITY || 0.68))
    .length;
  layerScores.consensus = (consensusAgreement / 5) * 100;

  const ev = (modelProbability * best.odds) - 1;
  const confidence = clamp(
    (layerScores.consensus * 0.18) +
    (layerScores.marketValidation * 0.15) +
    (layerScores.xgValidation * 0.14) +
    (layerScores.shotQuality * 0.12) +
    (layerScores.tacticalCompatibility * 0.11) +
    (layerScores.teamForm * 0.1) +
    (layerScores.squadAvailability * 0.08) +
    (layerScores.motivation * 0.05) +
    (layerScores.scheduleFatigue * 0.04) +
    (layerScores.leagueReliability * 0.03),
    1,
    100
  );
  const qualityScore = clamp(
    (layerScores.teamForm * 0.12) +
    (layerScores.xgValidation * 0.16) +
    (layerScores.shotQuality * 0.13) +
    (layerScores.tacticalCompatibility * 0.12) +
    (layerScores.squadAvailability * 0.1) +
    (layerScores.marketValidation * 0.14) +
    (layerScores.consensus * 0.14) +
    (layerScores.leagueReliability * 0.09),
    1,
    100
  );

  const rejectReason = firstRejectReason({
    fixture,
    best,
    bookmakerCount,
    eligiblePriceCount: eligiblePrices.length,
    projectedXg,
    stability,
    oddsSpread: oddsSpreadValue,
    ev,
    confidence,
    qualityScore,
    layerScores,
    consensusAgreement
  });

  return {
    best,
    bookmakerCount,
    averageOdds,
    oddsSpread: oddsSpreadValue,
    marketProbability,
    modelProbability,
    projectedXg,
    ev,
    confidence,
    qualityScore,
    stability,
    tier: tierFor(qualityScore, confidence, ev),
    riskLevel: riskFor(qualityScore, confidence, stability),
    layerScores,
    modelProbabilities,
    consensusAgreement,
    rejectReason
  };
}

function toSignal(fixture: FixtureRef, assessment: Over15Assessment): SignalCandidate {
  return {
    sport: 'football',
    engine: 'Football Over 1.5 Specialist',
    fixture,
    bookmaker: assessment.best.bookmaker,
    market: 'Over 1.5 Goals',
    selection: assessment.best.selection,
    odds: round(assessment.best.odds, 2),
    probability: round(assessment.modelProbability, 4),
    ev: round(assessment.ev, 4),
    confidence: Math.round(assessment.confidence),
    qualityScore: Math.round(assessment.qualityScore),
    tier: assessment.tier,
    riskLevel: assessment.riskLevel,
    reason: [
      'Elite Over 1.5 profile',
      `projected xG ${assessment.projectedXg.toFixed(2)}`,
      `${assessment.consensusAgreement}/5 model agreement`,
      `league reliability ${Math.round(assessment.layerScores.leagueReliability)}/100`,
      `market stability ${Math.round(assessment.stability)}/100`
    ].join(' + '),
    metadata: {
      over15Reengineered: true,
      over15QualityScore: Math.round(assessment.qualityScore),
      projectedXg: round(assessment.projectedXg, 2),
      consensusAgreement: assessment.consensusAgreement,
      modelProbabilities: roundedModelProbabilities(assessment.modelProbabilities),
      layerScores: roundedLayerScores(assessment.layerScores),
      marketProbability: round(assessment.marketProbability, 4),
      stability: Math.round(assessment.stability),
      bookmakerCount: assessment.bookmakerCount,
      averageOdds: round(assessment.averageOdds, 2),
      openingOdds: null,
      signalOdds: round(assessment.best.odds, 2),
      closingOdds: null,
      clvStatus: 'pending_close'
    }
  };
}

function firstRejectReason(input: {
  fixture: FixtureRef;
  best: MarketPrice;
  bookmakerCount: number;
  eligiblePriceCount: number;
  projectedXg: number;
  stability: number;
  oddsSpread: number;
  ev: number;
  confidence: number;
  qualityScore: number;
  layerScores: LayerScores;
  consensusAgreement: number;
}): string | undefined {
  if (input.eligiblePriceCount === 0) return 'odds outside Over 1.5 range';
  if (input.bookmakerCount < Number(process.env.OVER15_MIN_BOOKMAKERS || 3)) return 'poor market liquidity';
  if (input.projectedXg < Number(process.env.OVER15_MIN_PROJECTED_XG || 2.18)) return 'combined projected xG below threshold';
  if (input.layerScores.teamForm < 70) return 'poor recent scoring trend';
  if (input.layerScores.shotQuality < 68) return 'low shot quality proxy';
  if (input.layerScores.tacticalCompatibility < 68) return 'defensive tactical matchup';
  if (input.layerScores.squadAvailability < 70) return 'high lineup uncertainty proxy';
  if (input.layerScores.scheduleFatigue < 60) return 'severe fixture congestion or travel proxy';
  if (input.layerScores.marketValidation < 72) return 'weak market validation';
  if (input.layerScores.clvProtection < 68) return 'suspicious odds movement proxy';
  if (input.consensusAgreement < Number(process.env.OVER15_MIN_MODEL_AGREEMENT || 4)) return 'insufficient model consensus';
  if (input.ev < Number(process.env.OVER15_MIN_EV || 0.035)) return 'insufficient value edge';
  if (input.confidence < Number(process.env.OVER15_MIN_CONFIDENCE || 78)) return 'confidence below elite threshold';
  if (input.qualityScore < Number(process.env.OVER15_MIN_QUALITY || 88)) return 'quality score below elite threshold';
  if (input.fixture.competition?.kind === 'friendly' && input.qualityScore < 92) return 'friendly motivation uncertainty';
  return undefined;
}

function marketProbabilityFor(prices: MarketPrice[], market: string, selection: RegExp): number | undefined {
  const selected = prices.filter((price) => price.market === market && selection.test(price.selection));
  if (selected.length === 0) return undefined;
  return clamp(average(selected.map((price) => 1 / price.odds)), 0.01, 0.95);
}

function projectedGoals(over15Probability: number, over25Probability?: number, bttsProbability?: number): number {
  const fromOver15 = lambdaForOver15(over15Probability);
  const over25Lift = over25Probability ? (over25Probability - 0.42) * 1.35 : 0;
  const bttsLift = bttsProbability ? (bttsProbability - 0.5) * 0.75 : 0;
  return clamp(fromOver15 + over25Lift + bttsLift, 1.2, 4.2);
}

function lambdaForOver15(probability: number): number {
  let low = 0.2;
  let high = 5;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    const over15 = poissonOver15(mid);
    if (over15 < probability) low = mid;
    else high = mid;
  }

  return (low + high) / 2;
}

function poissonOver15(lambda: number): number {
  return clamp(1 - Math.exp(-lambda) * (1 + lambda), 0.01, 0.95);
}

function teamFormProxy(over15Probability: number, over25Probability?: number, bttsProbability?: number): number {
  return clamp(
    38 + (over15Probability * 42) + ((over25Probability || 0.4) * 20) + ((bttsProbability || 0.48) * 12),
    1,
    100
  );
}

function xgScore(projectedXg: number): number {
  return clamp(((projectedXg - 1.8) / 1.2) * 100, 1, 100);
}

function shotQualityProxy(over25Probability?: number, bttsProbability?: number, over15Probability?: number): number {
  return clamp(
    26 + ((over25Probability || 0.38) * 58) + ((bttsProbability || 0.48) * 23) + ((over15Probability || 0.68) * 10),
    1,
    100
  );
}

function tacticalScore(
  fixture: FixtureRef,
  matchBalance: number,
  over15Probability: number,
  over25Probability?: number,
  bttsProbability?: number
): number {
  const tournamentPenalty = fixture.competition?.tournamentMode ? 4 : 0;
  const friendlyPenalty = fixture.competition?.kind === 'friendly' ? 11 : 0;
  const dominancePenalty = matchBalance < 45 ? 16 : matchBalance < 60 ? 7 : 0;
  const balanceBonus = matchBalance >= 80 ? 8 : matchBalance >= 70 ? 4 : 0;
  const openMatchScore = (over15Probability * 48) + ((over25Probability || 0.4) * 32) + ((bttsProbability || 0.48) * 20);
  return clamp(openMatchScore + balanceBonus - tournamentPenalty - friendlyPenalty - dominancePenalty, 1, 100);
}

function motivationScore(fixture: FixtureRef): number {
  const priority = fixture.competition?.priorityScore || 52;
  if (fixture.competition?.kind === 'friendly') return 50;
  if (fixture.competition?.tournamentMode) return clamp(priority + 8, 1, 100);
  if (fixture.competition?.kind === 'qualification') return clamp(priority + 5, 1, 100);
  return clamp(priority, 1, 100);
}

function squadAvailabilityProxy(bookmakerCount: number, stability: number): number {
  return clamp(38 + (bookmakerCount * 6) + (stability * 0.45), 1, 100);
}

function scheduleFatigueScore(fixture: FixtureRef): number {
  const hoursToKickoff = (fixture.startsAt.getTime() - Date.now()) / (60 * 60 * 1000);
  const shortNoticePenalty = hoursToKickoff > 0 && hoursToKickoff < 2 ? 10 : 0;
  const internationalTravelPenalty = fixture.country === 'International' ? 4 : 0;
  return clamp(86 - shortNoticePenalty - internationalTravelPenalty, 1, 100);
}

function marketValidationScore(bestOdds: number, averageOdds: number, bookmakerCount: number, stability: number): number {
  const edgeToAverage = bestOdds / averageOdds - 1;
  return clamp(44 + (bookmakerCount * 5) + (stability * 0.32) + (edgeToAverage * 230), 1, 100);
}

function clvProtectionScore(bestOdds: number, averageOdds: number, stability: number): number {
  const edgeToAverage = Math.abs(bestOdds / averageOdds - 1);
  const suspiciousEdgePenalty = edgeToAverage > 0.14 ? 18 : edgeToAverage > 0.1 ? 10 : 0;
  return clamp((stability * 0.78) + 22 - suspiciousEdgePenalty, 1, 100);
}

function attackingDnaScore(
  fixture: FixtureRef,
  over15Probability: number,
  over25Probability?: number,
  bttsProbability?: number
): number {
  const leagueBase = leagueReliabilityScore(fixture);
  return clamp(
    (leagueBase * 0.32) + (over15Probability * 38) + ((over25Probability || 0.4) * 22) + ((bttsProbability || 0.48) * 18),
    1,
    100
  );
}

function leagueReliabilityScore(fixture: FixtureRef): number {
  const tier = fixture.competition?.priorityTier || 'other';
  const league = `${fixture.sportKey || ''} ${fixture.league} ${fixture.country || ''}`.toLowerCase();

  if (/premier league|la liga|bundesliga|serie a|ligue 1|champions league/.test(league)) return 88;
  if (/europa league|conference league|saudi|eredivisie|primeira|belgian|turkish/.test(league)) return 80;
  if (/world cup|euro|copa america|afcon|qualification/.test(league)) return 74;
  if (/friendly/.test(league) || tier === 'friendly') return 56;
  if (tier === 'tier_1_club' || tier === 'uefa_club') return 84;
  if (tier === 'qualification' || fixture.competition?.kind === 'international_tournament') return 72;
  return 62;
}

function balanceScore(prices: MarketPrice[]): number {
  const h2h = prices.filter((price) => price.market === 'Match Result');
  if (h2h.length < 2) return 70;
  const probabilities = h2h.map((price) => 1 / price.odds).sort((a, b) => b - a);
  const dominanceGap = probabilities[0] - probabilities[1];
  return clamp(100 - (dominanceGap * 160), 20, 100);
}

function compareOver15Signals(a: SignalCandidate, b: SignalCandidate): number {
  return (Number(b.metadata?.consensusAgreement || 0) - Number(a.metadata?.consensusAgreement || 0))
    || ((b.qualityScore || 0) - (a.qualityScore || 0))
    || ((b.confidence || 0) - (a.confidence || 0))
    || ((b.ev || 0) - (a.ev || 0));
}

function tierFor(quality: number, confidence: number, ev: number): SignalTier {
  if (quality >= 92 && confidence >= 84 && ev >= 0.06) return 'A+';
  if (quality >= 88 && confidence >= 78 && ev >= 0.035) return 'A';
  return 'B';
}

function riskFor(quality: number, confidence: number, stability: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (quality >= 90 && confidence >= 82 && stability >= 82) return 'LOW';
  if (quality >= 88 && confidence >= 78 && stability >= 72) return 'MEDIUM';
  return 'HIGH';
}

function roundedModelProbabilities(models: ModelProbabilities): ModelProbabilities {
  return {
    poisson: round(models.poisson, 4),
    xgProjection: round(models.xgProjection, 4),
    teamForm: round(models.teamForm, 4),
    tactical: round(models.tactical, 4),
    historicalPattern: round(models.historicalPattern, 4)
  };
}

function roundedLayerScores(scores: LayerScores): LayerScores {
  return {
    teamForm: Math.round(scores.teamForm),
    xgValidation: Math.round(scores.xgValidation),
    shotQuality: Math.round(scores.shotQuality),
    tacticalCompatibility: Math.round(scores.tacticalCompatibility),
    motivation: Math.round(scores.motivation),
    squadAvailability: Math.round(scores.squadAvailability),
    scheduleFatigue: Math.round(scores.scheduleFatigue),
    marketValidation: Math.round(scores.marketValidation),
    clvProtection: Math.round(scores.clvProtection),
    consensus: Math.round(scores.consensus),
    leagueReliability: Math.round(scores.leagueReliability),
    attackingDna: Math.round(scores.attackingDna)
  };
}

function oddsSpread(prices: MarketPrice[]): number {
  const odds = prices.map((price) => price.odds);
  return Math.max(...odds) / Math.min(...odds) - 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
