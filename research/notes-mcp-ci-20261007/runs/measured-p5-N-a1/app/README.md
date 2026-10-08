# Quick Notes

Persistent local notes using Node.js 24 built-ins only. No install step, credentials or external services required.

## Launch

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
npm test
```

The dashboard supports creating, editing, deleting, literal substring search, exact tag filtering, tag counts and 20-note pages. Tags in forms are comma separated. Validation errors appear on the page without saving changes.

Use `--port 0` for an automatically assigned web port; stdout prints one JSON line `{ "port": ... }`. The server binds only to loopback. Stop with Ctrl-C. MCP stdout contains only newline-delimited JSON-RPC; diagnostics go to stderr. Ending MCP stdin closes the database. Parent database directories are created automatically. Use the same file for sequential web and MCP sessions; stop one before switching. Back up the SQLite file while both are stopped. This is an unauthenticated local application, not a public hosting service.

## JSON API examples

```sh
curl -s http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["errands"]}'
curl -s 'http://127.0.0.1:8080/api/notes?q=milk&tag=errands&limit=20&offset=0'
curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Milk and bread"}'
curl -s http://127.0.0.1:8080/api/tags
curl -s http://127.0.0.1:8080/api/export > notes.json
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' --data-binary @notes.json
curl -s -X DELETE http://127.0.0.1:8080/api/notes/1
```

`GET /api/notes/:id` returns one full note. Missing notes/routes return 404; invalid inputs return 400 with an error message. Export returns `{version:1,notes:[{text,tags}]}` oldest first. Import accepts its `notes` array (the version field is optional), validates every record before writing and returns created full records. Imports append rather than merge; repeating an import creates duplicates.

## MCP stdio

Configure an MCP client with command `node`, arguments `src/mcp.mjs --db data/notes.sqlite`, and this directory as its working directory (or use absolute paths). Protocol version: `2024-11-05`.

Example input lines:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover JSON Schemas with `tools/list`. Tool content is JSON encoded in a text item. `notes://all` is a bare array of full notes, newest first; it is not the export wrapper.

## Implementation and tests

`src/store.mjs` provides synchronous SQLite CRUD with bound parameters, foreign-key cascades, atomic updates and transactions. `src/validation.mjs` centralizes input normalization. Both interfaces use `src/import.mjs` for prevalidated transactional imports and complete exports (not limited to the default list page).

`npm test` runs the preserved smoke test plus storage regression tests and real subprocess MCP/HTTP integration tests. Coverage includes persistence, validation rollback, later-record invalid tags, transport errors and notifications, export/resource shapes, escaping, forms, filtering and pagination. Test databases are created inside `test/` and removed afterward.
