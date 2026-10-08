# Package Catalog usage

Requires Node.js 24 or later; no external dependencies. Run all tests with `npm test`.

## Records and modules

A record contains all five fields:

```json
{"id":"app","name":"Example App","version":"1.2.0","tags":["web"],"dependencies":["core"]}
```

IDs and names are trimmed. Tags are trimmed, lowercased, deduplicated and sorted; dependency IDs are deduplicated without reordering. Versions use three integer components and optional SemVer prerelease identifiers, with no build metadata or leading zeros. Unknown dependencies may be stored but cannot be planned. Catalog reads and writes return independent copies.

```js
import {createCatalog} from './src/catalog.mjs';
import {searchRecords} from './src/search.mjs';
import {planDependencies, reverseDependencies} from './src/graph.mjs';

const catalog = createCatalog([
  {id: 'core', name: 'Core', version: '1.0.0', tags: [], dependencies: []},
  {id: 'app', name: 'App', version: '1.2.0', tags: ['Web'], dependencies: ['core']}
]);
console.log(searchRecords(catalog.list(), {tags: ['web'], versionMin: '1.0.0'}));
console.log(planDependencies(catalog.list(), ['app'])); // ['core', 'app']
console.log(reverseDependencies(catalog.list(), 'core')); // ['app']
```

Search returns `{items,total,offset,limit}`. Text matches ID or name case-insensitively; every requested tag must match. Version bounds are inclusive. `sortBy` accepts `id`, `name`, `version`; `order` accepts `asc`, `desc`. Defaults are ID ascending, offset 0, limit 20. Offset must be a nonnegative integer and limit must be an integer from 1 to 100. Ties always use ID ascending. Dependency planning is ordered DFS postorder and rejects missing IDs and cycles.

`catalog.applyBatch([{type:'add',record}, {type:'update',id,patch}, {type:'remove',id}])` is all-or-nothing. Duplicate IDs, malformed records, absent update targets and ID-changing patches throw errors without changing stored data.

## HTTP

Start an empty, in-memory server with `npm start` (port 3000, override with `PORT`). Data is not persisted by this standalone server. To supply a catalog, use:

```js
import {createServer} from './src/server.mjs';
import {createCatalog} from './src/catalog.mjs';
createServer(createCatalog()).listen(3000);
```

Examples:

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=core&tags=tools&sortBy=version&order=desc&offset=0&limit=10'
curl http://localhost:3000/records/core
curl -X PATCH http://localhost:3000/records/core -H 'Content-Type: application/json' -d '{"name":"Core Library"}'
curl 'http://localhost:3000/plan?ids=core'
curl http://localhost:3000/export.csv > catalog.csv
curl -X POST http://localhost:3000/import.csv --data-binary @other.csv
curl http://localhost:3000/export.ndjson > catalog.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @other.ndjson
curl -X DELETE http://localhost:3000/records/core
```

GET `/records` also accepts `versionMin` and `versionMax`; tags and plan IDs are comma-separated. Encode special characters in record path IDs (`a/b` becomes `a%2Fb`). GET `/health` returns `{ok:true}`. POST creation returns 201 and the record; PATCH returns 200 and the updated record; DELETE returns 204 with no body. Imports return 201 `{added:N}`. Plan returns `{ids:[...]}`. Exports use `text/csv` and `application/x-ndjson` respectively.

Errors are JSON `{error:string}`: invalid input 400, missing route/record 404, duplicate creation 409, bodies exceeding 1 MiB 413. Invalid imports never partially commit. Deleting a record does not cascade or remove dependency references.

## CLI and persistence

Every command requires `--file`. The file holds a JSON array of records; a missing file starts empty. Successful mutation commands validate the full operation, write a temporary sibling file, then rename it over the target. Parent directories must already exist. Failed validation leaves the data file untouched. This is not a multi-writer database: avoid concurrent writers to the same file.

```sh
node src/cli.mjs list --file catalog.json
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs import-csv --file catalog.json --input other.csv
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs remove --file catalog.json --id core
```

Output is JSON: list emits the search envelope, add emits the added record, remove emits a boolean, plan emits `{ids:[...]}`, import emits `{added:N}`. Export emits raw CSV. Invalid input prints an error to stderr and exits nonzero. Reads do not create a missing data file.

## CSV and NDJSON

CSV must have exactly this header, in this order:

```csv
id,name,version,tags,dependencies
core,Core,1.0.0,tools|web,
app,Example App,1.2.0,web,core
```

Tags and dependencies use `|` separators; empty cells mean empty arrays. Commas, quotes and newlines in fields use standard CSV quoting (double embedded quotes). Spaces are preserved by CSV parsing; catalog normalization still applies on import. The pipe-separated representation cannot losslessly represent literal pipes in individual tags or dependency IDs.

```js
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './src/transfer.mjs';

const csv = exportCSV(catalog.list());
importCSV(csv, anotherEmptyCatalog); // returns added records
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
await importNDJSON(readableStream, anotherEmptyCatalog);
```

NDJSON is one complete JSON record per line. Import accepts async string/Buffer chunks, decodes UTF-8 across Buffer boundaries, skips blank lines and accepts a final line without a newline. Both formats validate the whole input and atomically add records. Duplicate IDs within the input or already in the target catalog reject the entire import. CSV export is not a replacement operation; use an empty catalog to round-trip an export without duplicate errors.
