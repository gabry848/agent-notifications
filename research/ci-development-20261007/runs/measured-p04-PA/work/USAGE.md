# Package Catalog usage

Requires Node 24; no dependencies. Run all tests with `npm test`.

Records have this shape:

```json
{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}
```

IDs/names are trimmed, tags are normalized and deduplicated, and dependency order is preserved. Reads return independent copies. Unknown dependency IDs can be stored, but dependency planning rejects missing nodes and cycles. Versions use three integer components and optional prerelease identifiers, without build metadata.

## HTTP

The server factory returns an **unlistening** server. Start an in-memory catalog:

```sh
node --input-type=module -e "import {createCatalog} from './src/catalog.mjs'; import {createServer} from './src/server.mjs'; createServer(createCatalog()).listen(3000);"
curl http://localhost:3000/health
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?text=core&tags=tools&sortBy=version&order=desc&offset=0&limit=20'
curl 'http://localhost:3000/plan?ids=core'
curl -X PATCH http://localhost:3000/records/core -H 'Content-Type: application/json' -d '{"name":"Core library"}'
curl http://localhost:3000/records/core
curl -X DELETE http://localhost:3000/records/core
```

Search accepts `text`, comma-separated `tags` (all required), inclusive `versionMin`/`versionMax`, `sortBy` (`id`, `name`, `version`), `order` (`asc`, `desc`), `offset` and `limit`. Defaults: id ascending, offset 0, limit 20; limit must be 1–100. Response: `{items,total,offset,limit}`. Ties always sort by id ascending. Encode record IDs in URL path segments (e.g. `a/b` as `a%2Fb`). Plans return `{ids:[...]}` in dependency-first DFS order.

Export/import endpoints:

```sh
curl http://localhost:3000/export.csv -o packages.csv
curl -X POST http://localhost:3000/import.csv --data-binary @packages.csv
curl http://localhost:3000/export.ndjson -o packages.ndjson
curl -X POST http://localhost:3000/import.ndjson --data-binary @packages.ndjson
```

Import into an empty catalog or use new IDs: imports add, never overwrite. Successful imports return 201 `{added:N}`. Creates return 201, reads/updates 200, deletes 204. Unknown routes/record IDs return 404, duplicate IDs 409, malformed inputs 400, and bodies over 1 MiB 413. Errors are JSON `{error:string}`. Failed imports and updates leave state unchanged. HTTP storage is in-memory; restart loses it.

## CLI

`--file` is mandatory. The file is a JSON array; a nonexistent file starts empty. Successful writes use a temporary sibling file and rename after validation.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs export-csv --file catalog.json > packages.csv
node src/cli.mjs import-csv --file another.json --input packages.csv
node src/cli.mjs remove --file catalog.json --id core
```

Output is JSON (list uses the search envelope; plan uses `{ids}`; add returns the record; remove returns a boolean; import returns `{added}`), except `export-csv`. Invalid arguments, malformed files/records and duplicate imports exit nonzero, explain the error on stderr, and do not modify the catalog file.

## Module transfers

`src/transfer.mjs` exports `exportCSV(records)`, `importCSV(text,catalog)`, async generator `exportNDJSON(records)`, and async `importNDJSON(chunks,catalog)`.

CSV requires the exact header `id,name,version,tags,dependencies`. Tags and dependency IDs are pipe-joined; literal pipes within those values cannot be represented unambiguously. Commas, quotes and embedded newlines are escaped as CSV. NDJSON preserves arbitrary strings and emits one JSON record plus newline per iteration. Import accepts async string/Buffer chunks, including UTF-8 characters split between buffers, ignores blank lines, and accepts a final line without a newline.

```js
import {createCatalog} from './src/catalog.mjs';
import {importNDJSON, exportNDJSON} from './src/transfer.mjs';
import {createReadStream} from 'node:fs';

const catalog = createCatalog();
const added = await importNDJSON(createReadStream('packages.ndjson'), catalog);
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
```

Both imports validate the entire input and commit atomically. A malformed line, invalid record, or duplicate ID rolls back the whole import.
