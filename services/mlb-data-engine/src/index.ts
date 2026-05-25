import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

const DEFAULT_MLB_SPORT_KEYS = ['baseball_mlb'];

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
    key: string;
    title: string;
    markets?: Array<{
      key: string;
      outcomes?: Array<{
        name: string;
        description?: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

export class MlbDataEngine {
  private additionalMarketCount = 0;

  async loadContext(): Promise<EngineContext> {
    this.additionalMarketCount = 0;
    const eventsBySport = await Promise.all(mlbSportKeys().map((sportKey) => this.fetchOdds(sportKey)));
    const events = (await Promise.all(eventsBySport.flat().map((event) => this.enrichAdditionalMarkets(event)))).flat();

    return {
      fixtures: events.map(toFixture),
      prices: events.flatMap(toMarketPrices),
      playerStats: [],
      now: new Date()
    };
  }

  private async fetchOdds(sportKey: string): Promise<OddsApiEvent[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    const markets = process.env.MLB_ODDS_MARKETS || 'h2h,spreads,totals';
    const regions = process.env.MLB_ODDS_REGIONS || 'us';

    try {
      const response = await fetchOddsApi(sportKey, apiKey, regions, markets);
      if (!response.ok) {
        console.warn(`[mlb-data] The Odds API failed for ${sportKey}: ${response.status} ${await response.text()}`);
        if (markets !== 'h2h,spreads,totals') {
          const fallback = await fetchOddsApi(sportKey, apiKey, regions, 'h2h,spreads,totals');
          return fallback.ok ? await fallback.json() as OddsApiEvent[] : [];
        }
        return [];
      }
      return await response.json() as OddsApiEvent[];
    } catch (error) {
      console.warn(`[mlb-data] The Odds API unavailable for ${sportKey}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async enrichAdditionalMarkets(event: OddsApiEvent): Promise<OddsApiEvent> {
    if (!isInsideAdditionalMarketWindow(event.commence_time)) return event;
    const limit = Number(process.env.MLB_ADDITIONAL_EVENT_LIMIT || 8);
    if (this.additionalMarketCount >= limit) return event;
    this.additionalMarketCount += 1;

    const markets = process.env.MLB_ADDITIONAL_MARKETS || 'team_totals,totals_1st_5_innings,pitcher_strikeouts,pitcher_hits_allowed,pitcher_earned_runs';
    const regions = process.env.MLB_ODDS_REGIONS || 'us';
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return event;

    try {
      const response = await fetchEventOddsApi(event.sport_key, event.id, apiKey, regions, markets);
      if (!response.ok) {
        console.warn(`[mlb-data] The Odds API failed for event ${event.id} ${markets}: ${response.status} ${await response.text()}`);
        return event;
      }

      return mergeBookmakerMarkets(event, await response.json() as OddsApiEvent);
    } catch (error) {
      console.warn(`[mlb-data] The Odds API unavailable for event ${event.id} ${markets}: ${error instanceof Error ? error.message : String(error)}`);
      return event;
    }
  }
}

function fetchOddsApi(sportKey: string, apiKey: string, regions: string, markets: string): Promise<Response> {
  const params = new URLSearchParams({
    apiKey,
    regions,
    markets,
    oddsFormat: 'decimal',
    dateFormat: 'iso'
  });
  return fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds?${params}`);
}

function fetchEventOddsApi(sportKey: string, eventId: string, apiKey: string, regions: string, markets: string): Promise<Response> {
  const params = new URLSearchParams({
    apiKey,
    regions,
    markets,
    oddsFormat: 'decimal',
    dateFormat: 'iso'
  });
  return fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/events/${eventId}/odds?${params}`);
}

function mlbSportKeys(): string[] {
  const configured = process.env.MLB_SPORT_KEYS;
  if (!configured) return DEFAULT_MLB_SPORT_KEYS;
  const keys = configured.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? keys : DEFAULT_MLB_SPORT_KEYS;
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

function isInsideAdditionalMarketWindow(commenceTime: string): boolean {
  const hours = (new Date(commenceTime).getTime() - Date.now()) / 36e5;
  const windowHours = Number(process.env.MLB_ADDITIONAL_MARKET_WINDOW_HOURS || 36);
  return hours > 0 && hours <= windowHours;
}

function mergeBookmakerMarkets(base: OddsApiEvent, additional: OddsApiEvent): OddsApiEvent {
  const byKey = new Map<string, NonNullable<OddsApiEvent['bookmakers']>[number]>(
    (base.bookmakers || []).map((bookmaker) => [bookmaker.key, { ...bookmaker, markets: [...(bookmaker.markets || [])] }])
  );

  for (const bookmaker of additional.bookmakers || []) {
    const existing = byKey.get(bookmaker.key);
    if (existing) {
      existing.markets = [...(existing.markets || []), ...(bookmaker.markets || [])];
    } else {
      byKey.set(bookmaker.key, { ...bookmaker, markets: [...(bookmaker.markets || [])] });
    }
  }

  return { ...base, bookmakers: [...byKey.values()] };
}

function toMarketPrices(event: OddsApiEvent): MarketPrice[] {
  const prices: MarketPrice[] = [];
  for (const bookmaker of event.bookmakers || []) {
    if (!isPreferredBookmaker(bookmaker.title)) continue;
    for (const market of bookmaker.markets || []) {
      for (const outcome of market.outcomes || []) {
        prices.push({
          fixtureId: event.id,
          market: normalizeMarket(market.key, outcome),
          selection: outcome.description || outcome.name,
          bookmaker: bookmaker.title,
          odds: outcome.price,
          capturedAt: new Date()
        });
      }
    }
  }
  return prices;
}

function normalizeMarket(marketKey: string, outcome: { name: string; point?: number }): string {
  const side = outcome.name;
  const point = outcome.point;
  if (marketKey === 'totals') return `Game Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'team_totals') return `Team Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'totals_1st_5_innings') return `First 5 Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'spreads') return `Run Line ${side} ${point ?? ''}`.trim();
  if (marketKey.startsWith('pitcher_')) return `${marketKey} ${side} ${point ?? ''}`.trim();
  if (marketKey === 'h2h') return 'Moneyline';
  return marketKey;
}

function isPreferredBookmaker(bookmaker: string): boolean {
  const preferred = (process.env.PREFERRED_BOOKMAKERS || '1xBet')
    .split(',')
    .map(normalizeBookmaker)
    .filter(Boolean);
  const normalized = normalizeBookmaker(bookmaker);
  return preferred.length === 0 || preferred.some((item) => normalized.includes(item));
}

function normalizeBookmaker(bookmaker: string): string {
  return bookmaker.toLowerCase().replace(/[^a-z0-9]/g, '');
}
