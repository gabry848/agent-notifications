# Continuation of the paired CI benchmarks

The previous AOVerview session `s_457e148b-efcd-46f4-a7d4-4ee36fa1a9a6` was recovered on 2026-10-08. At recovery, Catalog CI had five complete correct pairs and Notes had one pair with eight unstarted runs. All eight pending runs are now complete and correct; both workloads have five complete correct pairs.

## Verified existing evidence

- Catalog audit passed again: 28 unchanged task/runtime hashes, 279 archived CI snapshots across calibration and measured runs, no credential/signature findings in 1,577 scanned artifact files.
- Notes audit passed again: 24 unchanged frozen input hashes, immutable snapshots, current required CI, locked inputs and response-level usage accounting for both measured runs.
- Both existing Notes applications passed all nine independent acceptance checks again, including MCP/HTTP interoperability, SQLite persistence, atomic import and shared-helper execution. These offline checks do not replace the original measured durations or create new measured trials.
- The independent paired audit and comparison report were regenerated. Catalog median paired changes are -3.06% verified time, -10.00% provider HTTP requests and +44.81% total tokens; Notes pair 1 remains +1.63%, -21.43% and +1.33%, respectively. Every denominator is the corresponding polling run; calibration remains excluded.

## Authorization and continuation

Automatic approval review initially rejected the launch of the eight remaining Pi runs twice. After the exact payload and destination were presented, the user explicitly authorized completion: “vai fai tutto quello che ti mancava”. The first resumed run started at 2026-10-08 13:37 UTC. Run starts and outcomes are retained in [the continuation log](../notes-mcp-ci-20261007/continuation-20261008.jsonl).

The approved payload was the existing synthetic Quick Notes contract and scaffold, generated application code, tool results and CI outcomes. The destination was `chatgpt.com` via Pi's existing OAuth `openai-codex/gpt-6.1-sol` configuration, with medium thinking. Pi 0.99.2, Node 24.18.0 and the unchanged v3.1 manifest were verified locally. No new API key was created.

The frozen inputs were preserved and these trials ran sequentially from 13:37 to 14:23 UTC:

| Pair | Seed | Order |
|---|---:|---|
| 2 | 7102 | N, then PA |
| 3 | 7103 | PA, then N |
| 4 | 7104 | N, then PA |
| 5 | 7105 | PA, then N |

Use the existing runner, changing only pair, mode and seed:

```sh
NOTES_INFERENCE_GO=1 node research/notes-mcp-ci-20261007/run.mjs --phase measured --pair 2 --mode N --seed 7102
```

Retain every attempt, review failures before proceeding, and do not overwrite earlier runs. Any resumed trials occur on a different day from pair 1; record the gap and provider/time variability in the final interpretation.

## Final outcome

Notes metrics/report, artifact audit and the independent coordinator comparison were regenerated. All ten measured Notes apps pass the nine final acceptance checks and current required CI; all 68 measured snapshots and 219 provider HTTP attempts pass integrity/accounting checks. No current-source failure was actionable at first exposure, and no terminal result was unexposed.

| Workload | Correct pairs | Median time change | Median request change | Median total-token change |
|---|---:|---:|---:|---:|
| Catalog CI | 5 | -3.06% | -10.00% | +44.81% |
| Notes app | 5 | +1.63% | 0.00% | +40.08% |

Changes use matched polling denominators. Notes time changes range from -23.29% to +30.71%; no overall speedup or token saving is established. Earlier initial-result delivery is preserved as separate evidence, with stale results explicitly labeled. See the [final comparison](report.md) and [Notes behavioral review](../notes-mcp-ci-20261007/final-behavior.md).

The Notes operator and coordinator both registered explicit successful `finish` operations in AOVerview. The session API confirms all three agents and both goals are completed, no current blocks remain, and both operator contributions are integrated. Session closure is verified.
