# Explorer — bounded pilot evidence

One measured Pi calibration completed in **3m32s**, with **12 HTTP attempts, 120648 tokens and $0.140560 API-equivalent estimated usage**. Unknown reserved usage is zero; actual Codex subscription charges remain unknown.

The independent audit confirms the task is correct: 14 unchanged public checks, four added integration checks and a real loopback CLI demo pass. The original automated summary remains `taskCorrect=false` because its static CLI filter wrongly excluded `src/cli.mjs`, which the task permitted. This is a preserved oracle false-negative, not a model task failure. See [independent correction](../audit/explorer-calibration-check.json) and [original summary](runs/explorer-compatibility-N-4101-847cae3a/summary.json).

| Condition | Mode | Raw checker | Actual minutes | HTTP attempts | API-equivalent USD | Checks/await | Public tests before/after report | Evidence |
|---|---|---|---:|---:|---:|---:|---:|---|
| compatibility | N | no | 3.54 | 12 | 0.140560 | 0/0 | 14/0 | [trace](runs/explorer-compatibility-N-4101-847cae3a/summary.json) |



No baseline pair was run: **there is no efficiency comparison**. The notification was received, exposed and dismissed once; get_updates, history, MCP and await calls were zero. It became visible 11.19 seconds after publication at the next natural inference. A correct configuration/release artifact write followed publication after 111.65 seconds. These timestamps do not reveal the model's private understanding or prove earlier production request handling.

All fourteen public core milestones passed before publication. Real CLI, additional integration tests and documentation work continued afterward, but this is not ten-minute or hour-long-session evidence. The process and owned endpoints are closed; no extra measured run was started while the independent suite measures.

## Interpretation limits

The task implements a real local delivery hub with HTTP, SQLite, bounded concurrency and reloadable runtime policy. External facts affect live body acceptance and retry policy, rather than only a final plan. But the event source is controlled: a real small corpus worker starts after three public tests pass. Its short computation and progress trigger are not production long-job latency.

Actual duration is shown above. A run shorter than ten minutes is not evidence for a ten-minute, thirty-minute or hour-long working session. Check remaining verified milestones and code work after report publication before claiming useful overlap or earlier intervention. The first measured consequence is a semantically correct configuration/release write, not the model's hidden understanding. Exposure is captured at the next natural context boundary and never means autonomous wake-up.

Native get_updates/await_update are not MCP calls (MCP calls zero in this explorer). W can work first and await a queued report at a sensible boundary. Independent analysis of the public corpus is allowed and must be counted if used. All scenarios preserve initial facts/contracts/model and actual failed attempts.

Source hashes, actual model, config deviations, raw usage, RPC events, local notification traces, work checkpoints and final tests are retained per run. Independent audit verified usage normalization, the real CLI and cleanup. A proposed [v3 maintenance workload](proposed-v3/PLAN.md) changes the task structure rather than adding filler to a short task; it is offline and unexecuted, and needs a fresh freeze and GO.
