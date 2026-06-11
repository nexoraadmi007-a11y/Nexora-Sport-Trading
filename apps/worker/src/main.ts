import { DataEngine } from '@nexora/data-engine';
import { PersistenceEngine } from '@nexora/persistence-engine';
import { loadDotEnv, validateRequiredEnv } from '@nexora/shared';
import { TelegramEngine } from '@nexora/telegram-engine';

async function runFoundationBatch(): Promise<void> {
  loadDotEnv();
  if (process.env.NODE_ENV === 'production') {
    validateRequiredEnv();
  }

  const dataEngine = new DataEngine();
  const context = await dataEngine.loadContext();
  const diagnostics = dataEngine.getDiagnostics();

  const message = [
    'NEXORA FOUNDATION MODE',
    'Old betting logic has been removed.',
    'No signal engines are configured yet.',
    `Fixtures loaded: ${context.fixtures.length}`,
    `Prices loaded: ${context.prices.length}`,
    diagnostics ? `Cache hits: ${diagnostics.cache.hits}, misses: ${diagnostics.cache.misses}` : undefined
  ].filter((line): line is string => Boolean(line)).join('\n');

  if (process.argv.includes('--dry-run') || process.argv.includes('--no-send')) {
    console.log(message);
    return;
  }

  const telegram = new TelegramEngine();
  const persistence = new PersistenceEngine();

  try {
    await telegram.sendMessage(message);
    await persistence.logTelegram({
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      message,
      status: 'sent'
    });
    console.log('TELEGRAM_SENT foundation status');
  } finally {
    await persistence.disconnect();
  }
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

  console.log(`NEXORA foundation scheduler active: ${scanTimes.join(', ')} WAT`);

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
      await runFoundationBatch();
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
    await new TelegramEngine().sendMessage(`NEXORA foundation scheduler failure\n${message}`);
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

const manualMode = ['--dry-run', '--no-send', '--once'].some((flag) => process.argv.includes(flag));

if (manualMode) {
  runFoundationBatch().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  startScheduler();
}
