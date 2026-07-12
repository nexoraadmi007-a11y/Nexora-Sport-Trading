import { DataEngine } from '@nexora/data-engine';
import { FootballBttsEngine } from '@nexora/football-btts-engine';
import { FootballDoubleChanceEngine } from '@nexora/football-doublechance-engine';
import { FootballOver15Engine } from '@nexora/football-over15-engine';
import { NbaFirstHalfEngine } from '@nexora/nba-firsthalf-engine';
import { NbaPlayerPropsEngine } from '@nexora/nba-playerprops-engine';
import { NbaTeamTotalsEngine } from '@nexora/nba-teamtotals-engine';
import { PersistenceEngine } from '@nexora/persistence-engine';
import { RiskEngine } from '@nexora/risk-engine';
import { allEngineStatuses, engineKeyForName, engineStatusForKey, engineStatusForSignal, loadDotEnv, validateRequiredEnv } from '@nexora/shared';
import { SignalEngine } from '@nexora/signal-engine';
import { TelegramEngine, formatSignal } from '@nexora/telegram-engine';
import type { EngineContext, MarketEngine, SignalCandidate } from '@nexora/types';

async function runSignalBatch(): Promise<void> {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const dataEngine = new DataEngine();
  const context = await dataEngine.loadContext();
  const diagnostics = dataEngine.getDiagnostics();
  const engines = buildEngines();
  const engineResults = await Promise.all(engines.map(async (engine) => {
    const engineKey = engineKeyForName(engine.name);
    const engineStatus = engineStatusForKey(engineKey);
    const generated = engineStatus === 'DISABLED'
      ? []
      : await engine.generate(context);
    const diagnosticsSource = engine as unknown as { getDiagnostics?: () => unknown };
    const engineDiagnostics = typeof diagnosticsSource.getDiagnostics === 'function'
      ? diagnosticsSource.getDiagnostics()
      : undefined;

    return {
      engine: engine.name,
      engineKey,
      engineStatus,
      engineDiagnostics,
      candidates: generated.map((signal) => ({ ...signal, engineStatus }))
    };
  }));
  printRuntimeEngineDiagnostics(engineResults);
  const candidates = engineResults.flatMap((result) => result.candidates);
  const signalAudit = new SignalEngine().audit(candidates);
  const approved = signalAudit.approved.map((signal) => ({
    ...signal,
    engineStatus: signal.engineStatus || engineStatusForSignal(signal)
  }));
  const shadowApproved = approved.filter((signal) => signal.engineStatus === 'SHADOW');
  const productionApproved = new RiskEngine().removeCorrelatedExposure(
    approved.filter((signal) => signal.engineStatus === 'PRODUCTION')
  );

  if (process.argv.includes('--dry-run') || process.argv.includes('--no-send')) {
    printDiagnostics(context, diagnostics, engineResults, candidates, signalAudit.rejected, productionApproved, shadowApproved);
    if (productionApproved.length > 0) {
      for (const signal of productionApproved) {
        console.log('');
        console.log(formatSignal(signal));
      }
    }
    if (shadowApproved.length > 0) {
      console.log('');
      console.log(`Shadow predictions: ${shadowApproved.length}`);
      for (const signal of shadowApproved.slice(0, 8)) {
        console.log(`SHADOW | ${signal.engine} | ${label(signal)} | ${signal.market} | ${signal.selection}`);
      }
    }
    return;
  }

  const telegram = new TelegramEngine();
  const persistence = new PersistenceEngine();

  try {
    await persistence.upsertEngineSettings(allEngineStatuses());
    for (const signal of shadowApproved) {
      await persistence.saveShadowPrediction(signal, 'SHADOW');
      console.log(`SHADOW_STORED ${signal.engine} | ${label(signal)} | ${signal.market}`);
    }

    if (productionApproved.length === 0) {
      await telegram.sendNoBet();
      await persistence.logTelegram({
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        message: 'NO ELITE SIGNALS TODAY',
        status: 'sent'
      });
      console.log('TELEGRAM_SENT NO ELITE SIGNALS TODAY');
      return;
    }

    let sentCount = 0;
    let duplicateCount = 0;

    for (const signal of productionApproved) {
      if (await persistence.hasDuplicateSignal(signal)) {
        duplicateCount += 1;
        console.log(`SKIP duplicate persisted signal | ${label(signal)}`);
        continue;
      }

      const signalId = await persistence.saveApprovedSignal(signal);
      await telegram.sendSignal(signal);
      await persistence.markSignalSent(signalId);
      await persistence.logTelegram({
        signalId,
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        message: `${signal.engine} | ${label(signal)} | ${signal.market} | ${signal.selection}`,
        status: 'sent'
      });
      console.log(`TELEGRAM_SENT ${signal.tier || 'B'} | ${label(signal)} | ${signal.market}`);
      sentCount += 1;
    }

    if (sentCount === 0) {
      await telegram.sendNoBet();
      await persistence.logTelegram({
        chatId: process.env.TELEGRAM_CHAT_ID || '',
        message: duplicateCount > 0
          ? `NO ELITE SIGNALS TODAY | ${duplicateCount} duplicate approved signal(s) skipped`
          : 'NO ELITE SIGNALS TODAY',
        status: 'sent'
      });
      console.log(`TELEGRAM_SENT NO ELITE SIGNALS TODAY | duplicates_skipped=${duplicateCount}`);
    }
  } finally {
    await persistence.disconnect();
  }
}

function buildEngines(): MarketEngine[] {
  return [
    new FootballOver15Engine(),
    new FootballBttsEngine(),
    new FootballDoubleChanceEngine(),
    new NbaPlayerPropsEngine(),
    new NbaTeamTotalsEngine(),
    new NbaFirstHalfEngine()
  ];
}

