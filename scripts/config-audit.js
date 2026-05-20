const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(process.cwd(), '.env');
const examplePath = path.join(process.cwd(), '.env.example');

function readKeys(filePath) {
  if (!fs.existsSync(filePath)) return new Map();
  const entries = new Map();
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) entries.set(match[1].trim(), match[2].trim());
  }
  return entries;
}

const env = readKeys(envPath);
const example = readKeys(examplePath);
const required = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
  'ODDS_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'REDIS_URL'
];
const missing = required.filter((key) => !env.get(key));
const optionalMissing = [...example.keys()].filter((key) => !required.includes(key) && !env.get(key));

console.log('NEXORA CONFIG AUDIT');
console.log(`Configured keys: ${[...env.entries()].filter(([, value]) => Boolean(value)).length}`);
console.log(`Missing required keys: ${missing.length}`);
for (const key of missing) {
  console.log(`- ${key}`);
}
console.log(`Optional keys not set: ${optionalMissing.length}`);
