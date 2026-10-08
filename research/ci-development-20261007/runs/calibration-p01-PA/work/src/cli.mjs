import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV, exportCSV} from './transfer.mjs';
export async function runCLI(args) {
  const [command, ...rest] = args, options = {};
  const allowed = {list: ['text', 'tags'], add: ['record'], remove: ['id'], plan: ['ids'], 'import-csv': ['input'], 'export-csv': []};
  if (!Object.hasOwn(allowed, command)) throw Error('unknown command');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!['file', ...allowed[command]].includes(key) || rest[i + 1] === undefined || Object.hasOwn(options, key)) throw Error('invalid option');
    options[key] = rest[i + 1];
  }
  if (!options.file) throw Error('--file is mandatory');
  const file = resolve(options.file);
  let seed;
  try { seed = JSON.parse(await readFile(file, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') seed = []; else throw err; }
  const catalog = createCatalog(seed);
  const required = key => { if (!options[key]) throw Error(`--${key} is required`); return options[key]; };
  let result, write = false;
  switch (command) {
    case 'list': result = searchRecords(catalog.list(), {text: options.text, tags: options.tags === undefined ? undefined : options.tags.split(',')}); break;
    case 'add': result = catalog.add(JSON.parse(required('record'))); write = true; break;
    case 'remove': result = catalog.remove(required('id')); write = true; break;
    case 'plan': result = {ids: planDependencies(catalog.list(), required('ids').split(','))}; break;
    case 'import-csv': result = {added: importCSV(await readFile(required('input'), 'utf8'), catalog).length}; write = true; break;
    case 'export-csv': result = exportCSV(catalog.list()); break;
  }
  if (write) {
    const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, JSON.stringify(catalog.list(), null, 2) + '\n', {flag: 'wx'}); await rename(temporary, file); }
    finally { await unlink(temporary).catch(err => { if (err.code !== 'ENOENT') throw err; }); }
  }
  return command === 'export-csv' ? result : JSON.stringify(result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(await runCLI(process.argv.slice(2))); }
  catch (err) { console.error(err.message); process.exitCode = 1; }
}
