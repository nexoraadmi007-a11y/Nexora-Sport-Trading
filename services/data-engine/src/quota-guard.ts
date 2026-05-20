import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type ApiProvider = 'odds-api' | 'sportsdataio';
type CallPriority = 'high' | 'normal' | 'low';

interface QuotaState {
  day: string;
  hour: string;
  daily: Record<string, number>;
  hourly: Record<string, number>;
  endpoints: Record<string, number>;
}

export interface QuotaSnapshot {
  daily: Record<string, number>;
  hourly: Record<string, number>;
  endpoints: Record<string, number>;
  skipped: number;
}

export class QuotaGuard {
  private readonly dir = process.env.NEXORA_CACHE_DIR || join(process.cwd(), '.nexora-cache');
  private readonly file = join(this.dir, 'api-quota.json');
  private skipped = 0;
  private queue = Promise.resolve();

  async canCall(provider: ApiProvider, endpoint: string, priority: CallPriority = 'normal'): Promise<boolean> {
    const state = await this.load();
    return this.canCallFromState(state, provider, endpoint, priority);
  }

  async reserveCall(provider: ApiProvider, endpoint: string, priority: CallPriority = 'normal'): Promise<boolean> {
    let reserved = false;
    this.queue = this.queue.then(async () => {
      const state = await this.load();
      if (!this.canCallFromState(state, provider, endpoint, priority)) {
        this.skipped += 1;
        reserved = false;
        return;
      }

      state.daily[provider] = (state.daily[provider] || 0) + 1;
      state.hourly[provider] = (state.hourly[provider] || 0) + 1;
      const endpointKey = `${provider}:${endpoint}`;
      state.endpoints[endpointKey] = (state.endpoints[endpointKey] || 0) + 1;
      await this.save(state);
      reserved = true;
    });

    await this.queue;
    return reserved;
  }

  async recordCall(provider: ApiProvider, endpoint: string): Promise<void> {
    const state = await this.load();
    state.daily[provider] = (state.daily[provider] || 0) + 1;
    state.hourly[provider] = (state.hourly[provider] || 0) + 1;
    const endpointKey = `${provider}:${endpoint}`;
    state.endpoints[endpointKey] = (state.endpoints[endpointKey] || 0) + 1;
    await this.save(state);
  }

  async snapshot(): Promise<QuotaSnapshot> {
    const state = await this.load();
    return {
      daily: state.daily,
      hourly: state.hourly,
      endpoints: state.endpoints,
      skipped: this.skipped
    };
  }

  private dailyLimit(provider: ApiProvider): number {
    const globalLimit = Number(process.env.API_DAILY_CALL_LIMIT || 250);
    if (provider === 'odds-api') return Number(process.env.ODDS_API_DAILY_CALL_LIMIT || Math.floor(globalLimit * 0.82));
    return Number(process.env.SPORTSDATAIO_DAILY_CALL_LIMIT || Math.floor(globalLimit * 0.18));
  }

  private hourlyLimit(provider: ApiProvider): number {
    const globalLimit = Number(process.env.API_HOURLY_CALL_LIMIT || 35);
    if (provider === 'odds-api') return Number(process.env.ODDS_API_HOURLY_CALL_LIMIT || Math.floor(globalLimit * 0.82));
    return Number(process.env.SPORTSDATAIO_HOURLY_CALL_LIMIT || Math.max(1, Math.floor(globalLimit * 0.18)));
  }

  private canCallFromState(state: QuotaState, provider: ApiProvider, endpoint: string, priority: CallPriority): boolean {
    const dailyLimit = this.dailyLimit(provider);
    const hourlyLimit = this.hourlyLimit(provider);
    const dailyUsed = state.daily[provider] || 0;
    const hourlyUsed = state.hourly[provider] || 0;

    if (!endpoint) return false;
    if (dailyUsed >= dailyLimit || hourlyUsed >= hourlyLimit) return false;
    if (priority === 'low' && dailyUsed >= Math.floor(dailyLimit * 0.75)) return false;
    if (priority === 'normal' && dailyUsed >= Math.floor(dailyLimit * 0.9)) return false;
    return true;
  }

  private async load(): Promise<QuotaState> {
    const now = new Date();
    const current = {
      day: now.toISOString().slice(0, 10),
      hour: now.toISOString().slice(0, 13)
    };

    try {
      const state = JSON.parse(await readFile(this.file, 'utf8')) as QuotaState;
      return {
        day: current.day,
        hour: current.hour,
        daily: state.day === current.day ? state.daily : {},
        hourly: state.hour === current.hour ? state.hourly : {},
        endpoints: state.day === current.day ? state.endpoints : {}
      };
    } catch {
      return {
        day: current.day,
        hour: current.hour,
        daily: {},
        hourly: {},
        endpoints: {}
      };
    }
  }

  private async save(state: QuotaState): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.file, JSON.stringify(state, null, 2), 'utf8');
  }
}
