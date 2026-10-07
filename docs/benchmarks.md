# Benchmarks, evidence and technical files

This index covers the recorded research, including unfavorable and incomplete results. The tables summarize selected questions; the linked exports contain every measured run and all 196 paired metric comparisons. [README](../README.md) · [Research story](research-story.md) · [Interactive report](../research/final-20261006/research.html).

## Reading the numbers

Model HTTP attempts, model responses, tool executions, MCP tool calls and backend API requests are different counts. Tokens are cumulative across requests, including reread cached input; they are not unique conversation length. Reasoning tokens are already within output. Full-turn time includes the final response and verification, not only the first submission. Concurrent group duration is the longest actor turn, not the sum of overlapping turns.

Costs are **API-equivalent estimates at frozen tariffs**, including cache categories. They are not verified subscription invoices. Unknown data is `null`, not zero. Report dollar differences alongside percentages: a large relative change can represent a fraction of a cent. Initial behavior-stage usage and Codex coordinator/subagent usage are outside the metered totals below.

Comparisons use complete, correct pairs matched by scenario, seed and phase, with paired bootstrap intervals. The exports also retain failures and their costs. A seed fixes fixture/order, not model sampling. “Median saved” is the median of paired control-minus-notification differences; a negative saving means N used more. Exploratory selection is distinct from frozen confirmation.

## Consolidated data

| Metered campaign | Episodes | Model HTTP attempts | Cumulative tokens | API-equivalent USD | Scope |
|---|---:|---:|---:|---:|---|
| Broad efficiency campaign | 270 | 2,169 | 4,701,546 | $5.9629926 | Short workloads, refinement, holdout, functional tests, GitHub |
| Concurrent-work pilot | 7 | 148 | 2,066,247 | $1.8158540 | Explorer + two three-agent groups; N incomplete |
| Native cache investigation | 6 | 42 | 730,360 | $0.5190272 | Controlled cache fixtures, not productivity |
| **Descriptive total** | **283** | **2,359** | **7,498,153** | **$8.2978738** | Not a pooled efficiency comparison |

Estimated GitHub runner cost was another **$0.096**, making the covered estimate **$8.3938738**. This is not the invoice or the cost of all project work. The 42 initial behavior attempts are separate.

- [Complete JSON](../research/final-20261006/data.json), [283 runs](../research/final-20261006/runs.csv), [2,359 request records](../research/final-20261006/requests.csv), [196 comparisons](../research/final-20261006/comparisons.csv), [42 initial observations](../research/final-20261006/initial-observations.csv).
- [Source manifest](../research/final-20261006/source-manifest.json), [data reconciliation](../research/final-20261006/data-verification.json), [report verification](../research/final-20261006/verification.json), [report builder](../research/final-20261006/build.mjs).

These reports preserve the sources as captured. Live documentation may change after a manifest was generated; the frozen experiment source copies establish the runtime used for a measurement.

## Initial behavior experiments

The initial lab used `openai/gpt-6.1-sol`, thinking medium, with a staged invoice-service planning task and the earlier **in-memory** store. Gates controlled source-read/event order. Eight cases tested relevance, plan change, noise, persistence, dismiss/history, idle backlog, contradictions/duplicates and hostile data.

| Stage | Attempts / selected outcomes | Technical record |
|---|---|---|
| First smoke | 1 timeout before first source read | [Summary](../artifacts/smoke-v1/summary.json), [case captures](../artifacts/smoke-v1/relevant-1/) |
| Fixed smoke | 1 passing attempt | [Summary](../artifacts/smoke-fixed-v1/summary.json) |
| Baseline v1 | 24 original attempts | [Summary](../artifacts/baseline-v1/summary.json), [all cases](../artifacts/baseline-v1/) |
| Retry v1 | 7 additional attempts; originals retained | [Summary](../artifacts/retry-v1/summary.json) |
| Consolidated v1 | 24/24 selected correct outcomes from 31 attempts | [Provenance and outcomes](../artifacts/baseline-final-v1/summary.json) |
| Refined v2 | 9/9 correct; relevant/persistent/hostile × 3 | [Summary](../artifacts/refined-v2/summary.json) |
| Payload verification | 33/33 selected checks passed | [Verification](../artifacts/verification.json) |

