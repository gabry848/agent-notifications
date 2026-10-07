# Roadmap and next research steps

The runtime capability is the project; Pi is its first experimental adapter. This roadmap records intended work, not shipped integrations or promised release dates. [README](../README.md) · [Research history](research-story.md) · [Use cases](use-cases.md).

## Complete the concurrent-work evidence

First complete matched notification, adaptive-polling and competitive-wait groups with sufficient reservation headroom. Freeze the corrected runtime, prompt, fixture and oracle before new measurements. Preserve every failed or incomplete attempt.

Calibrate useful work near ten minutes, then extend suitable tasks to 30 and 60 minutes. Do not pad tasks with artificial idle time. All controls can launch concurrent jobs and perform the same independent work. Count await fallback separately. Measure correctness, integration, verified overlap, event exposure, useful action, avoided rework, full completion, requests, tokens, cache and costs.

Longer tasks may dilute fixed notification overhead, but repeated active events may accumulate it. Both outcomes must remain possible. The earlier short cache experiment does not replace a full concurrent-work rerun.

## Harness adapters and transport

| Target | Status |
|---|---|
| Pi | Experimental adapter implemented and tested with 0.99.2 |
| Codex | Planned separate harness integration; current native-Codex provider experiments ran inside Pi |
| DeepSeek harness | Planned; contract and provider behavior still to be tested |
| oh-my-pi | Planned; integration and compatibility still to be tested |

Keep a shared event/session/lifecycle contract, with host-specific context projection. Verify authority, cache and transcript behavior independently for each host. Also consider an independent receiver for off-process backlog, authenticated remote bridges, core event deduplication, subscription expiry and controlled archival/coalescing. These are not current core features.

## Agent-defined filters with Jev

The author means **Jev from TypeSafe AI**, a recently introduced decision/classification model, rather than a JSON query utility. TypeSafe’s documented primitives include typed choice, score and yes/no questions evaluated against a supplied state. [Official introduction](https://typesafe.ai/blog/introducing-system-one-models-and-jev) · [Primitive documentation](https://docs.typesafe.ai/primitives).

The proposed experiment lets the agent define a subscription/relevance policy for its current task. Cheap deterministic checks select source, session and job first; Jev then evaluates semantic relevance before an event enters the visible queue. Candidate outcomes could be `deliver`, `defer` and `archive`. This is an experiment to design, not an implemented integration or an established saving.

```text
Raw events → source/session/job filters → Jev relevance decision
                                               ├─ deliver → active context queue
                                               ├─ defer   → retained for later
                                               └─ archive → retained in audit history
```

Preserve raw events and decisions so a filter cannot silently erase the research record. Route uncertain or critical events conservatively. Freeze policy and classifier version, then measure critical-event recall, missed relevant facts, false positives, task correctness, context volume and main-model usage. Include **classifier calls, cost and latency** in end-to-end accounting. A quieter context is useful only if the agent still receives the facts it needs.

Compare unfiltered delivery, deterministic filters and semantic filters on identical event streams, including sparse relevant events, bursty noise, changing requirements and adversarial text. The agent’s policy setup/update costs also count. No vendor speed, price or accuracy claim is adopted as a result of this project.
