# Explorer — bounded first pilot

Status: design and offline fixture preparation. No measured Pi request authorized yet.

## Open goal and selected hypotheses

Explore where context notifications benefit useful concurrent work; preserve ties and losses. I selected a real implementation workload rather than another wait-and-submit fixture: a local webhook delivery hub with validation, matching, subscriptions, deduplication, retries, persistence, routing and bounded delivery.

Two candidate conditions, each compared across N, PA and W (maximum six measured Pi sessions):

1. **Actionable external compatibility report.** A background corpus audit derives deployment constraints. It publishes after the agent has demonstrated useful implementation progress. The constraints are data under the initial task's authority, never executable instructions. The agent can apply them while continuing development. The live server reloads payload limits without restart and the HTTP sender reloads retry caps between attempts: these are operational consequences, not only fields in a final note.
2. **Informative report control.** The same audit publishes a summary which does not change routing rules. The task still includes a small final release note, but the update should not force an interruption. This can expose notification overhead or a tie when a single final await is sufficient.

The event source is a controlled laboratory fixture. It starts a real independent Node worker after three public tests pass; that worker aggregates the corpus and immediately publishes its computed result. The progress trigger is synthetic scheduling, not a claim about production latency, and actual computation may be very short. No sleeps or filler keep Pi busy. The workload is aimed at about ten minutes but actual duration is recorded, even if much shorter.

## Comparable scheduling

All modes can edit files and run tests while the producer runs. All see the same initial contracts, corpus, facts and event ordering. N receives the report through the frozen notification extension at the next context boundary. PA uses a `get_updates` snapshot at sensible work boundaries, with pending-check backoff 2/4/8/16/30 seconds. W can postpone `await_update` until a natural boundary or the final release note; it is not forced to block upfront or await all work. Native file/bash tools remain available.

N uses no history, polling or await while useful work remains. If required final facts are still absent at the end, an explicitly counted fallback makes the run hybrid. No-event control and malformed/duplicate behavior can be checked offline, without spending extra Pi sessions.

## Evidence and acceptance

Each run gets an immutable fixture copy, run ID, actual default provider/model, UUID, SQLite DB and trace paths. The runtime hashes are frozen before execution. Full task correctness requires independently passing implementation tests plus a release artifact matching the published report. Do not reward self-reported completion.

Record model attempts/usage/errors, native and source-tool calls, elapsed/settled time, event production/ingress/context exposure/first useful implementation action, real test milestones and source changes before and after the event. Overlap is verified completed milestones during the interval before report publication; it is not estimated from narrative. Reinjection and dismissal counts come from SQLite/context traces.

Workload construction, offline tests and expected failures are preparation, not successful Pi sessions. With only one pair per mode and condition this is exploratory, not statistical confirmation. Candidate workloads, tools, scheduling and thresholds must be frozen before the paid gate opens.

## Limits

Maximum six measured Pi runs, **two USD API-equivalent reference cap** (root reassigned the original four USD allocation before any run), no 30–60 minute extension, no credentials printed or changed. Actual Codex subscription charges are unknown and are not claimed as the reference estimate. No transport/production changes. Unknown pricing blocks measured calls until root provides reliable accounting or an approved bounded alternative.
