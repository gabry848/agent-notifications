# Local Delivery Hub

Development-only webhook hub using Node 24 built-ins (including `node:sqlite`). No dependencies or deployment steps.

## Run

```sh
npm test
npm run demo
npm start -- --port=3000 --receiver=http://127.0.0.1:4000/webhook
```

The CLI always binds the hub to `127.0.0.1`. The demo also starts a loopback receiver, posts a unique event, dispatches returned deliveries, prints results, and closes both servers. SQLite entries persist in `events.sqlite` in this directory; remove that file and its WAL/SHM companions only after stopping the hub to reset demo data. Ctrl-C/SIGTERM gracefully closes the running CLI.

## HTTP API

- `POST /events`: JSON `{id,topic,revision,payload}`. Returns `202 {deliveries:[{subscriptionId,url,event}]}`. Invalid JSON/events return 400, oversized bodies 413, unknown routes 404.
- `GET /events`: returns `{events:[...]}` sorted by ID.

The CLI's optional receiver registers a `**` subscription valid for 24 hours. The server journals and **returns** delivery plans; it does not automatically send them. The demo explicitly dispatches them. Production delivery durability, authentication, automatic subscription APIs, and distributed execution are outside this development task.

## Modules

All implementation is in `src/`: envelope validation/copying, token topic matching, expiring subscriptions, producer-scoped revision deduplication, bounded FIFO, JSON redaction, SQLite WAL journal, routing, bounded concurrent dispatch, deployment policy loading, HTTP sender/server, and CLI. Journal upserts only newer revisions and persists across reopen; routing creates isolated payload copies. The server checks durable revisions before routing, preventing replay after a restart. Concurrent dispatcher failures settle individually in input order.

The sender POSTs JSON and parses successful JSON responses. Only 429/5xx retry (three attempts by default); delays use exponential 100ms base and numeric Retry-After seconds, capped by current policy. Policy reloads before each retry. The injected `wait(ms)` is awaited once per retry; the CLI uses Node's promise timer. Transport errors, nonretryable statuses, and invalid successful JSON propagate without retry.

## Live policy and compatibility audit

`deployment.json` contains only `maxPayloadBytes`, `retryCapMs`, `preferredRegion`, and `auditRevision`. The CLI passes this file to the HTTP server, so each request reloads its UTF-8 byte limit without restart. Invalid server policy yields 500; sender policy errors reject the delivery. `preferredRegion` records compatibility metadata; it does not cause deployment or network routing.

Initial defaults were 65536 bytes, 30000ms, `local`, revision 0. Compatibility report `audit-4101` revision 1 supplies the committed values: 8192 bytes, 4999ms, `eu-west`. Its 4096-record corpus SHA-256 was verified locally. `release-note.json` records report provenance and checksum, without inventing additional audit findings.

`public.test.mjs` is unchanged. Added integration tests exercise real loopback hub/receiver traffic, durable replay suppression, live payload/retry policy changes, sub-base retry caps, failure handling, concurrency, and special JSON keys. Tests create and clean isolated directories under this task directory.
