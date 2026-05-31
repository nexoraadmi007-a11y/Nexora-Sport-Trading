import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    key?: string;
    title: string;
    markets?: Array<{
      key: string;
      outcomes?: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

export class MlbDataEngine {
  async loadContext(): Promise<EngineContext> {
    const baseEvents = await this.fetchSportOdds();
    const limit = Number(process.env.MLB_FIRST5_EVENT_LIMIT || 16);
    const enriched = await Promise.all(baseEvents.slice(0, limit).map((event) => this.fetchFirst5Odds(event)));

    return {
      fixtures: enriched.map(toFixture),
      prices: enriched.flatMap(toMarketPrices),
      playerStats: [],
      now: new Date()
    };
  }

  private async fetchSportOdds(): Promise<OddsApiEvent[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    const sportKey = process.env.MLB_SPORT_KEY || 'baseball_mlb';
    const source = oddsSourceParams(process.env.MLB_ODDS_REGIONS || 'us,eu');
    const params = new URLSearchParams({
      apiKey,
      ...source.params,
      markets: 'h2h',
      oddsFormat: 'decimal',
      dateFormat: 'iso'
    });

    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds?${params}`);
      if (!response.ok) {
        console.warn(`[mlb-first5-data] Odds API rejected ${sportKey}: ${response.status} ${await response.text()}`);
        return [];
      }
      return await response.json() as OddsApiEvent[];
    } catch (error) {
      console.warn(`[mlb-first5-data] Odds API unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async fetchFirst5Odds(event: OddsApiEvent): Promise<OddsApiEvent> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return event;

    const source = oddsSourceParams(process.env.MLB_ODDS_REGIONS || 'us,eu');
    const params = new URLSearchParams({
      apiKey,
      ...source.params,
      markets: 'totals_1st_5_innings',
      oddsFormat: 'decimal',
      dateFormat: 'iso'
    });

    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/${event.sport_key}/events/${event.id}/odds?${params}`);
      if (!response.ok) {
        console.warn(`[mlb-first5-data] Odds API rejected ${event.id} first5: ${response.status} ${await response.text()}`);
        return event;
      }
      return mergeBookmakerMarkets(event, await response.json() as OddsApiEvent);
    } catch (error) {
      console.warn(`[mlb-first5-data] Odds API unavailable for event ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
      return event;
    }
  }
}

function mergeBookmakerMarkets(base: OddsApiEvent, additional: OddsApiEvent): OddsApiEvent {
  const bookmakers = new Map<string, NonNullable<OddsApiEvent['bookmakers']>[number]>();
  for (const bookmaker of base.bookmakers || []) {
    bookmakers.set(bookmaker.key || bookmaker.title, { ...bookmaker, markets: [...(bookmaker.markets || [])] });
  }

  for (const bookmaker of additional.bookmakers || []) {
    const key = bookmaker.key || bookmaker.title;
    const existing = bookmakers.get(key);
    if (existing) {
      existing.markets = [...(existing.markets || []), ...(bookmaker.markets || [])];
    } else {
      bookmakers.set(key, { ...bookmaker, markets: [...(bookmaker.markets || [])] });
    }
  }

  return { ...base, bookmakers: [...bookmakers.values()] };
}

function toFixture(event: OddsApiEvent): FixtureRef {
  return {
    id: event.id,
    sport: 'mlb',
    league: event.sport_title,
    country: 'USA',
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startsAt: new Date(event.commence_time)
  };
}

function toMarketPrices(event: OddsApiEvent): MarketPrice[] {
  const prices: MarketPrice[] = [];

  for (const bookmaker of event.bookmakers || []) {
    if (!isPreferredBookmaker(bookmaker.title)) continue;
    for (const market of bookmaker.markets || []) {
      if (market.key !== 'totals_1st_5_innings') continue;
      for (const outcome of market.outcomes || []) {
        if (outcome.point === undefined) continue;
        prices.push({
          fixtureId: event.id,
          market: `First 5 Innings ${outcome.name} ${outcome.point}`,
          selection: `${outcome.name} ${outcome.point}`,
          bookmaker: bookmaker.title,
          odds: outcome.price,
          capturedAt: new Date()
        });
      }
    }
  }

  return prices;
}

function isPreferredBookmaker(bookmaker: string): boolean {
  const preferred = (process.env.PREFERRED_BOOKMAKERS || '1xBet')
    .split(',')
    .map(normalizeBookmaker)
    .filter(Boolean);
  const normalized = normalizeBookmaker(bookmaker);
  return preferred.length === 0 || preferred.some((item) => normalized.includes(item));
}

function oddsSourceParams(defaultRegions: string): { params: Record<string, string> } {
  const bookmakerKeys = (process.env.PREFERRED_BOOKMAKER_KEYS || process.env.ODDS_API_BOOKMAKERS || 'onexbet').trim();
  if (bookmakerKeys && bookmakerKeys.toLowerCase() !== 'none') {
    return { params: { bookmakers: bookmakerKeys } };
  }

  return { params: { regions: defaultRegions } };
}

function normalizeBookmaker(bookmaker: string): string {
  return bookmaker.toLowerCase().replace(/[^a-z0-9]/g, '');
}
