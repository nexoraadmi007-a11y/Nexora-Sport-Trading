# Specialized Queue Names

The calibrated Tennis and MLB extension keeps independent namespaces for future BullMQ workers:

- `tennis-overgames-queue`
- `mlb-first5-queue`

These queues are not mixed with football, NBA, Telegram, scheduler, or persistence work. The current worker runs the scan synchronously, but the names are reserved for isolated queue routing and Redis deduplication.
