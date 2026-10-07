# Agent Coordination

`agent-coordination` is a local Codex plugin for coordinating multiple coding agents working in the
same project.

The server stores activity and message state in SQLite. Activities use a compact shape with indexed
project/status queries, structured areas/files for conflict checks, and simple Markdown messages
addressed to a project, agent, or activity.

## Quickstart

From the repository root:

```sh
codex plugin marketplace add .agents/plugins
codex plugin add agent-coordination@personal
```

Open a new Codex thread after installing so the MCP tools and skills are loaded.

## Automatic Usage

The plugin exposes coordination tools and skills to Codex, but automatic use depends on the agent's
workflow instructions. If you want agents to coordinate without being reminded every time, create a
project workflow/skill that invokes `agent-coordination-workflow` for any shared-repo coding task.

Use the bundled `workflow-automation-designer` skill to create that workflow. For example:

```text
Use workflow-automation-designer to create a repeatable workflow for this repo.
Before editing, agents must run agent-coordination-workflow, check conflicts, publish an activity,
update it during testing/review, and finish it at the end.
```

Recommended workflow shape:

1. Purpose: coordinate concurrent Codex agents in this repository.
2. Trigger: any task that may read or edit shared project files.
3. Context gathered: project name, likely areas/files, active activities, recent messages.
4. Decision points: ask or wait only on file overlaps, blocking activity, or unclear ownership.
5. Actions: `check_conflicts`, `upsert_activity`, edit/test, refresh status, `post_message` if
   needed.
6. Verification: run relevant checks and review the final diff.
7. Cleanup: call `finish_activity` with `completed` or `abandoned`.
8. Failure behavior: mark the activity `blocked` and report the blocking condition to the user.

## MCP Tools

- `list_activities`
- `upsert_activity`
- `finish_activity`
- `post_message`
- `list_messages`
- `check_conflicts`

Activities use this shape:

```json
{
  "project": "mcp-gardraill",
  "agent": "codex-thread-x",
  "status": "editing",
  "description": "...markdown...",
  "areas": ["mcp-server"],
  "files": ["plugins/agent-coordination/scripts/agent_coordination_server.py"]
}
```

Use `upsert_activity` for new and refreshed activity records.

Messages use a compact shape:

```json
{
  "project": "mcp-gardraill",
  "from_agent": "codex-thread-x",
  "message": "...markdown...",
  "to_agent": "optional-agent",
  "to_activity_id": "optional-activity-id"
}
```

## Skills

- `agent-coordination-workflow`: operational protocol for concurrent coding agents.
- `workflow-automation-designer`: collaborative workflow and automation design with the user.

## Storage

Set `AGENT_COORDINATION_DB` to choose the SQLite file:

```sh
AGENT_COORDINATION_DB=/tmp/agent-coordination.sqlite3 python3 scripts/agent_coordination_server.py
```

If unset, the server uses:

```text
${TMPDIR:-/private/tmp}/agent-coordination/coordination.sqlite3
```

## Smoke Test

```sh
python3 scripts/smoke_test.py
```

## License

MIT License. Copyright (c) 2026 Gabriele Cipriani.
