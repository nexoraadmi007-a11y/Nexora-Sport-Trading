import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

type SharpRow = Record<string, unknown>;

interface RawMarket {
  eventId: string;
  sport: 'nba' | 'mlb';
  league: string;
  country: string;
  homeTeam: string;
  awayTeam: string;
  startsAt: Date;
  bookmaker: string;
  marketText: string;
  selectionText: string;
  playerName?: string;
  odds: number;
  line?: number;
}

export class SharpApiDataEngine {
  async loadContext(): Promise<EngineContext> {
    if (!process.env.SHARPAPI_API_KEY) return emptyContext();

    const [nbaRows, mlbRows] = await Promise.all([
      this.fetchOdds(process.env.SHARPAPI_NBA_SPORT || 'basketball', process.env.SHARPAPI_NBA_LEAGUE || 'nba', process.env.SHARPAPI_NBA_MARKETS || 'all'),
      this.fetchOdds(process.env.SHARPAPI_MLB_SPORT || 'baseball', process.env.SHARPAPI_MLB_LEAGUE || 'mlb', process.env.SHARPAPI_MLB_MARKETS || 'all')
    ]);

    const rawMarkets = [
      ...flattenRows(nbaRows).map((row) => toRawMarket(row, 'nba')).filter((row): row is RawMarket => Boolean(row)),
      ...flattenRows(mlbRows).map((row) => toRawMarket(row, 'mlb')).filter((row): row is RawMarket => Boolean(row))
    ];

    const fixtures = uniqueFixtures(rawMarkets);
    const prices = rawMarkets.flatMap(toMarketPrice).filter((price): price is MarketPrice => Boolean(price));

    return {
      fixtures,
      prices,
      playerStats: [],
      now: new Date()
    };
  }

