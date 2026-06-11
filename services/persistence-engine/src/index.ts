import { PrismaClient } from '@prisma/client';
import type { SignalCandidate } from '@nexora/types';
import { randomUUID } from 'node:crypto';

export class PersistenceEngine {
  private readonly prisma = new PrismaClient();

  async hasDuplicateSignal(_signal: SignalCandidate): Promise<boolean> {
    // TODO: Rebuild idempotency rules for the next signal schema.
    return false;
  }

  async saveApprovedSignal(_signal: SignalCandidate): Promise<string | undefined> {
    // TODO: Rebuild signal persistence for the next signal schema.
    return undefined;
  }

  async markSignalSent(_signalId?: string): Promise<void> {
    // TODO: Rebuild sent-state persistence for the next signal schema.
  }

  async logTelegram(params: { signalId?: string; chatId: string; message: string; status: string; error?: string }): Promise<void> {
    if (this.canUseRest()) {
      await this.logTelegramRest(params);
      return;
    }

    try {
      await this.prisma.telegramLog.create({
        data: {
          signalId: params.signalId,
          chatId: params.chatId,
          message: params.message,
          status: params.status,
          error: params.error
        }
      });
    } catch (error) {
      this.warn('Telegram log', error);
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
    } catch {
      // Persistence is non-blocking infrastructure.
    }
  }

  private canUseRest(): boolean {
    return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
  }

  private async logTelegramRest(params: { signalId?: string; chatId: string; message: string; status: string; error?: string }): Promise<void> {
    try {
      await this.rest('TelegramLog', {
        method: 'POST',
        body: JSON.stringify({
          id: randomUUID(),
          signalId: params.signalId,
          chatId: params.chatId,
          message: params.message,
          status: params.status,
          error: params.error
        })
      });
    } catch (error) {
      this.warn('REST Telegram log', error);
    }
  }

  private async rest<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: key || '',
        Authorization: `Bearer ${key || ''}`,
        'Content-Type': 'application/json',
        ...(init?.headers || {})
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${await response.text()}`);
    }

    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? JSON.parse(text) as T : undefined as T;
  }

  private warn(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Persistence skipped after ${action} failure: ${message}`);
  }
}
