# Package Catalog usage

Requires Node 24; no dependencies or installation step are needed. Run all tests with `npm test`.

## Records and library API

```json
{"id":"core","name":"Core","version":"1.2.0","tags":["tools"],"dependencies":[]}
```

All five fields are required on creation. IDs/names are trimmed and must be nonempty. Tags become lowercase, trimmed, unique and sorted. Dependency IDs are strings and duplicates are removed while preserving order. Versions are three-component semantic versions, optionally with prerelease identifiers (e.g. `1.2.0-rc.1`), without build metadata or numeric leading zeroes.

Import `createCatalog` from `./src/catalog.mjs`. It supports `list`, `get`, `add`, `update`, `remove` and atomic `applyBatch` with `{type:'add',record}`, `{type:'update',id,patch}` and `{type:'remove',id}` operations. Reads and writes return independent copies. Missing `get` returns null; `remove` returns a boolean. Updates cannot change IDs. Unknown dependencies may be stored, but planning rejects missing dependencies and cycles.

`searchRecords(records, query)` in `src/search.mjs` returns `{items,total,offset,limit}`. Text matches ID or name case-insensitively; tags require all supplied tags. Inclusive `versionMin`/`versionMax` filters use semantic ordering. Sort by `id`, `name` or `version`, with `asc`/`desc` order; ties always use ID ascending. Defaults: ID ascending, offset 0, limit 20. Offset must be a nonnegative integer; limit must be 1–100.

`planDependencies(records, requestedIds)` and `reverseDependencies(records, id)` are exported by `src/graph.mjs`. Planning returns unique dependency-first IDs, respecting requested/dependency order. Reverse dependencies return sorted transitive dependents, excluding the target.

## HTTP

Start an empty in-memory server:

```sh
npm start
# or PORT=8080 node src/server.mjs
```

For embedding, `createServer(catalog)` in `src/server.mjs` returns an unlistening Node HTTP Server. Call `.listen(...)` yourself. The standalone server does not persist data to a CLI file.

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.2.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=core&tags=tools&sortBy=version&order=desc&offset=0&limit=20'
curl 'http://localhost:3000/plan?ids=core'
curl -X PATCH http://localhost:3000/records/core -H 'Content-Type: application/json' -d '{"name":"New Core"}'
curl -X DELETE http://localhost:3000/records/core
```

| Endpoint | Success |
| --- | --- |
| `GET /health` | 200 `{ok:true}` |
| `GET /records` | 200 search envelope; supports text, comma-separated tags, versionMin/Max, sortBy, order, offset, limit |
| `POST /records` | 201 created record |
| `GET /records/:id` | 200 record |
| `PATCH /records/:id` | 200 updated record |
| `DELETE /records/:id` | 204, no body |
| `GET /plan?ids=a,b` | 200 `{ids:[...]}` |
| `GET /export.csv` | 200 `text/csv` |
| `POST /import.csv` | 201 `{added:N}` |
| `GET /export.ndjson` | 200 `application/x-ndjson` |
| `POST /import.ndjson` | 201 `{added:N}` |

URL-encode IDs used in paths (including spaces, slashes and Unicode). Errors are JSON `{error:string}`: unknown route/record 404, malformed input or invalid dependency plan 400, duplicate creation/import 409, bodies larger than 1 MiB 413. Failed mutations/imports leave the catalog unchanged.

## CLI and persistence

`--file` is mandatory for every command. The file contains a JSON array; a missing file starts empty. Successful modifying commands write a temporary sibling file and rename it only after full validation. Invalid input prints to stderr and exits nonzero without changing the data file. Use one writer at a time; concurrent CLI processes are not coordinated.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.2.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file another.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id core
```

Output is JSON: list uses the search envelope, add returns the created record, remove returns a boolean, plan returns `{ids:[...]}`, and import-csv returns `{added:N}`. Export-csv prints CSV instead. Unsupported commands/options and duplicate options are errors.

## CSV and NDJSON transfer

CSV requires exactly this header, in this order:

```csv
id,name,version,tags,dependencies
core,Core,1.2.0,tools|web,
app,Application,2.0.0,web,core
```

Tags and dependencies are pipe-separated; empty fields represent empty arrays. Pipes inside individual tag/dependency values cannot be represented unambiguously in this format. Commas, quotes and embedded newlines are handled with RFC4180 quoting; exports use CRLF record separators. Spaces are preserved by the CSV parser, with catalog normalization applied during import.

```sh
curl http://localhost:3000/export.csv > catalog.csv
curl -X POST http://localhost:3000/import.csv --data-binary @catalog.csv
curl http://localhost:3000/export.ndjson > catalog.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @catalog.ndjson
```

Library functions in `src/transfer.mjs`: `exportCSV(records)` returns a string; `importCSV(text,catalog)` returns added records. `exportNDJSON(records)` is an async iterator yielding one JSON string plus newline per record. `importNDJSON(chunks,catalog)` accepts async string/Buffer chunks, preserves UTF-8 split across Buffer boundaries, ignores blank lines and accepts a final line without newline. It resolves to added records. All imports validate and add atomically: malformed JSON, invalid records, incorrect CSV headers/column counts or duplicate IDs roll back the entire import.
