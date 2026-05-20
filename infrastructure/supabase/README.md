# Supabase

Use `prisma/schema.prisma` as the source schema for PostgreSQL/Supabase. Once `DATABASE_URL` and Supabase service credentials are provided, run:

```bash
npm run prisma:generate
npm run prisma:migrate
```

Do not run migrations against production until the schema has been reviewed.
