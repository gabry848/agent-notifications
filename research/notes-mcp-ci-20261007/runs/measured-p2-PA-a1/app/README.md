# Quick Notes

Persistent local notes with a server-rendered dashboard, JSON API and real MCP stdio service. Requires **Node.js 24**; uses only built-ins, including `node:sqlite`. No installation step.

## Launch

From this directory:

```sh
npm test
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
```

The web server binds only to localhost and prints one JSON startup line containing its port. Use `--port 0` to allocate a free port. The dashboard supports create/edit/delete, literal text search, exact tag filtering and 20-note pages. Tags in forms are comma-separated. Stop with Ctrl-C.

```sh
node src/mcp.mjs --db data/notes.sqlite
```

Configure an MCP client to launch `node` with arguments `src/mcp.mjs --db data/notes.sqlite` and this directory as its working directory (or use absolute paths). Transport is newline-delimited JSON-RPC 2.0, protocol version `2024-11-05`. Stdout contains only protocol responses; Node SQLite warnings go to stderr. Closing stdin closes the database and exits. Both services can use the same database sequentially; parent directories are created automatically. Keep the database file for persistence.

Example MCP input, one JSON object per line:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Remember the milk","tags":["Home"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover input schemas with `tools/list`. Tool content holds JSON text; errors set `isError`. `notes://all` contains all full records, newest first.

## JSON API examples

```sh
curl -s http://127.0.0.1:8080/api/notes -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["Home"]}'
curl -s 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'
curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Milk and bread","tags":["shopping"]}'
curl -s http://127.0.0.1:8080/api/tags
curl -s http://127.0.0.1:8080/api/export > notes.json
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' --data-binary @notes.json
curl -s -X DELETE http://127.0.0.1:8080/api/notes/1
```

Exports are `{version:1,notes:[{text,tags}]}` oldest first. Import accepts `{notes:[{text,tags?}]}` (also accepts the exported wrapper), validates the entire batch, then writes it in one transaction. Import adds notes; it does not replace or deduplicate existing notes.

Full records have `id`, `text`, sorted normalized `tags`, `createdAt`, `updatedAt`. Text is trimmed (1–4000 characters); tags are trimmed, lowercase, unique (1–40 characters each). Search treats `%` and `_` literally. JSON validation errors return 400; missing notes/routes return 404. This is a local application with no authentication; do not expose it through a public proxy.

## Tests

`npm test` includes the unchanged legacy smoke test plus storage and child-process integration tests. Coverage includes rollback, invalid later import records, tag cleanup through foreign-key cascade, reopening SQLite, exports beyond one page, MCP errors/resources and sequential web access to MCP-created notes.
