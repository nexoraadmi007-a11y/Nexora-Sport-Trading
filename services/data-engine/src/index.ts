import type { EngineContext } from '@nexora/types';
import { CacheManager, type CacheStats } from './cache-manager';
import { QuotaGuard, type QuotaSnapshot } from './quota-guard';

export interface DataEngineDiagnostics {
  cache: CacheStats;
  quota: QuotaSnapshot;
}

export class DataEngine {
  private readonly cache = new CacheManager();
  private readonly quota = new QuotaGuard();
  private diagnostics: DataEngineDiagnostics | undefined;

  async loadContext(): Promise<EngineContext> {
    // TODO: Rebuild data ingestion and normalization for the next NEXORA architecture.
    this.diagnostics = {
      cache: this.cache.snapshot(),
      quota: await this.quota.snapshot()
    };

    return {
      fixtures: [],
      prices: [],
      playerStats: [],
      now: new Date()
    };
  }

  getDiagnostics(): DataEngineDiagnostics | undefined {
    return this.diagnostics;
  }
}

export { CacheManager, QuotaGuard };
