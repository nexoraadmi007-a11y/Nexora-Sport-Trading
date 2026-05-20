import type { MarketPrice } from '@nexora/types';

export class MarketEngineService {
  findComparablePrices(prices: MarketPrice[], market: string): MarketPrice[] {
    return prices.filter((price) => price.market === market);
  }
}
