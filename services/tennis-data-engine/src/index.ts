import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers?: Array<{
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

interface OddsApiSport {
  key: string;
  title: string;
  active: boolean;
}

export class TennisDataEngine {
  async loadContext(): Promise<EngineContext> {
    const eventsBySport = await Promise.all((await this.tennisSportKeys()).map((sportKey) => this.fetchOdds(sportKey)));
    const events = eventsBySport.flat().filter(isConfirmedAtpHardCourtEvent);

    return {
      fixtures: events.map(toFixture),
      prices: events.flatMap(toMarketPrices),
      playerStats: [],
      now: new Date()
    };
  }

  private async tennisSportKeys(): Promise<string[]> {
    const configured = process.env.TENNIS_HARDCOURT_SPORT_KEYS;
    if (configured) return configured.split(',').map((key) => key.trim()).filter(Boolean);

    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`);
      if (!response.ok) {
        console.warn(`[tennis-hardcourt-data] Could not discover sports: ${response.status} ${await response.text()}`);
        return [];
      }

      const sports = await response.json() as OddsApiSport[];
      return sports
        .filter((sport) => sport.active)
        .filter((sport) => isConfirmedAtpHardCourtLabel(`${sport.key} ${sport.title}`))
        .map((sport) => sport.key);
    } catch (error) {
      console.warn(`[tennis-hardcourt-data] Sport discovery unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async fetchOdds(sportKey: string): Promise<OddsApiEvent[]> {
    const apiKey = process.env.ODDS_API_KEY;
    if (!apiKey) return [];

    const markets = 'totals';
    const regions = process.env.TENNIS_ODDS_REGIONS || 'uk,eu,us';
    const source = oddsSourceParams(regions);
    const params = new URLSearchParams({
      apiKey,
      ...source.params,
      markets,
      oddsFormat: 'decimal',
      dateFormat: 'iso'
    });

    try {
      const response = await fetch(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds?${params}`);
      if (!response.ok) {
        console.warn(`[tennis-hardcourt-data] Odds API rejected ${sportKey}: ${response.status} ${await response.text()}`);
        return [];
      }
      return await response.json() as OddsApiEvent[];
    } catch (error) {
      console.warn(`[tennis-hardcourt-data] Odds API unavailable for ${sportKey}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}

function isConfirmedAtpHardCourtEvent(event: OddsApiEvent): boolean {
  return isConfirmedAtpHardCourtLabel(`${event.sport_key} ${event.sport_title}`);
}

function isConfirmedAtpHardCourtLabel(value: string): boolean {
  const label = value.toLowerCase();
  if (!label.includes('atp')) return false;
  if (label.includes('wta')) return false;
  if (label.includes('clay') || label.includes('french')) return false;
  if (label.includes('grass') || label.includes('wimbledon')) return false;
  return label.includes('hard') || label.includes('australian') || label.includes('us open') || label.includes('indian wells') || label.includes('miami');
}

function toFixture(event: OddsApiEvent): FixtureRef {
  return {
    id: event.id,
    sport: 'tennis',
    league: event.sport_title,
    country: 'ATP Hard Court',
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
      if (market.key !== 'totals') continue;
      for (const outcome of market.outcomes || []) {
        if (outcome.point === undefined) continue;
        prices.push({
          fixtureId: event.id,
          market: `${outcome.name} ${outcome.point} Games`,
          selection: outcome.name,
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
