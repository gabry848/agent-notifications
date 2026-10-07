#!/usr/bin/env python3
"""Small stdio MCP server for coordinating concurrent coding agents."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


SERVER_NAME = "agent-coordination"
SERVER_VERSION = "0.1.0"
PROTOCOL_VERSION = "2024-11-05"

ACTIVE_STATUSES = {"planning", "waiting", "editing", "testing", "blocked", "reviewing"}
FINISHED_STATUSES = {"done", "abandoned"}
VALID_STATUSES = ACTIVE_STATUSES | FINISHED_STATUSES


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def short_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def db_path() -> Path:
    configured = os.environ.get("AGENT_COORDINATION_DB")
    if configured:
        return Path(configured).expanduser()
    base = Path(os.environ.get("TMPDIR", "/private/tmp"))
    return base / "agent-coordination" / "coordination.sqlite3"


def load_json(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def dump_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True)


def as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return [str(value)]


def compact_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value).strip()


class CoordinationStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.init_schema()

    def init_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS activities (
                id TEXT PRIMARY KEY,
                project TEXT NOT NULL,
                agent TEXT NOT NULL,
                status TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                areas_json TEXT NOT NULL DEFAULT '[]',
                files_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                data_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE INDEX IF NOT EXISTS idx_activities_project_status
                ON activities(project, status, updated_at);
            CREATE INDEX IF NOT EXISTS idx_activities_expiry
                ON activities(project, expires_at);

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                project TEXT NOT NULL,
                from_agent TEXT NOT NULL,
                to_agent TEXT,
                to_activity_id TEXT,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_project_created
                ON messages(project, created_at);
            CREATE INDEX IF NOT EXISTS idx_messages_targets
                ON messages(project, to_agent, to_activity_id);
            """
        )
        self.migrate_activity_schema()
        self.conn.commit()

    def migrate_activity_schema(self) -> None:
        columns = self.activity_columns()
        required_columns = {
            "description": "TEXT NOT NULL DEFAULT ''",
            "areas_json": "TEXT NOT NULL DEFAULT '[]'",
            "files_json": "TEXT NOT NULL DEFAULT '[]'",
            "data_json": "TEXT NOT NULL DEFAULT '{}'",
        }
        for name, definition in required_columns.items():
            if name not in columns:
                self.conn.execute(f"ALTER TABLE activities ADD COLUMN {name} {definition}")

        columns = self.activity_columns()
        if "summary" in columns:
            self.conn.execute(
                """
                UPDATE activities
                SET description = summary
                WHERE description = '' AND summary IS NOT NULL AND summary != ''
                """
            )
        if "title" in columns:
            self.conn.execute(
                """
                UPDATE activities
                SET description = title
                WHERE description = '' AND title IS NOT NULL AND title != ''
                """
            )
        if "areas_json" in columns or "files_json" in columns:
            rows = self.conn.execute("SELECT id, data_json, areas_json, files_json FROM activities")
            for row in rows:
                data = load_json(row["data_json"], {})
                updates: dict[str, str] = {}
                if row["areas_json"] in {"", "[]"} and data.get("areas"):
                    updates["areas_json"] = dump_json(as_str_list(data.get("areas")))
                if row["files_json"] in {"", "[]"} and data.get("files"):
                    updates["files_json"] = dump_json(as_str_list(data.get("files")))
                if updates:
                    assignments = ", ".join(f"{key} = ?" for key in updates)
                    self.conn.execute(
                        f"UPDATE activities SET {assignments} WHERE id = ?",
                        list(updates.values()) + [row["id"]],
                    )

    def activity_columns(self) -> set[str]:
        return {row["name"] for row in self.conn.execute("PRAGMA table_info(activities)")}

    def row_to_activity(self, row: sqlite3.Row, include_details: bool = False) -> dict[str, Any]:
        data = load_json(row["data_json"], {})
        expires_at = parse_iso(row["expires_at"])
        stale = bool(expires_at and expires_at < now_utc() and row["status"] not in FINISHED_STATUSES)
        activity = {
            "id": row["id"],
            "project": row["project"],
            "agent": row["agent"],
            "status": "stale" if stale else row["status"],
            "description": row["description"],
            "areas": as_str_list(load_json(row["areas_json"], [])),
            "files": as_str_list(load_json(row["files_json"], [])),
            "updated_at": row["updated_at"],
            "expires_at": row["expires_at"],
            "stale": stale,
        }
        if include_details:
            activity.update(
                {
                    "created_at": row["created_at"],
                }
            )
            if data:
                activity["data"] = data
        return activity

    def list_activities(self, args: dict[str, Any]) -> dict[str, Any]:
        project = required_text(args, "project")
        include_done = bool(args.get("include_done", False))
        include_details = bool(args.get("include_details", False))
        include_stale = bool(args.get("include_stale", True))
        limit = int(args.get("limit", 25))
        requested_areas = set(as_str_list(args.get("areas")))
        requested_files = set(as_str_list(args.get("files")))

        sql = "SELECT * FROM activities WHERE project = ?"
        params: list[Any] = [project]
        if not include_done:
            sql += " AND status NOT IN ('done', 'abandoned')"
        sql += " ORDER BY updated_at DESC LIMIT ?"
        params.append(max(1, min(limit * 4, 200)))

        activities: list[dict[str, Any]] = []
        for row in self.conn.execute(sql, params):
            area_set = set(as_str_list(load_json(row["areas_json"], [])))
            file_set = set(as_str_list(load_json(row["files_json"], [])))
            if requested_areas and not (requested_areas & area_set):
                continue
            if requested_files and not (requested_files & file_set):
                continue
            activity = self.row_to_activity(row, include_details=include_details)
            if activity["stale"] and not include_stale:
                continue
            if include_details:
                activity["recent_messages"] = self.recent_messages_for_activity(project, activity["id"])
            activities.append(activity)
            if len(activities) >= limit:
                break

        return {"activities": activities, "count": len(activities), "database": str(self.path)}

    def upsert_activity(self, args: dict[str, Any]) -> dict[str, Any]:
        activity_id = optional_text(args.get("activity_id"))
        row = self.fetch_activity_row(activity_id) if activity_id else None
        project = required_text(args, "project") if row is None else compact_text(args.get("project"), row["project"])
        agent = required_text(args, "agent") if row is None else compact_text(args.get("agent"), row["agent"])
        status = compact_text(args.get("status"), row["status"] if row else "planning")
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status '{status}'. Use one of: {', '.join(sorted(VALID_STATUSES))}")

        description = compact_text(
            args.get("description"),
            row["description"] if row else compact_text(args.get("summary"), compact_text(args.get("title"))),
        )
        if not description:
            description = compact_text(args.get("summary"), compact_text(args.get("title")))
        previous_areas = load_json(row["areas_json"], []) if row else []
        previous_files = load_json(row["files_json"], []) if row else []
        areas = as_str_list(args.get("areas")) if "areas" in args else as_str_list(previous_areas)
        files = as_str_list(args.get("files")) if "files" in args else as_str_list(previous_files)
        created_at = row["created_at"] if row else iso(now_utc())
        updated_at = iso(now_utc())
        ttl_minutes = int(args.get("ttl_minutes", 60))
        expires_at = iso(now_utc() + timedelta(minutes=max(5, ttl_minutes)))
        data = load_json(row["data_json"], {}) if row else {}
        extra_data = args.get("data")
        if isinstance(extra_data, dict):
            data.update(extra_data)

        values = {
            "id": activity_id or short_id("act"),
            "project": project,
            "agent": agent,
            "status": status,
            "description": description,
            "areas_json": dump_json(areas),
            "files_json": dump_json(files),
            "created_at": created_at,
            "updated_at": updated_at,
            "expires_at": expires_at,
            "data_json": dump_json(data),
        }
        columns = self.activity_columns()
        if row is None:
            legacy_values = {
                "title": compact_text(args.get("title"), description),
                "summary": compact_text(args.get("summary"), description),
                "worktree": optional_text(args.get("worktree")),
                "branch": optional_text(args.get("branch")),
                "priority": compact_text(args.get("priority"), "normal"),
                "eta_minutes": optional_int(args.get("eta_minutes")),
            }
            insert_values = {**values, **{k: v for k, v in legacy_values.items() if k in columns}}
            names = list(insert_values)
            placeholders = ", ".join("?" for _ in names)
            self.conn.execute(
                f"INSERT INTO activities ({', '.join(names)}) VALUES ({placeholders})",
                [insert_values[name] for name in names],
            )
        else:
            updates = {key: value for key, value in values.items() if key != "id"}
            if "summary" in columns:
                updates["summary"] = compact_text(args.get("summary"), description)
            if "title" in columns and ("title" in args or not compact_text(row["title"])):
                updates["title"] = compact_text(args.get("title"), description)
            assignments = ", ".join(f"{key} = ?" for key in updates)
            self.conn.execute(
                f"UPDATE activities SET {assignments} WHERE id = ?",
                list(updates.values()) + [values["id"]],
            )
        self.conn.commit()
        activity = self.get_activity(values["id"], include_details=True)
        conflicts = self.check_conflicts(
            {
                "project": project,
                "requester_agent": agent,
                "areas": areas,
                "files": files,
                "exclude_activity_id": values["id"],
            }
        )
        return {"activity": activity, "conflicts": conflicts}

    def finish_activity(self, args: dict[str, Any]) -> dict[str, Any]:
        activity_id = required_text(args, "activity_id")
        outcome = compact_text(args.get("outcome"), "completed")
        status = "abandoned" if outcome in {"abandoned", "cancelled", "canceled"} else "done"
        row = self.fetch_activity_row(activity_id)
        data = load_json(row["data_json"], {})
        data["outcome"] = outcome

        updated_at = iso(now_utc())
        description = compact_text(args.get("description"), compact_text(args.get("summary"), row["description"]))
        self.conn.execute(
            """
            UPDATE activities
            SET status = ?, description = ?, updated_at = ?, expires_at = ?, data_json = ?
            WHERE id = ?
            """,
            (status, description, updated_at, updated_at, dump_json(data), activity_id),
        )
        self.conn.commit()
        return {"activity": self.get_activity(activity_id, include_details=True)}

    def post_message(self, args: dict[str, Any]) -> dict[str, Any]:
        project = required_text(args, "project")
        from_agent = required_text(args, "from_agent")
        message = required_text(args, "message")
        message_id = short_id("msg")
        created_at = iso(now_utc())
        self.conn.execute(
            """
            INSERT INTO messages (
                id, project, from_agent, to_agent, to_activity_id, message, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                project,
                from_agent,
                optional_text(args.get("to_agent")),
                optional_text(args.get("to_activity_id")),
                message,
                created_at,
            ),
        )
        self.conn.commit()
        return {"message": self.get_message(message_id)}

    def list_messages(self, args: dict[str, Any]) -> dict[str, Any]:
        project = required_text(args, "project")
        agent = optional_text(args.get("agent"))
        activity_id = optional_text(args.get("activity_id"))
        include_broadcast = bool(args.get("include_broadcast", True))
        limit = max(1, min(int(args.get("limit", 25)), 100))

        sql = "SELECT * FROM messages WHERE project = ?"
        params: list[Any] = [project]
        clauses: list[str] = []
        if agent:
            if include_broadcast:
                clauses.append("(to_agent = ? OR to_agent IS NULL)")
            else:
                clauses.append("to_agent = ?")
            params.append(agent)
        if activity_id:
            if include_broadcast:
                clauses.append("(to_activity_id = ? OR to_activity_id IS NULL)")
            else:
                clauses.append("to_activity_id = ?")
            params.append(activity_id)
        if "since" in args:
            clauses.append("created_at >= ?")
            params.append(compact_text(args.get("since")))
        if clauses:
            sql += " AND " + " AND ".join(clauses)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        messages = [self.row_to_message(row) for row in self.conn.execute(sql, params)]
        return {"messages": messages, "count": len(messages)}

    def check_conflicts(self, args: dict[str, Any]) -> dict[str, Any]:
        project = required_text(args, "project")
        requester_agent = optional_text(args.get("requester_agent"))
        exclude_activity_id = optional_text(args.get("exclude_activity_id"))
        requested_areas = set(as_str_list(args.get("areas")))
        requested_files = set(as_str_list(args.get("files")))
        include_stale = bool(args.get("include_stale", False))

        rows = self.conn.execute(
            """
            SELECT * FROM activities
            WHERE project = ? AND status NOT IN ('done', 'abandoned')
            ORDER BY updated_at DESC
            """,
            (project,),
        )
        conflicts: list[dict[str, Any]] = []
        highest = "none"
        should_wait = False
        for row in rows:
            if exclude_activity_id and row["id"] == exclude_activity_id:
                continue
            if requester_agent and row["agent"] == requester_agent:
                continue
            activity = self.row_to_activity(row, include_details=True)
            if activity["stale"] and not include_stale:
                continue
            areas = set(activity["areas"])
            files = set(activity["files"])
            file_overlap = sorted(requested_files & files)
            area_overlap = sorted(requested_areas & areas)
            level = "same_project"
            if area_overlap:
                level = "area_overlap"
            if file_overlap:
                level = "file_overlap"
            if activity["status"] == "blocked":
                level = "blocking" if level != "same_project" else "blocked_peer"
            if activity["stale"]:
                level = "stale"
            if level in {"file_overlap", "blocking"}:
                should_wait = True
            highest = stronger_level(highest, level)
            conflicts.append(
                {
                    "activity_id": activity["id"],
                    "agent": activity["agent"],
                    "status": activity["status"],
                    "description": activity["description"],
                    "level": level,
                    "area_overlap": area_overlap,
                    "file_overlap": file_overlap,
                    "updated_at": activity["updated_at"],
                }
            )

        return {
            "level": highest,
            "should_wait": should_wait,
            "conflicting_activities": conflicts,
            "recommendation": recommendation_for(highest, should_wait),
        }

    def get_activity(self, activity_id: str, include_details: bool = False) -> dict[str, Any]:
        return self.row_to_activity(self.fetch_activity_row(activity_id), include_details=include_details)

    def fetch_activity_row(self, activity_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if row is None:
            raise ValueError(f"Unknown activity_id: {activity_id}")
        return row

    def get_message(self, message_id: str) -> dict[str, Any]:
        row = self.conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        if row is None:
            raise ValueError(f"Unknown message_id: {message_id}")
        return self.row_to_message(row)

    def row_to_message(self, row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "project": row["project"],
            "from_agent": row["from_agent"],
            "to_agent": row["to_agent"],
            "to_activity_id": row["to_activity_id"],
            "message": row["message"],
            "created_at": row["created_at"],
        }

    def recent_messages_for_activity(self, project: str, activity_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            SELECT * FROM messages
            WHERE project = ? AND (to_activity_id = ? OR to_activity_id IS NULL)
            ORDER BY created_at DESC LIMIT 5
            """,
            (project, activity_id),
        )
        return [self.row_to_message(row) for row in rows]


