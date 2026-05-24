# Sport Queue Namespaces

The tennis and MLB expansion uses isolated queue namespaces so future BullMQ workers can route jobs without colliding with the existing worker flow.

- `tennis-scan-queue`
- `tennis-signal-queue`
- `mlb-scan-queue`
- `mlb-signal-queue`

Idempotency keys should include sport, fixture id, engine, market, selection, and subject when present.