  private async fetchOdds(sport: string, league: string, markets: string): Promise<unknown> {
    const params = new URLSearchParams({
      sport,
      league,
      sportsbooks: process.env.SHARPAPI_SPORTSBOOKS || 'onexbet',
      limit: process.env.SHARPAPI_LIMIT || '200'
    });

    if (markets && markets.toLowerCase() !== 'all') {
      params.set('markets', markets);
    }

    try {
      const response = await fetchWithTimeout(`${sharpApiBaseUrl()}/odds?${params}`, {
        headers: {
          'X-API-Key': process.env.SHARPAPI_API_KEY || '',
          Authorization: `Bearer ${process.env.SHARPAPI_API_KEY || ''}`
        }
      });

      if (!response.ok) {
        console.warn(`[sharpapi-data] odds rejected for ${sport}/${league}: ${response.status} ${await response.text()}`);
        return [];
      }

      return await response.json();
    } catch (error) {
      console.warn(`[sharpapi-data] odds unavailable for ${sport}/${league}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
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

function sharpApiBaseUrl(): string {
  return (process.env.SHARPAPI_BASE_URL || 'https://api.sharpapi.io/api/v1').replace(/\/$/, '');
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const timeoutMs = Number(process.env.SHARPAPI_TIMEOUT_MS || 12_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function flattenRows(payload: unknown): SharpRow[] {
  if (Array.isArray(payload)) return payload.filter(isObject);
  if (!isObject(payload)) return [];

  for (const key of ['data', 'odds', 'events', 'results', 'markets']) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }

  return [];
}

function isObject(value: unknown): value is SharpRow {
  return typeof value === 'object' && value !== null;
}

function toRawMarket(row: SharpRow, sport: 'nba' | 'mlb'): RawMarket | undefined {
  const homeTeam = stringValue(row, ['home_team', 'homeTeam', 'home', 'home_name']);
  const awayTeam = stringValue(row, ['away_team', 'awayTeam', 'away', 'away_name']);
  const eventName = stringValue(row, ['event_name', 'name', 'match', 'game']);
  const parsedTeams = parseTeams(eventName);
  const odds = oddsValue(row);

  if (!odds) return undefined;

  const marketText = [
    stringValue(row, ['market_key', 'market_type', 'market', 'market_name', 'bet_type', 'name']),
    stringValue(row, ['period', 'period_type', 'betting_period']),
    stringValue(row, ['stat_type', 'prop_type'])
  ].filter(Boolean).join(' ');

  const selectionText = [
    stringValue(row, ['selection', 'outcome', 'side', 'label']),
    stringValue(row, ['participant', 'team', 'player_name', 'player'])
  ].filter(Boolean).join(' ');

  return {
    eventId: String(row.event_id || row.eventId || row.game_id || row.id || `${sport}:${eventName || `${homeTeam}-${awayTeam}`}:${stringValue(row, ['commence_time', 'start_time', 'starts_at'])}`),
    sport,
    league: stringValue(row, ['league', 'sport_title', 'competition']) || (sport === 'nba' ? 'NBA' : 'MLB'),
    country: stringValue(row, ['country']) || 'USA',
    homeTeam: homeTeam || parsedTeams.homeTeam || 'Home Team',
    awayTeam: awayTeam || parsedTeams.awayTeam || 'Away Team',
    startsAt: dateValue(row, ['commence_time', 'start_time', 'starts_at', 'startTime', 'game_time']),
    bookmaker: stringValue(row, ['sportsbook', 'bookmaker', 'book', 'sportsbook_name']) || 'SharpAPI',
    marketText,
    selectionText,
    playerName: stringValue(row, ['player_name', 'player', 'participant']),
    odds,
    line: numberValue(row, ['line', 'point', 'points', 'total', 'handicap'])
  };
}

function toMarketPrice(raw: RawMarket): MarketPrice | undefined {
  const market = raw.sport === 'nba' ? normalizeNbaMarket(raw) : normalizeMlbMarket(raw);
  if (!market) return undefined;

  return {
    fixtureId: raw.eventId,
    market: market.market,
    selection: market.selection,
    bookmaker: raw.bookmaker,
    odds: raw.odds,
    capturedAt: new Date()
  };
}

function normalizeNbaMarket(raw: RawMarket): { market: string; selection: string } | undefined {
  const text = normalizeText(`${raw.marketText} ${raw.selectionText}`);
  const side = sideFromText(text);
  if (!side || raw.line === undefined) return undefined;

  if (text.includes('first half') || text.includes('1st half') || text.includes('h1')) {
    return { market: `${side} ${raw.line} H1`, selection: `${side} ${raw.line}` };
  }

  if (text.includes('team total') || text.includes('team_total') || text.includes('team totals')) {
    const team = raw.selectionText.replace(/\b(over|under)\b/ig, '').trim() || raw.homeTeam;
    return { market: `Team Total ${team} ${side} ${raw.line}`, selection: team };
  }

  if (text.includes('player') || text.includes('points') || text.includes('rebounds') || text.includes('assists') || text.includes('threes') || text.includes('3pt')) {
    const prop = propKeyFromText(text);
    const player = raw.playerName || raw.selectionText.replace(/\b(over|under)\b/ig, '').trim();
    if (!player) return undefined;
    return { market: `${prop} ${side} ${raw.line}`, selection: player };
  }

  if (text.includes('total')) {
    return { market: `${side} ${raw.line}`, selection: side };
  }

  return undefined;
}

function normalizeMlbMarket(raw: RawMarket): { market: string; selection: string } | undefined {
  const text = normalizeText(`${raw.marketText} ${raw.selectionText}`);
  const side = sideFromText(text);
  if (!side || raw.line === undefined) return undefined;
  if (!(text.includes('first 5') || text.includes('first five') || text.includes('1st 5') || text.includes('f5'))) return undefined;
  return { market: `First 5 Innings ${side} ${raw.line}`, selection: `${side} ${raw.line}` };
}

function propKeyFromText(text: string): string {
  if (text.includes('rebound')) return 'player_rebounds';
  if (text.includes('assist')) return 'player_assists';
  if (text.includes('three') || text.includes('3pt') || text.includes('3pm')) return 'player_threes';
  return 'player_points';
}

function sideFromText(text: string): 'Over' | 'Under' | undefined {
  if (/\bover\b/.test(text)) return 'Over';
  if (/\bunder\b/.test(text)) return 'Under';
  return undefined;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[_-]/g, ' ');
}

function uniqueFixtures(markets: RawMarket[]): FixtureRef[] {
  const fixtures = new Map<string, FixtureRef>();
  for (const market of markets) {
    if (fixtures.has(market.eventId)) continue;
    fixtures.set(market.eventId, {
      id: market.eventId,
      sport: market.sport,
      league: market.league,
      country: market.country,
      homeTeam: market.homeTeam,
      awayTeam: market.awayTeam,
      startsAt: market.startsAt
    });
  }
  return [...fixtures.values()];
}

function parseTeams(eventName: string | undefined): { homeTeam?: string; awayTeam?: string } {
  if (!eventName) return {};
  const parts = eventName.split(/\s+vs\.?\s+|\s+v\s+|\s+@\s+/i).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  return { awayTeam: parts[0], homeTeam: parts[1] };
}

function stringValue(row: SharpRow, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function numberValue(row: SharpRow, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = row[key];
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function oddsValue(row: SharpRow): number | undefined {
  const decimal = numberValue(row, ['odds_decimal', 'decimal_odds', 'price', 'odds']);
  if (decimal && decimal > 1) return decimal;

  const american = numberValue(row, ['american_odds', 'moneyline']);
  if (!american) return undefined;
  return american > 0 ? 1 + (american / 100) : 1 + (100 / Math.abs(american));
}

function dateValue(row: SharpRow, keys: string[]): Date {
  const value = stringValue(row, keys);
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date : new Date();
}