Do not add consolidated outcomes to the original attempt count. Usage/cost for this stage is not reconciled into the efficiency totals. Capture-level evidence is in each case’s `spec.json`, `summary.json`, `provider.jsonl`, `runtime.jsonl` and `events.jsonl`.

[Scenario definitions](../experiments/scenarios.mjs) · [Runner](../experiments/run.mjs) · [Consolidation](../experiments/consolidate.mjs) · [Verifier](../experiments/verify-artifacts.mjs). The legacy verifier expects its original one-block format and prompt; do not apply it unmodified to later journal captures or changed prompts.

## Efficiency campaign

The main experiment compared N, fixed polling P10, adaptive polling PA and wait W. P10 required at least ten seconds between checks; PA used minimum pauses of 2/4/8/16/30 seconds, then 30. Polling could return all relevant job states together. W could do independent work before waiting. N could await only as a recorded fallback when useful independent work was exhausted.

| Scenario | Controlled work |
|---|---|
| S1 | One 2-second job, no independent file work |
| S2 | One 90-second job, no independent file work |
| S3 | One 20-second job plus independent module edits/tests |
| S4 | Six jobs completing after 60/10/40/20/50/30 seconds, one failure, plus file work |
| S5 | Failure/revocation after ten seconds plus file work |
| S6 | Ten-second job, large diagnostic and 19 irrelevant updates, plus file work |

The jobs were separate subprocesses with controlled waits, not production builds. Edits/tests across eight fixture modules were actual work. Fresh isolated Pi sessions used `openai/gpt-6.1-sol`, thinking medium, with serial measurement and retained randomized orders. The main phase had 120 runs. The complete 270-run campaign had **258 correct, 11 failed and one intentional negative control**. No 429 was recorded.

### Exploratory main phase: N versus PA

| Scenario | Correct complete pairs | Model HTTP saved | Total tokens saved | Full-turn seconds saved | Additional N cost, USD |
|---|---:|---:|---:|---:|---:|
| S1 | 5 | 1 | −1,252 | 2.51 | +$0.0012747 |
| S2 | 5 | 11 | 14,188 | 21.98 | −$0.0033195 |
| S3 | 5 | 3 | 2,740 | 3.07 | +$0.0162561 |
| S4 | 4 | 6.5 | 20,680.5 | 16.49 | +$0.0219337 |
| S5 | 5 | 2 | −616 | −5.71 | +$0.0166500 |
| S6 | 0 valid notification-channel pairs | — | — | — | Full notification messages rejected |

S1’s call/time intervals, S3’s token interval and S5’s time/token intervals include zero. S4 had one notification lifecycle failure among five attempts; its costs and repeated submission remain in the exports. S6 plans recovered through await do not turn rejected notifications into channel successes. [All baseline modes, intervals and failures](../artifacts/benchmark-real-20261006-r1/results.json).

### Frozen confirmation

Refinement selected v3, compact payloads, tail position, an explicit stable-prefix provider cache adapter and grouped dismiss. All modes got equivalent required facts and the selected cache policy. This adapter is separate from the later native Codex journal. Correctness preceded cost in selection; source hashes were frozen before new seeds. The holdout had 60/60 correct runs, ten pairs per row below.

| Comparison | Model HTTP saved | Tokens saved | Full-turn seconds saved | N cost change, USD |
|---|---:|---:|---:|---:|
| S2 N vs PA | 11 | 14,058.5 | 20.19 | −$0.00639075 |
| S2 N vs W | −1 | −4,050 | −3.65 | −$0.00059860 |
| S6 N vs P10 | 2 | −4,517 | 6.07 | +$0.01264800 |

S2 vs PA reduced cost by 45.37%, but N used await in **10/10** runs. It did not meet the frozen benefit criteria versus W; the time interval there includes zero. S6 vs P10 reduced requests by 22.22% and full-turn time by 18.29%, while increasing estimated cost by 62.99%. Two of its ten N runs used await. Full confirmation includes the S6 wait control as well; no benefit over W met the criteria.

