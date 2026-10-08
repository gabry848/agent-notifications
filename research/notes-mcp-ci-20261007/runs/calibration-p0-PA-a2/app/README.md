# Quick Notes

Persistent local notes with a server-rendered dashboard and MCP stdio service. Requires Node.js 24 (built-in SQLite); no dependencies or installation step.

## Launch

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
node --test test/*.test.mjs
```

The web server prints one JSON line with its actual port (`--port 0` selects an available port). MCP reads newline-delimited JSON-RPC on stdin and writes only protocol responses to stdout. SQLite experimental warnings, if emitted by Node, go to stderr. End stdin to close MCP; Ctrl-C stops the web server. Both processes can use the same database sequentially. Parent directories are created automatically.

Configure an MCP client with command `node`, arguments `["/absolute/path/src/mcp.mjs", "--db", "/absolute/path/data/notes.sqlite"]`. Protocol version: `2024-11-05`. Available tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Resource `notes://all` exposes all full records, newest first.

Example stdio request:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Remember the meeting","tags":["work"]}}}
```

## HTTP examples

```sh
curl -H 'Content-Type: application/json' -d '{"text":"Buy milk","tags":["home"]}' http://127.0.0.1:8080/api/notes
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'
curl -X PATCH -H 'Content-Type: application/json' -d '{"text":"Buy oat milk"}' http://127.0.0.1:8080/api/notes/1
curl http://127.0.0.1:8080/api/export
curl -H 'Content-Type: application/json' -d '{"notes":[{"text":"Imported note","tags":["home"]}]}' http://127.0.0.1:8080/api/import
```

Exports have shape `{version:1,notes:[{text,tags}]}`, oldest first. Imports accept a `notes` array (the export wrapper can be submitted directly); every record is validated before any write and the batch is transactional. Text is trimmed, tags are normalized and deduplicated. Search is a literal case-insensitive substring, not a SQL pattern. The dashboard offers creation, editing, deletion, search, tag counts and 20-note pages.

This is a localhost-only application with no authentication. Keep the SQLite file private; back it up with processes stopped. Automated tests cover validation, persistence, cascade deletion, batch atomicity, MCP framing/errors and real HTTP dashboard/API behavior.
