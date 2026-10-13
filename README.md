# Agent Notifications

**Give your agent updates while it works.**

Agent Notifications is an experimental runtime extension for AI agents. It delivers CI results, background job updates and messages from other agents directly into the next model request, without a tool call to check for them.

Available today as a **[Pi extension](docs/pi-adapter.md)**.

## See the difference

CI is running while the agent edits another file. An illustrative flow:

| Polling | Agent Notifications |
|---|---|
| “Is CI done?” → Still running. | Keep editing. |
| “Is CI done?” → Still running. | Keep editing. |
| “Is CI done?” → `auth.test.ts failed`. | Receive `CI: auth.test.ts failed` in the next request. |
| Inspect the failing test. | Inspect the failing test. |

**The agent gets the result without asking for it.**

**A requirement changes while three agents are coding.** In an earlier pilot:

```mermaid
flowchart TB
    U["New requirement:<br/>messages must fit in 192 characters"]

    U --> P["Polling<br/>The agent checks for updates"]
    U --> N["Agent Notifications<br/>The update enters the next model request"]

    P --> PA["Code updated<br/>32.3 seconds"]
    N --> NA["Code updated<br/>20.5 seconds"]
```

Observed response to one update; the notification group was interrupted before completion. [Pilot evidence](docs/benchmarks.md#earlier-requirement-change-pilot).

## Try it

Requires Node.js 24+ and a configured Pi installation. Tested with Pi 0.99.2. From this checkout:

```sh
PI_NOTIFY_PORT=8765 pi -e ./src/pi-extension.ts
```

Send an update from another terminal:

```sh
curl -X POST http://127.0.0.1:8765/notify \
  -H 'Content-Type: application/json' \
  -d '{"source":"CI","message":"CI: auth.test.ts failed."}'
```

If Pi is idle, ask it: **“What update did you receive?”** Its next request includes the notification. [Quickstart](docs/quickstart.md) · [Full setup](docs/pi-adapter.md).

For a runnable CI example, start a fresh demo project:

```sh
node demo/ci.mjs launch
```

Pi's task and the CI worker start automatically. While Pi builds a receipt formatter, the worker runs real shipping tests and delivers the failure. Follow the [demo steps](docs/hn-demo.md). The queue delay is simulated; this demonstrates delivery and reaction, not a speed benchmark. [Current limits](docs/limitations.md).

## How it works

1. A script, an MCP bridge or another agent sends an update to `POST /notify`.
2. The runtime saves it for the session and adds it to the next model request.
3. The agent can dismiss it when handled; it stays available in history.

Updates follow the normal agent loop. They do not wake an idle agent or interrupt a running call. [Specification](docs/notification-spec.md).

## Benchmarks

We compared notifications with adaptive polling while agents built a package catalog and an MCP server with a dashboard. Both modes kept coding while real tests ran against frozen source snapshots, after simulated CI queue delays.

| Measured benefit | Reduction vs adaptive polling | Workload |
|---|---:|---|
| Delay before the model sees CI results | **94.6%** | Catalog CI |
| Requests to the model | **10%** | Catalog CI |
| Manual CI status checks | **50%** | Notes MCP + dashboard |

Median paired reductions vs adaptive polling, from **5 complete, correct pairs per workload; 20 runs total**. All runs passed independent acceptance and required CI, and lasted roughly **4–7 minutes**. Delivery delay measures the time from publication of identical initial CI results to the first model request containing them.

**The clearest benefit was earlier visibility of CI results.** Overall completion time was mixed: median paired changes were −3.1% for Catalog and +1.6% for Notes. Cumulative tokens were 44.8% and 40.1% higher, respectively, including cached input reread across requests. These small exploratory samples do not establish faster bug fixing, lower cost or a general productivity gain.

Notification history remains in later model requests and contributes to token use; the trials do not isolate a fixed per-update overhead. [Token accounting](research/ci-comparison-20261007/token-accounting.md).

[Full results](research/ci-comparison-20261007/report.md) · [Methods and evidence](docs/benchmarks.md#readme-summary) · [Current limits](docs/limitations.md).

## Next

Pi works today. Codex, DeepSeek and oh-my-pi adapters, relevance filtering and longer benchmarks are planned. [Roadmap](docs/roadmap.md).

[Use cases](docs/use-cases.md) · [Research story](docs/research-story.md) · [All benchmarks](docs/benchmarks.md) · [Interactive report](research/final-20261006/research.html)
