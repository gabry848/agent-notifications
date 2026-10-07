---
name: workflow-automation-designer
description: Collaborate with the user to design practical Codex workflows, multi-agent coordination flows, and automations by asking focused questions, inspecting available local context when appropriate, considering existing skills/plugins/workflows, and proposing an implementation plan that may include Git, GitButler, reminders, monitors, or follow-up automations.
---

# Workflow Automation Designer

Use this skill when the user wants to brainstorm, design, or refine a repeatable Codex workflow,
agent workflow, skill, plugin, automation, reminder, monitor, or project operating procedure.

The goal is not to immediately overbuild. First understand the user's real loop, constraints, and
existing tools; then propose the smallest workflow that is clear, reliable, and easy to evolve.

## Operating Principles

- Treat the user as a collaborator. Ask concise questions only when answers materially change the
  design.
- Prefer inspecting available context over making the user restate it, but explain what you are
  checking.
- Keep workflows flexible enough for LLM judgment, with explicit guardrails only where mistakes are
  costly.
- Separate: user intent, trigger, context gathering, decision points, actions, verification, and
  cleanup.
- For automations, design the behavior first; create/update the automation only after the user has
  approved the concrete schedule/trigger and task.
- For coding workflows, include Git hygiene and coordination points when useful.

## Context Discovery

When relevant and allowed by available tools, inspect:

- repo files and local workflow docs with `rg --files`, `rg`, and targeted reads.
- existing `.codex/`, `.agents/`, plugin, skill, or marketplace folders.
- available skills/plugins listed in the current context.
- Git/GitButler state when the workflow touches source control.
- existing automations only if automation tools are available.
- past Codex threads/chats only if explicit thread tools are available and the user agrees or has
  already asked for this kind of inspection.

Do not claim access to past chats unless an actual thread-reading tool is available. If it is not
available, say that the workflow can include such a step later if Codex exposes it in the current
environment.

## Questions To Ask

Start with at most 2-4 focused questions unless the user explicitly wants a full interview.

Good first questions:

- What event should trigger this workflow?
- What outcome should exist when it finishes?
- Should it run automatically, only on request, or ask before taking action?
- What tools can it use: Git, GitHub, GitButler, Notion, calendar, browser, local files?
- What should it never do without confirmation?

Avoid asking about implementation details before the workflow shape is clear.

## Workflow Design Template

When proposing a workflow, use this structure:

1. Purpose: one sentence.
2. Trigger: manual prompt, schedule, monitor condition, repo event, PR event, or message.
3. Context gathered: files, skills, open tasks, git state, activities, previous decisions.
4. Decision points: where the agent asks the user versus proceeds.
5. Actions: concrete tool/work steps.
6. Verification: tests, checks, review, or user confirmation.
7. Handoff/cleanup: commit, PR, activity close, notes, reminder, or next automation.
8. Failure behavior: timeout, blocked state, no-op, or escalation to user.

Keep the first proposal compact. Add detail only where ambiguity creates risk.

## Automations

If the user wants reminders, monitors, recurring checks, follow-ups, or scheduled work:

- Search for the automation tool first when available.
- Before creating anything, confirm:
  - schedule or event trigger,
  - exact task text,
  - notification/reporting behavior,
  - whether the automation may modify files or only report,
  - stop condition or review cadence.
- Prefer a dry-run/reporting automation before allowing automatic writes.
- For monitors, define the condition that counts as "changed" or "actionable".

Example automation plan:

- Trigger: every weekday at 09:00.
- Context: inspect open PRs, CI failures, and current GitButler branches.
- Action: produce a short priority list; do not modify files.
- Escalation: if CI is red on a PR assigned to the user, ask before fixing.

## Git And GitButler

When a workflow touches code, recommend a source-control policy.

Explain GitButler briefly if needed:

> GitButler is a Git client/workflow tool that helps organize local work into separate virtual
> branches/changes, so multiple tasks can be staged, committed, amended, or turned into PRs more
> cleanly than one large mixed working tree.

Use GitButler when:

- the user works on multiple tasks at once,
- several agents may edit the same repo,
- commits need to stay scoped,
- the workflow benefits from branch/commit management and PR creation.

Keep Git steps explicit:

- inspect status before edits,
- create or select the right branch/change,
- stage only relevant files,
- commit with a scoped message,
- push/open PR only after approval or when the workflow explicitly allows it.

## Multi-Agent Coordination

For workflows involving concurrent agents, include `agent-coordination`:

- check active activities before editing,
- use `upsert_activity` to declare or refresh compact activity state,
- put human-readable task context in the activity `description` Markdown field,
- keep `areas` and `files` structured for filtering and conflict checks,
- use `post_message` with a Markdown `message` for handoff or conflict resolution,
- use `finish_activity` when work is complete or abandoned,
- use short wait cycles instead of long blind sleeps.

## Output Modes

Choose one of these based on the user's request:

- Brainstorm: 2-3 viable workflow options with tradeoffs.
- Recommendation: one preferred workflow with reasons.
- Implementation plan: ordered steps and files/tools to create.
- Automation spec: trigger, task, permissions, reports, and stop conditions.
- Skill/plugin spec: skill name, trigger description, core instructions, tools, validation.

End with the next concrete action: create the skill/plugin/automation, inspect context, or ask the
minimum remaining question.
