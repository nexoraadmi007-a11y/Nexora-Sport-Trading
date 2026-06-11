import type { CompetitionContext, EngineContext, FixtureRef, MarketPrice, Sport } from '@nexora/types';
import { CacheManager, type CacheStats } from './cache-manager';
import { QuotaGuard, type QuotaSnapshot } from './quota-guard';

export interface DataEngineDiagnostics {
  cache: CacheStats;
  quota: QuotaSnapshot;
  fixturesLoaded: number;
  pricesLoaded: number;
  sportKeysScanned: string[];
  errors: string[];
}

interface OddsApiSport {
  key: string;
  group: string;
  title: string;
  active: boolean;
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
  description?: string;
}

interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}

interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsApiBookmaker[];
}

export class DataEngine {
  private readonly cache = new CacheManager();
  private readonly quota = new QuotaGuard();
  private diagnostics: DataEngineDiagnostics | undefined;
  private readonly baseUrl = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';

  async loadContext(): Promise<EngineContext> {
    const errors: string[] = [];
    const sportKeysScanned: string[] = [];
    const key = process.env.ODDS_API_KEY;

    if (!key) {
      this.diagnostics = await this.snapshot(0, 0, sportKeysScanned, ['ODDS_API_KEY missing']);
      return emptyContext();
    }

    const sports = await this.loadSports(key, errors);
    const keys = this.selectSportKeys(sports);
    const fixtureMap = new Map<string, FixtureRef>();
    const prices: MarketPrice[] = [];

    for (const sportKey of keys) {
      sportKeysScanned.push(sportKey);
      const events = await this.loadOdds(key, sportKey, errors);

      for (const event of events) {
        const fixture = toFixture(event);
        fixtureMap.set(fixture.id, fixture);
        prices.push(...toPrices(event));
      }
    }

    this.diagnostics = await this.snapshot(fixtureMap.size, prices.length, sportKeysScanned, errors);

    return {
      fixtures: [...fixtureMap.values()],
      prices,
      playerStats: [],
      now: new Date()
    };
  }

  getDiagnostics(): DataEngineDiagnostics | undefined {
    return this.diagnostics;
  }

