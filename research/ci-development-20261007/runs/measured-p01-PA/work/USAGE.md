# Package Catalog usage

Requires Node 24; no dependencies. Run all tests with `npm test`.

## Records and library

Records have this shape:

```json
{"id":"app","name":"Application","version":"1.2.0","tags":["web"],"dependencies":["core"]}
```

Import `createCatalog` from `./src/catalog.mjs`. Tags are trimmed, lowercased,
unique and sorted; id/name are trimmed. Records and returned snapshots are
independent copies. Versions use three-component semantic versions with optional
prerelease but no build metadata. Dependency ids may be stored before their
records exist; planning rejects missing nodes and cycles. Batch writes and imports
are all-or-nothing.

`searchRecords(records, query)` in `src/search.mjs` supports text, all-of tags,
inclusive versionMin/versionMax, sortBy (id/name/version), order (asc/desc),
offset and limit. Defaults are id ascending, offset 0, limit 20; limit is 1–100.
Ties always use id ascending. `planDependencies` in `src/graph.mjs` returns unique
dependency-first ids; `reverseDependencies` returns sorted transitive dependents.

## HTTP

`createServer(catalog)` returns an unlistening Node HTTP server. Start it explicitly:

```sh
node --input-type=module -e 'import {createCatalog} from "./src/catalog.mjs"; import {createServer} from "./src/server.mjs"; createServer(createCatalog()).listen(3000)'
```

```sh
curl localhost:3000/health
curl -X POST localhost:3000/records -H 'Content-Type: application/json' \
  -d '{"id":"core","name":"Core","version":"1.0.0","tags":["web"],"dependencies":[]}'
curl 'localhost:3000/records?text=core&tags=web&sortBy=version&order=desc&offset=0&limit=10'
curl localhost:3000/records/core
curl -X PATCH localhost:3000/records/core -H 'Content-Type: application/json' -d '{"name":"Core library"}'
curl 'localhost:3000/plan?ids=core'
curl localhost:3000/export.csv > catalog.csv
curl -X POST localhost:3000/import.csv --data-binary @catalog.csv
curl localhost:3000/export.ndjson > catalog.ndjson
curl -X POST localhost:3000/import.ndjson --data-binary @catalog.ndjson
curl -X DELETE localhost:3000/records/core
```

Imports should target an empty catalog or contain only new ids. Creation/import
returns 201; deletion returns 204. Unknown routes/record ids return 404, duplicate
ids 409, malformed input 400, and bodies over 1 MiB 413. Errors are JSON
`{"error":"description"}`. URL-encode record ids in paths. `/records` also accepts
`versionMin` and `versionMax` query parameters. `/plan` preserves requested and
stored dependency order, and reports missing ids/cycles as input errors.

## CLI

Every command requires `--file`; a missing file starts as an empty catalog.
The file contains a JSON array, not NDJSON. Successful changes write a temporary
file in the same directory then rename it over the destination. The parent
directory must exist. Invalid data/arguments print to stderr and exit nonzero,
without changing the data file. Commands print JSON, except `export-csv`.

```sh
node src/cli.mjs add --file catalog.json --record '{"id":"core","name":"Core","version":"1.0.0","tags":["web"],"dependencies":[]}'
node src/cli.mjs list --file catalog.json --text core --tags web
node src/cli.mjs plan --file catalog.json --ids core
node src/cli.mjs export-csv --file catalog.json > catalog.csv
node src/cli.mjs import-csv --file other.json --input catalog.csv
node src/cli.mjs remove --file catalog.json --id core
```

`list` prints `{items,total,offset,limit}` with the default page of 20.
`plan` prints `{ids:[...]}`; `remove` prints a boolean; `import-csv` prints
`{added:N}`. Invalid existing files are rejected rather than replaced.

## CSV and NDJSON

`src/transfer.mjs` exports `exportCSV`, `importCSV`, `exportNDJSON` and
`importNDJSON`. CSV requires exactly this header, in this order:

```csv
id,name,version,tags,dependencies
core,Core,1.0.0,tools|web,
```

Tags/dependencies are pipe-separated, so literal pipes in their values are not
representable without ambiguity in this format. CSV quoting supports commas,
double quotes, CRLF/LF and embedded newlines. Spaces in fields are preserved by
the CSV parser; record normalization applies during import.

`exportNDJSON(records)` is an async iterator yielding one JSON record plus newline
per item. `await importNDJSON(chunks, catalog)` accepts async string/Buffer chunks,
including UTF-8 split across Buffer boundaries. Blank lines are ignored; the final
line need not have a newline. Both import functions return added records, reject
duplicate ids, and validate the entire input before committing any records.
NDJSON preserves characters such as pipes without CSV's delimiter ambiguity.
