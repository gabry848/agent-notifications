# Package Catalog usage

Requires Node.js 24; no dependencies. Run all tests with `npm test`.

## Records and library

```js
import {createCatalog} from './src/catalog.mjs';
const catalog = createCatalog([
  {id: 'core', name: 'Core', version: '1.0.0', tags: ['Tools'], dependencies: []},
  {id: 'app', name: 'App', version: '2.0.0-beta.1', tags: ['tools', 'web'], dependencies: ['core']}
]);
```

IDs and names are trimmed; tags become lowercase, trimmed, unique and sorted.
Dependencies keep their order with duplicates removed. Versions use three integer
components and optional prerelease identifiers (no build metadata). Returned
records are independent copies. `applyBatch([{type:'add',record},
{type:'update',id,patch},{type:'remove',id}])` commits only if all operations succeed.
Unknown dependencies may be stored, but dependency planning rejects missing nodes
and cycles with diagnostic IDs.

`searchRecords(records, query)` in `src/search.mjs` supports `text`, an array of
`tags` (all required), inclusive `versionMin`/`versionMax`, `sortBy` (`id`, `name`,
`version`), `order` (`asc`, `desc`), `offset` and `limit`. Defaults: id ascending,
offset 0, limit 20; limit must be 1–100. Ties always use ID ascending.
`planDependencies(records, ids)` and `reverseDependencies(records, id)` are in
`src/graph.mjs`.

## HTTP

`createServer(catalog)` returns an unlistening, in-memory HTTP server. Start one:

```sh
node --input-type=module -e "import {createCatalog} from './src/catalog.mjs'; import {createServer} from './src/server.mjs'; createServer(createCatalog()).listen(3000, '127.0.0.1')"
```

```sh
curl http://127.0.0.1:3000/health
curl -X POST http://127.0.0.1:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://127.0.0.1:3000/records?text=core&tags=tools&sortBy=version&order=desc&offset=0&limit=10'
curl 'http://127.0.0.1:3000/plan?ids=core'
```

Endpoints:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | `{ok:true}` |
| GET | `/records` | `{items,total,offset,limit}`; search parameters above; tags comma-separated |
| POST | `/records` | 201 created record (JSON request) |
| GET / PATCH | `/records/:id` | record / updated record (JSON patch) |
| DELETE | `/records/:id` | 204, no body |
| GET | `/plan?ids=app,core` | `{ids:[...]}` dependency-first order |
| GET | `/export.csv` | `text/csv` |
| POST | `/import.csv` | 201 `{added:N}` |
| GET | `/export.ndjson` | `application/x-ndjson` |
| POST | `/import.ndjson` | 201 `{added:N}` |

Encode IDs as URL components, e.g. `a/b` becomes `a%2Fb`. Unknown routes/records
return 404. Invalid data/query/JSON returns 400; duplicate record creation returns
409. Bodies over 1 MiB return 413. Errors have JSON shape `{error:string}`.
Failed writes/imports leave catalog state unchanged; bad requests do not stop the
server. HTTP data is not persisted automatically.

## CLI persistence

Every command requires `--file`; it contains a JSON array and starts empty if
absent. Successful writes use a same-directory temporary file and atomic rename.
The parent directory must exist. Do not run concurrent writers on the same file.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file other.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id core
```

Output is JSON except `export-csv`. Remove outputs a boolean; plan outputs
`{ids:[...]}`; import outputs `{added:N}`. Invalid input exits nonzero, explains
the error on stderr and leaves the existing file untouched.

## CSV and NDJSON transfer

CSV header must be exactly `id,name,version,tags,dependencies`. Tags and dependency
IDs are pipe-separated; empty fields represent empty arrays. CSV quoting supports
commas, escaped quotes and embedded newlines. Pipe characters within a tag or
dependency cannot be represented unambiguously in this format.

```sh
curl http://127.0.0.1:3000/export.csv > catalog.csv
curl -X POST http://127.0.0.1:3000/import.csv --data-binary @catalog.csv
curl http://127.0.0.1:3000/export.ndjson > catalog.ndjson
curl -X POST http://127.0.0.1:3000/import.ndjson --data-binary @catalog.ndjson
```

Import into an empty/different catalog to avoid duplicate IDs. Both imports are
add-only, validate all records and commit atomically. Duplicate IDs (including
within the input), malformed records, CSV headers or JSON reject the entire import.

Library exports in `src/transfer.mjs`: `exportCSV(records)`,
`importCSV(text,catalog)`, async iterable `exportNDJSON(records)` (one JSON record
plus newline per yield), and async `importNDJSON(chunks,catalog)` returning added
records. NDJSON accepts async string or Buffer chunks, handles UTF-8 split across
Buffer boundaries, ignores blank lines and accepts a final line without newline.
For example, pass `createReadStream('catalog.ndjson')` from `node:fs` as chunks.