| Campaign component | Technical files |
|---|---|
| All outcomes and presentation | [JSON](../artifacts/benchmark-real-20261006-r1/results.json), [CSV](../artifacts/benchmark-real-20261006-r1/results.csv), [findings](../artifacts/benchmark-real-20261006-r1/findings.md), [overview](../artifacts/benchmark-real-20261006-r1/overview.html) |
| Model/provider and budget | [Manifest](../artifacts/benchmark-real-20261006-r1/manifest.json), [ledger](../artifacts/benchmark-real-20261006-r1/budget.sqlite), [meter](../benchmark/meter.mjs) |
| Definitions and controls | [Method](../benchmark/README.md), [scenarios](../benchmark/scenarios.mjs), [MCP jobs server](../benchmark/jobs-server.mjs), [worker](../benchmark/worker.mjs), [client](../benchmark/pi-client.mjs) |
| Pilot/main orders | [Pilot order](../artifacts/benchmark-real-20261006-r1/pilot-v2-full-order.json), [main order](../artifacts/benchmark-real-20261006-r1/main-v2-full-order.json) |
| Refinement, including negative candidates | [Prompt order](../artifacts/benchmark-real-20261006-r1/refine-prompt-order.json), [layout order](../artifacts/benchmark-real-20261006-r1/refine-layout-order.json), [payload order](../artifacts/benchmark-real-20261006-r1/refine-payload-order.json), [dismiss order](../artifacts/benchmark-real-20261006-r1/refine-dismiss-order.json), [selection](../artifacts/benchmark-real-20261006-r1/selected.json) |
| Holdout | [Frozen profile](../artifacts/benchmark-real-20261006-r1/confirmation-frozen.json), [source copy](../artifacts/benchmark-real-20261006-r1/frozen-runtime/), [order](../artifacts/benchmark-real-20261006-r1/confirmation-order.json) |
| Functional controls | [Utility script](../benchmark/utility.mjs), [negative ablation](../artifacts/benchmark-real-20261006-r1/utility-negative-control.json), [regression](../artifacts/benchmark-real-20261006-r1/regression.json) |
| Earlier infrastructure/preflight records | [Early campaign](../artifacts/benchmark-real-20261006/), [budget-guard attempt](../artifacts/benchmark-budget-guard-20261006/), [verified guard check](../artifacts/benchmark-budget-guard-verified-20261006/), [preflight](../artifacts/benchmark-preflight-20261006/) |

Every metered run has its own directory, for example [confirmation S2 seed 1001](../artifacts/benchmark-real-20261006-r1/confirm-S2-1001-N-v3-compact-stable-batch/): specification, summary, prepared payloads, provider-final records, runtime/MCP/event logs, queue database, task artifacts and verification. Use the run ID in JSON/CSV to find the rest. Earlier infrastructure attempts are preserved separately, not silently added to the 270-run population.

## Unfavorable results

Waiting-only tasks do not establish the main independent-work use case. Noise, repeatedly active facts and management calls can outweigh avoided checks. S6’s rejected full payload and S4’s repeated plan exposed concrete failures; compact equivalent facts and stricter lifecycle instructions were tested rather than silently deleting those attempts.

Four-pair grouped-dismiss refinement was exploratory. Later wildcard `*` clears all active events with one call, but events arriving before execution can also be cleared unseen. Neither feature removes the need to preserve unresolved facts. Native cache was another material source of overhead, investigated separately below. No completed long-duration efficiency conclusion follows from these short runs.

## GitHub Actions demonstration

Real workflows tested success, failure and cancellation, with notification delivery via signed webhooks and P10 status polling controls. Fourteen metered episodes yielded thirteen correct outcomes and **six valid pairs**, two per conclusion. The first success N attempt failed with adapter HTTP 422; an added pair repaired coverage while preserving that attempt and its cost.

For success, N saved a paired median of one model HTTP request and **$0.0032735**, but used 2,544 more tokens. Full-turn saving was 3.79 seconds with an interval spanning zero. Scheduling/cancellation timing was uncontrolled, so this is a small external-service demonstration, not a confirmed latency estimate for notifications. Local await of webhook events is not GitHub status polling. The broader PR-plus-independent-work proposal remains untested.

