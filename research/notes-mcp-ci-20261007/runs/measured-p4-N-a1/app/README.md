# Quick Notes

Persistent SQLite notes, a server-rendered dashboard, and an MCP stdio service. Requires **Node.js 24**; uses built-ins only. No install step, credentials, or remote service.

## Launch

From this directory:

```sh
npm run web
# Open http://127.0.0.1:8080

# Or choose a database and an available port:
node src/web.mjs --db data/notes.sqlite --port 0
# stdout prints one JSON line: {"port":<assigned port>}

npm run mcp
# Or:
node src/mcp.mjs --db data/notes.sqlite
```

Database parent directories are created automatically. Both services default to `data/notes.sqlite`; sequential processes share persistent data. Stop the web service with Ctrl-C; MCP also closes cleanly on stdin EOF. SQLite experimental warnings, when emitted by Node, go to stderr, not the protocol stream.

The dashboard supports creation, editing, deletion, literal text search, exact normalized tag filtering, tag counts, and 20-note pagination. Text is trimmed (1–4000 characters); tags are trimmed, lowercased, deduplicated, and sorted (1–40 characters each). Forms accept comma-separated tags; APIs accept arrays.

## JSON API examples

With the web server running on port 8080:

```sh
curl -s http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Remember the release","tags":["Work"]}'

curl -s 'http://127.0.0.1:8080/api/notes?q=release&tag=work&limit=20&offset=0'
curl -s http://127.0.0.1:8080/api/notes/1
curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"text":"Release shipped","tags":[]}'
curl -s http://127.0.0.1:8080/api/tags
curl -s http://127.0.0.1:8080/api/export > backup.json
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' --data-binary @backup.json
curl -s -X DELETE http://127.0.0.1:8080/api/notes/1
```

Collections and imports return bare arrays; single-note operations return full records. Exports are `{version:1,notes:[{text,tags}]}` oldest first. Import accepts an object with a `notes` array (the export wrapper works directly), creates new notes rather than merging IDs, and validates **all text and tags before writing**. Validation errors return 400; absent notes/routes return 404.

## MCP

Configure an MCP client to run `node` with arguments `src/mcp.mjs --db data/notes.sqlite`, using this directory as its working directory (or use absolute paths). Transport is newline-delimited JSON-RPC 2.0, protocol version `2024-11-05`. Only protocol messages are printed on stdout.

Example input lines:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["demo"]}}}
{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover input schemas through `tools/list`. `notes://all` is an application/json resource containing all full note records newest first, not an export wrapper.

## Tests

```sh
npm test
```

Local tests cover validation and import atomicity, normalization, literal search, update timestamps, pagination, persistence, foreign-key cascade, complete exports, real child-process MCP transport, web CRUD and forms, HTML escaping, and sequential web/MCP database sharing. Temporary databases are cleaned up automatically.

This is a local, unauthenticated application bound to loopback. Do not expose it through a public proxy without adding appropriate authentication and request protections.
