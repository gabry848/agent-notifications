# Quick Notes

Persistent local notes, an MCP stdio service, and a server-rendered dashboard using only Node.js 24 built-ins. No installation step or remote service is required.

## Launch

From this directory, with Node.js 24:

```sh
npm test
node src/web.mjs --db data/notes.sqlite --port 8080
```

Open `http://127.0.0.1:8080`. The web process prints one JSON startup line containing its port; use `--port 0` for an available ephemeral port. The dashboard supports creating, editing, deleting, searching, exact tag filtering, tag counts and 20-note pages. Stop with Ctrl-C.

```sh
node src/mcp.mjs --db data/notes.sqlite
```

Configure your MCP client to run `node` with arguments `src/mcp.mjs --db data/notes.sqlite` and this directory as its working directory (or use absolute paths). Transport is newline-delimited JSON-RPC 2.0 over stdin/stdout, protocol `2024-11-05`. Stdout contains protocol messages only; Node's SQLite warnings, if any, go to stderr. Closing stdin shuts down cleanly. Both services can reuse the same database sequentially; missing parent directories are created automatically.

Example stdio session (one JSON object per line):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Buy milk","tags":["Errands"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. `tools/list` exposes their JSON Schemas. Tool content is JSON encoded in a text content entry. `notes://all` returns all full note records newest first.

## JSON API examples

With the web service running:

```sh
curl -X POST http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Buy milk","tags":["Errands"]}'
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=errands&limit=20&offset=0'
curl -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Buy oat milk"}'
curl http://127.0.0.1:8080/api/tags
curl http://127.0.0.1:8080/api/export
curl -X POST http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' \
  -d '{"notes":[{"text":"Imported note","tags":["work"]}]}'
curl -X DELETE http://127.0.0.1:8080/api/notes/1
```

Single-note GET is `/api/notes/:id`. Collection responses and imports are bare note arrays; deletes are booleans. Export is `{version:1,notes:[{text,tags}]}` oldest first. Pass its `notes` array to import; imports append rather than replace. Imports prevalidate every record and commit atomically. Validation errors return HTTP 400; missing notes/routes return 404.

Text is trimmed (1–4000 characters), tags are trimmed/lowercased/deduplicated (1–40 characters each). Searches are case-insensitive literal substrings, including `%` and `_`. API pagination limits are 1–100; default 50. Dashboard tags use commas as separators. HTML content is escaped. The dashboard is intended for local use and has no authentication; do not expose it through a public proxy.

## Tests and implementation

`npm test` runs the preserved smoke test plus storage and real subprocess integration tests. They cover validation/atomicity, Unicode and literal search, pagination, SQLite persistence and cascade deletion, all MCP tools/resources, transport errors/shutdown, API/form workflows and HTML escaping. Temporary test databases are created under `test/` and removed.

- `src/store.mjs`: synchronous SQLite store and shared validators.
- `src/import.mjs`: shared atomic importer and complete export helpers.
- `src/mcp.mjs`: MCP stdio server.
- `src/web.mjs`: local HTTP dashboard and JSON API.

Back up the SQLite file while services are stopped to preserve notes, IDs and timestamps. JSON exports preserve note text/tags only.
