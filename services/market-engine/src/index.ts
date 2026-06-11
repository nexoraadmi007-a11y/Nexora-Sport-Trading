export interface MarketSnapshot {
  source: string;
  capturedAt: Date;
  payload: unknown;
}

export class MarketEngineService {
  async normalizeSnapshot(_snapshot: MarketSnapshot): Promise<unknown[]> {
    // TODO: Rebuild market normalization for the next NEXORA architecture.
    return [];
  }
}
