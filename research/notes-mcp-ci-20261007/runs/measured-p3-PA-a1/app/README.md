# Quick Notes

Persistent local notes with a dashboard, JSON API and MCP stdio service. Requires Node.js 24; uses only built-ins. No install step or credentials.

```sh
npm test
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
```

The database directory is created automatically. Both services can use the same file sequentially. Stop web with Ctrl-C; MCP closes its database when stdin ends. Web binds only to localhost; `--port 0` chooses an available port and prints a single JSON startup line containing it. MCP stdout contains protocol messages only (Node's SQLite warning may appear on stderr).

## Dashboard and API

The dashboard supports creating, editing, deleting, searching, tag filtering, tag counts and 20-note pages. Tags in forms are comma separated. Text and tags are normalized and validated before writes.

```sh
curl -X POST http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["Home"]}'
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'
curl http://127.0.0.1:8080/api/export
curl -X POST http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' \
  -d '{"notes":[{"text":"Imported note","tags":["home"]}]}'
```

Also available: `GET/PATCH/DELETE /api/notes/:id` and `GET /api/tags`. Export is `{version:1,notes:[{text,tags}]}` oldest first. Import accepts its `notes` array, validates all text and tags before any writes, and returns created full note records. Validation errors return 400; missing routes/notes return 404.

## MCP

Configure an MCP client with command `node`, arguments `src/mcp.mjs --db data/notes.sqlite`, and this directory as its working directory (or use absolute paths). Transport is newline-delimited JSON-RPC 2.0, protocol `2024-11-05`.

Example stdin messages (one JSON object per line):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover their schemas with `tools/list`. The `notes://all` resource contains all full note records newest first.

## Tests

`npm test` includes storage persistence/foreign-key checks, validation and invalid-batch atomicity, real MCP subprocess transport, and real HTTP dashboard/API tests. Tests use temporary databases and require no running service.
