# Quick Notes

Persistent local notes, a server-rendered dashboard and an MCP stdio server.
Requires **Node.js 24**; uses only built-ins (`node:sqlite`). No installation needed.

## Launch

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
node src/mcp.mjs --db data/notes.sqlite
npm test
```

Both commands also have `npm run web` / `npm run mcp` defaults. The database parent
folder is created automatically. Use the same file to share data between
sequential web and MCP sessions. Stop with Ctrl-C; MCP also closes on stdin EOF.
SQLite may print an experimental warning to stderr on some Node versions.

The web server binds only to localhost. `--port 0` selects an available port;
its single startup JSON line reports `{ "port": 12345 }`. The dashboard supports
creation, editing, deletion, literal text search, tag filters and 20-note pages.
Tags are comma-separated in forms and arrays in JSON. This is a local,
unauthenticated application, not an Internet-facing service.

## JSON API examples

```sh
curl -H 'Content-Type: application/json' -d '{"text":"Buy milk","tags":["Home"]}' http://127.0.0.1:8080/api/notes
curl 'http://127.0.0.1:8080/api/notes?q=milk&tag=home&limit=20&offset=0'
curl -X PATCH -H 'Content-Type: application/json' -d '{"text":"Buy oat milk"}' http://127.0.0.1:8080/api/notes/1
curl http://127.0.0.1:8080/api/tags
curl http://127.0.0.1:8080/api/export
curl -H 'Content-Type: application/json' -d '{"notes":[{"text":"Imported note","tags":["home"]}]}' http://127.0.0.1:8080/api/import
curl -X DELETE http://127.0.0.1:8080/api/notes/1
```

Exports contain `{version:1,notes:[{text,tags}]}` in oldest-first order. Import
accepts its `notes` array and validates every record's text and tags before any
writes. Imports append notes; IDs and timestamps are newly generated.
Validation errors are 400; missing notes/routes are 404.

## MCP client configuration

Configure a stdio server with command `node`, arguments
`["/absolute/path/to/app/src/mcp.mjs", "--db", "/absolute/path/to/app/data/notes.sqlite"]`.
Replace paths with this application's location. No credentials are needed.
Protocol version: `2024-11-05`; messages are newline-delimited JSON-RPC 2.0.
Only protocol messages go to stdout.

Example input (one JSON object per line):

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`,
`tags_list`, `notes_export`, `notes_import`. Discover schemas with `tools/list`.
`notes://all` contains a bare array of full notes, newest first, unlike exports.

## Tests

`npm test` runs the preserved smoke test and regression tests for validation,
atomic invalid imports/updates, literal search, normalized tags, cascade deletion,
reopening SQLite, real MCP child-process I/O, and HTTP forms/API/escaping/paging.
Tests create and remove temporary SQLite folders inside this directory.
