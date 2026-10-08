# Frozen notes MCP CI workload

Protocol revision v2 clarifies the bare full-note resource array and all public return shapes before measured inference. The first v1 PA calibration is retained in `inputs/v1/` and its run's `assessment.json`; its underspecified resource-format failure is not eligible measured evidence. V2 also cancels the operator's finished oracle deadline and accepts the contract's alternative error/status/HTML-entity encodings.

Question: does automatic delivery of real asynchronous CI outcomes help a single Pi finish a correct persistent notes application sooner than competitive adaptive polling?

Actual defaults: Pi 0.99.2, openai-codex/gpt-6.1-sol, medium thinking, copied compaction setting. Fresh isolated application/config/session directories, SSE equally in both modes, no inferred monetary caps or HTTP-attempt ceilings. Same contract, prompt, native tools, CI tools, notification management tools and system instructions. Only journal context projection differs (`PI_NOTIFY_CONTEXT=1` or `0`). Notifications are external data and neither interrupt calls nor wake idle Pi.

The public application contract is in contract.md. SQLite storage begins as an explicitly incomplete legacy prototype with real defects: no foreign-key enforcement, missing validation/tag normalization, missing update/filter/pagination behavior. MCP and web implementations are absent. The user requested substantial useful development, not elapsed-time padding. The operator's complete reference app and hidden acceptance suites remain outside Pi's workspace. Application work includes storage hardening, eight real MCP stdio tools/resources, import/export, server-rendered dashboard/forms, JSON API, pagination/filters, tests and documentation.

CI is simulated by fixed queue delay followed by actual tests: initial legacy smoke 20s, initial legacy integrity 60s, submitted storage 30s, submitted MCP 60s, submitted web 45s. Delay begins at each equivalent submission milestone, identically in both modes. Initial jobs share the starting revision and begin with the task. Green/red status is determined exclusively by executed assertions. Later suites are submitted when their modules become runnable; submissions are immediate and independent implementation continues. No artificial agent sleep or slow polling is imposed. Acknowledged results are stored in both modes and batch retrieval/await remain available in both.

Every job copies an immutable snapshot and advertises a SHA-256 revision computed from the copied source bytes. Suite-current detection conservatively includes every helper source module plus the appropriate entry points. CI messages contain terminal eventId, suite, source revision, bounded failed-check summaries and tested file hashes. Both modes receive the identical bounded event; summary truncation is explicit and `ci_details` retrieves full diagnostics/hashes equally in both modes. Messages are checked against the adapter's 8000-character transport limit. Queue/start/completion/publication/retrieval/provider-exposure times are separate. Only terminal eventId exposure in a provider payload counts as model exposure, never a queued job ID. Explicit 90-second worker and 30-minute agent deadlines are technical stopping rules, with interrupted/failed trials retained.

Independent acceptance uses the installed official MCP SDK client and a different end-to-end scenario: MCP writes → web renders and edits → failed import leaves state unchanged → pagination → MCP restart/export/import/deletion → raw SQLite integrity/foreign-key checks → web restart. Coverage includes functional HTML form submissions and APIs; it does not include browser JavaScript execution or visual layout automation.

Stopping: Pi naturally settles with no operator steering. Then the harness waits for already queued required CI, verifies the independent final oracle and locked input contract/package/public smoke checks. Full time includes this verification; settlement and post-settlement work are reported separately. Correct completion requires current green storage/MCP/web suites, independent acceptance and preserved locked inputs. Premature agent settlement, ignored/stale events, failed final checks and incomplete runs remain visible.

Calibration is a separate pair with seed 7100. After workload review/freeze, measured seeds 7101–7105 use PA/N, N/PA, PA/N, N/PA, PA/N order. Five pairs are targeted; if constraints prevent five, at least three complete pairs are exploratory and the constraint is reported. No changes after freeze are mixed into the same measurement group.

Record correctness, full wall time, CI publication → provider exposure → relevant edit → first successful correcting CI verification, changes while jobs are active, empty batch reads, waits, obsolete/late/missed results, actual model HTTP attempts and input/output/cache tokens. Efficiency changes are `100*(N-PA)/PA`, with explicit complete correct paired denominators. Reaction speed does not imply complete-task speed. No universal benefit is presumed.

Launch only after coordinator release:

```sh
NOTES_INFERENCE_GO=1 node research/notes-mcp-ci-20261007/run.mjs --phase calibration --pair 0 --mode PA --seed 7100
NOTES_INFERENCE_GO=1 node research/notes-mcp-ci-20261007/run.mjs --phase calibration --pair 0 --mode N --seed 7100
```
