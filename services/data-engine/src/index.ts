import type { EngineContext, FixtureRef, MarketPrice, PlayerStatRef } from '@nexora/types';
import { CacheManager, type CacheStats } from './cache-manager';
import { QuotaGuard, type QuotaSnapshot } from './quota-guard';

const DEFAULT_FOOTBALL_SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_saudi_arabia_pro_league',
  'soccer_brazil_campeonato',
  'soccer_brazil_serie_b',
  'soccer_chile_campeonato',
  'soccer_china_superleague',
  'soccer_conmebol_copa_libertadores',
  'soccer_conmebol_copa_sudamericana',
  'soccer_finland_veikkausliiga',
  'soccer_norway_eliteserien',
  'soccer_sweden_allsvenskan',
  'soccer_sweden_superettan',
  'soccer_spain_segunda_division'
];

const DEFAULT_NBA_SPORT_KEYS = ['basketball_nba'];

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

interface DataEngineDiagnostics {
  cache: CacheStats;
  quota: QuotaSnapshot;
}

export class DataEngine {
  private readonly cache = new CacheManager();
  private readonly quota = new QuotaGuard();
  private readonly additionalMarketCounts = new Map<string, number>();
  private readonly additionalMarketSeen = new Map<string, Set<string>>();
  private diagnostics: DataEngineDiagnostics | undefined;

  async loadContext(): Promise<EngineContext> {
    this.additionalMarketCounts.clear();
    this.additionalMarketSeen.clear();
    const eventsBySport = await Promise.all([...footballSportKeys(), ...nbaSportKeys()].map((sportKey) => this.fetchOdds(sportKey)));
    const events = (await Promise.all(eventsBySport.flat().map((event) => this.enrichAdditionalMarkets(event)))).flat();
    const playerStats = isEnabled('ENABLE_NBA_PLAYER_PROPS') ? await this.fetchRecentNbaPlayerStats() : [];
    this.diagnostics = {
      cache: this.cache.snapshot(),
      quota: await this.quota.snapshot()
    };

    return {
      fixtures: events.map(toFixture),
      prices: events.flatMap(toMarketPrices),
      playerStats,
      now: new Date()
    };
  }

  getDiagnostics(): DataEngineDiagnostics | undefined {
    return this.diagnostics;
  }

  private async fetchOdds(sportKey: string): Promise<OddsApiEvent[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) throw new Error('ODDS_API_KEY missing');

    const markets = sportKey === 'basketball_nba' ? 'h2h,totals' : 'h2h,totals';
    const source = oddsSourceParams('uk,eu,us');
    const params = new URLSearchParams({
      apiKey,
      ...source.params,
      markets,
      oddsFormat: 'decimal',
      dateFormat: 'iso'
    });

    const cacheKey = `odds-api:sport:${sportKey}:${source.cacheKey}:markets:${markets}`;
    const cached = await this.cache.get<OddsApiEvent[]>(cacheKey);
    if (cached) return cached;

    const endpoint = `sports/${sportKey}/odds`;
    const priority = sportKey === 'basketball_nba' ? 'high' : 'normal';
    if (!await this.quota.reserveCall('odds-api', endpoint, priority)) {
      const stale = await this.cache.getStale<OddsApiEvent[]>(cacheKey, hours(24));
      if (stale) return stale;
      console.warn(`Quota guard skipped ${endpoint}; no usable cache available`);
      return [];
    }

