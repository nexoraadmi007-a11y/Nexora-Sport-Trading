import type { SignalCandidate } from '@nexora/types';

export class TelegramEngine {
  constructor(
    private readonly token = process.env.TELEGRAM_BOT_TOKEN,
    private readonly chatId = process.env.TELEGRAM_CHAT_ID
  ) {}

  async sendSignal(signal: SignalCandidate): Promise<void> {
    await this.sendMessage(formatSignal(signal));
  }

  async sendNoBet(): Promise<void> {
    await this.sendMessage('🚫 NO ELITE SIGNALS TODAY');
  }

  async sendMessage(text: string): Promise<void> {
    if (!this.token || !this.chatId) {
      throw new Error('Telegram token/chat ID missing');
    }

    const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: this.chatId, text })
    });

    if (!response.ok) {
      throw new Error(`Telegram delivery failed: ${response.status} ${await response.text()}`);
    }
  }
}

export function formatSignal(signal: SignalCandidate): string {
  const fixture = signal.fixture;
  const details = marketDetails(signal);
  const sportIcon = signal.sport === 'nba' ? '🏀' : '⚽';
  const sportName = signal.sport === 'nba' ? 'NBA Basketball' : 'Football';
  const country = fixture?.country || fallbackCountry(signal);
  const league = fixture?.league ? `${fixture.league}${country ? ` (${country})` : ''}` : country || 'N/A';
  const match = fixture?.homeTeam && fixture?.awayTeam ? `${fixture.homeTeam} vs ${fixture.awayTeam}` : 'N/A';

  return [
    '━━━━━━━━━━━━━━━',
    `${sportIcon} NEXORABET ELITE SIGNAL`,
    '━━━━━━━━━━━━━━━',
    '',
    `${sportIcon} Sport: ${sportName}`,
    `🏆 League: ${league}`,
    `🏟 Match: ${match}`,
    `🕒 Time: ${fixture ? `${formatWatTime(fixture.startsAt)} WAT` : 'TBD'}`,
    signal.subject ? `👤 Player: ${signal.subject}` : undefined,
    '',
    `🎯 Market: ${details.market}`,
    `✅ Selection: ${details.selection}`,
    `💰 Odds: ${signal.odds.toFixed(2)}`,
    `📊 Probability: ${formatPercent(signal.trueProbability)}`,
    `📈 EV: ${formatEv(signal.ev)}`,
    `🧠 Confidence: ${formatScore(signal.confidence)}`,
    `🛡 Quality Score: ${formatScore(signal.qualityScore)}`,
    '',
    `🔥 Signal Tier: ${signal.tier}`,
    `⚠ Risk Level: ${riskLevel(signal)}`,
    '✅ Action: PLACE',
    '',
    '📌 Reason:',
    signal.reason,
    '',
    '━━━━━━━━━━━━━━━'
  ].filter((line) => line !== undefined).join('\n');
}

interface MarketDetails {
  market: string;
  selection: string;
}

function marketDetails(signal: SignalCandidate): MarketDetails {
  const rawMarket = signal.market.trim();
  const selection = signal.selection.trim();
  const total = rawMarket.match(/^(Game Total Proxy )?(Over|Under) (\d+(?:\.\d+)?)( H1)?$/i);
  if (total) {
    const side = titleCase(total[2]);
    const line = total[3];
    const half = total[4] ? 'First Half ' : '';
    const unit = signal.sport === 'nba' ? 'Points' : 'Goals';
    return {
      market: `${half}${signal.sport === 'nba' ? 'Game Total' : 'Total Goals'}`,
      selection: `${side} ${line} ${unit}`
    };
  }

  const btts = rawMarket.match(/^BTTS (Yes|No)$/i);
  if (btts) {
    return {
      market: 'Both Teams To Score',
      selection: titleCase(btts[1])
    };
  }

  const playerProp = rawMarket.match(/^player_(points|rebounds|assists|threes) ?(\d+(?:\.\d+)?)?$/i);
  if (playerProp) {
    const line = playerProp[2] ? ` ${playerProp[2]}` : '';
    return {
      market: playerPropMarket(playerProp[1]),
      selection: `${titleCase(selection)}${line}`.trim()
    };
  }

  if (rawMarket === 'Double Chance Candidate') {
    return {
      market: 'Double Chance',
      selection
    };
  }

  return {
    market: rawMarket,
    selection
  };
}

function fallbackCountry(signal: SignalCandidate): string | undefined {
  if (signal.sport === 'nba') return 'USA';
  const league = signal.fixture?.league.toLowerCase() || '';
  if (league.includes('premier league')) return 'England';
  if (league.includes('la liga')) return 'Spain';
  if (league.includes('serie a')) return 'Italy';
  if (league.includes('bundesliga')) return 'Germany';
  if (league.includes('ligue')) return 'France';
  return undefined;
}

function formatWatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function formatEv(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number): string {
  const normalized = value <= 10 ? value * 10 : value;
  return `${Math.round(normalized)}/100`;
}

function riskLevel(signal: SignalCandidate): string {
  if (signal.tier === 'A+' && signal.qualityScore >= 82) return 'LOW';
  if (signal.tier === 'A+' || signal.qualityScore >= 72) return 'MEDIUM';
  return 'CONTROLLED';
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function playerPropMarket(value: string): string {
  const markets: Record<string, string> = {
    points: 'Player Points',
    rebounds: 'Player Rebounds',
    assists: 'Player Assists',
    threes: 'Player 3PT Made'
  };
  return markets[value.toLowerCase()] || 'Player Prop';
}
