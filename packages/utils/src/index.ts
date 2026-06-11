export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function watCronTimes(): string[] {
  return ['30 9 * * *', '30 13 * * *', '30 17 * * *'];
}

export function utcCronForWatScans(): string {
  return '30 8,12,16 * * *';
}

export * from './scoring';
export * from './bookmakers';