def required_text(args: dict[str, Any], key: str) -> str:
    value = compact_text(args.get(key))
    if not value:
        raise ValueError(f"Missing required argument: {key}")
    return value


def optional_text(value: Any) -> str | None:
    text = compact_text(value)
    return text or None


def optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    return int(value)


def stronger_level(current: str, candidate: str) -> str:
    order = {
        "none": 0,
        "stale": 1,
        "same_project": 2,
        "blocked_peer": 3,
        "area_overlap": 4,
        "file_overlap": 5,
        "blocking": 6,
    }
    return candidate if order.get(candidate, 0) > order.get(current, 0) else current


def recommendation_for(level: str, should_wait: bool) -> str:
    if level == "none":
        return "No active coordination conflict was found."
    if should_wait:
        return "Wait briefly or coordinate before editing overlapping files."
    if level == "area_overlap":
        return "Coordinate with the other agent and avoid overlapping files until scope is clear."
    if level in {"same_project", "blocked_peer"}:
        return "Proceed carefully, update your activity, and watch for messages."
    if level == "stale":
        return "The only matching activity is stale; proceed but mention the stale activity in your notes."
    return "Review the listed activity before proceeding."


TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "list_activities": {
        "description": "List active or completed activities for a project. Returns the compact activity shape by default.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "areas": {"type": "array", "items": {"type": "string"}},
                "files": {"type": "array", "items": {"type": "string"}},
                "include_done": {"type": "boolean", "default": False},
                "include_stale": {"type": "boolean", "default": True},
                "include_details": {"type": "boolean", "default": False},
                "limit": {"type": "integer", "default": 25},
            },
            "required": ["project"],
        },
    },
    "upsert_activity": {
        "description": "Create or update an activity using the central compact shape.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "activity_id": {"type": "string"},
                "project": {"type": "string"},
                "agent": {"type": "string"},
                "status": {"type": "string", "default": "planning"},
                "description": {"type": "string", "description": "Markdown or plain text activity description."},
                "areas": {"type": "array", "items": {"type": "string"}},
                "files": {"type": "array", "items": {"type": "string"}},
                "ttl_minutes": {"type": "integer", "default": 60},
            },
            "required": ["project", "agent", "description"],
        },
    },
    "finish_activity": {
        "description": "Close an activity as completed or abandoned and optionally record a final description.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "activity_id": {"type": "string"},
                "outcome": {"type": "string", "default": "completed"},
                "description": {"type": "string"},
            },
            "required": ["activity_id"],
        },
    },
    "post_message": {
        "description": "Post a Markdown coordination message to a project, agent, or activity.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "from_agent": {"type": "string"},
                "message": {"type": "string", "description": "Markdown or plain text message body."},
                "to_agent": {"type": "string"},
                "to_activity_id": {"type": "string"},
            },
            "required": ["project", "from_agent", "message"],
        },
    },
    "list_messages": {
        "description": "List recent project, agent, or activity coordination messages.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "agent": {"type": "string"},
                "activity_id": {"type": "string"},
                "since": {"type": "string"},
                "include_broadcast": {"type": "boolean", "default": True},
                "limit": {"type": "integer", "default": 25},
            },
            "required": ["project"],
        },
    },
    "check_conflicts": {
        "description": "Check active activities for same-project, area, or file overlaps.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "requester_agent": {"type": "string"},
                "areas": {"type": "array", "items": {"type": "string"}},
                "files": {"type": "array", "items": {"type": "string"}},
                "include_stale": {"type": "boolean", "default": False},
                "exclude_activity_id": {"type": "string"},
            },
            "required": ["project"],
        },
    },
}


