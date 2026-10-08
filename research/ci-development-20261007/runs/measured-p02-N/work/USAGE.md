# Package Catalog usage

Requires Node 24; no dependencies to install. Run `npm test` for all local tests.

## Records and modules

Records contain `id`, `name`, `version`, `tags` (string array), and `dependencies` (id array). For example:

```json
{"id":"web","name":"Web Tools","version":"1.2.0","tags":["tools"],"dependencies":[]}
```

Ids/names are trimmed; tags are trimmed, lowercased, deduplicated and sorted. Dependencies retain their order without duplicates. Versions use three integer components and optional prerelease, not build metadata. Unknown dependency ids can be stored, but dependency planning rejects missing nodes and cycles.

`createCatalog` from `src/catalog.mjs` stores independent copies and supports atomic `applyBatch` operations (`{type:'add',record}`, `{type:'update',id,patch}`, `{type:'remove',id}`). Search and graph helpers never mutate inputs. Search defaults to id ascending, offset 0, limit 20; limits must be 1–100. Sorting ties always use id ascending. Dependency plans use dependency-first DFS order; reverse dependencies are sorted transitively.

## HTTP

Start an empty in-memory catalog with `npm start` (default port 3000, configurable using `PORT`). Data is not persisted by this server. Embedding applications may import `createServer(catalog)` from `src/server.mjs` and call `.listen()` themselves.

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records \
  -H 'Content-Type: application/json' \
  -d '{"id":"web","name":"Web Tools","version":"1.2.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=web&tags=tools&versionMin=1.0.0&sortBy=version&order=desc&offset=0&limit=20'
curl http://localhost:3000/records/web
curl -X PATCH http://localhost:3000/records/web -d '{"name":"Updated Tools"}'
curl 'http://localhost:3000/plan?ids=web'
curl -X DELETE http://localhost:3000/records/web
```

GET `/records` returns `{items,total,offset,limit}`. Text matches id or name case-insensitively; all comma-separated tags must match; `versionMin` and `versionMax` are inclusive. `sortBy` accepts id/name/version and `order` asc/desc. GET `/plan` returns `{ids:[...]}`. Percent-encode ids in `/records/:id` (including embedded slashes).

Creation returns 201, reads/updates 200, deletion 204. Unknown routes or record ids return 404, duplicate creation 409, malformed input 400, and bodies above 1 MiB 413. Error bodies are JSON `{error:string}`. Failed writes/imports leave the catalog unchanged.

## CLI persistence

Every command requires `--file`; its contents must be a JSON array. A nonexistent file begins empty. Mutation commands validate fully before writing a same-directory temporary file and renaming it over the destination. Read-only commands do not create an absent file. This is single-writer persistence, not concurrent-write coordination.

```sh
node src/cli.mjs list --file catalog.json --text web --tags tools,web
node src/cli.mjs add --file catalog.json --record '{"id":"web","name":"Web","version":"1.0.0","tags":[],"dependencies":[]}'
node src/cli.mjs plan --file catalog.json --ids web
node src/cli.mjs remove --file catalog.json --id web
node src/cli.mjs import-csv --file catalog.json --input packages.csv
node src/cli.mjs export-csv --file catalog.json > packages.csv
```

Output is JSON except for `export-csv`. Remove returns a boolean; import returns `{added:N}`. Invalid options, records, files or dependency plans emit stderr and exit nonzero without altering stored data.

## CSV and NDJSON

```sh
curl http://localhost:3000/export.csv > packages.csv
curl -X POST http://localhost:3000/import.csv --data-binary @packages.csv
curl http://localhost:3000/export.ndjson > packages.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @packages.ndjson
```

CSV requires the exact header `id,name,version,tags,dependencies`. Tags and dependencies are pipe-separated; an empty cell means an empty array. Quoted commas, doubled quotes, embedded newlines and CRLF/LF are supported; whitespace is preserved by the CSV parser. The pipe-delimited format has no escaping for literal pipes inside tags or dependency ids; use NDJSON for those values.

`src/transfer.mjs` exports `exportCSV(records)`, `importCSV(text,catalog)`, `exportNDJSON(records)` (async iterator of newline-terminated JSON strings), and `importNDJSON(chunks,catalog)` (async iterable of strings/Buffers). NDJSON accepts split UTF-8 Buffer characters, blank lines, and a final line without a newline. HTTP export content types are `text/csv` and `application/x-ndjson`; imports return 201 `{added:N}`. Both import formats add records, never replace them, and validate the whole input atomically. Bad headers, JSON, records, or duplicate ids leave all existing records untouched.
