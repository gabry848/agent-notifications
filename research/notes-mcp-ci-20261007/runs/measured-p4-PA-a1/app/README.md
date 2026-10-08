# Quick Notes

Persistent local notes with a server-rendered dashboard, JSON API and MCP stdio service. Requires **Node.js 24**; uses only built-ins (`node:sqlite`), with no install step. Run commands from this directory.

## Launch

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
npm test
```

The web server binds only to localhost and prints one JSON startup line containing its port. Use `--port 0` for an available port. Stop web with Ctrl-C. MCP accepts newline-delimited JSON-RPC on stdin, writes only protocol messages to stdout, and closes its database on stdin EOF. Node may emit its SQLite experimental warning on stderr.

Configure an MCP client to launch `node` with arguments `src/mcp.mjs --db data/notes.sqlite` and this directory as its working directory (or use absolute paths). Protocol version is `2024-11-05`. Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Resource `notes://all` returns all full note records, newest first.

A stdio example:

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Remember milk","tags":["shopping"]}}}' \
  | node src/mcp.mjs --db data/notes.sqlite
```

## Dashboard and JSON API

The dashboard supports create/edit/delete, literal search, exact tag filtering, tag counts, and 20-note pages. Form tags are comma separated. Validation failures display an error without changing existing notes.

```sh
curl -X POST http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember milk","tags":["shopping"]}'
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=shopping&limit=20&offset=0'
curl -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"tags":["done"]}'
curl http://127.0.0.1:8080/api/export
curl -X POST http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' -d '{"notes":[{"text":"Imported","tags":["work"]}]}'
```

Also available: `GET /api/notes/:id`, `DELETE /api/notes/:id`, `GET /api/tags`. Collections and import results are bare arrays; export is `{version:1,notes:[{text,tags}]}` oldest first. To restore an export, submit its `notes` array to import (the export wrapper itself also contains the accepted `notes` field). Imports append notes, assigning new IDs/timestamps; they do not replace existing notes.

## Data and tests

Text is trimmed (1–4000 characters); tags are trimmed, lowercased, deduplicated and sorted (1–40 characters each). JSON tags must be arrays of strings. Invalid fields reject the entire create/update/import; imports validate all records before writing and commit as one SQLite transaction. Database parent directories are created automatically. Foreign keys cascade deletion of note/tag joins. MCP and web can use the same file sequentially. Back up the SQLite file while services are stopped. No credentials or remote services are required; this is a local application, not a hardened public server.

`npm test` runs the preserved smoke test and added storage/service tests: normalization, literal and Unicode search, atomic validation, persistence, cascade deletion, large export pagination, real MCP subprocess messaging, dashboard forms/escaping/pagination and HTTP JSON routes. Tests use disposable databases inside this directory.