[Harness](../benchmark/github/run.mjs) · [MCP adapter](../benchmark/github/server.mjs) · [Signed receiver](../benchmark/github/webhook.mjs) · [workflow](../benchmark/github/bench.yml) · [adapter repair](../artifacts/benchmark-real-20261006-r1/github-adapter-repair.json) · [preflight record](../artifacts/benchmark-real-20261006-r1/github-preflight-supplemental.json) · [supplemental successful preflight](../artifacts/benchmark-real-20261006-r1/github-preflight-supplemental-r2.json).

Each GitHub run retains external API invocation counts and receiver/job timestamps, for example [success N seed 3003](../artifacts/benchmark-real-20261006-r1/github-GH-success-3003-N-v3-compact-stable-batch/github-evidence.json). Driver reads, server calls and automatic fixture cancellation are distinguished. [Cleanup](../artifacts/benchmark-real-20261006-r1/cleanup-verified.json).

## Concurrent work and Agent Coordinator

The pilot used Pi’s registered defaults: openai-codex/gpt-6.1-sol, thinking medium. SSE was forced equally, optional automatic context was disabled, and real provider HTTP attempts were metered. These deviations are recorded. The runtime was frozen before measurement, and the revised plan had separate adapter, explorer, fixed-suite and auditor tasks with AOVerview reporting.

| Episode/group | Completion | Model HTTP | Tokens | Tools / MCP tools | `get_updates` / await | API-equivalent USD |
|---|---|---:|---:|---:|---:|---:|
| Explorer, one Pi | Complete, 212.329 s | 12 | 120,648 | No MCP or await | 0 / 0 | $0.1405600 |
| PA, three Pi actors | Complete, longest turn ≈209.43 s | 82 | 1,168,728 | 124 / 63 | 16 / 4 | $0.5027344 |
| N, three Pi actors | Artifacts passed; one turn/lifecycle incomplete | 54 | 776,871 | 131 / 49 | 0 / 5 | $1.1725596 |
| W | Not run | — | — | — | — | — |

The explorer delivered an external retry/reload policy during development of an HTTP/SQLite hub. Eighteen test milestones completed, fourteen before the event. It is a positive useful-work case with no paired baseline, not an efficiency comparison.

The suite actors edited ingest, delivery and view modules plus a shared contract. N received 72 notifications covering 66 unique identities, with 155 exposure appearances and six late arrivals left as backlog. No out-of-scope changes, deleted required exports or lost handoff were found by the oracle; that does not establish general race freedom.

The view actor received the relevant value `192` through context after 5.28 seconds and edited it after **20.53 seconds** from producer acknowledgement, while peers’ turns were open. PA’s corresponding edit followed 32.26 seconds after acknowledgement through retrieval. The N actor’s later incomplete turn prevents a full speed/cost win. Raw group tool/cost totals likewise are not a valid completed efficiency comparison.

The guard projected settled usage + pending reserves + a new reserve above its $6 cap. It blocked before HTTP, not because of an observed rate limit. All 148 attempts were reconciled; unknown final reservations were zero. Overlap was audited by distinct verified file versions, avoiding repeated checks being counted as independent progress.

