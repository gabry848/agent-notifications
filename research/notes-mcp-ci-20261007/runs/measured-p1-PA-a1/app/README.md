# Quick Notes

A local persistent notes app using only Node.js 24 built-ins (`node:sqlite`, HTTP and readline). No installation, credentials or external services required.

## Launch

```sh
node src/web.mjs --db data/notes.sqlite --port 8080
# Open http://127.0.0.1:8080
# --port 0 chooses a free port; stdout prints one JSON line {"port":...}.

node src/mcp.mjs --db data/notes.sqlite
# Or use the existing npm run web / npm run mcp scripts.
```

Database parent directories are created automatically. Notes survive restarts. MCP and web can use the same database sequentially. Stop web with Ctrl-C; MCP closes its connection on stdin EOF. SQLite diagnostics go to stderr, never protocol stdout.

The dashboard supports create/edit/delete, literal text search, exact normalized tag filters, tag counts and 20-note pages. Text must trim to 1–4000 characters; tags are trimmed, lowercased, deduplicated and sorted (1–40 characters each). HTML forms use comma-separated tags; JSON APIs use arrays. Invalid input returns HTTP 400; missing notes/routes return 404. Form successes redirect with 303 to `/`.

## JSON API examples

```sh
curl -s http://127.0.0.1:8080/api/notes \
  -H 'Content-Type: application/json' \
  -d '{"text":"Plan the week","tags":["Work"]}'
curl -s 'http://127.0.0.1:8080/api/notes?q=plan&tag=work&limit=20&offset=0'
curl -s -X PATCH http://127.0.0.1:8080/api/notes/1 \
  -H 'Content-Type: application/json' -d '{"tags":["done"]}'
curl -s -X DELETE http://127.0.0.1:8080/api/notes/1
curl -s http://127.0.0.1:8080/api/tags
curl -s http://127.0.0.1:8080/api/export > backup.json
curl -s http://127.0.0.1:8080/api/import \
  -H 'Content-Type: application/json' --data-binary @backup.json
```

Collections return bare arrays; single-note operations return full records. Export returns `{version:1,notes:[{text,tags}]}` oldest-first. Import accepts `{notes:[{text,tags?}]}` (an export document works), creates new notes and returns their full records; it validates all fields and commits the batch atomically. Import is additive, so repeated imports duplicate notes. JSON GET/PATCH/DELETE single-note routes are `/api/notes/:id`.

## MCP stdio

Configure a client with command `node`, arguments `["/absolute/path/to/src/mcp.mjs","--db","/absolute/path/to/data/notes.sqlite"]`. Protocol version: `2024-11-05`; transport: one JSON-RPC 2.0 message per line (not HTTP or Content-Length framing).

```sh
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"example","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"notes_create","arguments":{"text":"Hello","tags":["personal"]}}}' \
  '{"jsonrpc":"2.0","id":3,"method":"resources/read","params":{"uri":"notes://all"}}' \
  | node src/mcp.mjs --db data/notes.sqlite
```

Tools: `notes_create`, `notes_get`, `notes_list`, `notes_update`, `notes_delete`, `tags_list`, `notes_export`, `notes_import`. Discover input schemas with `tools/list`. Tool results encode JSON in text content; invalid calls have `isError:true`. Resource `notes://all` contains a bare array of full note records, newest-first, distinct from the export wrapper. Notifications receive no reply.

## Tests

```sh
npm test
# Equivalent: node --test test/*.test.mjs
```

Tests cover persistence, validation, atomic writes/imports, literal search, normalized filters, pagination, cascading deletion, real MCP subprocess requests and shutdown, real HTTP API/forms and HTML escaping. Test databases are created under `test/.tmp-*` and removed after each test. No dependencies or network services are used; HTTP tests bind only to loopback on an ephemeral port.

This is a local unauthenticated app, not an internet-facing service. Web listens only on `127.0.0.1`; JSON bodies are limited to 2 MiB.
