# CI while Pi codes

Pi implements useful features while real tests run against frozen code snapshots. We compare automatic results from Agent Notifications with adaptive batch polling.

Final results.

| Task | Correct matched pairs | Verified time | Model requests | Total tokens |
|---|---:|---:|---:|---:|
| Catalog CI | 5 | -3.1% | -10.0% | +44.8% |
| Notes app | 5 | +1.6% | +0.0% | +40.1% |

Changes are median paired percentages relative to polling: `100 × (notifications − polling) / polling`. Negative means less. Time includes final independent verification. Model requests are actual provider HTTP attempts; tokens count input (including cached tokens) plus output across those requests.

CI outcomes reached the model earlier with notifications, but the complete-task effects are mixed. Catalog's median paired initial-result delivery delay fell 94.6%; Notes' ten matched initial-job comparisons also all show earlier delivery. Notes has no actionable current-source failure at first exposure, so its stale failure messages do not establish faster bug correction. See the [Notes behavioral review](../notes-mcp-ci-20261007/final-behavior.md).

**Catalog CI**

10/10 measured runs pass independent acceptance and required CI. Paired time change range: -14.2% to +20.0%.

| Pair | Polling | Notifications | Time change |
|---|---:|---:|---:|
| p01 | 4m 04s | 3m 57s | -3.1% |
| p02 | 4m 21s | 4m 18s | -1.2% |
| p03 | 4m 12s | 5m 02s | +20.0% |
| p04 | 4m 43s | 4m 03s | -14.2% |
| p05 | 5m 17s | 4m 32s | -14.2% |

**Notes app**

10/10 measured runs pass independent acceptance and required CI. Paired time change range: -23.3% to +30.7%.

| Pair | Polling | Notifications | Time change |
|---|---:|---:|---:|
| 1 | 5m 52s | 5m 58s | +1.6% |
| 2 | 6m 39s | 5m 39s | -15.0% |
| 3 | 4m 41s | 5m 01s | +7.3% |
| 4 | 6m 49s | 5m 14s | -23.3% |
| 5 | 5m 05s | 6m 38s | +30.7% |

Both modes use Pi 0.99.2, gpt-6.1-sol with medium thinking, fresh workspaces, the same task/tools/instructions and declared CI queue delays. Real assertions decide success or failure. Mode order alternates; Pi workloads run sequentially. Calibration and unsuccessful/duplicate pairs remain visible in the detailed reports and are excluded from efficiency summaries.

Earlier delivery of a result does not establish faster task completion. Failure reports already superseded by proactive edits are excluded from actionable failure-reaction comparisons. The protocol targets five pairs per task; even a completed five-pair cohort is exploratory evidence.

Verified runs lasted roughly 4–7 minutes, below the intended 10–15-minute workload. Notes pair 1 ran on October 7; pairs 2–5 resumed on October 8 with the same frozen inputs and settings. Provider/time variability remains a limitation. See the [continuation record](continuation-20261008.md).

[Catalog results](../ci-development-20261007/report.md) · [Notes results](../notes-mcp-ci-20261007/report.md) · [Independent paired/raw usage audit](paired-audit.json) · [Protocol](protocol.md)
