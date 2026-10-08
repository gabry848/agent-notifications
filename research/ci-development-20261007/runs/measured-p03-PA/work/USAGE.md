# Package Catalog usage

Requires Node 24; no dependencies. Run all tests with `npm test`.

## HTTP

Start an empty, in-memory catalog with `npm start` (port 3000; override with
`PORT=8080`). For embedding, import `createServer` from `src/server.mjs`,
pass a `createCatalog()` instance, and call `.listen()` yourself.

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?tags=tools&sortBy=version&order=desc&limit=10'
curl 'http://localhost:3000/plan?ids=core'
curl -X PATCH http://localhost:3000/records/core -d '{"name":"Core library"}'
curl http://localhost:3000/records/core
curl -X DELETE http://localhost:3000/records/core
```

Search supports `text`, comma-separated `tags`, inclusive `versionMin` and
`versionMax`, `sortBy` (`id`, `name`, `version`), `order` (`asc`, `desc`),
`offset` (nonnegative integer), and `limit` (1–100). Defaults are id ascending,
offset 0, limit 20. Responses contain `items`, `total`, `offset`, `limit`.
Planning returns dependency-first unique ids and rejects missing dependencies
or cycles. Encode path ids with `encodeURIComponent`, including embedded slashes.

## CLI persistence

Every command requires `--file`. A missing file starts empty. The file contains
a JSON array; mutating commands validate first, then write a temporary file in
the same directory and rename it over the original. Parent directories must exist.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file other.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id core
```

Outputs are JSON (list uses the search envelope, plan returns `{ids}`, remove
returns a boolean, import returns `{added}`), except CSV export.

## CSV and NDJSON

```sh
curl http://localhost:3000/export.csv > catalog.csv
curl -X POST http://localhost:3000/import.csv --data-binary @catalog.csv
curl http://localhost:3000/export.ndjson > catalog.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @catalog.ndjson
```

CSV requires the exact header `id,name,version,tags,dependencies`. Tags and
dependencies use `|` separators, so these fields should not contain literal
pipes when using CSV. Commas, quotes and embedded newlines use CSV quoting.
NDJSON contains one full JSON record per line and avoids the pipe limitation.
Empty NDJSON lines are ignored; a final newline is optional.

The `src/transfer.mjs` API exports `exportCSV(records)`,
`importCSV(text,catalog)`, async iterator `exportNDJSON(records)` and
`await importNDJSON(chunks,catalog)`. Import accepts async string/Buffer chunks,
including split UTF-8 sequences. Imports are atomic: invalid records, malformed
input or duplicate ids leave the catalog unchanged.

## Validation and errors

Records require nonempty string id/name, a three-component semantic version
(no build metadata), string arrays for tags and dependencies. Id/name are trimmed;
tags are trimmed, lowercased, deduplicated and sorted. Dependencies are deduplicated
in stored order. Unknown dependencies may be stored but cannot be planned.

HTTP errors use `{error: string}`: malformed input 400, unknown routes/ids 404,
duplicate creation 409, bodies over 1 MiB 413. Successful creates/imports return
201; deletion returns 204. Bad requests do not stop the server.
CLI failures write stderr, exit nonzero and preserve existing file data.
Catalog reads and writes use independent copies; `applyBatch` is transactional.
