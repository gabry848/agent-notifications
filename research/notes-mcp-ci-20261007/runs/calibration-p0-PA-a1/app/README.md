# Quick Notes

Persistent local notes with a browser dashboard, JSON API and MCP stdio service. Requires Node.js 24 (uses built-in `node:sqlite`); no dependencies to install.

## Run

```sh
npm test
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
```

`npm run web` and `npm run mcp` use these defaults. Parent directories are created automatically. `--port 0` selects an available port; the web server prints one JSON startup line containing that port. Use the same database for sequential web/MCP sessions. Stop web with Ctrl-C; MCP closes on stdin EOF. SQLite experimental warnings, if emitted by Node, go to stderr.

The dashboard supports creation, editing, deletion, literal search, normalized tags, tag counts and 20-note pages. Tags in forms are comma separated. Text is trimmed (1–4000 characters); tags are trimmed, lowercased and deduplicated (1–40 characters each). Empty form tags mean no tags.

## API examples

```sh
curl -X POST http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the milk","tags":["personal"]}'
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=personal&limit=20&offset=0'
curl -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Milk and bread"}'
curl http://127.0.0.1:8080/api/tags
curl http://127.0.0.1:8080/api/export
curl -X POST http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' -d '{"version":1,"notes":[{"text":"Imported","tags":[]}]}'
curl -X DELETE http://127.0.0.1:8080/api/notes/1
```

`GET /api/notes/:id` fetches one note. Errors return JSON with an `error` message and HTTP 400 or 404. Exports are `{version:1,notes:[{text,tags}]}` oldest first; imports validate the whole batch before any write. Imports append new notes, not original IDs/timestamps.

## MCP

Configure your MCP client to run `node` with arguments `src/mcp.mjs --db /absolute/path/notes.sqlite` (use an absolute script path when the client has a different working directory). Protocol is `2024-11-05`, newline-delimited JSON-RPC on stdio; stdout contains only protocol messages.

```sh
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}' \
 | node src/mcp.mjs --db data/notes.sqlite
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover schemas with `tools/list`. `resources/read` for `notes://all` returns a JSON array of all full notes (including IDs and timestamps). Tools encode values as JSON text content; validation failures set `isError:true`.

This is a local application without authentication; bind remains localhost. Keep database backups and do not expose the service publicly. Tests exercise storage persistence/atomicity and launch real MCP and HTTP processes.
