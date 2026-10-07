#!/usr/bin/env python3
"""Protocol smoke test for the agent-coordination MCP server."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "scripts" / "agent_coordination_server.py"


def call(proc: subprocess.Popen[str], request: dict) -> dict:
    assert proc.stdin is not None
    assert proc.stdout is not None
    proc.stdin.write(json.dumps(request) + "\n")
    proc.stdin.flush()
    line = proc.stdout.readline()
    if not line:
        raise RuntimeError("server exited without response")
    response = json.loads(line)
    if "error" in response:
        raise RuntimeError(response["error"])
    return response


def tool_result(response: dict) -> dict:
    text = response["result"]["content"][0]["text"]
    return json.loads(text)


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        env = os.environ.copy()
        env["AGENT_COORDINATION_DB"] = str(Path(tmp) / "coordination.sqlite3")
        proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            call(proc, {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
            tools = call(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
            tool_names = {tool["name"] for tool in tools["result"]["tools"]}
            assert tool_names == {
                "list_activities",
                "upsert_activity",
                "finish_activity",
                "post_message",
                "list_messages",
                "check_conflicts",
            }
            started = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 3,
                        "method": "tools/call",
                        "params": {
                            "name": "upsert_activity",
                            "arguments": {
                                "project": "demo",
                                "agent": "agent-a",
                                "status": "editing",
                                "description": "Editing auth coordination path.",
                                "areas": ["auth"],
                                "files": ["src/auth.ts"],
                            },
                        },
                    },
                )
            )
            activity_id = started["activity"]["id"]
            assert started["activity"]["project"] == "demo"
            assert started["activity"]["agent"] == "agent-a"
            assert started["activity"]["status"] == "editing"
            assert started["activity"]["description"] == "Editing auth coordination path."
            assert started["activity"]["areas"] == ["auth"]
            assert started["activity"]["files"] == ["src/auth.ts"]
            assert "title" not in started["activity"]
            assert "summary" not in started["activity"]
            conflicts = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 4,
                        "method": "tools/call",
                        "params": {
                            "name": "check_conflicts",
                            "arguments": {
                                "project": "demo",
                                "requester_agent": "agent-b",
                                "areas": ["auth"],
                                "files": ["src/auth.ts"],
                            },
                        },
                    },
                )
            )
            assert conflicts["level"] == "file_overlap"
            assert conflicts["conflicting_activities"][0]["description"] == "Editing auth coordination path."
            message = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 5,
                        "method": "tools/call",
                        "params": {
                            "name": "post_message",
                            "arguments": {
                                "project": "demo",
                                "from_agent": "agent-b",
                                "to_activity_id": activity_id,
                                "message": "Can I touch auth config after you finish?",
                            },
                        },
                    },
                )
            )
            assert message["message"]["id"].startswith("msg_")
            assert message["message"]["project"] == "demo"
            assert message["message"]["from_agent"] == "agent-b"
            assert message["message"]["message"] == "Can I touch auth config after you finish?"
            assert "severity" not in message["message"]
            assert "data" not in message["message"]
            assert "read_at" not in message["message"]
            listed_messages = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 6,
                        "method": "tools/call",
                        "params": {
                            "name": "list_messages",
                            "arguments": {"project": "demo", "activity_id": activity_id},
                        },
                    },
                )
            )
            assert listed_messages["count"] == 1
            assert listed_messages["messages"][0]["id"] == message["message"]["id"]
            assert "severity" not in listed_messages["messages"][0]
            assert "data" not in listed_messages["messages"][0]
            assert "read_at" not in listed_messages["messages"][0]
            updated = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 7,
                        "method": "tools/call",
                        "params": {
                            "name": "upsert_activity",
                            "arguments": {
                                "activity_id": activity_id,
                                "project": "demo",
                                "agent": "agent-a",
                                "status": "testing",
                                "description": "Testing auth coordination path.",
                                "areas": ["auth", "tests"],
                                "files": ["src/auth.ts", "test/auth.test.ts"],
                            },
                        },
                    },
                )
            )
            assert updated["activity"]["status"] == "testing"
            assert updated["activity"]["description"] == "Testing auth coordination path."
            assert updated["activity"]["areas"] == ["auth", "tests"]
            listed = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 8,
                        "method": "tools/call",
                        "params": {
                            "name": "list_activities",
                            "arguments": {"project": "demo", "include_details": True},
                        },
                    },
                )
            )
            assert listed["count"] == 1
            assert listed["activities"][0]["description"] == "Testing auth coordination path."
            finished = tool_result(
                call(
                    proc,
                    {
                        "jsonrpc": "2.0",
                        "id": 9,
                        "method": "tools/call",
                        "params": {
                            "name": "finish_activity",
                            "arguments": {
                                "activity_id": activity_id,
                                "description": "Auth edit completed",
                            },
                        },
                    },
                )
            )
            assert finished["activity"]["status"] == "done"
            assert finished["activity"]["description"] == "Auth edit completed"
        finally:
            proc.terminate()
            proc.wait(timeout=5)
    print("agent-coordination smoke test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
