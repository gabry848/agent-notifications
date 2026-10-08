import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args,options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!rest[i].startsWith('--') || rest[i+1]===undefined || rest[i+1].startsWith('--')) throw Error('invalid arguments');
    const key=rest[i].slice(2);if(Object.hasOwn(options,key)) throw Error(`duplicate option: ${key}`);options[key]=rest[i+1];
  }
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command)) throw Error('unknown command');
  if(!options.file) throw Error('--file is mandatory');
  for(const key of Object.keys(options)) if(key!=='file' && !allowed[command].includes(key)) throw Error(`unknown option: ${key}`);
  const file=resolve(options.file);let seed=[];
  try {seed=JSON.parse(await readFile(file,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const catalog=createCatalog(seed);let output,write=false;
  const required=key=>{if(options[key]===undefined) throw Error(`--${key} is mandatory`);return options[key];};
  switch(command) {
    case 'list': output=searchRecords(catalog.list(),{text:options.text??'',tags:options.tags?.split(',')??[]});break;
    case 'add': output=catalog.add(JSON.parse(required('record')));write=true;break;
    case 'remove': output=catalog.remove(required('id'));write=true;break;
    case 'plan': output={ids:planDependencies(catalog.list(),required('ids').split(',').filter(Boolean))};break;
    case 'import-csv': output={added:importCSV(await readFile(required('input'),'utf8'),catalog).length};write=true;break;
    case 'export-csv': output=exportCSV(catalog.list());break;
  }
  if(write) {
    const temporary=join(dirname(file),`.${basename(file)}.${randomUUID()}.tmp`);
    try {await writeFile(temporary,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temporary,file);}
    finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT') throw error;});}
  }
  process.stdout.write((command==='export-csv'?output:JSON.stringify(output))+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
