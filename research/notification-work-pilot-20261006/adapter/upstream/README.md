# Agent Coordination

Agent Coordination is a local Codex plugin for coordinating multiple coding agents in the same
project. It provides a small MCP server, workflow skills, and a SQLite-backed activity board so
agents can declare what they are doing, check for overlapping work, exchange short Markdown
messages, and close their work cleanly.

## Quickstart

Install from the local marketplace in this repository:

```sh
codex plugin marketplace add .agents/plugins
codex plugin add agent-coordination@personal
```

Open a new Codex thread after installing so the MCP tools and skills are loaded.

## Automatic Agent Workflow

Installing the plugin makes the MCP tools and bundled skills available, but it does not force every
agent to coordinate automatically. To make coordination automatic for a project, create or update a
Codex workflow/skill that explicitly tells agents to use the `agent-coordination-workflow` skill
before they edit shared files.

Use the `workflow-automation-designer` skill to define that project workflow. A minimal request is:

```text
Use the workflow-automation-designer skill to create a project workflow for this repo.
Agents must use agent-coordination-workflow before editing, refresh their activity while working,
check conflicts for planned areas/files, and finish the activity when done.
```

After that workflow is installed or added to the agents' operating instructions, new agents should
automatically:

- check active activities before editing;
- call `upsert_activity` with their intent, areas, and files;
- coordinate on overlapping files or areas;
- close their activity with `finish_activity` when complete or abandoned.

## What It Provides

- `list_activities`: view active or completed project activity.
- `upsert_activity`: create or refresh compact activity state.
- `check_conflicts`: detect overlapping areas or files.
- `post_message`: send a Markdown coordination message.
- `list_messages`: read project, agent, or activity messages.
- `finish_activity`: close completed or abandoned work.

Activities use a compact shape:

```json
{
  "project": "my-project",
  "agent": "codex-thread-a",
  "status": "editing",
  "description": "## Intent\nRefactor the MCP server contract.",
  "areas": ["mcp-server"],
  "files": ["plugins/agent-coordination/scripts/agent_coordination_server.py"]
}
```

Messages are intentionally simple:

```json
{
  "project": "my-project",
  "from_agent": "codex-thread-b",
  "message": "## Request\nCan I edit this file after you finish?",
  "to_activity_id": "act_..."
}
```

## Local Development

Run the smoke test:

```sh
python3 plugins/agent-coordination/scripts/smoke_test.py
```

The MCP server stores state in SQLite. Override the default database location with:

```sh
AGENT_COORDINATION_DB=/tmp/agent-coordination.sqlite3 \
  python3 plugins/agent-coordination/scripts/agent_coordination_server.py
```

## License

MIT License. See [LICENSE](LICENSE).
