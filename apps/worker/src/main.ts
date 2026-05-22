import { DataEngine } from '@nexora/data-engine';
import { FootballBttsEngine } from '@nexora/football-btts-engine';
import { FootballDoubleChanceEngine } from '@nexora/football-doublechance-engine';
import { FootballOver15Engine } from '@nexora/football-over15-engine';
import { NbaFirstHalfEngine } from '@nexora/nba-firsthalf-engine';
import { NbaPlayerPropsEngine } from '@nexora/nba-playerprops-engine';
import { NbaTeamTotalsEngine } from '@nexora/nba-teamtotals-engine';
import { PersistenceEngine } from '@nexora/persistence-engine';
import { RiskEngine } from '@nexora/risk-engine';
import { loadDotEnv, validateRequiredEnv } from '@nexora/shared';
import { SignalEngine } from '@nexora/signal-engine';
import { TelegramEngine } from '@nexora/telegram-engine';
import type { MarketEngine } from '@nexora/types';

const engines: MarketEngine[] = [
  new FootballOver15Engine(),
  new FootballBttsEngine(),
  new FootballDoubleChanceEngine(),
  new NbaPlayerPropsEngine(),
  new NbaTeamTotalsEngine(),
  new NbaFirstHalfEngine()
];

async function runSignalBatch() {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const dataEngine = new DataEngine();
  const signalEngine = new SignalEngine();
  const riskEngine = new RiskEngine();
  const telegram = new TelegramEngine();
  const context = await dataEngine.loadContext();
  const engineResults = await Promise.all(engines.map(async (engine) => ({
    engine: engine.name,
    candidates: await engine.generate(context)
  })));
  const candidates = engineResults.flatMap((result) => result.candidates);
  const approved = riskEngine.removeCorrelatedExposure(signalEngine.approve(candidates));

  if (process.argv.includes('--dry-run')) {
    const footballFixtures = context.fixtures.filter((fixture) => fixture.sport === 'football');
    const nbaFixtures = context.fixtures.filter((fixture) => fixture.sport === 'nba');
    const over15Prices = context.prices.filter((price) => price.market === 'Over 1.5');
    const bttsPrices = context.prices.filter((price) => price.market === 'BTTS Yes');
    const h2hPrices = context.prices.filter((price) => price.market === 'Double Chance Candidate');
    const nbaTotals = context.prices.filter((price) =>
      context.fixtures.some((fixture) => fixture.id === price.fixtureId && fixture.sport === 'nba') &&
      (/^Over \d+(\.\d+)?$/.test(price.market) || /^Under \d+(\.\d+)?$/.test(price.market))
    );
    const nbaH1Totals = context.prices.filter((price) =>
      context.fixtures.some((fixture) => fixture.id === price.fixtureId && fixture.sport === 'nba') &&
      (/^Over \d+(\.\d+)? H1$/.test(price.market) || /^Under \d+(\.\d+)? H1$/.test(price.market))
    );
    const playerPropPrices = context.prices.filter((price) => price.market.startsWith('player_'));
    console.log(`NEXORA dry run: fixtures=${context.fixtures.length}, prices=${context.prices.length}`);
    console.log(`Football fixtures: ${footballFixtures.length} (${formatLeagueCounts(footballFixtures)})`);
    console.log(`NBA fixtures: ${nbaFixtures.length}`);
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
    console.log(`NBA totals prices: ${nbaTotals.length}`);
    console.log(`NBA first-half totals prices: ${nbaH1Totals.length}`);
    console.log(`NBA player stats rows: ${context.playerStats.length}`);
    console.log(`NBA player prop prices: ${playerPropPrices.length}`);
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
  let active = false;
  let lastRunKey = '';

  console.log(`NEXORA scheduler active: ${scanTimes.join(', ')} WAT (grace ${scheduleGraceMinutes}m)`);

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

    active = true;
    lastRunKey = runKey;
    console.log(`SCHEDULER_TRIGGER ${slot} WAT current=${now.time} WAT`);

    try {
      await runSignalBatch();
      console.log(`SCHEDULER_DONE ${slot} WAT`);
    } catch (error) {
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
