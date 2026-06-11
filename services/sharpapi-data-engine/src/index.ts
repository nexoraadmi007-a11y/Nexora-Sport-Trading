import type { EngineContext } from '@nexora/types';

export class SharpApiDataEngine {
  async loadContext(): Promise<EngineContext> {
    // TODO: Rebuild optional SharpAPI ingestion only if the next architecture needs it.
    return {
      fixtures: [],
      prices: [],
      playerStats: [],
      now: new Date()
    };
  }
}
