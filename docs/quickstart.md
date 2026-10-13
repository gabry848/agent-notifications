# Try Agent Notifications

Send a fact to a running Pi session and see it in the next model request. The extension is available from this source repository; there is no published Agent Notifications package. [Full adapter guide](pi-adapter.md) · [CI demo](hn-demo.md) · [Limits](limitations.md).

## Before you start

1. Download or clone this repository and open a terminal in its root folder.
2. Use **Node.js 24+** (`node --version`).
3. Install the tested Pi version if you do not already have it:

   ```sh
   npm install -g @earendil-works/pi-coding-agent@0.99.2
   pi --version
   ```

4. Configure and authenticate Pi for your provider normally. If Pi cannot answer an ordinary prompt yet, complete that setup first. The extension does not supply an account or API key; provider requests use your existing configuration.

The minimal extension uses Node's built-in SQLite and Pi's extension APIs. **You do not need `npm ci` to try it.** Installation and authentication time vary; the steps below take a few minutes once Pi is working.

## Send your first update

In Terminal A, from the repository root:

```sh
PI_NOTIFY_PORT=8765 pi -e ./src/pi-extension.ts
```

Keep Pi open. In Terminal B:

```sh
curl --fail-with-body -sS -X POST http://127.0.0.1:8765/notify \
  -H 'Content-Type: application/json' \
  -d '{"source":"Quickstart","message":"The background export completed: 17 records."}'
```

Success returns a JSON record containing an ID beginning `notif_`, your Pi session ID, source, message and timestamps. The HTTP status is **201**. This means the event was committed to SQLite, not that the agent has already processed it.

If Pi is idle, send it this normal prompt:

```text
What update did you receive? State its source and the number of exported records.
```

Expected behavior: it can report **Quickstart** and **17 records** from the injected context, without calling a notification retrieval tool. It may dismiss the event after handling it. The precise wording and decisions depend on your model.

## Try CI while coding

From another terminal in the repository root, start the isolated demo:

```sh
node demo/ci.mjs launch
```

Pi's task and the local CI worker both start automatically. Follow the [demo steps](hn-demo.md) to see a real local test failure arrive while the agent works on another module. The demo uses a free port, a fresh SQLite database and a new temporary project, so it can coexist with the quickstart session.

## If something fails

| Symptom | Next step |
|---|---|
| `pi: command not found` | Install Pi and ensure your global npm executable directory is on PATH. |
| SQLite is unavailable | Check that the `node` used by Pi is version 24 or newer. |
| `EADDRINUSE` on 8765 | Choose another free port in both terminal commands, or use the demo launcher, which selects one automatically. |
| curl cannot connect | Keep Pi open and check its startup output for an extension error. |
| Event accepted, no agent response | Send a normal prompt. Arrival does not start a model request or interrupt an already prepared one. |
| Demo has no CI notification | Inspect the printed `.demo/ci-console.log`. Keep Pi open for the eight-second queue delay. If delivery shows HTTP 201 and Pi is idle, send “Continue with any relevant CI result received.” |

The receiver is bound to `127.0.0.1`. It accepts updates only while Pi is running. Accepted events remain in `.pi/notifications.sqlite`; use the same database and resume the same saved session to recover them. See [session routing and restart](pi-adapter.md#persistence-and-restart) before integrating longer background jobs.
