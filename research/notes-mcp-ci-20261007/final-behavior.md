# What the Notes runs showed

All five matched pairs built a correct persistent notes app. Notifications changed median paired verified time by **+1.63%**, with a range of **-23.29% to +30.71%**. Median paired model-request change was **0%** and total-token change was **+40.08%**. Each percentage uses that pair's adaptive-polling value as denominator; calibration is excluded. This small sample does not establish a complete-task speedup or a token saving.

## Delivery and useful work

The two fixed initial jobs test identical source bytes and have the same terminal status within every pair. In all ten matched initial-job comparisons, the terminal result reached the provider sooner with notifications. Exact delays and stale flags are in [initial-delivery.md](initial-delivery.md). Later agent-submitted jobs are kept separate because their snapshots and counts depend on implementation choices.

Both modes continued coding while CI was queued or running: notification runs had 3–6 source-changing tool results overlapping pending CI, polling runs 5–8. These are discrete observed edits, not a measure of continuous work or causal productivity. There were 4 batch status reads across the five notification runs and 10 across polling runs; median paired status-read change was -50%. Neither mode made an empty status check.

Every measured terminal result was eventually visible in a provider request. There were **zero actionable current-source failures at first exposure** across the ten measured runs. Agents proactively changed the supplied defective source before seeing its old failure. Earlier delivery of stale CI results cannot be credited as faster bug correction. This workload demonstrates delivery during real coding, but does not provide a current-failure repair-speed comparison.

## Verification and limits

All ten apps passed the nine independent acceptance checks and latest applicable storage/MCP/web CI. The audit verifies all 68 measured CI snapshots, 24 frozen input hashes and all 219 measured provider HTTP attempts with response-level raw/Pi usage reconciliation. Locked public inputs remained unchanged. See [audit.json](audit.json) and [metrics.json](metrics.json).

Verified runs lasted 4m41s–6m49s. The planned 10–15-minute workload duration was not reached; no idle padding was added. Pair 1 ran on 2026-10-07, and pairs 2–5 resumed on 2026-10-08 after user approval. The same frozen v3.1 inputs and resolved Pi/model/thinking/transport/compaction/retry settings were retained. Sequential runs and alternating mode order reduce contention, but the day-long gap and provider/time variability remain limitations. Workloads and calibration versions are not pooled.

Acceptance covers the official MCP SDK, cross-process SQLite persistence, HTML forms and HTTP APIs. Browser JavaScript and visual layout remain outside coverage. Total tokens include cached input and output; they do not represent billable uncached usage or a monetary cost.

The original technical calibration failures and corrected offline evidence remain preserved. All measured pairs use the same corrected oracle; no failed attempt was overwritten or converted into an efficiency win.
