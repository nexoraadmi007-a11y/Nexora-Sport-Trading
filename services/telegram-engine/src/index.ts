import type { SignalCandidate } from '@nexora/types';

export class TelegramEngine {
  constructor(
    private readonly token = process.env.TELEGRAM_BOT_TOKEN,
    private readonly chatId = process.env.TELEGRAM_CHAT_ID
  ) {}

  async sendSignal(signal: SignalCandidate): Promise<void> {
    await this.sendMessage(formatSignal(signal));
  }

  async sendNoBet(): Promise<void> {
    await this.sendMessage([
      '━━━━━━━━━━━━━━━',
      'NEXORA ELITE SIGNALS',
      '━━━━━━━━━━━━━━━',
      '',
      'NO ELITE SIGNALS TODAY',
      '',
      'No market passed the current probability, EV, confidence, quality, and exposure filters.'
    ].join('\n'));
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.token || !this.chatId) {
      throw new Error('Telegram token/chat ID missing');
    }

    const attempts = Number(process.env.TELEGRAM_DELIVERY_ATTEMPTS || 4);
    const timeoutMs = Number(process.env.TELEGRAM_DELIVERY_TIMEOUT_MS || 20_000);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: this.chatId, text }),
          signal: controller.signal
        });

        if (response.ok) return;
        lastError = new Error(`Telegram delivery failed: ${response.status} ${await response.text()}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }

      if (attempt < attempts) await delay(1_000 * attempt);
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export function formatSignal(_signal: SignalCandidate): string {
  const signal = _signal;
  const fixture = signal.fixture;
  const sportIcon = signal.sport === 'nba' ? '🏀' : '⚽';
  const league = fixture
    ? `${fixture.league}${fixture.country ? ` (${fixture.country})` : ''}`
    : 'Unknown League';
  const match = fixture?.homeTeam && fixture.awayTeam
    ? `${fixture.homeTeam} vs ${fixture.awayTeam}`
    : signal.subject || 'Unknown Match';
  const time = fixture?.startsAt ? watTime(fixture.startsAt) : 'TBC';

  return [
    '━━━━━━━━━━━━━━━',
    `${sportIcon} NEXORA ELITE SIGNAL`,
    '━━━━━━━━━━━━━━━',
    '',
    `Sport: ${signal.sport === 'nba' ? 'NBA Basketball' : 'Football'}`,
    `Engine: ${signal.engine}`,
    `League: ${league}`,
    `Match: ${match}`,
    `Time: ${time} WAT`,
    signal.subject ? `Subject: ${signal.subject}` : undefined,
    '',
    `Market: ${signal.market}`,
    `Selection: ${signal.selection}`,
    `Bookmaker: ${signal.bookmaker || 'Best available'}`,
    `Odds: ${formatNumber(signal.odds)}`,
    `Probability: ${formatPercent(signal.probability)}`,
    `EV: ${formatSignedPercent(signal.ev)}`,
    `Confidence: ${signal.confidence ?? 'N/A'}/100`,
    `Quality Score: ${signal.qualityScore ?? 'N/A'}/100`,
    '',
    `Signal Tier: ${signal.tier || 'B'}`,
    `Risk Level: ${signal.riskLevel || 'MEDIUM'}`,
    'Action: PLACE',
    '',
    'Reason:',
    signal.reason || 'Consensus value edge passed validation.',
    '',
    '━━━━━━━━━━━━━━━'
  ].filter((line): line is string => line !== undefined).join('\n');
}

function watTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatNumber(value: number | undefined): string {
  return typeof value === 'number' ? value.toFixed(2) : 'N/A';
}

function formatPercent(value: number | undefined): string {
  return typeof value === 'number' ? `${(value * 100).toFixed(1)}%` : 'N/A';
}

function formatSignedPercent(value: number | undefined): string {
  if (typeof value !== 'number') return 'N/A';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)}%`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
