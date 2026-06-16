import type { EngineOperationalStatus, SignalCandidate } from '@nexora/types';
import { loadDotEnv } from './config';

export const ENGINE_KEYS = {
  footballOver15: 'football_over15',
  footballBtts: 'football_btts',
  footballDoubleChance: 'football_double_chance',
  nbaPlayerProps: 'nba_player_props',
  nbaTeamTotals: 'nba_team_totals',
  nbaFirstHalfTotals: 'nba_first_half_totals'
} as const;

export type EngineKey = typeof ENGINE_KEYS[keyof typeof ENGINE_KEYS];

export const DEFAULT_ENGINE_STATUS: Record<EngineKey, EngineOperationalStatus> = {
  football_over15: 'PRODUCTION',
  football_btts: 'PRODUCTION',
  football_double_chance: 'SHADOW',
  nba_player_props: 'SHADOW',
  nba_team_totals: 'SHADOW',
  nba_first_half_totals: 'PRODUCTION'
};

export function engineKeyForName(engineName: string): EngineKey {
  const normalized = engineName.toLowerCase();

  if (normalized.includes('over 1.5')) return ENGINE_KEYS.footballOver15;
  if (normalized.includes('btts')) return ENGINE_KEYS.footballBtts;
  if (normalized.includes('double chance')) return ENGINE_KEYS.footballDoubleChance;
  if (normalized.includes('player props')) return ENGINE_KEYS.nbaPlayerProps;
  if (normalized.includes('team totals')) return ENGINE_KEYS.nbaTeamTotals;
  if (normalized.includes('first half')) return ENGINE_KEYS.nbaFirstHalfTotals;

  return engineName.toLowerCase().replace(/[^a-z0-9]+/g, '_') as EngineKey;
}

export function engineStatusForSignal(signal: SignalCandidate): EngineOperationalStatus {
  return engineStatusForKey(engineKeyForName(signal.engine));
}

export function engineStatusForKey(engineKey: EngineKey): EngineOperationalStatus {
  loadDotEnv();
  const configured = loadConfiguredStatuses();
  return configured[engineKey] || DEFAULT_ENGINE_STATUS[engineKey] || 'SHADOW';
}

export function allEngineStatuses(): Record<string, EngineOperationalStatus> {
  return {
    ...DEFAULT_ENGINE_STATUS,
    ...loadConfiguredStatuses()
  };
}

function loadConfiguredStatuses(): Partial<Record<EngineKey, EngineOperationalStatus>> {
  const raw = process.env.ENGINE_STATUS_CONFIG;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [key, normalizeStatus(value)])
        .filter((entry): entry is [EngineKey, EngineOperationalStatus] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
}

function normalizeStatus(value: string): EngineOperationalStatus | undefined {
  const normalized = value.toUpperCase();
  if (normalized === 'PRODUCTION' || normalized === 'SHADOW' || normalized === 'DISABLED') {
    return normalized;
  }

  return undefined;
}