    try {
      const response = await fetchWithRetry(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds?${params}`);
      if (!response.ok) {
        console.warn(`The Odds API failed for ${sportKey}: ${response.status} ${await response.text()}`);
        const stale = await this.cache.getStale<OddsApiEvent[]>(cacheKey, hours(24));
        return stale || [];
      }

      const events = await response.json() as OddsApiEvent[];
      await this.cache.set(cacheKey, events, oddsRefreshTtlMs(events));
      return events;
    } catch (error) {
      console.warn(`The Odds API unavailable for ${sportKey}: ${error instanceof Error ? error.message : String(error)}`);
      const stale = await this.cache.getStale<OddsApiEvent[]>(cacheKey, hours(24));
      return stale || [];
    }
  }

  private async enrichAdditionalMarkets(event: OddsApiEvent): Promise<OddsApiEvent> {
    if (!isInsideAdditionalMarketWindow(event.commence_time)) return event;
    if (event.sport_key === 'basketball_nba') {
      if (!isEnabled('ENABLE_ODDS_API_NBA_EXTENDED_MARKETS')) return event;
      const withTeamTotals = await this.enrichEventMarkets(event, 'team_totals,alternate_team_totals', 'nbaTeamTotals');
      const withFirstHalf = await this.enrichEventMarkets(withTeamTotals, 'totals_h1', 'nbaFirstHalf');
      return this.enrichEventMarkets(withFirstHalf, 'player_points,player_rebounds,player_assists,player_threes', 'nbaPlayerProps');
    }
    if (!event.sport_key.startsWith('soccer_')) return event;
    return this.enrichEventMarkets(event, 'btts', 'btts');
  }

  private async enrichEventMarkets(event: OddsApiEvent, markets: string, counterKey: string): Promise<OddsApiEvent> {
    if (!this.shouldFetchAdditionalMarket(event.id, counterKey)) return event;

    const regions = additionalMarketRegions(event.sport_key, counterKey);
    const source = oddsSourceParams(regions);
    const cacheKey = `odds-api:event:${event.sport_key}:${event.id}:${source.cacheKey}:markets:${markets}`;
    const cached = await this.cache.get<OddsApiEvent>(cacheKey);
    if (cached) return mergeBookmakerMarkets(event, cached);

    const endpoint = `sports/${event.sport_key}/events/${event.id}/odds:${markets}`;
    const priority = event.sport_key === 'basketball_nba' ? 'high' : 'low';
    if (!await this.quota.reserveCall('odds-api', endpoint, priority)) {
      const stale = await this.cache.getStale<OddsApiEvent>(cacheKey, hours(12));
      return stale ? mergeBookmakerMarkets(event, stale) : event;
    }

    try {
      const params = new URLSearchParams({
        apiKey: process.env.ODDS_API_KEY || '',
        ...source.params,
        markets,
        oddsFormat: 'decimal',
        dateFormat: 'iso'
      });

      const response = await fetchWithRetry(`https://api.the-odds-api.com/v4/sports/${event.sport_key}/events/${event.id}/odds?${params}`);
      if (!response.ok) {
        console.warn(`The Odds API failed for ${event.sport_key} ${markets}: ${response.status} ${await response.text()}`);
        const stale = await this.cache.getStale<OddsApiEvent>(cacheKey, hours(12));
        if (stale) return mergeBookmakerMarkets(event, stale);
        return event;
      }

      const enriched = await response.json() as OddsApiEvent;
      await this.cache.set(cacheKey, enriched, oddsRefreshTtlMs([event]));
      return mergeBookmakerMarkets(event, enriched);
    } catch (error) {
      console.warn(`The Odds API unavailable for ${event.sport_key} ${markets}: ${error instanceof Error ? error.message : String(error)}`);
      const stale = await this.cache.getStale<OddsApiEvent>(cacheKey, hours(12));
      if (stale) return mergeBookmakerMarkets(event, stale);
      return event;
    }
  }

  private async fetchRecentNbaPlayerStats(): Promise<PlayerStatRef[]> {
    const key = process.env.SPORTSDATAIO_NBA_API_KEY;
    if (!key) return [];

    const lookbackDays = Number(process.env.NBA_PLAYER_STATS_LOOKBACK_DAYS || 14);
    for (let offset = 1; offset <= lookbackDays; offset += 1) {
      const date = sportsDataIoDate(new Date(Date.now() - offset * 24 * 60 * 60 * 1000));
      const cacheKey = `sportsdataio:nba:player-stats:${date}`;
      const cached = await this.cache.get<PlayerStatRef[]>(cacheKey);
      if (cached && cached.length > 0) return cached.map(revivePlayerStat);

      const endpoint = `nba/player-game-stats-final/${date}`;
      if (!await this.quota.reserveCall('sportsdataio', endpoint, offset <= 3 ? 'normal' : 'low')) {
        const stale = await this.cache.getStale<PlayerStatRef[]>(cacheKey, hours(168));
        if (stale && stale.length > 0) return stale.map(revivePlayerStat);
        continue;
      }

      try {
        const response = await fetchWithRetry(`https://api.sportsdata.io/v3/nba/stats/json/PlayerGameStatsByDateFinal/${date}`, {
          headers: { 'Ocp-Apim-Subscription-Key': key }
        });
        if (!response.ok) {
          const stale = await this.cache.getStale<PlayerStatRef[]>(cacheKey, hours(168));
          if (stale && stale.length > 0) return stale.map(revivePlayerStat);
          continue;
        }

        const rows = await response.json() as Array<Record<string, unknown>>;
        const stats = rows.map(toPlayerStat).filter((stat): stat is PlayerStatRef => Boolean(stat));
        await this.cache.set(cacheKey, stats, hours(Number(process.env.SPORTSDATAIO_PLAYER_STATS_TTL_HOURS || 18)));
        if (stats.length > 0) return stats;
      } catch {
        const stale = await this.cache.getStale<PlayerStatRef[]>(cacheKey, hours(168));
        if (stale && stale.length > 0) return stale.map(revivePlayerStat);
      }
    }

    return [];
  }