function printDiagnostics(
  context: EngineContext,
  diagnostics: ReturnType<DataEngine['getDiagnostics']>,
  engineResults: Array<{ engine: string; candidates: SignalCandidate[]; engineDiagnostics?: unknown }>,
  candidates: SignalCandidate[],
  rejected: Array<{ signal: SignalCandidate; reasons: string[] }>,
  approved: SignalCandidate[],
  shadowApproved: SignalCandidate[]
): void {
  const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
  const nbaFixtures = context.fixtures.filter((fixture) => fixture.sport === 'nba');

  console.log('NEXORA ELITE SIGNALS DRY RUN');
  console.log(`Fixtures loaded: ${context.fixtures.length}`);
  console.log(`Football fixtures: ${footballFixtures.length}`);
  console.log(`NBA fixtures: ${nbaFixtures.length}`);
  console.log(`Prices loaded: ${context.prices.length}`);
  console.log(`Candidates: ${candidates.length}`);
  console.log(`Rejected: ${rejected.length}`);
  console.log(`Approved production: ${approved.length}`);
  console.log(`Approved shadow: ${shadowApproved.length}`);

  if (diagnostics) {
    console.log(`Sport keys scanned: ${diagnostics.sportKeysScanned.join(', ') || 'none'}`);
    console.log(`Scan window: next ${diagnostics.scanWindowHours} hours`);
    console.log(`Deep market events scanned: ${diagnostics.deepMarketEventsScanned}`);
    console.log(`Cache: hits=${diagnostics.cache.hits}, misses=${diagnostics.cache.misses}, stale=${diagnostics.cache.staleHits}, writes=${diagnostics.cache.writes}`);
    console.log(`Quota: daily=${JSON.stringify(diagnostics.quota.daily)}, hourly=${JSON.stringify(diagnostics.quota.hourly)}, skipped=${diagnostics.quota.skipped}`);
    for (const error of diagnostics.errors) {
      console.log(`DATA_WARNING ${error}`);
    }
  }

  for (const result of engineResults) {
    const engineStatus = 'engineStatus' in result ? String(result.engineStatus) : 'UNKNOWN';
    console.log(`${result.engine} [${engineStatus}]: ${result.candidates.length} candidates`);
  }

  const reasonCounts = new Map<string, number>();
  for (const item of rejected) {
    for (const reason of item.reasons) {
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
  }

  if (reasonCounts.size > 0) {
    console.log('Rejection reasons:');
    for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`- ${reason}: ${count}`);
    }
  }
}

function printRuntimeEngineDiagnostics(
  engineResults: Array<{ engine: string; engineDiagnostics?: unknown }>
): void {
  for (const result of engineResults) {
    if (result.engine !== 'Football Over 1.5 Specialist' || !isOver15Diagnostics(result.engineDiagnostics)) continue;

    const diagnostics = result.engineDiagnostics;
    console.log('OVER15_DIAGNOSTICS');
    console.log(`- fixtures checked: ${diagnostics.fixturesChecked}`);
    console.log(`- Over 1.5 markets found: ${diagnostics.over15MarketsFound}`);
    console.log(`- approved: ${diagnostics.approved}`);
    console.log(`- rejected: ${diagnostics.rejected}`);

    const reasons = Object.entries(diagnostics.rejectionReasons)
      .sort((a, b) => b[1] - a[1]);
    if (reasons.length > 0) {
      console.log('- rejection reasons:');
      for (const [reason, count] of reasons) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    if (diagnostics.strongestNearMiss) {
      const miss = diagnostics.strongestNearMiss;
      console.log('- strongest near-miss:');
      console.log(`  match: ${miss.match}`);
      console.log(`  reason: ${miss.reason}`);
      console.log(`  odds: ${formatMaybeNumber(miss.odds)}`);
      console.log(`  projected xG: ${formatMaybeNumber(miss.projectedXg)}`);
      console.log(`  EV: ${formatMaybePercent(miss.ev)}`);
      console.log(`  confidence: ${formatMaybeNumber(miss.confidence)}/100`);
      console.log(`  quality: ${formatMaybeNumber(miss.qualityScore)}/100`);
      console.log(`  model agreement: ${formatMaybeNumber(miss.consensusAgreement)}/5`);
    }
  }
}

function isOver15Diagnostics(value: unknown): value is {
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
} {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { fixturesChecked?: unknown }).fixturesChecked === 'number' &&
    typeof (value as { over15MarketsFound?: unknown }).over15MarketsFound === 'number' &&
    typeof (value as { rejected?: unknown }).rejected === 'number'
  );
}

function formatMaybeNumber(value: number | undefined): string {
  return typeof value === 'number' ? String(value) : 'N/A';
}

function formatMaybePercent(value: number | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'N/A';
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

  console.log(`NEXORA scheduler active: ${scanTimes.join(', ')} WAT`);

  const tick = async () => {
    const now = watParts(new Date());
    const slot = dueScheduleSlot(now.time, scanTimes, scheduleGraceMinutes);
    if (!slot) return;

    const runKey = `${now.date}-${slot}`;
    if (active || lastRunKey === runKey) return;

    const failedAttempts = failedRunAttempts.get(runKey) || 0;
    if (failedAttempts >= scheduleMaxRetries) return;

    active = true;
    console.log(`SCHEDULER_TRIGGER ${slot} WAT current=${now.time} WAT`);

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

function label(signal: SignalCandidate): string {
  if (signal.fixture?.homeTeam && signal.fixture.awayTeam) {
    return `${signal.fixture.homeTeam} vs ${signal.fixture.awayTeam}`;
  }

  return signal.subject || signal.market;
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
