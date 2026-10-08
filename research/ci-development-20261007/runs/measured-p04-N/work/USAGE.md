# Package Catalog usage

Requires Node 24; no dependencies. Run all tests with `npm test`.

## Records and library

A record has the following shape:

```json
{"id":"tools","name":"Tools","version":"1.2.0","tags":["utility"],"dependencies":[]}
```

Versions use three integer components and optional prerelease (for example
`1.2.0-beta.2`), without build metadata or numeric leading zeros. IDs and names
are trimmed; tags are lowercase, trimmed, unique and sorted. Dependencies are
unique with their original order preserved. Unknown dependencies may be stored,
but dependency planning rejects missing nodes and cycles.

`createCatalog` in `src/catalog.mjs` provides list/get/add/update/remove and
atomic `applyBatch`. Returned records are independent copies. Search defaults to
id ascending, offset 0, limit 20 (maximum 100); tag filters require all tags.
`planDependencies` emits DFS dependency-first order; `reverseDependencies` gives
sorted transitive dependents.

## HTTP

The server factory returns an unlistening, in-memory HTTP server. Start it with:

```sh
node --input-type=module -e "import {createCatalog} from './src/catalog.mjs'; import {createServer} from './src/server.mjs'; createServer(createCatalog()).listen(3000);"
```

```sh
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"tools","name":"Tools","version":"1.2.0","tags":["utility"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=tool&tags=utility&sortBy=version&order=desc&limit=10&offset=0'
curl http://localhost:3000/records/tools
curl -X PATCH http://localhost:3000/records/tools -d '{"name":"New Tools"}'
curl 'http://localhost:3000/plan?ids=tools'
curl -X DELETE http://localhost:3000/records/tools
```

GET `/records` also accepts inclusive `versionMin`/`versionMax` bounds, sortBy
`id`, `name`, or `version`, and order `asc`/`desc`. Ties always use id ascending.
URL-encode record IDs in paths, including slashes as `%2F`.

POST creation returns 201, GET/PATCH return 200, DELETE returns 204.
Errors return JSON `{"error":"message"}`: malformed input 400, unknown route or
record 404, duplicate creation 409, bodies exceeding 1 MiB 413. Import failures
are 400 and do not partially write records. Data lasts only for the lifetime of
the catalog; HTTP does not persist the CLI file.

## CLI

`--file` is required for every command; a missing file starts with an empty
catalog. Existing files must contain a valid JSON record array.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"tools","name":"Tools","version":"1.2.0","tags":["utility"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text tools --tags utility
node src/cli.mjs plan --file catalog.json --ids tools
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file another.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id tools
```

Output is JSON (list uses the search envelope; plan uses `{ids:[...]}`;
import uses `{added:N}`), except export-csv. Writes validate completely before
writing a temporary sibling file and renaming it. Invalid records, duplicate
IDs, malformed files, unknown flags, missing arguments and failed plans exit
nonzero with stderr and leave existing data untouched.

## CSV and NDJSON

CSV uses the exact header `id,name,version,tags,dependencies`. Tags and dependencies
are pipe-separated, with empty fields representing empty arrays. CSV quoting
handles commas, double quotes, CRLF/LF and embedded newlines. Because pipes are
list separators, values containing literal pipes cannot round-trip through CSV;
use NDJSON for such records.

```sh
curl http://localhost:3000/export.csv > catalog.csv
curl -X POST http://localhost:3000/import.csv --data-binary @catalog.csv
curl http://localhost:3000/export.ndjson > catalog.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @catalog.ndjson
```

Exports return `text/csv` or `application/x-ndjson`. Imports return 201
`{added:N}` and atomically add all records, rejecting duplicates rather than
replacing existing records. NDJSON ignores empty lines and accepts a final line
without a newline.

Library streaming example:

```js
import {createReadStream} from 'node:fs';
import {createCatalog} from './src/catalog.mjs';
import {importNDJSON, exportNDJSON} from './src/transfer.mjs';
const catalog = createCatalog();
await importNDJSON(createReadStream('catalog.ndjson'), catalog);
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
```

`importNDJSON` accepts async string/Buffer chunks and safely decodes UTF-8 even
when characters cross Buffer boundaries. Malformed JSON or invalid records
leave the entire catalog unchanged. `importCSV(text,catalog)` likewise validates
and commits atomically; both return the added normalized records.
