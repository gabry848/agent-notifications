import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV, exportCSV} from './transfer.mjs';
export async function runCLI(args) {
  const [command, ...rest] = args;
  const allowed = {
    list:['text','tags'], add:['record'], remove:['id'], plan:['ids'], 'import-csv':['input'], 'export-csv':[]
  };
  if (!Object.hasOwn(allowed,command)) throw Error('Unknown command');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i], value = rest[i+1];
    if (!flag.startsWith('--') || value === undefined || !['file',...allowed[command]].includes(flag.slice(2)) || Object.hasOwn(options,flag.slice(2))) throw Error(`Invalid option: ${flag}`);
    options[flag.slice(2)] = value;
  }
  if (!options.file) throw Error('--file is mandatory');
  const requireOption = key => { if (!options[key]) throw Error(`--${key} is mandatory`); return options[key]; };
  let seed;
  try { seed = JSON.parse(await readFile(options.file,'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; seed = []; }
  const catalog = createCatalog(seed); let result, changed = false;
  switch (command) {
    case 'list': result = searchRecords(catalog.list(),{text:options.text ?? '',tags:options.tags ? options.tags.split(',') : []}); break;
    case 'add': result = catalog.add(JSON.parse(requireOption('record'))); changed = true; break;
    case 'remove': result = catalog.remove(requireOption('id')); changed = true; break;
    case 'plan': result = {ids:planDependencies(catalog.list(),requireOption('ids').split(','))}; break;
    case 'import-csv': result = {added:importCSV(await readFile(requireOption('input'),'utf8'),catalog).length}; changed = true; break;
    case 'export-csv': result = exportCSV(catalog.list()); break;
  }
  if (changed) {
    const temporary = `${options.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary,JSON.stringify(catalog.list(),null,2) + '\n',{flag:'wx'});
      await rename(temporary,options.file);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  return command === 'export-csv' ? result : JSON.stringify(result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCLI(process.argv.slice(2)).then(output => { process.stdout.write(output + '\n'); }).catch(error => {
    process.stderr.write(error.message + '\n'); process.exitCode = 1;
  });
}
