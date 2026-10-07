# Dynamic Notification Memory

External events become part of an agent’s context on its next model request. A script, an MCP integration or another agent can publish an update while the agent continues working. The model receives the fact without calling a tool to check whether it arrived.

This is an experimental runtime capability and a research project. **Pi is the first adapter**: a convenient place to implement and measure the idea, rather than the scope of the idea itself.

[Research story](docs/research-story.md) · [Detailed specification](docs/notification-spec.md) · [All benchmarks and technical artifacts](docs/benchmarks.md) · [Interactive research report](research/final-20261006/research.html)

## How it works

A producer sends an event to a local HTTP receiver. SQLite stores it for the destination session. Before the next model request, the runtime adds a snapshot of the active notifications near the end of the context. Each event has an ID, a receive timestamp and an age measured in context preparations. The agent can dismiss incorporated events, including all active events with `*`, and consult their history later.

```text
External producer ── POST /notify ──► SQLite, per session
                                             │
                                    next context preparation
                                             ▼
┌─────────────────────────────────────────────────────────┐
│ System prompt + static notification instructions        │
│ Tools                                                   │
│ Conversation                                            │
│ Current input / latest tool results                      │
├─────────────────────────────────────────────────────────┤
│ Runtime Notifications — latest active queue              │
└─────────────────────────────────────────────────────────┘
                         next model request
```

This shows Pi’s default `tail` placement. `before-input` is also supported. With the native Codex journal mode, immutable earlier snapshots remain at their original positions in the conversation projection; **only the last notification section is the active queue**. See the [memory layout and lifecycle](docs/notification-spec.md#context-layout).

Arrival does not wake an idle agent or interrupt a running tool or model request. Delivery happens at the next natural context preparation. No retrieval call is needed to acquire the event, but its text still uses context tokens, and managing it can require tools.

## Try the Pi adapter

Requires Node.js 24+ and a configured Pi installation. The adapter was tested with Pi **0.99.2**. Run from this checkout:

```sh
PI_NOTIFY_PORT=8765 pi -e ./src/pi-extension.ts
```

From another terminal:

```sh
curl -X POST http://127.0.0.1:8765/notify \
  -H 'Content-Type: application/json' \
  -d '{"source":"CI","message":"CI run 4821 finished: one test failed."}'
```

Continue working in Pi, or send it a message if it is idle. The next request includes the event. The default tool can clear the queue with `notifications_dismiss({id:"*"})`; removed events remain in history.

The minimal adapter needs no separate notification MCP server or local npm installation. [Full installation, persistence, session routing and configuration](docs/pi-adapter.md).

## What this is designed for

The main target is **useful work continuing while external facts change**: background jobs finishing out of order, a peer changing a shared contract, a CI result arriving during another edit, or a relevant event the agent never explicitly requested.

We tested those capabilities, then broadened the experiments to polling, waiting, noise, lifecycle errors and cache behavior. The measurements show that fewer checks can mean fewer model requests; they also show that fewer requests do not automatically mean fewer tokens or lower cost.

| Workload | Evidence | Median model HTTP requests saved | Median total tokens saved | Median full-turn time saved | API-equivalent cost change |
|---|---|---:|---:|---:|---:|
| One 20-second background job + file work, vs adaptive polling | Exploratory, 5 pairs | 3 | 2,740 | 3.07 s | **+$0.0162561** |
| Six out-of-order jobs + file work, vs adaptive polling | Exploratory, 4 valid pairs; one notification run failed | 6.5 | 20,680.5 | 16.49 s | **+$0.0219337** |
| Real GitHub Actions success, webhook delivery vs status polling | Exploratory, 2 pairs | 1 | **−2,544** | 3.79 s | **−$0.0032735** |

These are medians of paired differences, not differences between group medians. Negative tokens saved means more tokens used. The first workload’s token interval and the GitHub timing interval include zero. Costs are frozen-tariff estimates, not subscription invoices. [Methods, intervals, all outcomes and raw files](docs/benchmarks.md).

With **Agent Coordinator**, three Pi agents edited nearby files using a real adapted MCP server. One agent received an externally published contract change and made the correct code edit **20.53 seconds after acknowledgement**, while peer turns were still open, without retrieving that fact. The notification group later stopped at a budget-reservation guard: this is evidence of a useful action, **not a completed efficiency win**. [Action evidence and limitations](docs/benchmarks.md#concurrent-work-and-agent-coordinator).

## Where it performs poorly

When the only useful next step depends on a result, a competitive wait tool is a strong choice. In the confirmed 90-second waiting case, the notification mode used an await fallback in every run: it saved 11 model requests and $0.00639075 versus adaptive polling, but used one more request and 4,050 more tokens than the wait-only control. No advantage over that control met the frozen benefit criteria.

Noise is costly. In the confirmed noisy case, notifications saved two requests and 6.07 seconds versus fixed polling, but used **4,517 more tokens** and cost **$0.012648 more** per paired median. Oversized messages were rejected rather than silently truncated. Repeated active events, unnecessary dismiss calls and unstable context prefixes also created overhead. [Negative results and implementation lessons](docs/benchmarks.md#unfavorable-results).

## Use cases I want to explore

- **Agent Coordinator:** deliver scoped activity changes, contract revisions and directed messages while peers work; retain explicit conflict checks before overlapping edits.
- **MCP servers and read-only resources:** bridge source events into the runtime queue so relevant changes become visible without repeated model-driven reads.
- **GitHub Actions during PR work:** open a PR, continue another task, then receive a result tied to its run ID and commit; act only if that revision is still relevant.

[Proposed flows, diagrams and what has actually been tested](docs/use-cases.md).

## Roadmap

Pi is implemented. Adapters for **Codex, a DeepSeek harness and oh-my-pi** are planned, without a promised schedule. The next research steps are complete concurrent-work comparisons, followed by calibrated 30–60-minute workloads, plus an independent receiver for events arriving while the agent process is off.

I also want to test **Jev**, TypeSafe AI’s classification model, for agent-defined relevance filters. That remains a proposal: classifier calls, latency, cost and missed important events must be measured alongside any reduction in context noise. [Roadmap and official Jev references](docs/roadmap.md).

## Author’s note

I built this because I wanted to send notifications to an agent without making it call something to look for them. I was especially interested in read-only MCP servers and resources: the agent can inspect them, but I wanted changes to reach its working context while it was doing something else.

Pi gave me a practical way to test the idea. The research is about that capability and where it helps. I want to keep the useful cases, the failures and the costs visible, and find out when notifications deserve a place in an agent’s runtime.
