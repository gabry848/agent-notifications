import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args,options={};
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command)) throw Error('unknown command');
  for(let i=0;i<rest.length;i+=2) {
    const key=rest[i].slice(2);
    if(!rest[i].startsWith('--') || !['file',...allowed[command]].includes(key) || rest[i+1]===undefined || Object.hasOwn(options,key)) throw Error('invalid option: '+rest[i]);
    options[key]=rest[i+1];
  }
  if(!options.file) throw Error('--file is mandatory');
  let seed=[];
  try {seed=JSON.parse(await readFile(options.file,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  const catalog=createCatalog(seed);
  function required(key) {if(!options[key]) throw Error('--'+key+' is mandatory');return options[key];}
  let result,write=false;
  switch(command) {
    case 'list':result=searchRecords(catalog.list(),{text:options.text??'',tags:options.tags?.split(',')??[]});break;
    case 'add':result=catalog.add(JSON.parse(required('record')));write=true;break;
    case 'remove':result=catalog.remove(required('id'));write=true;break;
    case 'plan':result={ids:planDependencies(catalog.list(),required('ids').split(','))};break;
    case 'import-csv':result={added:importCSV(await readFile(required('input'),'utf8'),catalog).length};write=true;break;
    case 'export-csv':result=exportCSV(catalog.list());break;
  }
  if(write) {
    const temp=options.file+'.'+randomUUID()+'.tmp';
    try {await writeFile(temp,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temp,options.file);}
    finally {await unlink(temp).catch(e=>{if(e.code!=='ENOENT') throw e;});}
  }
  process.stdout.write((command==='export-csv'?result:JSON.stringify(result))+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
}