class JsonRpcServer:
    def __init__(self) -> None:
        self.store = CoordinationStore(db_path())

    def run(self) -> None:
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                message = json.loads(line)
                response = self.handle_message(message)
                if response is not None:
                    self.write(response)
            except Exception as exc:
                self.write(error_response(None, -32603, str(exc)))

    def handle_message(self, message: dict[str, Any]) -> dict[str, Any] | None:
        method = message.get("method")
        request_id = message.get("id")
        params = message.get("params") or {}

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                },
            }
        if method == "notifications/initialized":
            return None
        if method == "ping":
            return {"jsonrpc": "2.0", "id": request_id, "result": {}}
        if method == "tools/list":
            tools = [{"name": name, **schema} for name, schema in TOOL_SCHEMAS.items()]
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tools}}
        if method == "tools/call":
            return self.handle_tool_call(request_id, params)
        if method in {"resources/list", "prompts/list"}:
            key = "resources" if method == "resources/list" else "prompts"
            return {"jsonrpc": "2.0", "id": request_id, "result": {key: []}}
        return error_response(request_id, -32601, f"Method not found: {method}")

    def handle_tool_call(self, request_id: Any, params: dict[str, Any]) -> dict[str, Any]:
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            if name == "list_activities":
                result = self.store.list_activities(args)
            elif name == "upsert_activity":
                result = self.store.upsert_activity(args)
            elif name == "finish_activity":
                result = self.store.finish_activity(args)
            elif name == "post_message":
                result = self.store.post_message(args)
            elif name == "list_messages":
                result = self.store.list_messages(args)
            elif name == "check_conflicts":
                result = self.store.check_conflicts(args)
            else:
                raise ValueError(f"Unknown tool: {name}")
            return tool_response(request_id, result)
        except Exception as exc:
            return tool_response(request_id, {"error": str(exc)}, is_error=True)

    def write(self, message: dict[str, Any]) -> None:
        sys.stdout.write(json.dumps(message, ensure_ascii=True) + "\n")
        sys.stdout.flush()


def tool_response(request_id: Any, result: dict[str, Any], is_error: bool = False) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=True, indent=2)}],
            "isError": is_error,
        },
    }


def error_response(request_id: Any, code: int, message: str) -> dict[str, Any]:
    if os.environ.get("AGENT_COORDINATION_DEBUG"):
        traceback.print_exc(file=sys.stderr)
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


if __name__ == "__main__":
    JsonRpcServer().run()
