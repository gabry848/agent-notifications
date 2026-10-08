# Package Catalog usage

Requires Node 24; no dependencies. Run all tests with `npm test`.

## Records and library

Records contain `id`, `name`, `version`, `tags` (string array), and
`dependencies` (id array). IDs and names are trimmed; tags are trimmed,
lowercased, deduplicated and sorted. Dependencies retain their order without
duplicates. Versions use three numeric components and optional prerelease,
without build metadata. Unknown dependencies may be stored, but cannot be planned.

```js
import {createCatalog} from './src/catalog.mjs';
import {searchRecords} from './src/search.mjs';
import {planDependencies, reverseDependencies} from './src/graph.mjs';
const catalog = createCatalog([
  {id:'core', name:'Core', version:'1.0.0', tags:['tools'], dependencies:[]}
]);
console.log(searchRecords(catalog.list(), {tags:['tools'], limit:10}));
console.log(planDependencies(catalog.list(), ['core']));
console.log(reverseDependencies(catalog.list(), 'core'));
```

Catalog reads and writes return independent copies. `applyBatch` accepts
`{type:'add',record}`, `{type:'update',id,patch}`, and `{type:'remove',id}`;
a failed batch changes nothing. Search supports text matching name or id,
all-tag matching, inclusive `versionMin`/`versionMax`, `sortBy` id/name/version,
`order` asc/desc, and integer paging (`offset >= 0`, `limit` 1–100).
Defaults are id ascending, offset 0, limit 20. Sort ties use id ascending.
Plans are unique dependency-first DFS order. Missing dependencies and cycles throw.

## HTTP

Start an unlistening server explicitly from a small script:

```js
import {createCatalog} from './src/catalog.mjs';
import {createServer} from './src/server.mjs';
createServer(createCatalog()).listen(3000, '127.0.0.1');
```

```sh
curl http://127.0.0.1:3000/health
curl -X POST http://127.0.0.1:3000/records \
  -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://127.0.0.1:3000/records?tags=tools&sortBy=version&order=desc&limit=10'
curl 'http://127.0.0.1:3000/plan?ids=core'
curl http://127.0.0.1:3000/export.csv
curl -X POST --data-binary @packages.csv http://127.0.0.1:3000/import.csv
curl -X POST --data-binary @packages.ndjson http://127.0.0.1:3000/import.ndjson
curl http://127.0.0.1:3000/export.ndjson
```

`GET /records/:id`, `PATCH /records/:id` (JSON patch), and
`DELETE /records/:id` read, update and remove. Percent-encode IDs in paths.
POST creation and imports return 201; deletion returns 204. Imports return
`{"added":N}`. Records listing returns `{items,total,offset,limit}`.
Query tags and plan ids are comma-separated. All search options above are supported.

Errors return JSON `{"error":"message"}`: malformed input 400, unknown
routes/record IDs 404, duplicate IDs 409, bodies over 1 MiB 413.
Failed mutations/imports leave the catalog unchanged. The HTTP server stores
records in memory; persistence is provided by the CLI file, not the server.

## CLI

Every command requires `--file`. The file is a JSON array; a missing file
starts empty. Mutations validate fully, then use a temporary file and rename.

```sh
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs import-csv --file catalog.json --input packages.csv
node src/cli.mjs export-csv --file catalog.json > packages.csv
node src/cli.mjs remove --file catalog.json --id core
```

Output is JSON except `export-csv`. Errors go to stderr with nonzero exit
status and leave file contents untouched. `remove` outputs a boolean;
`plan` outputs `{ids:[...]}`; imports output `{added:N}`.

## CSV and NDJSON

CSV has the exact header `id,name,version,tags,dependencies`. Tags and
dependencies are pipe-separated within cells (so literal pipes in those values
cannot be represented unambiguously). CSV quoting supports commas, escaped
quotes, CRLF/LF and multiline fields; spaces are preserved by the CSV parser.
Record normalization still trims names and IDs. Empty tag/dependency cells mean
empty arrays. Wrong headers, invalid rows and duplicate IDs reject the whole import.

```js
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './src/transfer.mjs';
const csv = exportCSV(catalog.list());
// Import into a different/empty catalog to avoid duplicate IDs.
const target = createCatalog();
importCSV(csv, target);
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
const another = createCatalog();
await importNDJSON([Buffer.from(JSON.stringify(catalog.get('core')))], another);
```

NDJSON exports one JSON record plus newline at a time through an async iterator.
Import accepts async string or Buffer chunks, including split UTF-8 characters.
Blank lines are ignored and the final newline is optional. Malformed JSON,
invalid records and duplicates reject atomically; no partial additions occur.
