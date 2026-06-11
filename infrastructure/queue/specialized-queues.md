# Specialized Queue Names

Business-specific queue names have been cleared during the foundation reset.

Reserved foundation namespaces for future BullMQ workers:

- `foundation-scan-queue`
- `foundation-delivery-queue`

Future signal engines should add their own isolated queues without mixing payloads with Telegram, scheduler, persistence, or shared infrastructure work.