  private shouldFetchAdditionalMarket(eventId: string, namespace: string): boolean {
    const limit = Number(
      namespace === 'nbaFirstHalf'
        ? Math.max(Number(process.env.NBA_H1_EVENT_LIMIT || 0), 6)
        : namespace === 'nbaTeamTotals'
          ? Math.max(Number(process.env.NBA_TEAM_TOTALS_EVENT_LIMIT || 0), 6)
        : namespace === 'nbaPlayerProps'
          ? Math.max(Number(process.env.NBA_PLAYER_PROPS_EVENT_LIMIT || 0), 6)
          : Math.max(Number(process.env.BTTS_EVENT_LIMIT || 0), 6)
    );
    if (!this.additionalMarketSeen.has(namespace)) this.additionalMarketSeen.set(namespace, new Set<string>());
    const seen = this.additionalMarketSeen.get(namespace);
    if (seen?.has(eventId)) return false;
    const current = this.additionalMarketCounts.get(namespace) || 0;
    if (current >= limit) return false;
    seen?.add(eventId);
    this.additionalMarketCounts.set(namespace, current + 1);
    return true;
  }
}

async function fetchWithRetry(url: string, initOrAttempts: RequestInit | number = {}, attempts = 2): Promise<Response> {
  const init = typeof initOrAttempts === 'number' ? {} : initOrAttempts;
  const maxAttempts = typeof initOrAttempts === 'number' ? initOrAttempts : attempts;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await delay(750 * attempt);
    }
  }
  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function hours(value: number): number {
  return value * 60 * 60 * 1000;
}

function oddsRefreshTtlMs(events: OddsApiEvent[]): number {
  const upcomingHours = events
    .map((event) => (new Date(event.commence_time).getTime() - Date.now()) / 36e5)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (upcomingHours.length === 0) return hours(6);

  const nearest = Math.min(...upcomingHours);
  if (nearest <= 6) return minutes(Number(process.env.ODDS_TTL_0_6H_MINUTES || 30));
  if (nearest <= 12) return hours(Number(process.env.ODDS_TTL_6_12H_HOURS || 2));
  return hours(Number(process.env.ODDS_TTL_12H_PLUS_HOURS || 4));
}

function minutes(value: number): number {
  return value * 60 * 1000;
}

