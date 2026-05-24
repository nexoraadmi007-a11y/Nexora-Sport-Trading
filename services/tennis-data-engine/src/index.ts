import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

const DEFAULT_TENNIS_SPORT_KEYS = ['tennis_atp', 'tennis_wta'];

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

export class TennisDataEngine {
  async loadContext(): Promise<EngineContext> {
    const eventsBySport = await Promise.all(tennisSportKeys().map((sportKey) => this.fetchOdds(sportKey)));
    const events = eventsBySport.flat();

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

    const markets = process.env.TENNIS_ODDS_MARKETS || 'h2h,spreads,totals,h2h_1st_set,totals_1st_set';
    const regions = process.env.TENNIS_ODDS_REGIONS || 'uk,eu,us';

    try {
      const response = await fetchOddsApi(sportKey, apiKey, regions, markets);
      if (!response.ok) {
        console.warn(`[tennis-data] The Odds API failed for ${sportKey}: ${response.status} ${await response.text()}`);
        if (markets !== 'h2h,spreads,totals') {
          const fallback = await fetchOddsApi(sportKey, apiKey, regions, 'h2h,spreads,totals');
          return fallback.ok ? await fallback.json() as OddsApiEvent[] : [];
        }
        return [];
      }
      return await response.json() as OddsApiEvent[];
    } catch (error) {
      console.warn(`[tennis-data] The Odds API unavailable for ${sportKey}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
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

function tennisSportKeys(): string[] {
  const configured = process.env.TENNIS_SPORT_KEYS;
  if (!configured) return DEFAULT_TENNIS_SPORT_KEYS;
  const keys = configured.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? keys : DEFAULT_TENNIS_SPORT_KEYS;
}

function toFixture(event: OddsApiEvent): FixtureRef {
  return {
    id: event.id,
    sport: 'tennis',
    league: event.sport_title,
    country: 'International',
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startsAt: new Date(event.commence_time)
  };
}

function toMarketPrices(event: OddsApiEvent): MarketPrice[] {
  const prices: MarketPrice[] = [];
  for (const bookmaker of event.bookmakers || []) {
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
  if (marketKey === 'totals') return `${side} ${point ?? ''} Games`.trim();
  if (marketKey === 'spreads') return `Game Handicap ${side} ${point ?? ''}`.trim();
  if (marketKey === 'h2h_1st_set') return 'First Set Winner';
  if (marketKey === 'totals_1st_set') return `First Set ${side} ${point ?? ''} Games`.trim();
  if (marketKey === 'h2h') return 'Match Winner';
  return marketKey;
}
