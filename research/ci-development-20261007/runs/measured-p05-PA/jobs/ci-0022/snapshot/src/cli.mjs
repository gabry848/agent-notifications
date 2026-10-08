import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV, exportCSV} from './transfer.mjs';

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const allowed = {
    list: ['text', 'tags'], add: ['record'], remove: ['id'], plan: ['ids'],
    'import-csv': ['input'], 'export-csv': []
  };
  if (!Object.hasOwn(allowed, command ?? '')) throw new Error('Unknown command');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!key.startsWith('--') || !['file', ...allowed[command]].includes(key.slice(2)) || rest[i + 1] === undefined || Object.hasOwn(options, key.slice(2))) throw new Error(`Invalid option: ${key}`);
    options[key.slice(2)] = rest[i + 1];
  }
  if (!options.file) throw new Error('--file is mandatory');
  const required = key => {
    if (!options[key]) throw new Error(`--${key} is mandatory`);
    return options[key];
  };
  const file = resolve(options.file);
  let seed;
  try { seed = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') seed = []; else throw error; }
  const catalog = createCatalog(seed);
  let output, changed = false;
  switch (command) {
    case 'list': output = searchRecords(catalog.list(), {text: options.text ?? '', tags: options.tags ? options.tags.split(',') : []}); break;
    case 'add': output = catalog.add(JSON.parse(required('record'))); changed = true; break;
    case 'remove': output = catalog.remove(required('id')); changed = true; break;
    case 'plan': output = {ids: planDependencies(catalog.list(), required('ids').split(','))}; break;
    case 'import-csv': {
      const added = importCSV(await readFile(required('input'), 'utf8'), catalog);
      output = {added: added.length}; changed = true; break;
    }
    case 'export-csv': output = exportCSV(catalog.list()); break;
  }
  if (changed) {
    const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(catalog.list(), null, 2) + '\n', {flag: 'wx'});
      await rename(temporary, file);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  process.stdout.write((command === 'export-csv' ? output : JSON.stringify(output)) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
