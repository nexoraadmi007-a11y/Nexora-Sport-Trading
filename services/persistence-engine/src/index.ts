import { PrismaClient } from '@prisma/client';
import type { EngineOperationalStatus, SignalCandidate } from '@nexora/types';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface SentSignalRecord {
  id: string;
  matchKey: string;
  signalKey: string;
  match: string;
  market: string;
  selection: string;
  startsAt?: string;
  status: 'approved' | 'sent';
  createdAt: string;
  sentAt?: string;
}

export class PersistenceEngine {
  private readonly prisma = new PrismaClient();
  private readonly cacheDir = process.env.NEXORA_CACHE_DIR || join(process.cwd(), '.nexora-cache');
  private readonly sentSignalsFile = join(this.cacheDir, 'sent-signals.json');

  async hasDuplicateSignal(signal: SignalCandidate): Promise<boolean> {
    if (process.argv.includes('--force-resend') || process.env.ALLOW_SIGNAL_RESEND === 'true') {
      return false;
    }

    const matchKey = this.matchKey(signal);
    const signalKey = this.signalKey(signal);
    const registry = await this.loadSentRegistry();
    const localDuplicate = registry.some((record) =>
      record.status === 'sent' &&
      (record.matchKey === matchKey || record.signalKey === signalKey) &&
      !this.isExpiredDuplicate(record)
    );

    if (localDuplicate) return true;
    return this.hasRecentTelegramLog(signal);
  }

  async saveApprovedSignal(signal: SignalCandidate): Promise<string | undefined> {
    const id = randomUUID();
    const registry = await this.loadSentRegistry();
    registry.push({
      id,
      matchKey: this.matchKey(signal),
      signalKey: this.signalKey(signal),
      match: this.matchLabel(signal),
      market: signal.market,
      selection: signal.selection,
      startsAt: signal.fixture?.startsAt?.toISOString(),
      status: 'approved',
      createdAt: new Date().toISOString()
    });
    await this.saveSentRegistry(registry);
    return id;
  }

  async markSignalSent(signalId?: string): Promise<void> {
    if (!signalId) return;
    const registry = await this.loadSentRegistry();
    const record = registry.find((item) => item.id === signalId);
    if (!record) return;
    record.status = 'sent';
    record.sentAt = new Date().toISOString();
    await this.saveSentRegistry(registry);
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

  async saveShadowPrediction(signal: SignalCandidate, engineStatus: EngineOperationalStatus): Promise<void> {
    const record = {
      id: randomUUID(),
      engineName: signal.engine,
      match: this.matchLabel(signal),
      market: signal.market,
      prediction: signal.selection,
      odds: signal.odds,
      confidence: signal.confidence,
      ev: signal.ev,
      result: null,
      profitLoss: null,
      metadata: {
        sport: signal.sport,
        engineStatus,
        fixtureId: signal.fixture?.id,
        league: signal.fixture?.league,
        startsAt: signal.fixture?.startsAt?.toISOString(),
        probability: signal.probability,
        qualityScore: signal.qualityScore,
        tier: signal.tier,
        riskLevel: signal.riskLevel,
        reason: signal.reason,
        ...(signal.metadata || {})
      }
    };

    if (this.canUseRest()) {
      try {
        await this.rest('ShadowPrediction', {
          method: 'POST',
          body: JSON.stringify(record)
        });
        return;
      } catch (error) {
        this.warn('REST shadow prediction', error);
      }
    }

    try {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO "ShadowPrediction" ("id","engineName","match","market","prediction","odds","confidence","ev","result","profitLoss","metadata")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         ON CONFLICT ("id") DO NOTHING`,
        record.id,
        record.engineName,
        record.match,
        record.market,
        record.prediction,
        record.odds ?? null,
        record.confidence ?? null,
        record.ev ?? null,
        record.result,
        record.profitLoss,
        JSON.stringify(record.metadata)
      );
    } catch (error) {
      this.warn('shadow prediction', error);
    }
  }

  async upsertEngineSettings(settings: Record<string, EngineOperationalStatus>): Promise<void> {
    for (const [engineName, status] of Object.entries(settings)) {
      if (this.canUseRest()) {
        try {
          await this.rest('EngineSetting', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({ engineName, status })
          });
          continue;
        } catch (error) {
          this.warn(`REST engine setting ${engineName}`, error);
        }
      }

      try {
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO "EngineSetting" ("engineName","status")
           VALUES ($1,$2)
           ON CONFLICT ("engineName") DO UPDATE SET "status" = EXCLUDED."status", "updatedAt" = CURRENT_TIMESTAMP`,
          engineName,
          status
        );
      } catch (error) {
        this.warn(`engine setting ${engineName}`, error);
      }
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

  private async hasRecentTelegramLog(signal: SignalCandidate): Promise<boolean> {
    if (!this.canUseRest()) return false;

    try {
      const match = this.matchLabel(signal);
      const market = signal.market;
      const since = new Date(Date.now() - Number(process.env.SIGNAL_DUPLICATE_LOOKBACK_DAYS || 30) * 24 * 60 * 60 * 1000)
        .toISOString();
      const query = new URLSearchParams({
        select: 'message,status,sentAt',
        status: 'eq.sent',
        message: `ilike.*${match}*`,
        sentAt: `gte.${since}`,
        limit: '20'
      });
      const rows = await this.rest<Array<{ message?: string }>>(`TelegramLog?${query.toString()}`);
      return rows.some((row) => {
        const message = row.message || '';
        return message.includes(match) && message.includes(market);
      });
    } catch (error) {
      this.warn('Telegram duplicate lookup', error);
      return false;
    }
  }

  private async loadSentRegistry(): Promise<SentSignalRecord[]> {
    try {
      const rows = JSON.parse(await readFile(this.sentSignalsFile, 'utf8')) as SentSignalRecord[];
      return rows.filter((row) => row && typeof row.id === 'string');
    } catch {
      return [];
    }
  }

  private async saveSentRegistry(records: SentSignalRecord[]): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    const maxRecords = Number(process.env.SENT_SIGNAL_REGISTRY_LIMIT || 1000);
    await writeFile(this.sentSignalsFile, JSON.stringify(records.slice(-maxRecords), null, 2), 'utf8');
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

  private matchKey(signal: SignalCandidate): string {
    const fixture = signal.fixture;
    const raw = fixture?.id || [
      fixture?.homeTeam || '',
      fixture?.awayTeam || '',
      fixture?.startsAt?.toISOString() || '',
      signal.subject || ''
    ].join('|');
    return this.hash(raw.toLowerCase());
  }

  private signalKey(signal: SignalCandidate): string {
    return this.hash([
      this.matchKey(signal),
      signal.market,
      signal.selection
    ].join('|').toLowerCase());
  }

  private matchLabel(signal: SignalCandidate): string {
    if (signal.fixture?.homeTeam && signal.fixture.awayTeam) {
      return `${signal.fixture.homeTeam} vs ${signal.fixture.awayTeam}`;
    }

    return signal.subject || signal.market;
  }

  private isExpiredDuplicate(record: SentSignalRecord): boolean {
    const expiryMs = Number(process.env.SIGNAL_DUPLICATE_LOOKBACK_DAYS || 30) * 24 * 60 * 60 * 1000;
    const sentAt = record.sentAt || record.createdAt;
    return Date.now() - new Date(sentAt).getTime() > expiryMs;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
