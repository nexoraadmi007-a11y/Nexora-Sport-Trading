import type { EngineContext } from '@nexora/types';

export class MlbDataEngine {
  async loadContext(): Promise<EngineContext> {
    // TODO: Rebuild MLB data ingestion after the new architecture is defined.
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
