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
    await this.sendMessage('NO ELITE SIGNALS TODAY');
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.token || !this.chatId) {
      throw new Error('Telegram token/chat ID missing');
    }

    const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text })
    });

    if (!response.ok) {
      throw new Error(`Telegram delivery failed: ${response.status} ${await response.text()}`);
    }
  }
}

export function formatSignal(signal: SignalCandidate): string {
  if (signal.sport === 'nba') {
    return [
      '🏀 NEXORA NBA ELITE SIGNAL',
      '',
      `Engine: ${signal.engine}`,
      signal.subject ? `Player: ${signal.subject}` : undefined,
      `Market: ${signal.market}`,
      `Odds: ${signal.odds.toFixed(2)}`,
      `Confidence: ${signal.confidence.toFixed(1)}`,
      `EV: ${formatEv(signal.ev)}`,
      `Signal Tier: ${signal.tier}`,
      '',
      'Reason:',
      signal.reason
    ].filter(Boolean).join('\n');
  }

  return [
    '🟢 NEXORA ELITE SIGNAL',
    '',
    'Sport: Football',
    `Engine: ${signal.engine}`,
    '',
    signal.fixture ? `Match: ${signal.fixture.homeTeam} vs ${signal.fixture.awayTeam}` : undefined,
    `Market: ${signal.market}`,
    `Odds: ${signal.odds.toFixed(2)}`,
    `Confidence: ${signal.confidence.toFixed(1)}`,
    `EV: ${formatEv(signal.ev)}`,
    `Signal Tier: ${signal.tier}`,
    '',
    'Reason:',
    signal.reason
  ].filter(Boolean).join('\n');
}

function formatEv(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}
