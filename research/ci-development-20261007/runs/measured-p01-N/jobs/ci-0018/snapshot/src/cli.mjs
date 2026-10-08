import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
async function main(args) {
  const [command,...rest]=args, options={};
  for(let i=0;i<rest.length;i+=2) {
    if(!rest[i].startsWith('--') || rest[i+1]===undefined || Object.hasOwn(options,rest[i].slice(2))) throw Error('invalid arguments');
    options[rest[i].slice(2)]=rest[i+1];
  }
  if(!options.file) throw Error('--file is mandatory');
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command) || Object.keys(options).some(k=>k!=='file' && !allowed[command].includes(k))) throw Error('invalid command/options');
  let seed=[];
  try {seed=JSON.parse(await readFile(options.file,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  const catalog=createCatalog(seed);let result, dirty=false, csv=false;
  const requireOption=key=>{if(options[key]===undefined || options[key]==='') throw Error(`--${key} is required`);return options[key];};
  switch(command) {
    case 'list': result=searchRecords(catalog.list(),{text:options.text,tags:options.tags?.split(',')});break;
    case 'add': result=catalog.add(JSON.parse(requireOption('record')));dirty=true;break;
    case 'remove': result=catalog.remove(requireOption('id'));dirty=true;break;
    case 'plan': result={ids:planDependencies(catalog.list(),requireOption('ids').split(','))};break;
    case 'import-csv': result={added:importCSV(await readFile(requireOption('input'),'utf8'),catalog).length};dirty=true;break;
    case 'export-csv': result=exportCSV(catalog.list());csv=true;break;
  }
  if(dirty) {
    const temporary=`${options.file}.${randomUUID()}.tmp`;
    try {await writeFile(temporary,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temporary,options.file);}
    finally {await unlink(temporary).catch(e=>{if(e.code!=='ENOENT') throw e;});}
  }
  process.stdout.write((csv?result:JSON.stringify(result))+'\n');
}
main(process.argv.slice(2)).catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
