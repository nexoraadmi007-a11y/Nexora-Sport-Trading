"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateRequiredEnv = validateRequiredEnv;
exports.optionalEnv = optionalEnv;
const REQUIRED_ENV = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'ODDS_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'REDIS_URL'
];
function validateRequiredEnv(env = process.env) {
    const missing = REQUIRED_ENV.filter((key) => !env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required NEXORA environment variables: ${missing.join(', ')}`);
    }
}
function optionalEnv(key, fallback = '') {
    return process.env[key] || fallback;
}
