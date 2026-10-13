# Install and try the Pi adapter

This is a local research checkout, not a published notification package. The setup below is for the current [Pi extension](../src/pi-extension.ts); other harness adapters are planned. [Quickstart](quickstart.md) · [Runnable CI demo](hn-demo.md) · [README](../README.md) · [Specification](notification-spec.md).

## Prerequisites

Use **Node.js 24+**. SQLite comes from Node’s built-in `node:sqlite`. The research used **Pi 0.99.2**; the installed package was `@earendil-works/pi-coding-agent@0.99.2`.

If Pi is not installed, install the tested version:

```sh
npm install -g @earendil-works/pi-coding-agent@0.99.2
pi --version
```

Configure and authenticate Pi normally for the provider you want to use. The extension does not select a model or set up credentials. Its launch command uses your Pi defaults.

The minimal extension requires no local `npm ci`: Pi resolves its extension APIs, and Node supplies SQLite. For the full repository’s MCP harnesses and offline tests, run `npm ci` from the checkout. This does not install a global notification service.

## Launch and publish

From the repository root:

```sh
PI_NOTIFY_PORT=8765 pi -e ./src/pi-extension.ts
```

From a second terminal:

```sh
curl -X POST http://127.0.0.1:8765/notify \
  -H 'Content-Type: application/json' \
  -d '{"source":"CI","message":"CI run 4821 finished: one test failed."}'
```

The response is the persisted record with a generated ID. If Pi is idle, send a normal prompt such as “Summarize the updates received.” Arrival alone does not invoke the model. During an ongoing task, the next context preparation makes the event available without a retrieval tool call.

The agent manages it through native tools:

```js
notifications_dismiss({id:"notif_<received-id>"})
notifications_dismiss({id:"*"})
notifications_history({since:"2h",limit:20})
```

These are model tool arguments, not commands to paste into your shell. `*` clears the entire active session queue at tool execution time; use specific IDs when unresolved events must remain.

## Route a background job to its original session

Have the runtime write a ready file:

```sh
PI_NOTIFY_PORT=8765 PI_NOTIFY_READY=.pi/notifications-ready.json \
  pi -e ./src/pi-extension.ts
```

It contains `url`, `sessionId` and `databasePath`. A job producer should capture that destination **when the job starts**, then POST its result with that same `sessionId`. The extension rewrites the ready file when the active session changes.

```json
{
  "sessionId": "<sessionId-captured-at-job-start>",
  "source": "worker",
  "message": "jobId=export-17; revision=3; completed; result=./artifacts/export-17.json"
}
```

Omitting the ID sends to the session active when the POST arrives. An explicit unknown ID returns HTTP 400. Large logs belong in an artifact; send a concise result, its identity and a reference. Opening that artifact is a separate action that should be counted in measurements.

## Persistence and restart

The default database is `.pi/notifications.sqlite` relative to Pi’s working directory. Accepted events and history survive process termination. Resume a saved session:

```sh
PI_NOTIFY_PORT=8765 pi --continue -e ./src/pi-extension.ts
```

Use the same working directory/database and the same session ID to recover its queue and `t-N` counter. A new session or fork has separate state. For controlled experiments, `--session-id <UUID>` selects an explicit identity. `--no-session` disables saving Pi’s session file: reusing its UUID and database can recover the SQLite queue, but not saved journal metadata after shutdown.

A fixed port keeps the address stable after a successful restart; it is still unavailable during the shutdown interval. With port `0`, the runtime chooses a free port and the producer must read the new URL. The core endpoint cannot accept events while Pi is off.

## Configuration

| Variable | Default / meaning |
|---|---|
| `PI_NOTIFY_DB` | `.pi/notifications.sqlite`; relative to Pi’s working directory |
| `PI_NOTIFY_PORT` | `0`; loopback port, or a fixed free port |
| `PI_NOTIFY_READY` | Optional ready JSON path; its parent directory must exist |
| `PI_NOTIFY_PROMPT` | Bundled `prompts/v2.txt`; an alternate instruction file |
| `PI_NOTIFY_POSITION` | `tail`; alternative `before-input` |
| `PI_NOTIFY_DISMISS` | Single-ID schema; `batch` enables `{ids:[…]}` |
| `PI_NOTIFY_CACHE` | `journal` for native `openai-codex-responses`, `dynamic` for other APIs; explicit override available |
| `PI_NOTIFY_CONTEXT` | `0` disables the injection and static instructions for ablations; server/tools remain registered |
| `PI_NOTIFY_TRACE` | Optional runtime JSONL log |
| `PI_NOTIFY_PROVIDER_TRACE` | Optional prepared provider-payload JSONL log |
| `PI_NOTIFY_LAB` | `1` enables the laboratory-only `/lab/release` gate |

To try the later prompt and grouped dismiss explicitly:

```sh
PI_NOTIFY_PORT=8765 PI_NOTIFY_PROMPT=./prompts/v3.txt \
  PI_NOTIFY_DISMISS=batch PI_NOTIFY_POSITION=tail \
  pi -e ./src/pi-extension.ts
```

Then `notifications_dismiss({ids:["*"]})` clears the queue. This command does not enable the broad benchmark’s provider-specific `stable` cache adapter. Journal mode is a separate implementation; see the [context specification](notification-spec.md#context-layout).

Trace files can contain task text, event bodies and tool arguments. They record prepared payloads, not assembled authentication headers. Keep logs appropriate for your own data; the committed research captures use fixture data.

## Offline checks and research runs

```sh
npm ci
npm test
npm run test:pi
```

Unit tests cover store and context behavior, including crash/restart persistence, concurrent writes, session isolation and journal projection. The Pi integration check runs RPC **offline**, changes sessions and restarts on the same SQLite database; it exercises store operations directly, not model understanding. Prior runtime verification recorded 44 unit tests and one offline integration test passing.

Real benchmark commands call a configured model and can use external services; they are not needed to try the extension. Use a new campaign name and frozen runtime when reproducing a comparison. [All measurement scripts, original configurations and artifact locations](benchmarks.md).
