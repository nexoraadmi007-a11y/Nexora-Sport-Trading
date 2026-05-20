import { PrismaClient } from '@prisma/client';
import type { SignalCandidate } from '@nexora/types';
import { randomUUID } from 'node:crypto';

export class PersistenceEngine {
  private readonly prisma = new PrismaClient();

  async hasDuplicateSignal(signal: SignalCandidate): Promise<boolean> {
    if (!signal.fixture) return false;
    if (this.canUseRest()) return this.hasDuplicateSignalRest(signal);

    try {
      const existing = await this.prisma.signal.findFirst({
        where: {
          fixtureId: signal.fixture.id,
          market: signal.market,
          selection: signal.selection,
          status: { in: ['approved', 'sent'] }
        },
        select: { id: true }
      });

      return Boolean(existing);
    } catch (error) {
      this.warn('duplicate check', error);
      return false;
    }
  }

  async saveApprovedSignal(signal: SignalCandidate): Promise<string | undefined> {
    if (this.canUseRest()) return this.saveApprovedSignalRest(signal);

    try {
      if (signal.fixture) {
        await this.prisma.fixture.upsert({
          where: { id: signal.fixture.id },
          create: {
            id: signal.fixture.id,
            sport: signal.fixture.sport,
            league: signal.fixture.league,
            country: signal.fixture.country,
            homeTeam: signal.fixture.homeTeam || '',
            awayTeam: signal.fixture.awayTeam || '',
            kickoffTime: signal.fixture.startsAt,
            status: 'scheduled'
          },
          update: {
            sport: signal.fixture.sport,
            league: signal.fixture.league,
            country: signal.fixture.country,
            homeTeam: signal.fixture.homeTeam || '',
            awayTeam: signal.fixture.awayTeam || '',
            kickoffTime: signal.fixture.startsAt
          }
        });
      }

      const saved = await this.prisma.signal.create({
        data: {
          fixtureId: signal.fixture?.id,
          sport: signal.sport,
          engine: signal.engine,
          market: signal.market,
          selection: signal.selection,
          odds: signal.odds,
          trueProbability: signal.trueProbability,
          ev: signal.ev,
          confidence: signal.confidence,
          tier: signal.tier,
          reason: signal.reason,
          status: 'approved',
          qualityScore: {
            create: {
              score: signal.qualityScore,
              factors: {
                confidence: signal.confidence,
                ev: signal.ev,
                tier: signal.tier
              }
            }
          },
          clvTracking: {
            create: {
              signalOdds: signal.odds
            }
          }
        }
      });

      return saved.id;
    } catch (error) {
      this.warn('signal save', error);
      return undefined;
    }
  }

  async markSignalSent(signalId?: string): Promise<void> {
    if (!signalId) return;
    if (this.canUseRest()) {
      await this.markSignalSentRest(signalId);
      return;
    }

    try {
      await this.prisma.signal.update({
        where: { id: signalId },
        data: {
          status: 'sent',
          sentAt: new Date()
        }
      });
    } catch (error) {
      this.warn('sent marker', error);
    }
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
      // Nothing to recover here; persistence is intentionally non-blocking.
    }
  }

  private canUseRest(): boolean {
    return Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY));
  }

  private async hasDuplicateSignalRest(signal: SignalCandidate): Promise<boolean> {
    if (!signal.fixture) return false;
    const params = new URLSearchParams({
      select: 'id',
      fixtureId: `eq.${signal.fixture.id}`,
      market: `eq.${signal.market}`,
      selection: `eq.${signal.selection}`,
      status: 'in.(approved,sent)',
      limit: '1'
    });

    try {
      const rows = await this.rest<Array<{ id: string }>>(`Signal?${params}`);
      return rows.length > 0;
    } catch (error) {
      this.warn('REST duplicate check', error);
      return false;
    }
  }

  private async saveApprovedSignalRest(signal: SignalCandidate): Promise<string | undefined> {
    const signalId = randomUUID();

    try {
      if (signal.fixture) {
        await this.rest('Fixture?on_conflict=id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({
            id: signal.fixture.id,
            sport: signal.fixture.sport,
            league: signal.fixture.league,
            country: signal.fixture.country,
            homeTeam: signal.fixture.homeTeam || '',
            awayTeam: signal.fixture.awayTeam || '',
            kickoffTime: signal.fixture.startsAt.toISOString(),
            status: 'scheduled',
            updatedAt: new Date().toISOString()
          })
        });
      }

      await this.rest('Signal', {
        method: 'POST',
        body: JSON.stringify({
          id: signalId,
          fixtureId: signal.fixture?.id,
          sport: signal.sport,
          engine: signal.engine,
          market: signal.market,
          selection: signal.selection,
          odds: signal.odds,
          trueProbability: signal.trueProbability,
          ev: signal.ev,
          confidence: signal.confidence,
          tier: signal.tier,
          reason: signal.reason,
          status: 'approved'
        })
      });

      await this.rest('SignalQualityScore', {
        method: 'POST',
        body: JSON.stringify({
          id: randomUUID(),
          signalId,
          score: signal.qualityScore,
          factors: {
            confidence: signal.confidence,
            ev: signal.ev,
            tier: signal.tier
          }
        })
      });

      await this.rest('ClvTracking', {
        method: 'POST',
        body: JSON.stringify({
          id: randomUUID(),
          signalId,
          signalOdds: signal.odds
        })
      });

      return signalId;
    } catch (error) {
      this.warn('REST signal save', error);
      return undefined;
    }
  }

  private async markSignalSentRest(signalId: string): Promise<void> {
    try {
      await this.rest(`Signal?id=eq.${encodeURIComponent(signalId)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'sent',
          sentAt: new Date().toISOString()
        })
      });
    } catch (error) {
      this.warn('REST sent marker', error);
    }
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
