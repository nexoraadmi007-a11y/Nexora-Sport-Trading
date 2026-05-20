import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CacheEntry<T> {
  createdAt: number;
  expiresAt: number;
  value: T;
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  writes: number;
}

export class CacheManager {
  private readonly dir = process.env.NEXORA_CACHE_DIR || join(process.cwd(), '.nexora-cache');
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    staleHits: 0,
    writes: 0
  };

  async get<T>(key: string): Promise<T | undefined> {
    const entry = await this.read<T>(key);
    if (!entry) {
      this.stats.misses += 1;
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.stats.misses += 1;
      return undefined;
    }

    this.stats.hits += 1;
    return entry.value;
  }

  async getStale<T>(key: string, maxStaleMs: number): Promise<T | undefined> {
    const entry = await this.read<T>(key);
    if (!entry) return undefined;

    const agePastExpiry = Date.now() - entry.expiresAt;
    if (agePastExpiry > maxStaleMs) return undefined;

    this.stats.staleHits += 1;
    return entry.value;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const entry: CacheEntry<T> = {
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      value
    };
    await writeFile(this.pathFor(key), JSON.stringify(entry), 'utf8');
    this.stats.writes += 1;
  }

  snapshot(): CacheStats {
    return { ...this.stats };
  }

  private async read<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      return JSON.parse(await readFile(this.pathFor(key), 'utf8')) as CacheEntry<T>;
    } catch {
      return undefined;
    }
  }

  private pathFor(key: string): string {
    const safeKey = createHash('sha256').update(key).digest('hex');
    return join(this.dir, `${safeKey}.json`);
  }
}
