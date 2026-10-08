# Quick Notes

A persistent local notes app using only Node.js 24 built-ins. No installation or credentials required.

## Launch

From this directory:

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080

node src/mcp.mjs --db data/notes.sqlite

npm test
```

`npm run web` and `npm run mcp` use the same defaults. Database parent directories are created automatically. `--port 0` selects a free port; the web server prints one JSON startup line containing its port. Stop with Ctrl-C. Use the same database for sequential web and MCP processes to share notes. SQLite files persist across restarts; back up the file while the app is stopped.

The dashboard supports creating, editing and deleting notes, literal substring search, exact tag filtering, tag counts and 20-note pagination. Text is trimmed (1–4000 characters); tags are trimmed, lowercased, deduplicated and sorted (1–40 characters each). Form tags are comma-separated. Validation errors appear on the page.

## JSON API

```sh
curl -s http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["Home"]}'

curl -s 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'

curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Milk and bread","tags":["shopping"]}'

curl -s http://127.0.0.1:8080/api/export > backup.json
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' --data-binary @backup.json
```

Other routes: `GET /api/notes/:id`, `DELETE /api/notes/:id`, `GET /api/tags`. Collections and imports return bare arrays; single-note routes return full note records. Exports contain `{version:1,notes:[{text,tags}]}` in oldest-first order. Imports accept `{notes:[{text,tags?}]}` (the export wrapper is compatible), append new notes, and validate the complete batch before writing atomically. Imported notes receive new IDs and timestamps. Invalid input returns 400; missing notes/routes return 404.

## MCP stdio

Configure an MCP client to launch `node` with arguments `src/mcp.mjs --db data/notes.sqlite`, with this directory as its working directory (or use absolute paths). The service uses newline-delimited JSON-RPC 2.0, protocol version `2024-11-05`. Stdout is reserved for protocol responses; stdin EOF closes the database and exits.

Example input lines:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover JSON Schemas with `tools/list`. Tool content contains JSON-encoded values; invalid tool calls return `isError:true`. The `notes://all` resource is a bare newest-first array of full note records, unlike the export wrapper.

## Tests and scope

`npm test` covers normalization, validation, atomic updates/imports, rollback, literal search, deletion cascades, persistence, large exports, real MCP subprocess transport, dashboard escaping/forms/pagination, API routes and cross-process state. No external dependencies or remote services are used. The web server binds only to loopback and is intended for trusted local use, not public deployment.
