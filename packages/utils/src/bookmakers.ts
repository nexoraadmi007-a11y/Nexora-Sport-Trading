export function isPreferredBookmaker(bookmaker: string): boolean {
  const preferred = (process.env.PREFERRED_BOOKMAKERS || '1xbet,1xbet,1xBet')
    .split(',')
    .map((value) => normalizeBookmaker(value))
    .filter(Boolean);

  if (preferred.length === 0) return true;
  const normalized = normalizeBookmaker(bookmaker);
  return preferred.some((item) => normalized.includes(item));
}

export function normalizeBookmaker(bookmaker: string): string {
  return bookmaker.toLowerCase().replace(/[^a-z0-9]/g, '');
}
