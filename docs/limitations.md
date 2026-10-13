# What the prototype does today

Agent Notifications persists session-scoped updates and adds them to the context prepared for the next model request. The agent can use those facts without a tool call to discover their arrival. It can still need tools to inspect logs, verify a result or act on it. [Quickstart](quickstart.md) · [Full contract](notification-spec.md).

## Timing and runtime support

- **Pi only today.** The tested host is Pi 0.99.2 on Node.js 24+. Other harness adapters are planned.
- **Next request, not an immediate interrupt.** Arrival does not wake an idle agent, start inference or change an already prepared request. A running agent sees updates at a later natural context preparation. An idle agent needs a normal user prompt or an existing host-driven turn.
- **Persistence covers accepted events.** The HTTP receiver stops with Pi. SQLite retains events already accepted; recovering a queue requires the same database and session ID. There is no always-on receiver in the core.
- **Delivery is not action.** HTTP 201 means persistence. Context exposure, correct interpretation and a verified code change are separate observations.

## Source integration and lifecycle

- **A producer or bridge must send the update.** The extension does not subscribe to every CI system or MCP server automatically. The included demo runs real local tests with a simulated queue delay; it is not GitHub Actions.
- **Route by session and identify the tested revision.** Without `sessionId`, an arrival targets the currently active session. Background jobs should capture their original destination at job start and include run/revision identity, so an old failure is not mistaken for a failure of the latest source.
- **Core ingress is local and unauthenticated.** It binds to loopback. Remote integrations require their own authenticated bridge; source labels are not verified identities.
- **Updates are external data.** They cannot grant approvals or override user instructions. The Pi provider transport can use a user-message role; prompt guidance and quoting do not establish a universal injection-resistance guarantee.
- **No automatic relevance filter, TTL, queue cap or deduplication.** Repeated POSTs create separate entries. Active events remain until dismissed. Use concise facts and references to large artifacts; dismiss specific handled IDs to preserve unresolved events.

## Measured benefits and tradeoffs

The current CI study has **five complete, correct pairs per workload**, twenty successful runs in total. Compared with adaptive polling, Catalog CI had a median **94.6% reduction in result-delivery delay** and **10% fewer model requests**. Notes MCP + dashboard had **50% fewer manual CI status checks**. These are different metrics from different workloads, not a combined savings claim.

Overall completion time was mixed: median paired changes were **−3.1%** for Catalog and **+1.6%** for Notes. Cumulative tokens were **44.8%** and **40.1% higher**, respectively. Earlier result visibility does not establish faster bug fixing, lower cost or a general productivity gain. Historical journal snapshots also remain model input and use tokens; caching behavior is provider-dependent.

These small exploratory cohorts ran for roughly four to seven minutes and used fixed simulated queue delays before real snapshot tests. Read the [methods, unfavorable results and evidence](benchmarks.md#ci-while-coding) before generalizing the numbers.
