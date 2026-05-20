import fs from 'node:fs';
import path from 'node:path';

const REQUIRED_ENV = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ODDS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'REDIS_URL'
] as const;

export function validateRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  loadDotEnv();
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required NEXORA environment variables: ${missing.join(', ')}`);
  }
}

export function optionalEnv(key: string, fallback = ''): string {
  loadDotEnv();
  return process.env[key] || fallback;
}

export function loadDotEnv(filePath = path.join(process.cwd(), '.env')): void {
  const resolvedPath = fs.existsSync(filePath) ? filePath : findDotEnv(process.cwd());
  if (!resolvedPath) return;

  for (const line of fs.readFileSync(resolvedPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    process.env[key.trim()] ||= value.trim();
  }
}

function findDotEnv(start: string): string | null {
  let current = start;
  while (true) {
    const candidate = path.join(current, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}
