---
name: agent-coordination-workflow
description: Coordinate with other coding agents before editing shared projects by using the agent-coordination MCP tools for activity discovery, conflict checks, updates, messages, waits, and closure.
---

# Agent Coordination Workflow

Use this skill whenever work may overlap with other active agents in the same project. The MCP
server is a shared coordination board, not an orchestrator: agents remain responsible for judgment,
scope control, user communication, and final verification.

## Tools

Use the `agent-coordination` MCP server tools:

- `list_activities`: compact project activity list by default; use `include_details: true` only when
  the compact view indicates a likely conflict or useful message context.
- `check_conflicts`: compare planned `areas` and `files` with active work.
- `upsert_activity`: declare or refresh status, description, areas, files, and TTL.
- `post_message`: ask another agent to clarify, hand off, or coordinate.
- `list_messages`: check messages after waiting or before entering an overlapping area.
- `finish_activity`: close work with outcome and an optional final description.

## Activity Shape

Keep the required fields clear and compact:

- `project`: stable repo or product identifier.
- `agent`: stable session/thread/agent label.
- `status`: one of `planning`, `waiting`, `editing`, `testing`, `blocked`, `reviewing`, `done`,
  `abandoned`.
- `description`: Markdown or plain text describing the current work.
- `areas`: semantic areas such as `auth`, `cli`, `mcp-server`, `docs`, `tests`.
- `files`: exact paths only when known.
- `expires_at` / TTL: freshness marker for stale activity detection.

Do not over-model. Put human-readable task context into `description`; use `areas` and `files` for
querying and conflict checks.

Use this Markdown shape for `description` unless the task is trivial:

```md
## Intent
One sentence describing what this agent is doing.

## Scope
- Areas: area-a, area-b
- Files: path/to/file.ext

## State
Current status, immediate next step, or blocking condition.
```

Keep `areas` and `files` duplicated as structured MCP arguments when known. They are for filtering
and conflict checks; the Markdown is for humans and LLM context.

## Required Workflow

1. Before editing, infer the likely `project`, `areas`, and known `files`.
2. Call `check_conflicts` or `list_activities` for the project and planned areas/files.
3. Call `upsert_activity` before making edits. Start with `status: planning` unless editing begins
   immediately.
4. After inspecting the code, call `upsert_activity` with better `areas`, `files`, and `description`.
5. Before changing files, set `status: editing`.
6. When testing or reviewing, set `status: testing` or `reviewing`.
7. At completion, call `finish_activity` with a final description when useful.

## Conflict Behavior

Treat conflicts as soft coordination signals, not hard locks.

- `file_overlap` or `blocking`: coordinate before editing the overlapping file. Prefer a short wait
  or message.
- `area_overlap`: check details, message if unclear, and avoid overlapping files until scope is
  clear.
- `same_project`: proceed carefully and keep the activity updated.
- `stale`: mention the stale activity in your next `description` and proceed unless the stale
  activity shows a clear risk.

If you can safely do non-overlapping work first, do that instead of waiting.

## Waiting Behavior

Never sleep for a long ETA blindly. Use short cycles:

- light conflict: wait 1-3 minutes, then recheck.
- strong conflict with short ETA: wait 3-5 minutes, then recheck.
- after each wait, call `list_activities` and `list_messages`.
- after 2-3 unchanged cycles, mark your own activity `blocked` or ask the user how to proceed.

When waiting, update your activity with `status: waiting` and a short reason in `description`.

## Messaging

Use concise Markdown or plain-text coordination messages with this shape:

- `project`: stable repo or product identifier.
- `from_agent`: stable session/thread/agent label.
- `message`: Markdown or plain text body.
- `to_agent`: optional target agent.
- `to_activity_id`: optional target activity.

Use this Markdown shape for `message` when asking for coordination:

```md
## Request
The concrete coordination ask.

## Context
Why this matters and which files or areas are involved.

## Needed
The short answer or action needed from the other agent.
```

Message when you need to:

- ask whether another agent is still editing an area or file.
- announce that you will work around their scope.
- hand off when you finish an area they were waiting on.

Messages are not a substitute for updating activities. If your scope changes, call
`upsert_activity`.

## Cleanup

Always close activities you started. Use:

- `finish_activity` with `outcome: completed` for completed work.
- `finish_activity` with `outcome: abandoned` if you stop without completing.

Keep the final description short.
