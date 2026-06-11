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
    await this.sendMessage('NEXORA foundation is online. No signal engines are configured yet.');
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
  // TODO: Rebuild Telegram signal formatting once new signal DTOs are defined.
  return 'NEXORA signal formatting template is not configured yet.';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
