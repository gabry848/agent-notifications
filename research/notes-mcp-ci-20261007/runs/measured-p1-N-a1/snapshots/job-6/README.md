# Quick Notes

Persistent SQLite notes, a server-rendered dashboard, JSON API and real MCP stdio service. Requires **Node.js 24**; uses only built-ins, with no install step.

## Launch

Run from this directory:

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://localhost:8080
node src/mcp.mjs --db data/notes.sqlite
npm test
```

Or use `npm run web` / `npm run mcp`. Database parent directories are created automatically. Both services can use the same database sequentially; notes survive restarts. `--port 0` chooses an available port and the web process prints one JSON line `{"port":12345}`. The web service binds to loopback only. Stop with Ctrl-C; MCP also closes cleanly when stdin ends. SQLite warnings, if emitted by Node, go to stderr.

The dashboard supports create, edit, delete, literal case-insensitive search, tag filtering and 20-note pages. Form tags are comma-separated. Text is trimmed (1–4000 characters); tags are trimmed, lowercased, deduplicated and sorted (1–40 characters each). API/MCP tags are arrays. Updates replace any supplied tag array, including `[]` to clear tags.

## JSON API examples

```sh
curl -s http://localhost:8080/api/notes -H 'Content-Type: application/json' \
  -d '{"text":"Remember the meeting","tags":["Work"]}'
curl -s 'http://localhost:8080/api/notes?q=meeting&tag=work&limit=20&offset=0'
curl -s -X PATCH http://localhost:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Meeting at 10","tags":[]}'
curl -s http://localhost:8080/api/tags
curl -s http://localhost:8080/api/export > notes.json
curl -s http://localhost:8080/api/import -H 'Content-Type: application/json' --data-binary @notes.json
curl -s -X DELETE http://localhost:8080/api/notes/1
```

Single notes: `GET/PATCH/DELETE /api/notes/:id`. Collections and tags are bare arrays; delete returns a boolean. Validation errors return 400 with an `error` message; missing notes/routes return 404. Imports accept `{notes:[{text,tags?}]}` (the export wrapper is accepted too), validate every field before writing and run in one transaction. Exports are `{version:1,notes:[{text,tags}]}` oldest first. Web request bodies are limited to 2 MiB. This is a local, unauthenticated application, not a public hosting service.

## MCP

Configure an MCP client with command `node`, args `["/absolute/path/to/app/src/mcp.mjs","--db","/absolute/path/to/app/data/notes.sqlite"]`. Protocol: JSON-RPC 2.0, newline-delimited stdio, MCP `2024-11-05`. Stdout contains protocol messages only.

Example (one JSON object per input line):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover their schemas with `tools/list`. Results are JSON encoded in text content; invalid tool calls set `isError:true`. Resource `notes://all` is the full newest-first note array, not the export wrapper.

## Tests

`npm test` runs the unchanged legacy smoke test plus storage and process-level service tests. These cover persistence, normalization, literal filters, pagination, transaction rollback, late-invalid import text/tags, exports beyond 100 notes, real MCP transport, dashboard escaping/forms and shared MCP/web database state. Tests create temporary databases under `test/` and remove them afterward.
