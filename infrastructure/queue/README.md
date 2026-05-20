# Queue

BullMQ and Redis queue topology:

- `scan.pre_match`
- `telegram.delivery`
- `data.refresh`
- `results.settlement`
- `clv.capture`

The worker app owns queue execution. The API app should only enqueue or expose health state.
