# Package Catalog usage

Requires Node 24; no dependencies to install. Run `npm test` for all tests.

## Records and modules

```json
{"id":"tools","name":"Tools","version":"1.2.0-beta.1","tags":["web","utilities"],"dependencies":[]}
```

All five fields are required. IDs and names are trimmed and must be nonempty.
Tags are trimmed, lowercased, deduplicated and sorted. Dependencies retain their
order with duplicates removed. Versions follow three-component semantic versions
with optional prereleases, without build metadata or leading numeric zeros.
Unknown dependencies can be stored, but cannot be planned.

Import `createCatalog` from `./src/catalog.mjs` to create an in-memory catalog.
Its `list`, `get`, `add`, `update`, `remove`, and transactional `applyBatch` methods
return independent copies. `get` returns null for missing IDs; `remove` returns a
boolean. Batch operations are `{type:'add',record}`, `{type:'update',id,patch}`,
or `{type:'remove',id}`. Failed writes change nothing.

`searchRecords` in `src/search.mjs` supports text (name or ID), all-of tag filters,
inclusive `versionMin`/`versionMax`, and sorting by `id`, `name`, or `version`.
Order is `asc` or `desc`; ties always use ID ascending. Defaults are ID ascending,
offset 0 and limit 20. Offset must be a nonnegative integer and limit 1–100.
The result is `{items,total,offset,limit}` with total measured before pagination.

`planDependencies(records,requestedIds)` in `src/graph.mjs` returns a unique,
dependency-first DFS plan in requested/dependency order. Missing nodes and cycles
throw errors naming the involved IDs. `reverseDependencies(records,id)` returns
sorted transitive dependents, excluding the target; unknown targets throw.

## HTTP

```sh
npm start                         # empty in-memory catalog on port 3000
PORT=8080 node src/server.mjs
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"tools","name":"Tools","version":"1.2.0","tags":["web"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=tool&tags=web&sortBy=version&order=desc&limit=10'
curl 'http://localhost:3000/plan?ids=tools'
```

For embedding, `createServer(catalog)` from `src/server.mjs` returns an unlistening
Node HTTP Server; call `.listen(port)` yourself. The standalone server is not
persistent; use the CLI for file-backed storage.

| Route | Success |
| --- | --- |
| GET /health | 200 `{ok:true}` |
| GET /records | 200 search envelope |
| POST /records (JSON record) | 201 normalized record |
| GET /records/:id | 200 record |
| PATCH /records/:id (JSON patch) | 200 updated record |
| DELETE /records/:id | 204, no body |
| GET /plan?ids=a,b | 200 `{ids:[...]}` |
| GET /export.csv | 200 `text/csv` |
| POST /import.csv | 201 `{added:N}` |
| GET /export.ndjson | 200 `application/x-ndjson` |
| POST /import.ndjson | 201 `{added:N}` |

GET /records accepts `text`, comma-separated `tags`, `versionMin`, `versionMax`,
`sortBy`, `order`, `offset`, and `limit`. Encode path IDs with `encodeURIComponent`
(e.g. an ID containing `/` uses `%2F`). PATCH cannot change an ID.

Errors return JSON `{error:string}`: malformed requests are 400, unknown routes
or record IDs 404, duplicate creation 409, and bodies over 1 MiB 413. Invalid
imports leave the whole catalog unchanged. Planning missing dependencies/cycles
returns 400. Bad requests do not stop the server.

## CLI

Every command requires `--file PATH`. The file contains a JSON record array;
a missing file starts empty. Mutating commands validate first, write a sibling
temporary file, then rename it. Invalid input exits nonzero, writes an error to
stderr, and leaves existing data untouched. Do not run simultaneous writers to
the same file: this is not a database with interprocess locking.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"a","name":"A","version":"1.0.0","tags":["web"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text A --tags web
node src/cli.mjs plan --file catalog.json --ids a
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file another.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id a
```

`list` emits the default search envelope; `add` emits the created record;
`remove` emits a boolean; `plan` emits `{ids:[...]}`; `import-csv` emits `{added:N}`.
Only `export-csv` emits raw CSV instead of JSON. Unknown commands/options,
malformed JSON files, duplicate IDs, invalid records, and failed plans are errors.

## CSV and NDJSON

CSV requires this exact, case-sensitive header:

```csv
id,name,version,tags,dependencies
a,A,1.0.0,web|tools,
b,"B, with comma",1.2.0,web,a
```

Fields support quoted commas, escaped quotes, and multiline text. Tags and
dependencies are pipe-separated, so literal pipes in those values cannot be
represented unambiguously; use NDJSON for such records. Empty list cells mean
empty arrays. LF/CRLF are accepted; CSV exports use CRLF separators.

```sh
curl --data-binary @catalog.csv http://localhost:3000/import.csv
curl http://localhost:3000/export.ndjson > catalog.ndjson
curl --data-binary @catalog.ndjson http://localhost:3000/import.ndjson
```

`src/transfer.mjs` exports `exportCSV(records)`, `importCSV(text,catalog)`,
`exportNDJSON(records)` (an async iterator of newline-terminated JSON strings),
and `importNDJSON(chunks,catalog)` (an async function). NDJSON chunks may be strings
or Buffers, including UTF-8 characters split across Buffer boundaries. Empty lines
are ignored and a final line need not end with a newline. Both import functions
validate all records and add them atomically, returning the added records;
duplicate IDs, malformed data, or invalid records roll back the entire import.
