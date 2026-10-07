# Research story: from context delivery to concurrent work

The research began with a capability the author wanted: an external system should be able to leave an update in an agent’s working context without the model asking whether anything had changed. The intended setting was an agent doing useful work while scripts, services or peers produced relevant facts.

The current outcome is a working Pi prototype and a set of measured experiments with mixed efficiency results. Event delivery and useful reactions are demonstrated in specific cases. A completed long-duration concurrent-work efficiency advantage is still an open question.

[README](../README.md) · [Specification](notification-spec.md) · [Benchmark index](benchmarks.md) · [Consolidated interactive report](../research/final-20261006/research.html).

## 1. Separate receiving an event from waking the agent

The [original MVP design](../dynamic_notification_memory_pi_mvp.md) proposed a notification store, HTTP ingress, a context adapter and dismissal/history operations. A notification would carry an ID, a timestamp and an exposure age. Its arrival would not start inference. At the next natural model call, the agent would see pending facts alongside its ongoing task.

This boundary mattered: the target was awareness during work, not autonomous scheduling whenever a message arrived. It also made a small local prototype possible. The initial adapter used Pi’s context hook and static instructions describing notifications as external data. Management operations became native Pi tools; the separate MCP dismiss/history interface in the design was not the implementation ultimately used.

## 2. Prove delivery and behavior before comparing efficiency

The first experiments ran real Pi subprocesses on a controlled invoice-service planning task. The agent read three staged source snapshots and submitted a JSON plan. A producer delivered events at controlled points through HTTP. Gates made delivery order reproducible without relying only on network timing.

Eight scenarios covered relevant results, a changed plan, irrelevant events, persistent events, dismissal/history, idle backlog, conflicting or duplicate claims, and hostile text. The checks distinguished three questions: was the event actually in the prepared provider payload, did it remain active with the expected age, and did the final plan reflect the right facts?

The first smoke attempt timed out waiting for the first source read. It remains in the record; it does not establish a cause such as a provider rate limit. A later smoke passed. The main v1 batch had 24 attempts, and seven additional attempts retried incomplete cases. Consolidation selected the last attempt for each case/repetition while retaining the provenance of all attempts. The consolidated v1 set was 24/24 correct.

Prompt v2 was then tested on the three more troublesome categories—relevance, persistence and hostile text—with three repetitions each. Those nine selected tests passed. The payload verifier recorded 33/33 checks across consolidated v1 and refined v2.

