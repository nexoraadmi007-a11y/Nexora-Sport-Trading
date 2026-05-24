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
  async loadContext(): Promise<EngineContext> {
    const eventsBySport = await Promise.all(mlbSportKeys().map((sportKey) => this.fetchOdds(sportKey)));
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

    const markets = process.env.MLB_ODDS_MARKETS || 'h2h,spreads,totals,team_totals,totals_1st_5_innings,pitcher_strikeouts,pitcher_hits_allowed,pitcher_earned_runs';
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
  if (marketKey === 'totals') return `Game Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'team_totals') return `Team Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'totals_1st_5_innings') return `First 5 Total ${side} ${point ?? ''}`.trim();
  if (marketKey === 'spreads') return `Run Line ${side} ${point ?? ''}`.trim();
  if (marketKey.startsWith('pitcher_')) return `${marketKey} ${side} ${point ?? ''}`.trim();
  if (marketKey === 'h2h') return 'Moneyline';
  return marketKey;
}
