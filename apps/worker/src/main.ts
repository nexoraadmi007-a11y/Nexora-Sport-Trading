import { DataEngine } from '@nexora/data-engine';
import { FootballBttsEngine } from '@nexora/football-btts-engine';
import { FootballDoubleChanceEngine } from '@nexora/football-doublechance-engine';
import { FootballOver15Engine } from '@nexora/football-over15-engine';
import { MlbDataEngine } from '@nexora/mlb-data-engine';
import { MlbFirst5Engine } from '@nexora/mlb-first5-engine';
import { NbaFirstHalfEngine } from '@nexora/nba-firsthalf-engine';
import { NbaPlayerPropsEngine } from '@nexora/nba-playerprops-engine';
import { NbaTeamTotalsEngine } from '@nexora/nba-teamtotals-engine';
import { PersistenceEngine } from '@nexora/persistence-engine';
import { RiskEngine } from '@nexora/risk-engine';
import { loadDotEnv, validateRequiredEnv } from '@nexora/shared';
import { SignalEngine, type SignalAuditResult } from '@nexora/signal-engine';
import { TennisDataEngine } from '@nexora/tennis-data-engine';
import { TennisHardcourtOverGamesEngine } from '@nexora/tennis-hardcourt-overgames-engine';
import { TelegramEngine } from '@nexora/telegram-engine';
import type { EngineContext, MarketEngine, MarketPrice, SignalCandidate } from '@nexora/types';

