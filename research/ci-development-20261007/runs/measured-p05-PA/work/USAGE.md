# Package Catalog usage

Requires Node.js 24; no dependencies or install step. Run all tests with `npm test`.

## Records and storage

Records have this shape:

```json
{"id":"app","name":"Application","version":"1.2.0","tags":["web"],"dependencies":["core"]}
```

IDs/names are trimmed, tags are trimmed/lowercased/deduplicated/sorted, and duplicate dependencies are removed while preserving order. Versions follow semantic version ordering (prereleases supported; build metadata is not). Storage allows unknown dependencies; planning rejects missing dependencies or cycles. Catalog reads and writes return independent copies. Batches and imports are atomic.

## CLI

Every command requires `--file`; the file contains a JSON array. An absent file starts empty. Successful mutations validate completely, then save through a temporary sibling file and rename. Read-only commands do not create the file.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags tools
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs import-csv --file catalog.json --input packages.csv
node src/cli.mjs export-csv --file catalog.json > packages.csv
node src/cli.mjs remove --file catalog.json --id core
```

`list` returns `{items,total,offset,limit}` (default first 20). `add` returns the created record; `remove` returns a boolean; `plan` returns `{ids:[...]}` in dependency-first DFS order; import returns `{added:N}`. All output is JSON except CSV export. Errors go to stderr, exit nonzero, and leave the data file untouched. Unknown commands/options and duplicate options are rejected.

## HTTP

`createServer(catalog)` returns an **unlistening** server. Start an in-memory instance explicitly:

```sh
node --input-type=module -e 'import {createCatalog} from "./src/catalog.mjs"; import {createServer} from "./src/server.mjs"; createServer(createCatalog()).listen(3000, "127.0.0.1");'
```

This instance does not persist to disk; the CLI uses separate file-backed storage.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/health` | `{ok:true}` |
| GET | `/records` | Search envelope |
| POST | `/records` | Created record (201) |
| GET / PATCH | `/records/:id` | Record / updated record |
| DELETE | `/records/:id` | Empty response (204) |
| GET | `/plan?ids=app,core` | `{ids:[...]}` |
| GET | `/export.csv` | `text/csv` |
| POST | `/import.csv` | `{added:N}` (201) |
| GET | `/export.ndjson` | `application/x-ndjson` |
| POST | `/import.ndjson` | `{added:N}` (201) |

POST/PATCH record bodies are JSON; PATCH supplies partial fields and cannot change the id. URL-encode ids in paths, including embedded slashes (`a%2Fb`).

Search parameters: `text` matches id or name, case-insensitively; `tags` is comma-separated and requires all normalized tags; `versionMin`/`versionMax` are inclusive; `sortBy=id|name|version`; `order=asc|desc`; `offset` is an integer >=0; `limit` is 1–100. Defaults are id ascending, offset 0, limit 20. Sort ties always use ascending id.

```sh
curl -X POST http://localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["tools"],"dependencies":[]}'
curl 'http://localhost:3000/records?tags=tools&sortBy=version&order=desc&limit=10'
curl -X PATCH http://localhost:3000/records/core -d '{"name":"Core library"}'
curl -X POST http://localhost:3000/import.csv --data-binary @packages.csv
curl http://localhost:3000/export.ndjson > packages.ndjson
```

Errors return JSON `{error:string}`: malformed input 400, unknown routes/record ids 404, duplicate creation/import 409, request bodies above 1 MiB 413. A failed import changes no records. Bad requests do not shut down the server.

## CSV and NDJSON module APIs

```js
import {createCatalog} from './src/catalog.mjs';
import {exportCSV, importCSV, exportNDJSON, importNDJSON} from './src/transfer.mjs';
import {createReadStream} from 'node:fs';

const catalog = createCatalog();
const added = importCSV('id,name,version,tags,dependencies\r\ncore,Core,1.0.0,tools,', catalog);
const csv = exportCSV(catalog.list());
for await (const line of exportNDJSON(catalog.list())) process.stdout.write(line);
// Import into a fresh catalog to avoid duplicate ids:
await importNDJSON(createReadStream('packages.ndjson'), createCatalog());
```

CSV requires exactly `id,name,version,tags,dependencies` in that order and five fields per record. Tags and dependencies are pipe-separated; empty fields mean empty arrays. Commas, quotes, and embedded newlines are quoted/escaped automatically. Pipe characters inside tags/dependency ids are not escaped by this format: use NDJSON to preserve them. CSV parsing preserves whitespace and supports CRLF/LF, quoted commas/newlines and doubled quotes; malformed quoting is rejected.

NDJSON export is an async iterator yielding a JSON string plus newline for each record. Import accepts async (or sync iterable) string/Buffer chunks, including split UTF-8 byte sequences. Empty lines are ignored and a final line without newline is accepted. All records are buffered and validated before one atomic commit; malformed JSON, invalid records, duplicate ids or interrupted streams leave storage unchanged. Importing an export adds records rather than overwriting existing ids.

Graph APIs `planDependencies(records, requestedIds)` and `reverseDependencies(records, id)` do not mutate inputs. Reverse dependencies return sorted transitive dependents, excluding the target, and tolerate cycles; planning rejects cycles with the involved ids in the error.