There were **42 unique initial attempts**, counting smoke, baseline, retries and v2, rather than 42 independent successes. Their token/cost coverage is not reconciled into the later campaign totals. These captures precede the SQLite implementation and document the earlier in-memory store, not a persistence benchmark. [Original summaries and verification](benchmarks.md#initial-behavior-experiments).

## 3. Add durable session memory

Before broad efficiency testing, the project added SQLite so the lifecycle could be inspected rather than inferred from a running process. Each Pi session has an isolated queue and context counter. Active events, dismiss times and history survive restart. An explicit destination lets a worker deliver to the session that launched it even if the user switches sessions meanwhile.

Offline tests covered reopen, forced process termination, concurrent writers, rollback and session isolation. Pi RPC checks exercised actual extension startup, session switching and restart without model inference. Persistence means accepted events survive; it does not mean the in-process HTTP endpoint receives while Pi is stopped.

The definition of `t-N` became precise: it counts context preparations since first visibility, not elapsed time or successful model requests. [Current store](../src/store.mjs) · [Offline integration](../tests/pi-sqlite.integration.mjs).

## 4. Run a broad comparison, including unsuitable cases

The next campaign deliberately widened the question. It compared notifications (`N`), fixed polling (`P10`), adaptive polling (`PA`) and a competitive wait tool (`W`). All could work with background jobs; waiting was not forced to block before independent work was finished. Notifications could use a final await fallback when no useful work remained, and that use was recorded.

Six controlled workloads covered a short wait, a longer wait, one background job with file work, six jobs finishing out of order, a failed/revoked result and a noisy result. Workers were real subprocesses with fixture-defined waits. File edits and tests were real; the controlled waits did not simulate an hour of productive coding.

Pi used `openai/gpt-6.1-sol`, thinking medium, in isolated fresh sessions. Measurement ran serially, retaining randomized orders. Seeds controlled fixture values and ordering, not deterministic model output. The harness counted actual outbound model HTTP attempts, tools, MCP calls, external API calls, token categories, full-turn time and tariff-based cost estimates.

The main phase had 120 runs: six workloads × four modes × five repetitions. Pilot, refinement, functional controls, confirmation and GitHub episodes brought the metered campaign to **270 runs**. It retained 258 correct runs, 11 development/infrastructure failures and one intentional negative control. There were no observed HTTP 429s in this campaign.

### Refine observed problems, then freeze a confirmation profile

The noisy full payload exceeded the core 8,000-character message limit and was rejected. Those runs stayed channel failures even when the agent later acquired the result through await. The six-job case also exposed repeated plan submission after dismissal in one run. These were reasons to change the approach, not remove inconvenient data.

Refinement compared v2/v3 prompts, `tail`/`before-input` layouts, a provider-specific explicit cache policy, full/compact summaries, and single/grouped dismiss. Correctness came before median cost in selection. Required facts were compacted equally for notifications and retrieval controls, preventing a verbose-baseline comparison.

The selected profile was v3, compact payloads, tail placement, the explicit stable-prefix cache adapter and grouped dismissal. Its source and hashes were frozen before **60 confirmation runs** on fresh seeds: the favorable and unfavorable development scenarios were both included, with ten pairs per control. All 60 were correct. Five further six-job lifecycle checks passed without repeated submission.

The clearest confirmed polling reduction came from the 90-second waiting workload. But N used await in all ten runs, and it did not meet the frozen benefit criteria against W. That result is about avoiding polling in a hybrid mode; it is not evidence of saving 90 seconds through independent work. The noisy holdout saved calls and time versus polling but cost more and used more tokens.

The independent-work development cases saved calls in some comparisons but also cost more. Absolute differences were often fractions of a cent or a few cents, so the report retains dollars alongside percentages. [All comparisons and intervals](benchmarks.md#efficiency-campaign).

### Check capabilities with ablations and a real external service

A functional test delivered an unknown external fact with zero MCP tool calls. Disabling delivery and retrieval left the fact unavailable in the negative control. MCP initialization still existed; zero tool calls did not mean there was no server connection. This demonstrated the bridge in this integration, not impossibility in all other event systems.

Other tests covered accepted-event persistence, idle backlog, hostile text and repeated messages. The core API still does not deduplicate repeated producer POSTs automatically.

GitHub tests dispatched real workflows through an MCP server and received signed `workflow_run` webhooks. Notification mode used the webhook-produced event stream rather than hidden GitHub status polling. Local waiting for delivery remained possible. The first dispatch exposed an HTTP 422 caused by adapter argument formatting; its failure and cost were retained, the adapter was repaired, and an extra pair completed coverage without overwriting the first attempt. A DNS/ping preflight failure occurred before inference and was kept separately.

Fourteen metered GitHub episodes produced thirteen correct outcomes and six valid pairs, two per success/failure/cancelled outcome. Remote scheduling was uncontrolled, so timings remain exploratory. This was not yet a full long-running “open a PR, do unrelated work, then react” workload. [GitHub evidence](benchmarks.md#github-actions-demonstration).

## 5. Refocus on useful work and independently inspect the pilot

Review with the author clarified that beating await while nothing else can be done was not the main objective. The revised question was whether incoming facts support useful actions while the agent continues another task, especially facts it did not know to request.

The [second research plan](../notification_research_plan_v2.md) separated an open-ended explorer, a fixed suite, an independent auditor and MCP-adapter preparation. Codex subagents inherited the coordinator’s model and used their own medium-detail AOVerview tasks. Pi sessions used Pi’s real defaults rather than the earlier campaign’s forced provider: **openai-codex/gpt-6.1-sol**, thinking medium. Changes to transport, configuration and measurement remained explicit.

The plan aimed first at roughly ten minutes of useful work, then 30–60-minute tests after review. Actual tasks ended earlier; artificial sleeps were not added to reach the target. The explorer’s completed turn lasted **212.329 seconds**, about 3 minutes 32 seconds. The 30–60-minute phase has not been run.

### Adapt a real Coordinator server

The preparation task used an isolated copy of [gabry848/agent-coordination](https://github.com/gabry848/agent-coordination), commit `84fa1a0e53342aa6bf41648aa1a4c2ed2512d9f3`, retaining its real store, conflict checks and MCP interface. Transactional board events fed a persistent outbox. Per-session subscriptions selected project, actor and destination; directed messages and self-event filtering reduced irrelevant delivery. The frozen transport copy added event identity and deduplication.

Polling and waiting controls read the same board events as the notification path. Backend outbox retries were counted separately from model tool calls. The board remained a coordination aid, not an orchestrator, and activities were not file locks. Four grouped preflight tests passed without inference. No production board, global MCP configuration or PR/release workflow was changed.

### Observe actions, then audit completion

The explorer built an HTTP/SQLite delivery hub with retry/reload policy. It completed 18 test milestones, with no MCP retrieval or await. Fourteen public-core milestones occurred before the external event; later CLI integration completed the useful action. The original checker incorrectly excluded a legitimate CLI path; the auditor retained that initial result and corrected its interpretation rather than altering the task outcome.

The fixed suite ran two groups sequentially, PA then N, each with three concurrent Pi actors—ingest, delivery and view—editing neighboring modules and a shared contract. Before measurement, the auditor caught future expected data leaked into a prompt and a transport path that was not frozen; both were corrected and their earlier versions retained.

PA completed. N produced artifacts passing the task oracle, but one actor’s turn and finish-activity lifecycle did not complete because the budget guard refused a new reservation. The W group was not run. Therefore there are **zero valid completed pilot efficiency comparisons**.

One N actor nevertheless supplied directly traceable useful-action evidence: after an external contract publication was acknowledged, it saw the fact in context after 5.28 seconds and edited the correct value after 20.53 seconds, without retrieving that fact. Peer turns were still open. PA’s corresponding observed action took 32.26 seconds after acknowledgement and used `get_updates`. This single incomplete-group case is not a general speed claim; an open peer turn also does not prove continuous CPU work.

The suite guard’s projected reservations crossed its $6 cap even though settled spending was much lower. This was a conservative concurrency reservation, not a provider 429 or demonstrated notification loss. All 148 pilot HTTP attempts were later reconciled to usage, with no unknown final reservations. [Audits, action timestamps and raw metrics](benchmarks.md#concurrent-work-and-agent-coordinator).

## 6. Investigate a runtime cost issue without changing the research target

The pilot also showed weak native cache reuse with request-local notification snapshots. A dedicated investigation froze the old runtime, reproduced prefix changes offline, and tested an immutable snapshot journal on real native Codex requests.

In six short controlled episodes, each making seven model HTTP requests, facts were also available through common tool outputs. This isolated cache behavior rather than the benefit of notifications. One triplet tested current, no-notification baseline and journal prototype; the other reversed the order around the applied fix.

The journal restored observed cache growth and lowered estimated cost versus the old notification layout. It did not achieve identical full-episode cost/cache fraction to the baseline. The applied episode had 70.72% cached input versus 77.10% for the baseline, and cost $0.082562 versus $0.0663836. Later warm-window fractions were closer, but do not replace these full-episode results. A second-request miss happened before nonempty events in two variants; its provider-internal cause was not observed.

The fix stores projection metadata in Pi sessions and teaches the prompt that only the last section is active. Offline durable-resume tests simulated provider responses without external HTTP. Forty-four unit tests and the offline Pi integration passed after loopback sandbox restrictions were handled. The six real episodes cost an API-equivalent $0.5190272. This was an implementation lesson, not a productivity benchmark or a general claim about provider internals. [Diagnosis, source freeze and checks](../research/cache-fix-20261006/report.md).

## 7. Preserve the record and state the remaining question

The final report combines three metered campaigns descriptively: **283 episodes, 2,359 model HTTP attempts, 7,498,153 cumulative tokens and $8.2978738 API-equivalent cost**, plus $0.096 estimated GitHub runner cost. These are not pooled causal results or an invoice. Initial behavior-stage usage and the Codex coordinator/subagents’ usage are outside that total.

The [data exports](benchmarks.md#consolidated-data) retain request-level records, run outcomes, paired comparisons and source manifests. Historical runtime copies and captures establish what actually ran; live README/specification files describe the present implementation and can evolve after those captures.

The next useful test is a complete, fairly controlled concurrent-work comparison, followed by calibrated longer tasks. Event arrival, exposure and correct action must remain separate. Fewer checks, less rework or earlier intervention may be useful even when token cost rises slightly; whether that tradeoff is worthwhile is a measured, workload-specific question. [Roadmap](roadmap.md).
