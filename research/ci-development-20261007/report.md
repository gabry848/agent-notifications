# CI results during independent development

Five complete paired trials passed the same independent correctness checks. Notifications reduced the median paired delay before the provider saw four identical initial CI outcomes by **94.64%**, but task completion changed much less: median paired verified time **−3.06%**, ranging from **−14.19% to +20.00%**. This workload supports earlier delivery; it does not establish a general productivity improvement.

## Measured results

N uses automatic Agent Notifications. PA uses competitive adaptive polling. Changes are `100 × (N − PA) / PA` for each pair, using that pair's PA value as denominator. Negative means fewer seconds, requests or tokens with N. Calibration is excluded.

| Pair | N verified | PA verified | Time change | Requests N / PA | Request change | Total-token change |
|---|---:|---:|---:|---:|---:|---:|
| p01 | 236.63 s | 244.08 s | −3.06% | 17 / 18 | −5.56% | +48.89% |
| p02 | 258.16 s | 261.18 s | −1.16% | 17 / 19 | −10.53% | +42.31% |
| p03 | 302.30 s | 251.92 s | +20.00% | 21 / 20 | +5.00% | +104.90% |
| p04 | 243.15 s | 283.35 s | −14.19% | 17 / 19 | −10.53% | +44.81% |
| p05 | 271.91 s | 316.81 s | −14.17% | 18 / 20 | −10.00% | +32.47% |

| Paired percentage change, five pairs | Median | Min–max | IQR |
|---|---:|---:|---:|
| Fully verified time | −3.06% | −14.19% to +20.00% | 13.02 percentage points |
| Provider requests | −10.00% | −10.53% to +5.00% | 4.97 points |
| Cumulative input/output tokens | +44.81% | +32.47% to +104.90% | 6.58 points |

The separate ratio-of-means changes are −3.33% time, −6.25% requests and +54.53% cumulative tokens. Their denominator is the PA arithmetic mean across the same complete correct pairs; they differ from median paired changes. Quartiles use linear interpolation at `(n−1)×p`.

All ten measured attempts passed the nine-group, 7,230-assertion independent oracle, preserved immutable public files, and had green current-revision CI at settlement. All Pi processes exited 0. Actual verified durations were 3.94–5.28 minutes; the intended 10–15-minute target was not reached and no time was added to extend the workload.

## Delivery during useful work

The fixed initial checks `ci-0001`–`ci-0004` test identical starting source bytes in both modes, with identical integrity/CSV/version/catalog queues of 0/30/60/90 seconds. This secondary delivery-only subset was requested after p03; it was not a preregistered primary endpoint. Later job counts depend on implementation choices and are not used for this subset comparison.

Exposure is the first provider payload containing the specific terminal result event ID, measured from result publication. Tool return time is retrieval; a queued/running job ID does not count as terminal-result exposure. All 40 measured initial outcomes reached the provider; obsolete results remain included.

| Pair | N median initial delivery delay | PA median initial delivery delay | Paired change | Stale at exposure N / PA |
|---|---:|---:|---:|---:|
| p01 | 2.02 s | 95.43 s | −97.88% | 2 / 4 |
| p02 | 3.58 s | 49.63 s | −92.78% | 2 / 4 |
| p03 | 5.69 s | 60.64 s | −90.62% | 3 / 4 |
| p04 | 6.53 s | 121.68 s | −94.64% | 2 / 4 |
| p05 | 4.04 s | 115.90 s | −96.51% | 3 / 4 |

Median paired delivery change is −94.64% (range −97.88% to −90.62%; IQR 3.74 percentage points). The medians of the five per-trial four-event delays are 4.04 s N and 95.43 s PA. These are delivery observations, not a repair or task-completion speedup.

PA proactively repaired the documented starter helpers before seeing their failed CI results in every measured pair. Staleness at publication and at first exposure are both retained. When relevant source changed before exposure, action/verification reaction latency is null, even if newer CI had not yet finished. In p03, all red results were stale by exposure in both modes, including N. Automatic delivery cannot be credited with those proactive repairs.

N made 3–4 source-changing tool results overlapping queued/running CI per measured attempt; PA made 3–6. This confirms coding occurred while actual checks ran, with final correctness verified independently; it does not measure continuous work or establish causality. N made 6 batched status queries in total, PA 10. Neither mode made an empty check or used `ci_wait`; there were no technical CI errors or unexposed terminal results.

## Workload and reproducibility

The agent builds a dependency-free Node 24 package catalog: robust CSV and semantic versions, transaction-safe catalog storage, combined search/paging, dependency planning, atomic CSV/UTF-8 NDJSON transfers, an HTTP API, persistent file CLI, meaningful regression tests and usage documentation. Independent modules allow useful coding while CI passes or fails.

