export const SPORT_QUEUE_NAMES = {
  tennisScan: 'tennis-scan-queue',
  tennisSignal: 'tennis-signal-queue',
  mlbScan: 'mlb-scan-queue',
  mlbSignal: 'mlb-signal-queue'
} as const;

export function signalIdempotencyKey(input: {
  sport: string;
  fixtureId?: string;
  engine: string;
  market: string;
  selection: string;
  subject?: string;
}): string {
  return [
    input.sport,
    input.fixtureId || 'no-fixture',
    input.engine,
    input.subject || 'no-subject',
    input.market,
    input.selection
  ].join(':').toLowerCase().replace(/\s+/g, '-');
}