  private async loadSports(apiKey: string, errors: string[]): Promise<OddsApiSport[]> {
    const cacheKey = 'odds-api:sports:v1';
    const cached = await this.cache.get<OddsApiSport[]>(cacheKey);
    if (cached) return cached;

    if (!await this.quota.reserveCall('odds-api', 'sports', 'normal')) {
      const stale = await this.cache.getStale<OddsApiSport[]>(cacheKey, 7 * 24 * 60 * 60 * 1000);
      if (stale) return stale;
      errors.push('Odds API sports metadata skipped by quota guard');
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/sports/?apiKey=${encodeURIComponent(apiKey)}`);
      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const sports = await response.json() as OddsApiSport[];
      await this.cache.set(cacheKey, sports, 24 * 60 * 60 * 1000);
      return sports;
    } catch (error) {
      errors.push(`Odds API sports metadata failed: ${messageOf(error)}`);
      return await this.cache.getStale<OddsApiSport[]>(cacheKey, 7 * 24 * 60 * 60 * 1000) || [];
    }
  }

  private async loadOdds(apiKey: string, sportKey: string, errors: string[]): Promise<OddsApiEvent[]> {
    const regions = process.env.ODDS_ADDITIONAL_MARKET_REGIONS || process.env.ODDS_API_REGIONS || 'uk';
    const markets: string = sportKey === 'basketball_nba'
      ? 'h2h,spreads,totals,player_points,player_rebounds,player_assists,player_threes,team_totals'
      : 'h2h,totals,btts,double_chance';
    const cacheKey = `odds-api:odds:${sportKey}:${regions}:${markets}:v2`;
    const cached = await this.cache.get<OddsApiEvent[]>(cacheKey);
    if (cached) return cached;

    if (!await this.quota.reserveCall('odds-api', `odds:${sportKey}`, 'normal')) {
      const stale = await this.cache.getStale<OddsApiEvent[]>(cacheKey, 4 * 60 * 60 * 1000);
      if (stale) return stale;
      errors.push(`Odds API odds skipped by quota guard for ${sportKey}`);
      return [];
    }

    const url = new URL(`${this.baseUrl}/sports/${sportKey}/odds/`);
    url.searchParams.set('apiKey', apiKey);
    url.searchParams.set('regions', regions);
    url.searchParams.set('markets', markets);
    url.searchParams.set('oddsFormat', 'decimal');
    url.searchParams.set('dateFormat', 'iso');

    try {
      let response = await fetch(url);
      if (!response.ok && markets !== 'h2h,totals') {
        errors.push(`Extended markets unavailable for ${sportKey}; retrying core markets`);
        url.searchParams.set('markets', 'h2h,totals');
        response = await fetch(url);
      }

      if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      const events = await response.json() as OddsApiEvent[];
      await this.cache.set(cacheKey, events, oddsTtlMs(events));
      return events;
    } catch (error) {
      errors.push(`Odds API odds failed for ${sportKey}: ${messageOf(error)}`);
      return await this.cache.getStale<OddsApiEvent[]>(cacheKey, 4 * 60 * 60 * 1000) || [];
    }
  }

  private selectSportKeys(sports: OddsApiSport[]): string[] {
    const configuredFootball = splitEnv('FOOTBALL_SPORT_KEYS');
    const configuredNba = splitEnv('NBA_SPORT_KEYS');
    const active = sports.filter((sport) => sport.active && !isOutrightSport(sport.key, sport.title));
    const discoveredFootball = active
      .filter((sport) => sport.group.toLowerCase() === 'soccer')
      .filter((sport) => isSupportedFootballCompetition(sport.key, sport.title))
      .map((sport) => sport.key);
    const discoveredNba = active
      .filter((sport) => sport.key === 'basketball_nba')
      .map((sport) => sport.key);

    return unique([
      ...configuredFootball,
      ...discoveredFootball,
      ...configuredNba,
      ...discoveredNba,
      'basketball_nba'
    ]).slice(0, Number(process.env.MAX_SPORT_KEYS_PER_SCAN || 18));
  }

  private async snapshot(
    fixturesLoaded: number,
    pricesLoaded: number,
    sportKeysScanned: string[],
    errors: string[]
  ): Promise<DataEngineDiagnostics> {
    return {
      cache: this.cache.snapshot(),
      quota: await this.quota.snapshot(),
      fixturesLoaded,
      pricesLoaded,
      sportKeysScanned,
      errors
    };
  }
}

export { CacheManager, QuotaGuard };

function emptyContext(): EngineContext {
  return {
    fixtures: [],
    prices: [],
    playerStats: [],
    now: new Date()
  };
}

function toFixture(event: OddsApiEvent): FixtureRef {
  const sport = event.sport_key === 'basketball_nba' ? 'nba' : 'football';
  return {
    id: event.id,
    sport,
    sportKey: event.sport_key,
    league: event.sport_title,
    country: inferCountry(event.sport_key, event.sport_title, sport),
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startsAt: new Date(event.commence_time),
    competition: sport === 'football' ? classifyFootballCompetition(event.sport_key, event.sport_title) : undefined
  };
}

function toPrices(event: OddsApiEvent): MarketPrice[] {
  const prices: MarketPrice[] = [];
  const sport = event.sport_key === 'basketball_nba' ? 'nba' : 'football';

  for (const bookmaker of event.bookmakers || []) {
    for (const market of bookmaker.markets || []) {
      for (const outcome of market.outcomes || []) {
        if (!Number.isFinite(outcome.price) || outcome.price <= 1) continue;
        const normalized = normalizeMarket(sport, market.key, outcome);
        if (!normalized) continue;

        prices.push({
          fixtureId: event.id,
          market: normalized.market,
          selection: normalized.selection,
          bookmaker: bookmaker.title || bookmaker.key,
          odds: outcome.price,
          point: outcome.point,
          sourceMarketKey: market.key,
          description: outcome.description,
          capturedAt: new Date()
        });
      }
    }
  }

  return prices;
}

function normalizeMarket(
  sport: Sport,
  key: string,
  outcome: OddsApiOutcome
): { market: string; selection: string } | undefined {
  const point = typeof outcome.point === 'number' ? formatPoint(outcome.point) : undefined;
  const name = outcome.name.trim();
  const description = outcome.description?.trim();

  if (sport === 'football') {
    if (key === 'totals' && point) {
      return {
        market: `${name} ${point} Goals`,
        selection: `${name} ${point}`
      };
    }

    if (key === 'btts') {
      return {
        market: 'BTTS',
        selection: name
      };
    }

    if (key === 'double_chance') {
      return {
        market: 'Double Chance',
        selection: name
      };
    }

    if (key === 'h2h') {
      return {
        market: 'Match Result',
        selection: name
      };
    }
  }

  if (sport === 'nba') {
    if (key === 'totals' && point) {
      return {
        market: 'Game Total',
        selection: `${name} ${point} Points`
      };
    }

    if (key === 'team_totals' && point) {
      return {
        market: 'Team Total',
        selection: `${description || name} ${name} ${point} Points`
      };
    }

    if (key.includes('1st_half') || key.includes('first_half')) {
      return {
        market: 'First Half Total',
        selection: point ? `${name} ${point} Points` : name
      };
    }

    if (key.startsWith('player_') && point) {
      return {
        market: playerMarketName(key),
        selection: `${description || name} ${name} ${point}`
      };
    }
  }

  return undefined;
}

function playerMarketName(key: string): string {
  if (key.includes('rebounds')) return 'Player Rebounds';
  if (key.includes('assists')) return 'Player Assists';
  if (key.includes('threes')) return 'Player 3PM';
  return 'Player Points';
}

function oddsTtlMs(events: OddsApiEvent[]): number {
  const soonest = events
    .map((event) => new Date(event.commence_time).getTime() - Date.now())
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b)[0];

  if (!soonest) return 60 * 60 * 1000;
  if (soonest <= 6 * 60 * 60 * 1000) return 30 * 60 * 1000;
  if (soonest <= 12 * 60 * 60 * 1000) return 2 * 60 * 60 * 1000;
  return 4 * 60 * 60 * 1000;
}

function classifyFootballCompetition(key: string, title: string): CompetitionContext {
  const text = `${key} ${title}`.toLowerCase();

  if (/(world cup|euro|copa america|afcon|africa cup|asian cup|gold cup)/.test(text)) {
    return {
      kind: 'international_tournament',
      priorityTier: text.includes('world cup') ? 'world_cup'
        : text.includes('euro') ? 'euro'
          : text.includes('copa america') ? 'copa_america'
            : text.includes('afcon') || text.includes('africa cup') ? 'afcon'
              : 'other',
      tournamentMode: true,
      priorityScore: 78
    };
  }

  if (/(qualif|qualification)/.test(text)) {
    return { kind: 'qualification', priorityTier: 'qualification', tournamentMode: false, priorityScore: 64 };
  }

  if (/nations league/.test(text)) {
    return { kind: 'international_tournament', priorityTier: 'nations_league', tournamentMode: false, priorityScore: 58 };
  }

  if (/friendly|friendlies/.test(text)) {
    return { kind: 'friendly', priorityTier: 'friendly', tournamentMode: false, priorityScore: 40 };
  }

  if (/(champions league|europa league|conference league)/.test(text)) {
    return { kind: 'club', priorityTier: 'uefa_club', tournamentMode: false, priorityScore: 82 };
  }

  if (/(premier league|la liga|bundesliga|serie a|ligue 1|saudi)/.test(text)) {
    return { kind: 'club', priorityTier: 'tier_1_club', tournamentMode: false, priorityScore: 90 };
  }

  return { kind: 'club', priorityTier: 'other', tournamentMode: false, priorityScore: 52 };
}

function isSupportedFootballCompetition(key: string, title: string): boolean {
  const text = `${key} ${title}`.toLowerCase();
  return /(premier league|epl|la liga|bundesliga|serie a|ligue|saudi|champions league|europa league|conference league|eredivisie|primeira|belgian|turkish|world cup|qualification|qualif|euro|nations league|copa america|afcon|africa cup|gold cup|asian cup|friendly)/.test(text);
}

function isOutrightSport(key: string, title: string): boolean {
  const text = `${key} ${title}`.toLowerCase();
  return /winner|championship winner|outright|tournament winner/.test(text);
}

function inferCountry(key: string, title: string, sport: Sport): string | undefined {
  if (sport === 'nba') return 'USA';
  const text = `${key} ${title}`.toLowerCase();
  if (/england|epl|premier league/.test(text)) return 'England';
  if (/spain|la liga/.test(text)) return 'Spain';
  if (/germany|bundesliga/.test(text)) return 'Germany';
  if (/italy|serie a/.test(text)) return 'Italy';
  if (/france|ligue/.test(text)) return 'France';
  if (/saudi/.test(text)) return 'Saudi Arabia';
  if (/netherlands|eredivisie/.test(text)) return 'Netherlands';
  if (/portugal|primeira/.test(text)) return 'Portugal';
  if (/belg/.test(text)) return 'Belgium';
  if (/turkey|turkish/.test(text)) return 'Turkey';
  if (/world cup|copa america|afcon|euro|nations league|friendly/.test(text)) return 'International';
  return undefined;
}

function splitEnv(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatPoint(point: number): string {
  return Number.isInteger(point) ? point.toFixed(0) : point.toFixed(1);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
