import type { EngineContext } from '@nexora/types';

export class TennisDataEngine {
  async loadContext(): Promise<EngineContext> {
    // TODO: Rebuild tennis data ingestion after the new architecture is defined.
    return emptyContext();
  }
}

function emptyContext(): EngineContext {
  return {
    fixtures: [],
    prices: [],
    playerStats: [],
    now: new Date()
  };
}
