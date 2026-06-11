export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function watCronTimes(): string[] {
  return ['30 9 * * *', '30 13 * * *', '30 17 * * *'];
}

export function utcCronForWatScans(): string {
  return '30 8,12,16 * * *';
}

export * from './bookmakers';
