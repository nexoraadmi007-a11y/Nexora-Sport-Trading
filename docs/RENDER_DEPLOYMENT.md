# Render Deployment

NEXORA deploys to Render as a background worker using `render.yaml`.

## Dashboard Flow

1. Open Render.
2. Choose **New +**.
3. Choose **Blueprint**.
4. Connect the GitHub repository:
   `nexoraadmi007-a11y/Nexora-Sport-Trading`
5. Select the repository root. Render will read `render.yaml`.
6. Create the service.
7. Fill every environment variable marked `sync: false`.

## Required Secret Values

Copy these from the local `.env` file into Render:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `TELEGRAM_CHANNEL_ID`
- `TELEGRAM_WEBHOOK_URL`
- `ODDS_API_KEY`
- `SPORTSDATAIO_NBA_API_KEY`
- `GOOGLE_SHEETS_WEBHOOK_URL`
- `SUPABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_DB_HOST`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `POSTGRESQL_DATABASE_URL`
- `SUPABASE_POOLER_DATABASE_URL`
- `REDIS_URL`

## Expected Startup Log

After deployment, Render logs should show:

```text
NEXORA scheduler active: 09:30, 13:30, 17:30 WAT
```

The service must remain running as a background worker. It sends Telegram signals only when a scheduled scan approves a signal, or sends `NO ELITE SIGNALS TODAY` when no edge survives the filters.

## API Call Protection

The Render blueprint mounts `/var/data` and sets:

```text
NEXORA_CACHE_DIR=/var/data/nexora-cache
API_DAILY_CALL_LIMIT=250
ODDS_API_DAILY_CALL_LIMIT=205
SPORTSDATAIO_DAILY_CALL_LIMIT=45
```

This keeps API cache and quota state persistent across normal service restarts.
