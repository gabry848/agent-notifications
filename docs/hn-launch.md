# Hacker News launch preparation

The technical hook is receiving background results in the agent's next model request while it continues independent work. Show the concrete problem, how to reproduce it and the actual boundaries of delivery.

| Launch material | Ready-to-use artifact |
|---|---|
| Short demo | [CI demo and recording checklist](hn-demo.md); launch with `node demo/ci.mjs launch`. |
| Reproducible first try | [Quickstart](quickstart.md), followed by the isolated demo. |
| Honest scope | [Current limits and tradeoffs](limitations.md), with links to methods and source evidence. |

## Prepare the public source

The quickstart assumes readers can obtain this checkout. Before submitting, make the version containing the demo and these documents available at a public source URL. Include the demo fixture and worker in that version. Local preparation does not establish public availability.

Run the minimal try flow from that public version once, then record an actual model run using the [checklist](hn-demo.md#what-to-capture). The code and storyboard are provided here; a live recording is a separate artifact. Show the tested host, the queue-delay label and the final test result. Keep uncut local evidence for claims about delivery or reaction.

Link the runnable source as the Show HN submission destination and make the demo easy to find from its README. Show HN accepts early projects that people can actually try; a write-up alone belongs in a regular submission. [Show HN instructions](https://news.ycombinator.com/showhn.html).

## Topics to explain in your own words

- The task that made you want updates while an agent was busy.
- Why the host injects accepted facts at context preparation, how session routing works, and what the model still needs to inspect.
- How this relates to an event queue: the queue is storage and routing; the added behavior is presenting those facts in the model's next context with dismiss/history lifecycle tools.
- The current Pi-only support, the lack of idle wake-up, and the difference between earlier visibility and faster completion.
- Which design question you want feedback on: relevance selection, cache overhead or adoption in other agent runtimes.

Use the benchmark numbers only with their named workload, matched control and metric. The toy demo cannot support an efficiency percentage.

Write the submission and discussion yourself. HN's current guidelines prohibit generated or AI-edited posts and automated posting. This document is preparation material, not a submission to paste into HN. [HN guidelines](https://news.ycombinator.com/newsguidelines.html).
