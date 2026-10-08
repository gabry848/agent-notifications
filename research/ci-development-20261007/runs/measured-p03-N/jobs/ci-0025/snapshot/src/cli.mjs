import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV, exportCSV} from './transfer.mjs';
export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const allowed = {list: ['text', 'tags'], add: ['record'], remove: ['id'], plan: ['ids'], 'import-csv': ['input'], 'export-csv': []};
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown command');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].slice(2);
    if (!rest[i].startsWith('--') || !['file', ...allowed[command]].includes(key) || Object.hasOwn(options, key) || rest[i + 1] === undefined) throw new Error('Invalid options');
    options[key] = rest[i + 1];
  }
  if (!options.file) throw new Error('--file is mandatory');
  let seed = [];
  try { seed = JSON.parse(await readFile(options.file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const catalog = createCatalog(seed);
  let result, write = false;
  switch (command) {
    case 'list': result = searchRecords(catalog.list(), {text: options.text, tags: options.tags?.split(',')}); break;
    case 'add':
      if (!options.record) throw new Error('--record is mandatory');
      result = catalog.add(JSON.parse(options.record)); write = true; break;
    case 'remove':
      if (!options.id) throw new Error('--id is mandatory');
      result = catalog.remove(options.id); write = true; break;
    case 'plan':
      if (options.ids === undefined) throw new Error('--ids is mandatory');
      result = {ids: planDependencies(catalog.list(), options.ids ? options.ids.split(',') : [])}; break;
    case 'import-csv':
      if (!options.input) throw new Error('--input is mandatory');
      result = {added: importCSV(await readFile(options.input, 'utf8'), catalog).length}; write = true; break;
    case 'export-csv': result = exportCSV(catalog.list()); break;
  }
  if (write) {
    const temp = `${options.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(catalog.list(), null, 2) + '\n', {flag: 'wx'});
      await rename(temp, options.file);
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  process.stdout.write((command === 'export-csv' ? result : JSON.stringify(result)) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
