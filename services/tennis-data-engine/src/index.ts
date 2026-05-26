import type { EngineContext, FixtureRef, MarketPrice } from '@nexora/types';

const DEFAULT_TENNIS_HARDCOURT_KEYS = [
  'tennis_atp_australian_open',
  'tennis_atp_us_open'
];

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

export class TennisDataEngine {
  async loadContext(): Promise<EngineContext> {
    const eventsBySport = await Promise.all(tennisSportKeys().map((sportKey) => this.fetchOdds(sportKey)));
    const events = eventsBySport.flat().filter(isConfirmedAtpHardCourtEvent);

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

    const markets = 'totals';
    const regions = process.env.TENNIS_ODDS_REGIONS || 'uk,eu,us';
    const params = new URLSearchParams({
      apiKey,
      regions,
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

function tennisSportKeys(): string[] {
  const configured = process.env.TENNIS_HARDCOURT_SPORT_KEYS;
  if (!configured) return DEFAULT_TENNIS_HARDCOURT_KEYS;

  const keys = configured.split(',').map((key) => key.trim()).filter(Boolean);
  return keys.length > 0 ? keys : DEFAULT_TENNIS_HARDCOURT_KEYS;
}

function isConfirmedAtpHardCourtEvent(event: OddsApiEvent): boolean {
  const label = `${event.sport_key} ${event.sport_title}`.toLowerCase();
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

function normalizeBookmaker(bookmaker: string): string {
  return bookmaker.toLowerCase().replace(/[^a-z0-9]/g, '');
}