function sportsDataIoDate(date: Date): string {
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function toPlayerStat(row: Record<string, unknown>): PlayerStatRef | null {
  const playerId = row.PlayerID ?? row.PlayerId ?? row.playerId;
  const name = row.Name ?? row.PlayerName ?? row.playerName;
  if (!playerId || !name) return null;

  return {
    playerId: String(playerId),
    playerName: String(name),
    team: stringField(row.Team),
    opponent: stringField(row.Opponent),
    gameDate: new Date(String(row.Day || row.DateTime || new Date().toISOString())),
    points: numberField(row.Points),
    rebounds: numberField(row.Rebounds),
    assists: numberField(row.Assists),
    threePointersMade: numberField(row.ThreePointersMade ?? row.ThreePointers),
    minutes: numberField(row.Minutes)
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberField(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function revivePlayerStat(stat: PlayerStatRef): PlayerStatRef {
  return {
    ...stat,
    gameDate: new Date(stat.gameDate)
  };
}

function isInsideAdditionalMarketWindow(commenceTime: string): boolean {
  const hours = (new Date(commenceTime).getTime() - Date.now()) / 36e5;
  const windowHours = Number(process.env.ADDITIONAL_MARKET_WINDOW_HOURS || 36);
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

  return {
    ...base,
    bookmakers: [...byKey.values()]
  };
}

function toFixture(event: OddsApiEvent): FixtureRef {
  const sport = event.sport_key === 'basketball_nba' ? 'nba' : 'football';
  return {
    id: event.id,
    sport,
    league: event.sport_title,
    country: countryFromSportKey(event.sport_key),
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startsAt: new Date(event.commence_time)
  };
}

function countryFromSportKey(sportKey: string): string | undefined {
  const countries: Record<string, string> = {
    basketball_nba: 'USA',
    soccer_epl: 'England',
    soccer_spain_la_liga: 'Spain',
    soccer_italy_serie_a: 'Italy',
    soccer_germany_bundesliga: 'Germany',
    soccer_france_ligue_one: 'France',
    soccer_saudi_arabia_pro_league: 'Saudi Arabia',
    soccer_brazil_campeonato: 'Brazil',
    soccer_brazil_serie_b: 'Brazil',
    soccer_chile_campeonato: 'Chile',
    soccer_china_superleague: 'China',
    soccer_conmebol_copa_libertadores: 'South America',
    soccer_conmebol_copa_sudamericana: 'South America',
    soccer_finland_veikkausliiga: 'Finland',
    soccer_norway_eliteserien: 'Norway',
    soccer_sweden_allsvenskan: 'Sweden',
    soccer_sweden_superettan: 'Sweden',
    soccer_spain_segunda_division: 'Spain'
  };
  return countries[sportKey];
}

function footballSportKeys(): string[] {
  return configuredSportKeys('FOOTBALL_SPORT_KEYS', DEFAULT_FOOTBALL_SPORT_KEYS);
}

function nbaSportKeys(): string[] {
  return configuredSportKeys('NBA_SPORT_KEYS', DEFAULT_NBA_SPORT_KEYS);
}

function configuredSportKeys(envName: string, fallback: string[]): string[] {
  const configured = process.env[envName];
  if (!configured) return fallback;

  const keys = configured
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  return keys.length > 0 ? keys : fallback;
}

function isEnabled(envName: string): boolean {
  return process.env[envName] === 'true';
}

function oddsSourceParams(defaultRegions: string): { params: Record<string, string>; cacheKey: string } {
  const bookmakerKeys = (process.env.PREFERRED_BOOKMAKER_KEYS || process.env.ODDS_API_BOOKMAKERS || 'onexbet').trim();
  if (bookmakerKeys && bookmakerKeys.toLowerCase() !== 'none') {
    return {
      params: { bookmakers: bookmakerKeys },
      cacheKey: `bookmakers:${bookmakerKeys}`
    };
  }

  return {
    params: { regions: defaultRegions },
    cacheKey: `regions:${defaultRegions}`
  };
}

function additionalMarketRegions(sportKey: string, namespace: string): string {
  if (sportKey === 'basketball_nba') {
    return process.env.NBA_ADDITIONAL_MARKET_REGIONS || 'us';
  }

  if (namespace === 'btts') {
    return process.env.FOOTBALL_ADDITIONAL_MARKET_REGIONS || process.env.ODDS_ADDITIONAL_MARKET_REGIONS || 'uk,eu,us';
  }

  return process.env.ODDS_ADDITIONAL_MARKET_REGIONS || 'uk,eu,us';
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
          selection: normalizeSelection(market.key, outcome),
          bookmaker: bookmaker.title,
          odds: outcome.price,
          capturedAt: new Date()
        });
      }
    }
  }
  return prices;
}

function normalizeSelection(marketKey: string, outcome: { name: string; description?: string }): string {
  if (marketKey.startsWith('player_') || marketKey.includes('team_totals')) return outcome.description || outcome.name;
  return outcome.name;
}

function normalizeMarket(marketKey: string, outcome: { name: string; description?: string; point?: number }): string {
  if (marketKey.startsWith('player_')) return `${marketKey} ${outcome.name} ${outcome.point ?? ''}`.trim();
  if (marketKey.includes('team_totals')) return `Team Total ${outcome.description || 'Team'} ${outcome.name} ${outcome.point ?? ''}`.trim();
  if (marketKey === 'totals_h1') return `${outcome.name} ${outcome.point ?? ''} H1`.trim();
  if (marketKey === 'totals') return `${outcome.name} ${outcome.point ?? ''}`.trim();
  if (marketKey === 'btts') return `BTTS ${outcome.name}`;
  if (marketKey === 'h2h') return 'Double Chance Candidate';
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
