import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV, exportCSV} from './transfer.mjs';
export async function main(args = process.argv.slice(2)) {
  const [command,...rest] = args, options = {};
  const allowed = {list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if (!Object.hasOwn(allowed,command)) throw Error('unknown command');
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !['file',...allowed[command]].includes(key) || rest[i + 1] === undefined || Object.hasOwn(options,key)) throw Error('invalid arguments');
    options[key] = rest[i + 1];
  }
  if (!options.file) throw Error('--file is required');
  const file = resolve(options.file); let seed;
  try { seed = JSON.parse(await readFile(file,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') seed = []; else throw error; }
  const catalog = createCatalog(seed);
  const required = key => { if (!options[key]) throw Error(`--${key} is required`); return options[key]; };
  let output, changed = false;
  if (command === 'list') output = searchRecords(catalog.list(),{text:options.text,tags:options.tags?.split(',')});
  if (command === 'add') { output = catalog.add(JSON.parse(required('record'))); changed = true; }
  if (command === 'remove') { output = catalog.remove(required('id')); changed = true; }
  if (command === 'plan') output = {ids:planDependencies(catalog.list(),required('ids').split(','))};
  if (command === 'import-csv') { output = {added:importCSV(await readFile(required('input'),'utf8'),catalog).length}; changed = true; }
  if (command === 'export-csv') output = exportCSV(catalog.list());
  if (changed) {
    const temporary = join(dirname(file),`.${basename(file)}.${randomUUID()}.tmp`);
    try { await writeFile(temporary,JSON.stringify(catalog.list(),null,2) + '\n',{flag:'wx'}); await rename(temporary,file); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  process.stdout.write((command === 'export-csv' ? output : JSON.stringify(output)) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