Both modes used Pi 0.99.2 and the actual installed default `openai-codex/gpt-6.1-sol`, medium thinking, native provider caching. Prompt, model settings, file tools, notification cleanup/history tools and batched `ci_status` / `ci_wait` were identical. N additionally delivered external CI data at the next natural context preparation through the current journal adapter. PA queried adaptively and worked between checks. Each run received one initial prompt; neither mode received follow-up prompts, wakeups or stream steering. Provider runs were serialized.

The [preregistered design](design.md), [scaffold specification](scaffold/README.md) and [frozen manifest](frozen.json) were recorded before inference. Initial queue offsets were 0/30/60/90 s; source-change CI queues were 10 s, followed by real tests. Queue, execution start, completion and publication have separate timestamps. Queueing staggers outcomes; it does not pad agent duration.

CI tests immutable copied source trees. Advertised revisions and tested-file hashes are computed after copying, including transitive literal imports. Each result identifies its tested revision and a unique terminal event ID. Current status is recomputed on retrieval to prevent an immediately preceding edit from exposing obsolete green status. The independent reference passes; original CSV/version/catalog fail meaningful boundaries. The agent worktree contains no hidden oracle/reference implementation.

The stopping rule was natural settlement or a 30-minute wall timeout. Correctness required the final oracle, unchanged specification/package/public tests, and all current CI green at settlement. Primary duration ends after independent verification. Agent settlement duration and obsolete-job cleanup are separate. No monetary reservation or request-count guard stopped runs. Fixed order was p01 N→PA, p02 PA→N, p03 N→PA, p04 PA→N, p05 N→PA (seed 20261007); every attempt is preserved.

## Accounting and calibration

Measured N used 90 logical model requests, 90 provider HTTP attempts and 90 settled responses; PA used 96/96/96. All response-level raw and Pi input/output/cache usage reconciled, with no retries, unresolved attempts or provider errors. Cumulative input includes cached input and is not billable uncached usage. Reasoning tokens are a subset of output, not added twice. No price or billing claim is made.

| Measured total | N | PA |
|---|---:|---:|
| Full input tokens, including cache | 1,331,803 | 845,197 |
| Output tokens | 47,338 | 47,278 |
| Cached input tokens | 1,101,184 | 668,544 |
| Uncached input tokens | 230,619 | 176,653 |

Calibration is separate: N 328.49 s / 21 requests, PA 295.36 s / 19 requests, both correct. N used 11.22% more verified time and 92.50% more cumulative tokens, despite earlier CI exposure. This was preserved without winner-based workload tuning. Across calibration plus measured attempts, all 226 requests and responses reconcile.

Offline source/status/wait fixtures, zero-inference Pi transport startup, notification delivery and seven current journal/cache tests passed. An initial offline fixture expected HTTP 202, but the adapter correctly returned 201; that failed setup attempt and corrected validation remain under `offline/`. Numeric provider usage is deduplicated by response ID, so an attribution-only terminal frame cannot overwrite valid totals. Analysis-only amendments and prior versions are retained in [analysis-amendments.json](analysis-amendments.json) and [manifests/](manifests/); task/runtime identity remained unchanged.

## Evidence and limits

- [Machine-readable primary metrics](metrics.json): every attempt, full usage, per-event exposure/staleness and verified source-action timing.
- [Fixed-initial delivery evidence](delivery.json) and its [reproducible analyzer](delivery.mjs): source-byte equality, all events, stale flags and unexposed counts.
- [Artifact audit](audit.json): immutable snapshot hashes, unchanged workload/runtime, event classifications and sanitation scan.
- [Complete calibration pair](calibration-pair.json), excluded from measured estimates.
- Every `runs/` attempt contains sanitized RPC/provider/tool/CI/notification traces, source snapshots, final oracle output and resolved configuration. Authentication remains an ignored symlink; credential contents were not copied or logged.

```sh
node research/ci-development-20261007/offline.mjs
# A provider run requires the parent's explicit scheduling release:
CI_INFERENCE_GO=1 node research/ci-development-20261007/run.mjs measured p01 N
node research/ci-development-20261007/analyze.mjs
node research/ci-development-20261007/delivery.mjs
node research/ci-development-20261007/audit.mjs
```

This is a small exploratory cohort on one controlled workload. Sequential runs and alternating order reduce contention but do not eliminate time/provider variation. There was a 170-minute operator gap between p05 N's verified finish (09:42 UTC) and PA's start (12:32 UTC); no CI provider remained active in that gap. The pair is retained, and the gap increases temporal uncertainty. These seconds describe model visibility, not human notification latency. Failures or incomplete trials could not become efficiency wins; none of the online attempts was incomplete. Earlier exposure is clear here, but a broad completion or token-saving claim is unsupported.
