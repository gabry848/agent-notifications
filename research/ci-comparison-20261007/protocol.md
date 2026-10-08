# Paired CI notification benchmarks

## Question

Does automatic delivery of asynchronous CI results help Pi complete useful coding work correctly and sooner than retrieving the same results through adaptive polling?

Two independently prepared workloads cover development in an existing package-catalog project and construction of a SQLite notes MCP server with a small web dashboard. Each workload has its own scaffold, CI fixtures, oracle, frozen protocol and results. Results are not pooled across projects.

## Common controls

- Use Pi 0.99.2 with the actual installed defaults: `openai-codex/gpt-6.1-sol`, thinking medium. Recheck before inference.
- Use the current notification journal adapter, isolated configuration and fresh work directories. Keep the provider, transport, tools, prompt, task, fixtures and CI scheduling equivalent within each pair. Record all necessary configuration deviations.
- Both modes can retrieve CI results, batch status checks and wait when independent useful work is exhausted. Automatic context delivery is the treatment. Polling may continue useful work between checks.
- Results come from tests executed against immutable code snapshots, carrying a job ID and source revision. Success, failure and obsolete results all need appropriate handling.
- Simulated CI queue delays may stagger real test execution. Declare identical scheduling in both modes and record queue, start, completion and publication times. Do not lengthen agent work with idle waits.
- Notification arrival does not wake an idle agent or interrupt a running tool/model request. No operator prompt steering substitutes for automatic delivery.
- Validate the runner, notification projection, metering and independent correctness oracle offline first. Review setup before releasing inference.
- Prepare workloads in parallel; serialize measured Pi workloads across benchmark operators to reduce local/provider contention. Alternate or randomize mode order within each workload, recording the order.
- Separate calibration from measured repetitions. Aim for five complete pairs per workload, with three as the exploratory minimum if a recorded constraint prevents five. Preserve every attempt and explain exclusions. Freeze workload changes before measured repetitions.
- Aim for substantial real implementation work, approximately 10–15 minutes after calibration. Report actual duration even when naturally shorter. A reasonable per-run timeout is 30 minutes; timeout results remain incomplete evidence.

## Measurements

1. Correctness and full time to verified completion using an independent final oracle; include required CI outcomes and final verification in the stopping rule.
2. CI result publication to first provider exposure, first relevant code action and first verified successful correction. Declare the timing origin and retain events with no action required.
3. Real edits/test milestones while CI is active, empty status checks, fallback waits, stale/ignored/missed/late results and task failures.
4. Model HTTP attempts and cumulative input/output/cache tokens. Supporting cache/accounting diagnostics do not replace behavioral results.

For a complete, correct matched pair, report change as `100 × (notifications − polling) / polling`. Summaries use paired changes and show their sample size and spread. Incomplete or incorrect pairs do not become efficiency wins; their outcomes remain visible. A faster reaction to one event does not establish a faster complete task.

## Artifacts and ownership

- Coordinator: `research/ci-comparison-20261007/`.
- CI development operator: `research/ci-development-20261007/`.
- Notes MCP operator: `research/notes-mcp-ci-20261007/`.

Each operator preserves a runnable harness, immutable input hashes, sanitized traces, per-run application artifacts, final oracle evidence, machine-readable paired metrics and an English report. Existing README and historical benchmark files remain outside this experiment's editing scope.
