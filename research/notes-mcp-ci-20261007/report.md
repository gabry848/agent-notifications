# Notes MCP + SQLite + dashboard CI benchmark

5 complete correct measured pairs are available out of 5 attempted groups. Automatic delivery and adaptive polling build the same app; calibration versions are separate and excluded. Five pairs are a small exploratory sample.

| Run | Protocol | Correct | Full seconds | HTTP | Total tokens | Actionable current failures |
|---|---|---:|---:|---:|---:|---:|
| calibration-p0-N-a1 | v3 | technical oracle failure; app passes corrected offline checks | 326.0 | 22 | 396410 | 0 |
| calibration-p0-PA-a1 | v1 | yes | 283.4 | 24 | 312723 | 1 |
| calibration-p0-PA-a2 | v3.1 | yes | 231.0 | 15 | 129810 | 0 |
| measured-p1-N-a1 | v3.1 | yes | 357.9 | 22 | 471946 | 0 |
| measured-p1-PA-a1 | v3.1 | yes | 352.2 | 28 | 465759 | 0 |
| measured-p2-N-a1 | v3.1 | yes | 339.4 | 20 | 345193 | 0 |
| measured-p2-PA-a1 | v3.1 | yes | 399.2 | 20 | 238964 | 0 |
| measured-p3-N-a1 | v3.1 | yes | 301.1 | 20 | 321792 | 0 |
| measured-p3-PA-a1 | v3.1 | yes | 280.6 | 20 | 229712 | 0 |
| measured-p4-N-a1 | v3.1 | yes | 313.7 | 15 | 208944 | 0 |
| measured-p4-PA-a1 | v3.1 | yes | 408.9 | 27 | 430954 | 0 |
| measured-p5-N-a1 | v3.1 | yes | 398.2 | 24 | 496678 | 0 |
| measured-p5-PA-a1 | v3.1 | yes | 304.6 | 23 | 304646 | 0 |

## Matched comparisons

Percent change uses the polling denominator: 100 × (notifications − polling) / polling. Negative time means notifications finished sooner. Pairing requires the same protocol, seed and frozen manifest. Duplicate attempts are reported and never silently selected.

| Measure | Complete pairs | Median change | Pair range |
|---|---:|---:|---:|
| Complete task time | 5 | 1.6% | -23.3% to 30.7% |
| Model HTTP requests | 5 | 0.0% | -44.4% to 4.3% |
| Total tokens | 5 | 40.1% | -51.5% to 63.0% |
| Input tokens (diagnostic) | 5 | 41.4% | -52.7% to 65.2% |
| Output tokens (diagnostic) | 5 | 6.0% | -10.8% to 7.2% |
| Batch status checks | 5 | -50.0% | -100.0% to -50.0% |

## Behavioral scope

The v3 [contract](contract.md) preregisters a freely repairable shared-import atomicity regression, alongside storage, MCP and web implementation. Both modes use the same real tests and simulated 20/60/30/60/45-second CI queues. Tests execute on immutable snapshots. Proactive repairs may leave green/stale-only trials; those trials are labeled rather than counted as failure-reaction wins. No agent idle padding is added.

First exposure is a provider payload containing the terminal eventId, identically in both modes. Current/stale source status is reconstructed at exposure. Reaction summaries exclude already changed/fixed source and technical worker failures. Helper/store edits count; a reported correction edit must have matching changed bytes in a subsequent passing CI snapshot. This linkage is observational and does not prove that every edit caused the fix.

Acceptance uses the official MCP SDK, SQLite cross-process persistence/integrity, HTML forms and HTTP APIs. The ninth check verifies that MCP and web execute the shared helper on an instrumented disposable copy; delivered source is not modified. Browser JavaScript and visual layout are outside coverage.

Full time includes final acceptance and required CI. Calibration v1's bare-resource-array ambiguity is retained in its [assessment](runs/calibration-p0-PA-a1/assessment.json); v2 had offline validation only. The original v3 N trial preserves a technical-oracle export-forwarding failure; corrected offline checks establish app correctness without rewriting its time. All measured pairs use the amended v3.1 oracle. Calibration versions are not pooled. Failed/incomplete trials remain visible.

HTTP and token counts support the behavioral result. Numeric provider usage is reconciled against Pi input+cache/output for every response; attribution-only frames cannot overwrite numbers. Unresolved HTTP attempts and partial observed totals remain explicit, and incomplete token accounting is excluded from token percentages. Total tokens are input plus output; input includes cached tokens. No billed-cost claim is made.

See [final behavioral review](final-behavior.md), [paired/event metrics](metrics.json), [CSV](metrics.csv), [v3 offline checks](offline/v3-final/preflight.json), [allowed alternative encodings](offline/v3/alternative-valid-oracle.json), [frozen hashes](input-manifest.json) and [archived analyzer versions](analyzers/).
