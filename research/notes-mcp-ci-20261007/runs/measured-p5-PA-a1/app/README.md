# Quick Notes

Persistent local notes with a server-rendered dashboard, JSON API and a real MCP stdio service. Requires **Node.js 24**; uses only built-ins (including `node:sqlite`). No installation, credentials or network service needed.

## Launch

```sh
npm test
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080

node src/mcp.mjs --db data/notes.sqlite
```

Alternatively use `npm run web` or `npm run mcp`. Database directories are created automatically. Both services default to `data/notes.sqlite`; they can use the same file sequentially. State persists across restarts. Stop the web process with Ctrl-C; MCP closes its database when stdin ends.

The web server binds only to localhost. `--port 0` selects a free port; its single startup stdout line is JSON, e.g. `{"port":54321}`. SQLite experimental warnings, if emitted by Node, go to stderr.

The dashboard supports create/edit/delete, literal text search, exact tag filtering, counts and 20-note pages. Text is trimmed (1–4000 characters). Tags are trimmed/lowercased, deduplicated and sorted, with at most 40 characters per tag. HTML forms accept comma-separated tags; JSON accepts arrays. Validation errors return HTTP 400 and readable messages.

## JSON API examples

```sh
curl -s http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["Home"]}'

curl -s 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'
curl -s http://127.0.0.1:8080/api/notes/1
curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"tags":["shopping"]}'
curl -s http://127.0.0.1:8080/api/tags
curl -s http://127.0.0.1:8080/api/export
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' \
  -d '{"notes":[{"text":"Imported note","tags":["home"]}]}'
curl -s -X DELETE http://127.0.0.1:8080/api/notes/1
```

Collection and import responses are bare note arrays; single-note responses include `id`, `text`, `tags`, `createdAt`, `updatedAt`. Export returns `{version:1,notes:[{text,tags}]}` in oldest-first order. Import accepts its `notes` array, creates new IDs, and validates the entire batch before writing it in a transaction. Missing routes/notes return 404. Search treats `%` and `_` literally; collection order is newest ID first, limit 1–100 (default 50), offset nonnegative.

## MCP

Configure an MCP client to launch `node` with arguments `src/mcp.mjs --db data/notes.sqlite` from this directory, or use absolute paths. Transport is newline-delimited JSON-RPC 2.0 on stdio, protocol `2024-11-05`. Stdout contains only protocol messages.

For a direct round-trip:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"From MCP","tags":["demo"]}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}' \
  | node src/mcp.mjs --db data/notes.sqlite
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover schemas with `tools/list`. Tool content is text containing a JSON value; invalid calls set `isError:true`. The `notes://all` JSON resource contains all full note records newest-first, not the export wrapper. Notifications receive no response.

## Tests and structure

`npm test` runs the preserved smoke test plus storage and subprocess integration tests under `test/`. Coverage includes normalization, Unicode/literal search, persistence, foreign-key cascading, atomic updates/imports (invalid later text and tags), pagination, export, MCP framing/errors and all tools, dashboard escaping/forms, JSON routes and sequential cross-process database sharing. Tests use disposable databases and require no running services.

- `src/store.mjs`: synchronous SQLite store and validation
- `src/import.mjs`: shared atomic importer, export and all-note traversal
- `src/mcp.mjs`: MCP stdio entry point
- `src/web.mjs`: local dashboard and JSON API

This is a local tool without authentication; do not expose it to an untrusted network.