async function runSignalBatch() {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const engines = buildEngines();
  const dataEngine = new DataEngine();
  const signalEngine = new SignalEngine();
  const riskEngine = new RiskEngine();
  const telegram = new TelegramEngine();
  const context = await loadSpecializedContext(dataEngine);
  const engineResults = await Promise.all(engines.map(async (engine) => ({
    engine: engine.name,
    candidates: await engine.generate(context)
  })));
  const candidates = engineResults.flatMap((result) => result.candidates);
  const signalAudit = signalEngine.audit(candidates);
  const approved = riskEngine.removeCorrelatedExposure(signalAudit.approved);

  if (process.argv.includes('--dry-run')) {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const nbaFixtures = context.fixtures.filter((fixture) => fixture.sport === 'nba');
    const tennisFixtures = context.fixtures.filter((fixture) => fixture.sport === 'tennis');
    const mlbFixtures = context.fixtures.filter((fixture) => fixture.sport === 'mlb');
    const over15Prices = context.prices.filter((price) => price.market === 'Over 1.5');
    const bttsPrices = context.prices.filter((price) => price.market === 'BTTS Yes');
    const h2hPrices = context.prices.filter((price) => price.market === 'Double Chance Candidate');
    const nbaTotals = context.prices.filter((price) =>
      context.fixtures.some((fixture) => fixture.id === price.fixtureId && fixture.sport === 'nba') &&
      (isGameTotal(price.market) || isNbaTeamTotal(price.market))
    );
    const nbaH1Totals = context.prices.filter((price) =>
      context.fixtures.some((fixture) => fixture.id === price.fixtureId && fixture.sport === 'nba') &&
      (/^Over \d+(\.\d+)? H1$/.test(price.market) || /^Under \d+(\.\d+)? H1$/.test(price.market))
    );
    const playerPropPrices = context.prices.filter((price) => price.market.startsWith('player_'));
    const tennisOverGames = context.prices.filter((price) => price.market.endsWith('Games') && price.market.startsWith('Over'));
    const mlbFirst5 = context.prices.filter((price) => price.market.startsWith('First 5 Innings'));
    console.log(`NEXORA dry run: fixtures=${context.fixtures.length}, prices=${context.prices.length}`);
    console.log(`Football fixtures: ${footballFixtures.length} (${formatLeagueCounts(footballFixtures)})`);
    console.log(`NBA fixtures: ${nbaFixtures.length}`);
    console.log(`ATP tennis fixtures: ${tennisFixtures.length} (${formatLeagueCounts(tennisFixtures)})`);
    console.log(`MLB fixtures: ${mlbFixtures.length} (${formatLeagueCounts(mlbFixtures)})`);
    console.log(`Over 1.5 prices: ${over15Prices.length}`);
    if (over15Prices.length > 0) {
      const odds = over15Prices.map((price) => price.odds).sort((a, b) => a - b);
      console.log(`Over 1.5 odds range: ${odds[0]}-${odds[odds.length - 1]}`);
    }
    console.log(`BTTS Yes prices: ${bttsPrices.length}`);
    if (bttsPrices.length > 0) {
      const odds = bttsPrices.map((price) => price.odds).sort((a, b) => a - b);
      console.log(`BTTS Yes odds range: ${odds[0]}-${odds[odds.length - 1]}`);
    }
    console.log(`H2H prices for Double Chance modeling: ${h2hPrices.length}`);
    console.log(`NBA total prices: ${nbaTotals.length}`);
    console.log(`NBA first-half totals prices: ${nbaH1Totals.length}`);
    console.log(`NBA player stats rows: ${context.playerStats.length}`);
    console.log(`NBA player prop prices: ${playerPropPrices.length}`);
    console.log(`ATP Over Games prices: ${tennisOverGames.length}`);
    console.log(`ATP signal delivery: ${process.env.ENABLE_TENNIS_SIGNALS === 'true' ? 'enabled' : 'validation-only/disabled'}`);
    console.log(`MLB First 5 prices: ${mlbFirst5.length}`);
    const diagnostics = dataEngine.getDiagnostics();
    if (diagnostics) {
      console.log(`Cache: hits=${diagnostics.cache.hits}, misses=${diagnostics.cache.misses}, stale=${diagnostics.cache.staleHits}, writes=${diagnostics.cache.writes}`);
      console.log(`Quota: daily=${JSON.stringify(diagnostics.quota.daily)}, hourly=${JSON.stringify(diagnostics.quota.hourly)}, skipped=${diagnostics.quota.skipped}`);
    }
    for (const result of engineResults) {
      console.log(`${result.engine}: ${result.candidates.length} candidates`);
    }
    console.log(`Candidates: ${candidates.length}`);
    console.log(`Approved: ${approved.length}`);
    console.log(`Approved by engine: ${formatSignalCounts(approved)}`);
    logScanDiagnostics(context, engineResults, candidates, approved, signalAudit);
    for (const signal of approved.slice(0, 5)) {
      console.log(`${signal.tier} | ${signal.engine} | ${signalLabel(signal)} | ${signal.market} @ ${signal.odds} | EV ${(signal.ev * 100).toFixed(1)}% | Q ${signal.qualityScore}`);
    }
    return;
  }

  const persistence = new PersistenceEngine();
  const forceResend = process.argv.includes('--force-resend');

  if (approved.length === 0) {
    if (process.argv.includes('--no-send')) {
      console.log('NO ELITE SIGNALS TODAY');
      await persistence.disconnect();
      return;
    }
    await telegram.sendNoBet();
    await persistence.logTelegram({
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      message: 'NO ELITE SIGNALS TODAY',
      status: 'sent'
    });
    await persistence.disconnect();
    return;
  }

  const deliverySignals = approved;

  if (deliverySignals.length === 0) {
    if (process.argv.includes('--no-send')) {
      console.log('NO ELITE SIGNALS TODAY');
      await persistence.disconnect();
      return;
    }
    await telegram.sendNoBet();
    await persistence.logTelegram({
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      message: 'NO ELITE SIGNALS TODAY',
      status: 'sent'
    });
    await persistence.disconnect();
    return;
  }

  let sentCount = 0;

  for (const signal of deliverySignals) {
    if (process.argv.includes('--no-send')) {
      console.log(`NO-SEND ${signal.tier} | ${signal.engine} | ${signalLabel(signal)} | ${signal.market} @ ${signal.odds} | persistence skipped`);
      sentCount += 1;
      continue;
    }

    if (!forceResend && await persistence.hasDuplicateSignal(signal)) {
      console.log(`SKIP duplicate persisted signal | ${signalLabel(signal)} | ${signal.market}`);
      continue;
    }

    const signalId = forceResend ? undefined : await persistence.saveApprovedSignal(signal);
    try {
      await telegram.sendSignal(signal);
      console.log(`TELEGRAM_SENT ${signal.tier} | ${signal.engine} | ${signalLabel(signal)} | ${signal.market}`);
      await persistence.markSignalSent(signalId);
      await persistence.logTelegram({
        signalId,
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        message: `${signal.engine} | ${signal.market} | ${signal.selection}`,
        status: 'sent'
      });
    } catch (error) {
      await persistence.logTelegram({
        signalId,
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        message: `${signal.engine} | ${signal.market} | ${signal.selection}`,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    sentCount += 1;
  }

  if (sentCount === 0 && !process.argv.includes('--no-send')) {
    await telegram.sendNoBet();
    await persistence.logTelegram({
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      message: 'NO ELITE SIGNALS TODAY',
      status: 'sent'
    });
    console.log('TELEGRAM_SENT NO ELITE SIGNALS TODAY');
  }

  await persistence.disconnect();
}

function buildEngines(): MarketEngine[] {
  return [
    new FootballOver15Engine(),
    new FootballBttsEngine(),
    new FootballDoubleChanceEngine(),
    new NbaPlayerPropsEngine(),
    new NbaTeamTotalsEngine(),
    new NbaFirstHalfEngine(),
    ...(process.env.ENABLE_TENNIS_SIGNALS === 'true' ? [new TennisHardcourtOverGamesEngine()] : []),
    new MlbFirst5Engine()
  ];
}

async function loadSpecializedContext(dataEngine: DataEngine): Promise<EngineContext> {
  const tennisEnabled = process.env.ENABLE_TENNIS_SIGNALS === 'true' || process.env.ENABLE_TENNIS_VALIDATION === 'true';
  const [core, tennis, mlb] = await Promise.all([
    dataEngine.loadContext(),
    tennisEnabled ? new TennisDataEngine().loadContext() : emptyContext(),
    new MlbDataEngine().loadContext()
  ]);

  return {
    fixtures: [...core.fixtures, ...tennis.fixtures, ...mlb.fixtures],
    prices: [...core.prices, ...tennis.prices, ...mlb.prices],
    playerStats: [...core.playerStats, ...tennis.playerStats, ...mlb.playerStats],
    now: core.now
  };
}

function emptyContext(): EngineContext {
  return {
    fixtures: [],
    prices: [],
    playerStats: [],
    now: new Date()
  };
}

function startScheduler(): void {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const scanTimes = (process.env.SCAN_TIMES_WAT || '09:30,13:30,17:30')
    .split(',')
    .map((time) => time.trim())
    .filter(Boolean);
  const scheduleGraceMinutes = Number(process.env.SCHEDULE_GRACE_MINUTES || 20);
  const scheduleMaxRetries = Number(process.env.SCHEDULE_MAX_RETRIES || 2);
  let active = false;
  let lastRunKey = '';
  const failedRunAttempts = new Map<string, number>();

  console.log(`NEXORA scheduler active: ${scanTimes.join(', ')} WAT (grace ${scheduleGraceMinutes}m, retries ${scheduleMaxRetries})`);

  const tick = async () => {
    const now = watParts(new Date());
    const slot = dueScheduleSlot(now.time, scanTimes, scheduleGraceMinutes);
    if (!slot) return;

    const runKey = `${now.date}-${slot}`;
    if (active || lastRunKey === runKey) {
      if (lastRunKey === runKey) {
        console.log(`SCHEDULER_SKIP_ALREADY_RUN ${slot} WAT current=${now.time} WAT`);
      }
      return;
    }

    const failedAttempts = failedRunAttempts.get(runKey) || 0;
    if (failedAttempts >= scheduleMaxRetries) {
      console.log(`SCHEDULER_SKIP_RETRY_LIMIT ${slot} WAT current=${now.time} WAT attempts=${failedAttempts}`);
      return;
    }

    active = true;
    console.log(`SCHEDULER_TRIGGER ${slot} WAT current=${now.time} WAT attempt=${failedAttempts + 1}`);

    try {
      await runSignalBatch();
      lastRunKey = runKey;
      failedRunAttempts.delete(runKey);
      console.log(`SCHEDULER_DONE ${slot} WAT`);
    } catch (error) {
      failedRunAttempts.set(runKey, failedAttempts + 1);
      console.error(`SCHEDULER_FAILED ${slot} WAT`, error);
      await notifySchedulerFailure(error);
    } finally {
      active = false;
    }
  };

  void tick();
  setInterval(() => {
    void tick();
  }, 30_000);
}

async function notifySchedulerFailure(error: unknown): Promise<void> {
  try {
    const message = error instanceof Error ? error.message : String(error);
    await new TelegramEngine().sendMessage(`NEXORA scheduler failure\n${message}`);
  } catch (notifyError) {
    console.error('SCHEDULER_NOTIFY_FAILED', notifyError);
  }
}

function watParts(date: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`
  };
}

function formatLeagueCounts(fixtures: Array<{ league: string; country?: string }>): string {
  const counts = new Map<string, number>();
  for (const fixture of fixtures) {
    const label = fixture.country ? `${fixture.league} (${fixture.country})` : fixture.league;
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([league, count]) => `${league}: ${count}`)
    .join(', ') || 'none';
}

function signalLabel(signal: { subject?: string; fixture?: { homeTeam?: string; awayTeam?: string } }): string {
  const match = `${signal.fixture?.homeTeam || 'N/A'} vs ${signal.fixture?.awayTeam || 'N/A'}`;
  return signal.subject ? `${signal.subject} | ${match}` : match;
}

function formatSignalCounts(signals: Array<{ engine: string }>): string {
  const counts = new Map<string, number>();
  for (const signal of signals) {
    counts.set(signal.engine, (counts.get(signal.engine) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([engine, count]) => `${engine}: ${count}`)
    .join(', ') || 'none';
}

function logScanDiagnostics(
  context: EngineContext,
  engineResults: Array<{ engine: string; candidates: SignalCandidate[] }>,
  candidates: SignalCandidate[],
  approved: SignalCandidate[],
  signalAudit: SignalAuditResult
): void {
  const rejectedAfterEngine = Math.max(candidates.length - approved.length, 0);
  console.log('Diagnostics:');
  console.log(`Signals rejected after engine pass: ${rejectedAfterEngine}`);
  console.log(`False-positive detector rejections: ${formatAuditRejections(signalAudit)}`);
  console.log(`Engine zero-output reasons: ${engineZeroReasons(context, engineResults).join(' | ') || 'none'}`);
  console.log(`Football market coverage: ${footballCoverage(context).join(' | ') || 'none'}`);
  console.log(`NBA market coverage: ${nbaCoverage(context).join(' | ') || 'none'}`);
  console.log(`Tennis market coverage: ${tennisCoverage(context).join(' | ') || 'none'}`);
  console.log(`MLB market coverage: ${mlbCoverage(context).join(' | ') || 'none'}`);
}

function formatAuditRejections(signalAudit: SignalAuditResult): string {
  if (signalAudit.rejected.length === 0) return 'none';
  return signalAudit.rejected
    .slice(0, 8)
    .map((item) => `${item.signal.engine} ${signalLabel(item.signal)} ${item.signal.market}: ${item.reasons.join(', ')}`)
    .join(' | ');
}

function engineZeroReasons(context: EngineContext, engineResults: Array<{ engine: string; candidates: SignalCandidate[] }>): string[] {
  const reasons: string[] = [];
  const resultMap = new Map(engineResults.map((result) => [result.engine, result.candidates.length]));

  const over15 = context.prices.filter((price) => price.market === 'Over 1.5');
  if ((resultMap.get('Over 1.5 Specialist') || 0) === 0) {
    reasons.push(over15.length === 0 ? 'Over 1.5: no preferred-bookmaker Over 1.5 markets' : `Over 1.5: ${over15.length} markets failed probability/EV/quality filters`);
  }

  const btts = context.prices.filter((price) => price.market === 'BTTS Yes');
  if ((resultMap.get('BTTS Specialist') || 0) === 0) {
    reasons.push(btts.length === 0 ? 'BTTS: no preferred-bookmaker BTTS Yes markets' : `BTTS: ${btts.length} markets failed probability/EV/quality filters`);
  }

  const completeDoubleChance = context.fixtures
    .filter((fixture) => fixture.sport === 'football')
    .filter((fixture) => hasCompleteH2hSet(context.prices.filter((price) => price.fixtureId === fixture.id), fixture.homeTeam, fixture.awayTeam));
  if ((resultMap.get('Double Chance Specialist') || 0) === 0) {
    reasons.push(completeDoubleChance.length === 0 ? 'Double Chance: no complete preferred-bookmaker home/draw/away set' : `Double Chance: ${completeDoubleChance.length} complete sets failed EV/quality filters`);
  }

  const nbaTotals = context.prices.filter((price) => isNbaFixturePrice(context, price) && (isGameTotal(price.market) || isNbaTeamTotal(price.market)));
  if ((resultMap.get('Team Totals') || 0) === 0) {
    reasons.push(nbaTotals.length === 0 ? 'NBA totals: no preferred-bookmaker game/team-total markets' : `NBA totals: ${nbaTotals.length} markets failed EV/quality filters`);
  }

  const nbaH1 = context.prices.filter((price) => isNbaFixturePrice(context, price) && isFirstHalfTotal(price.market));
  if ((resultMap.get('First Half Totals') || 0) === 0) {
    reasons.push(nbaH1.length === 0 ? 'NBA first half: no preferred-bookmaker H1 total markets' : `NBA first half: ${nbaH1.length} markets failed EV/quality filters`);
  }

  const propPrices = context.prices.filter((price) => price.market.startsWith('player_'));
  if ((resultMap.get('Player Props') || 0) === 0) {
    reasons.push(propPrices.length === 0 ? 'NBA props: no preferred-bookmaker player prop markets' : `NBA props: ${propPrices.length} prop markets failed stat matching/EV/quality filters`);
  }

  const tennisOverGames = context.prices.filter((price) => price.market.startsWith('Over') && price.market.endsWith('Games'));
  if (process.env.ENABLE_TENNIS_SIGNALS !== 'true') {
    reasons.push('ATP tennis: validation-only/disabled after loss audit');
  } else if ((resultMap.get('ATP Over Games') || 0) === 0) {
    reasons.push(tennisOverGames.length === 0 ? 'ATP tennis: no confirmed Over Games markets on allowed surfaces' : `ATP tennis: ${tennisOverGames.length} markets failed competitiveness/dominance/EV filters`);
  }

  const mlbFirst5 = context.prices.filter((price) => price.market.startsWith('First 5 Innings'));
  if ((resultMap.get('MLB First 5 Innings') || 0) === 0) {
    reasons.push(mlbFirst5.length === 0 ? 'MLB First 5: no preferred-bookmaker First 5 markets' : `MLB First 5: ${mlbFirst5.length} markets failed pitcher/weather/volatility/EV filters`);
  }

  return reasons;
}

function footballCoverage(context: EngineContext): string[] {
  return context.fixtures
    .filter((fixture) => fixture.sport === 'football')
    .map((fixture) => {
      const prices = context.prices.filter((price) => price.fixtureId === fixture.id);
      const over15 = prices.filter((price) => price.market === 'Over 1.5').length;
      const btts = prices.filter((price) => price.market === 'BTTS Yes').length;
      const h2h = prices.filter((price) => price.market === 'Double Chance Candidate').length;
      return `${fixture.homeTeam || 'N/A'} vs ${fixture.awayTeam || 'N/A'}: over15=${over15}, btts=${btts}, h2h=${h2h}`;
    });
}

function nbaCoverage(context: EngineContext): string[] {
  return context.fixtures
    .filter((fixture) => fixture.sport === 'nba')
    .map((fixture) => {
      const prices = context.prices.filter((price) => price.fixtureId === fixture.id);
      const totals = prices.filter((price) => isGameTotal(price.market)).length;
      const teamTotals = prices.filter((price) => isNbaTeamTotal(price.market)).length;
      const h1 = prices.filter((price) => isFirstHalfTotal(price.market)).length;
      const props = prices.filter((price) => price.market.startsWith('player_')).length;
      return `${fixture.homeTeam || 'N/A'} vs ${fixture.awayTeam || 'N/A'}: totals=${totals}, teamTotals=${teamTotals}, h1=${h1}, props=${props}`;
    });
}

function tennisCoverage(context: EngineContext): string[] {
  return context.fixtures
    .filter((fixture) => fixture.sport === 'tennis')
    .map((fixture) => {
      const prices = context.prices.filter((price) => price.fixtureId === fixture.id);
      const overGames = prices.filter((price) => price.market.startsWith('Over') && price.market.endsWith('Games')).length;
      return `${fixture.homeTeam || 'N/A'} vs ${fixture.awayTeam || 'N/A'}: overGames=${overGames}`;
    });
}

function mlbCoverage(context: EngineContext): string[] {
  return context.fixtures
    .filter((fixture) => fixture.sport === 'mlb')
    .map((fixture) => {
      const prices = context.prices.filter((price) => price.fixtureId === fixture.id);
      const first5 = prices.filter((price) => price.market.startsWith('First 5 Innings')).length;
      return `${fixture.homeTeam || 'N/A'} vs ${fixture.awayTeam || 'N/A'}: first5=${first5}`;
    });
}

function hasCompleteH2hSet(prices: MarketPrice[], homeTeam?: string, awayTeam?: string): boolean {
  if (!homeTeam || !awayTeam) return false;
  const selections = new Set(prices.filter((price) => price.market === 'Double Chance Candidate').map((price) => price.selection));
  return selections.has(homeTeam) && selections.has(awayTeam) && selections.has('Draw');
}

function isNbaFixturePrice(context: EngineContext, price: MarketPrice): boolean {
  return context.fixtures.some((fixture) => fixture.id === price.fixtureId && fixture.sport === 'nba');
}

function isGameTotal(market: string): boolean {
  return /^Over \d+(\.\d+)?$/.test(market) || /^Under \d+(\.\d+)?$/.test(market);
}

function isNbaTeamTotal(market: string): boolean {
  return /^Team Total .+ (Over|Under) \d+(\.\d+)?$/.test(market);
}

function isFirstHalfTotal(market: string): boolean {
  return /^Over \d+(\.\d+)? H1$/.test(market) || /^Under \d+(\.\d+)? H1$/.test(market);
}

function dueScheduleSlot(currentTime: string, scanTimes: string[], graceMinutes: number): string | undefined {
  const currentMinute = minutesOfDay(currentTime);
  if (!Number.isFinite(currentMinute)) return undefined;

  return scanTimes.find((slot) => {
    const slotMinute = minutesOfDay(slot);
    if (!Number.isFinite(slotMinute)) return false;

    const minutesLate = currentMinute - slotMinute;
    return minutesLate >= 0 && minutesLate <= graceMinutes;
  });
}

function minutesOfDay(time: string): number {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.NaN;
  return (hour * 60) + minute;
}

const manualMode = ['--dry-run', '--no-send', '--once'].some((flag) => process.argv.includes(flag));

if (manualMode) {
  runSignalBatch().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  startScheduler();
}
