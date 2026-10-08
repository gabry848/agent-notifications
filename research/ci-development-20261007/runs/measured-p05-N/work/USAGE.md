# Package Catalog usage

Requires Node.js 24; no dependencies. Run `npm test` for the complete local suite.

Records have this shape:

```json
{"id":"core","name":"Core","version":"1.2.0","tags":["tools"],"dependencies":[]}
```

IDs and names are trimmed. Tags are trimmed, lowercased, deduplicated and sorted; dependencies are deduplicated in input order. Versions follow semantic version precedence (prereleases allowed, build metadata not allowed). Returned records are independent copies. Unknown dependencies can be stored, but cannot be planned. Batch writes and imports are atomic.

## HTTP

`npm start` serves an initially empty, in-memory catalog on port 3000. Set `PORT` to override it. Data is not persisted by this server. To embed a seeded catalog:

```js
import {createCatalog} from './src/catalog.mjs';
import {createServer} from './src/server.mjs';
const server = createServer(createCatalog([]));
server.listen(3000);
```

```sh
curl localhost:3000/health
curl -X POST localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.2.0","tags":["tools"],"dependencies":[]}'
curl 'localhost:3000/records?text=core&tags=tools&sortBy=version&order=desc&offset=0&limit=20'
curl localhost:3000/records/core
curl -X PATCH localhost:3000/records/core -d '{"name":"Core Library"}'
curl 'localhost:3000/plan?ids=core'
curl localhost:3000/export.csv
curl localhost:3000/export.ndjson
curl -X POST localhost:3000/import.csv --data-binary @packages.csv
curl -X POST localhost:3000/import.ndjson --data-binary @packages.ndjson
curl -X DELETE localhost:3000/records/core
```

Search returns `{items,total,offset,limit}`. Text matches name or ID case-insensitively; comma-separated tags must all match. `versionMin` and `versionMax` are inclusive. Sort keys: `id`, `name`, `version`; order: `asc` or `desc`. Ties always use ID ascending. Default offset is 0, limit 20; allowed limit is 1–100.

Planning returns `{ids:[...]}` in dependency-first DFS order; requested IDs and each dependency list retain their order. URL-encode IDs in record paths (e.g. `a%2Fb`). Creates return 201, reads/updates 200, deletes 204, and imports 201 with `{added:N}`. CSV content type is `text/csv`, NDJSON is `application/x-ndjson`.

Errors return JSON `{error:string}`: malformed JSON, invalid records, queries, missing plan dependencies or cycles → 400; duplicate creation → 409; unknown record/route → 404; request body above 1 MiB → 413. Invalid writes leave the catalog unchanged.

## CLI

Every command requires `--file`. The file is a JSON array; a missing file starts empty. Mutating commands validate first, then write a temporary sibling file and rename it. Invalid inputs exit nonzero and report an error on stderr without changing data. Output is JSON, except `export-csv`.

```sh
node src/cli.mjs list --file catalog.json
node src/cli.mjs list --file catalog.json --text core --tags tools,web
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":[],"dependencies":[]}'
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs import-csv --file catalog.json --input packages.csv
node src/cli.mjs export-csv --file catalog.json > packages.csv
node src/cli.mjs remove --file catalog.json --id core
```

`list` returns the search envelope; `add` returns the created record; `remove` returns a boolean; `plan` returns `{ids:[...]}`; `import-csv` returns `{added:N}`. Unknown commands/options, missing required options, invalid files or duplicate IDs fail. CLI and HTTP are independent unless you explicitly load the CLI file into an embedded server.

## CSV and NDJSON modules

CSV requires exactly this header, in this order:

```csv
id,name,version,tags,dependencies
core,Core,1.0.0,tools|web,
app,Application,2.0.0,web,core
```

Tags and dependencies use `|` separators (literal pipes in individual values are not representable in this format). CSV quoting supports commas, double quotes and embedded newlines; spaces are preserved by the CSV parser. Empty fields represent empty tag/dependency arrays. Invalid headers, malformed rows/records and duplicate IDs reject the entire import.

```js
import {createCatalog} from './src/catalog.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './src/transfer.mjs';
const catalog = createCatalog([]);
importCSV('id,name,version,tags,dependencies\ncore,Core,1.0.0,,', catalog);
const csv = exportCSV(catalog.list());
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
// Use a different catalog: imports add records, they do not overwrite them.
const restored = createCatalog([]);
await importNDJSON(exportNDJSON(catalog.list()), restored);
```

NDJSON exports one JSON record plus newline per iteration. Imports accept asynchronous string/Buffer chunks, including UTF-8 characters split across buffers. Blank lines are ignored; the last record need not end in a newline. Malformed JSON, invalid records, duplicate IDs or stream errors roll back the entire import.

`reverseDependencies(records,id)` in `src/graph.mjs` returns sorted transitive dependents, excluding the given ID; unknown IDs reject. All search and graph operations leave their input unchanged.