| Pilot component | Technical files |
|---|---|
| Mandate and aggregate report | [Plan](../notification_research_plan_v2.md), [campaign](../research/notification-work-pilot-20261006/campaign.json), [report JSON](../research/notification-work-pilot-20261006/report-data.json), [HTML](../research/notification-work-pilot-20261006/research.html) |
| Real Coordinator adaptation | [Report](../research/notification-work-pilot-20261006/adapter/report.md), [server](../research/notification-work-pilot-20261006/adapter/coordinator_server.py), [upstream copy](../research/notification-work-pilot-20261006/adapter/upstream_server.py), [ready/freeze](../research/notification-work-pilot-20261006/adapter/ready.json), [source hashes](../research/notification-work-pilot-20261006/adapter/source-hashes.json), [preflight tests](../research/notification-work-pilot-20261006/adapter/preflight.test.mjs) |
| Open-ended explorer | [Report](../research/notification-work-pilot-20261006/explorer/report.md), [experiments](../research/notification-work-pilot-20261006/explorer/experiments.md), [metrics JSON](../research/notification-work-pilot-20261006/explorer/metrics.json), [CSV](../research/notification-work-pilot-20261006/explorer/metrics.csv), [runner](../research/notification-work-pilot-20261006/explorer/run.mjs) |
| Fixed suite | [Report](../research/notification-work-pilot-20261006/suite/report.md), [metrics JSON](../research/notification-work-pilot-20261006/suite/metrics.json), [CSV](../research/notification-work-pilot-20261006/suite/metrics.csv), [frozen runtime](../research/notification-work-pilot-20261006/suite/runtime-frozen.json), [runner](../research/notification-work-pilot-20261006/suite/run.mjs), [oracle](../research/notification-work-pilot-20261006/suite/oracle.mjs) |
| Independent checks | [Audit report](../research/notification-work-pilot-20261006/audit/report.md), [action evidence](../research/notification-work-pilot-20261006/audit/contract-action-evidence.json), [guard diagnosis](../research/notification-work-pilot-20261006/audit/reservation-guard-diagnostic.json), [usage reconciliation](../research/notification-work-pilot-20261006/audit/usage-reconciliation.json), [overlap versions](../research/notification-work-pilot-20261006/audit/overlap-versions.json), [notification residuals](../research/notification-work-pilot-20261006/audit/notification-residuals.json) |
| Accounting | [Shared ledger](../research/notification-work-pilot-20261006/budget.sqlite), [Coordinator analysis](../research/notification-work-pilot-20261006/coordinator-analysis.json) |

## Native cache investigation

Six complete episodes, 42 HTTP attempts and **$0.5190272** tested a frozen old layout, no-notification baseline and immutable journal. Each episode made seven requests and six fixture tool calls. Common tool outputs supplied the facts too, isolating context/cache behavior rather than notification utility. Order was changed between triplets; all settings matched within each triplet.

| Triplet | Old notification layout: cached input / cost | No-notification baseline | Journal |
|---|---|---|---|
| Prototype | 50.00% / $0.1293484 | 76.90% / $0.0666424 | 76.83% / $0.0680368 |
| Applied fix | 60.08% / $0.1060540 | 77.10% / $0.0663836 | 70.72% / $0.0825620 |

The journal reduced cost versus the old layout by $0.0613116 and $0.0234920, respectively. The applied fix still exceeded its baseline by $0.0161784 and added 2,374 cumulative input tokens. Later requests 4–7 had 84.47% cached input for the fix versus 84.88% for the baseline; that warm-window view does not replace full-episode accounting. Two variants had a second-request miss before nonempty events, with no observed server-internal explanation.

Offline serialization showed why replacing old snapshots changed previously sent prefixes. Anchored immutable observations restored cache growth in these tests. Saved-session journal resume was tested with simulated provider responses and no external HTTP. This does not prove identical cache behavior for all providers, fix the historical pilot retroactively or establish productivity savings.

[Report](../research/cache-fix-20261006/report.md) · [metrics JSON](../research/cache-fix-20261006/metrics.json) · [CSV](../research/cache-fix-20261006/metrics.csv) · [experiment log](../research/cache-fix-20261006/experiments.md) · [frozen control](../research/cache-fix-20261006/control-freeze.json) · [source hashes](../research/cache-fix-20261006/source-hashes.json) · [runner](../research/cache-fix-20261006/run.mjs) · [ledger](../research/cache-fix-20261006/budget.sqlite) · [verification](../research/cache-fix-20261006/verification.json) · [test results](../research/cache-fix-20261006/tests-verification.json) · [durable-resume assertions](../research/cache-fix-20261006/offline/durable-resume/assertions.json) · [root review](../research/cache-fix-20261006/coordinator-review.json).

## Reproduction boundaries

Start with offline transport/oracle checks. For a new measured campaign, freeze runtime, prompt, facts, controls, accounting and concurrency before new seeds, and use a new output directory. Real inference and GitHub workflows are separate from offline checks. Existing artifacts should not be overwritten to fit current code. The detailed historical command recipes are in [benchmark/README.md](../benchmark/README.md); [Pi setup](pi-adapter.md) covers the present adapter.

There is currently no completed 30–60-minute efficiency benchmark, no production deployment evidence, no tested Jev filter and no standalone Codex/DeepSeek/oh-my-pi adapter. These remain [next steps](roadmap.md), rather than implicit results of the 283 episodes.
