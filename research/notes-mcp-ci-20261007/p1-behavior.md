# Pair 1: same correct app, fewer requests, similar time

Historical pair-1 observation. All five measured pairs are now complete; see the [final behavioral review](final-behavior.md) and [full results](report.md).

Both Pi runs built the complete persistent notes app: SQLite storage, a real MCP stdio server, a dashboard, local tests and launch instructions. All nine independent acceptance checks and the latest storage/MCP/web CI passed. Notifications finished 1.6% later in this first pair; this is an interim observation, not a speedup claim.

| Measure | Adaptive polling | Notifications | Change vs polling |
|---|---:|---:|---:|
| Complete verified task | 352.2 s | 357.9 s | +1.6% |
| Model HTTP requests | 28 | 22 | −21.4% |
| Total tokens | 465,759 | 471,946 | +1.3% |
| Nonempty status batches | 2 | 1 | −50.0% |
| Empty status batches | 0 | 0 | — |

Both agents noticed and repaired the supplied bulk-import defect before a relevant CI snapshot was submitted. The initial integrity failure therefore referred to obsolete source when exposed. Notifications delivered that stale result after 5.1 seconds; polling retrieved it after 89.6 seconds. Neither delay measures reaction to a current bug, and this pair provides no current-failure correction comparison.

Both agents kept implementing while CI ran. Polling used two useful batches and a final short await, without empty checks. Notification mode inspected full stale-failure diagnostics, dismissed obsolete events, and used one final status batch plus an await after a shared-helper change required current storage verification. All eight polling terminal events and all six notification terminal events eventually appeared in provider payloads. Different numbers of later CI jobs reflect each agent's own code changes, not different prescribed jobs or queue settings.

The two runs share the same frozen v3.1 inputs and fixture seed 7101. The input contract, prompt, tools, current notification adapter and queue delays are identical; automatic context delivery is the treatment. Every tested snapshot's source/revision hash and every numeric provider response were independently reconciled. Token totals include cached input. This was one exploratory matched pair; the remaining preregistered pairs were pending when this initial observation was recorded.

Evidence: [paired metrics](metrics.json), [PA audit](runs/measured-p1-PA-a1/audit.json), [N audit](runs/measured-p1-N-a1/audit.json), [PA final acceptance](runs/measured-p1-PA-a1/oracle.json), [N final acceptance](runs/measured-p1-N-a1/oracle.json).
