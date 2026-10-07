# Proposed v3 — incremental maintenance, not blank-module completion

Status: **offline proposal only; no Pi execution authorized or started**. This is a new candidate experiment, not a revision of the measured v2 result. The first calibration and its frozen sources remain intact.

## What the calibration changed

Pi completed all thirteen core modules in one large generation/tool group. The checker first observed fourteen passing public tests together, so a three-pass progress trigger fired after all of them were already complete. Adding more independent blank modules would not reliably create an incremental workflow. The valid subsequent work was CLI wiring, extra integration tests, documentation and runtime policy application, but the session lasted only 3m32s.

The notification channel did work with no retrieval/await. This candidate must now test event awareness during a larger, genuinely incremental maintenance job and measure verified work after arrival. No present efficiency or long-duration win is established.

## Candidate useful task

Start from a frozen copy of the **existing actual Coordinator MCP server**, not production state. Add a bounded delivery outbox and maintenance controls without changing the external notification transport under observation:

1. Persist failed notification deliveries and their identities/revisions in SQLite; migrations must preserve existing board data, subscription state and actor isolation.
2. Retry eligible transient failures with capped backoff, preserve event identity across retries/restart, avoid delivering to unsubscribed destinations, and prevent another session/actor receiving a record.
3. Add inspect/retry/cancel commands for outbox records with bounded output; define what a cancellation means when a send is already in flight.
4. Exercise real local receiver failure, recovery and restart in integration tests; verify board get_updates parity even when notification transport fails.
5. Add explicit CLI diagnostics and documentation, preserving compatibility with existing MCP clients and avoiding hidden board polling.

This is a coupled change to a working application: database schema, thread/HTTP lifecycle, queue semantics, MCP contracts and tests. It cannot be accepted solely because a list of tiny pure-function checks passes. The live runtime receiving research notifications stays frozen and separate from the server Pi is modifying.

## Events while it works

Use two clearly labeled controlled producers:

- A real local compatibility audit of the baseline database/client contracts publishes findings. Source start, completion and publication are distinct timestamps.
- A fixture external incident feed supplies independently fixed nonblocking operational facts (receiver recovery, destination retirement, obsolete revision, unrelated notice). If delivery is scheduled by time, label that as a controlled event schedule; do not claim a synthetic wait is production CPU work.

Facts and schedule must be frozen identically for N/PA/W. No future answer file belongs in the Pi working copy. The model can still query the legitimate source in baseline modes. N must not poll/await while useful maintenance remains; W can postpone a competitive await-next until a sensible boundary and retrieve already queued facts immediately.

Producer triggers must not depend only on a batch of public-test passes. First collect read/edit/test progress offline and in a bounded calibration, then choose a defensible arrival opportunity. If the entire task still completes in a single bulk change or before the event, preserve that outcome and do not stretch the timer.

## Acceptance and oracles to build before a future GO

- Use real end-to-end MCP/HTTP/database behavior, including separate restart/cancel/actor-routing tests. Public tests, extra tests, schema preservation, CLI behavior and no lost updates are separate acceptance fields.
- Explicitly execute a finite demo/diagnostic command; allow legitimate CLI locations such as src/cli.mjs. The old static source-directory exclusion was a scorer bug, not a model failure.
- Trace feature-level passing checks and added integration behaviors **after** publication. Record configuration writes separately from actual successful request behavior under the changed configuration.
- Persist PID/PGID and observed shutdown/ESRCH receipts, then independently check owned endpoint and process closure.
- Keep model/provider/default thinking equal, source hashes immutable, real usage and conservative shared reserves complete. Record actual task duration and cost in dollars.
- Do not use a failed/incomplete task as a speed win. First calibrate useful overlap; only after an explicit new root/audit receipt run an informative N/PA/W comparison.

## Conditions to explore, without a preferred winner

An actionable update arrives while multiple independent fixes remain; a burst contains one relevant update plus obsolete/irrelevant notices; an update affects only final documentation; no update is needed. These may yield benefits, ties or notification overhead. With small samples they remain exploratory. Any 30–60 minute study requires separate authorization after reviewing the pilot.
