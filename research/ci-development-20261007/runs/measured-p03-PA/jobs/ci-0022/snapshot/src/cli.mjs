import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args, options={};
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command)) throw new Error('unknown command');
  for(let i=0;i<rest.length;i+=2) {
    const key=rest[i].slice(2);
    if(!rest[i].startsWith('--') || !['file',...allowed[command]].includes(key) || rest[i+1]===undefined || Object.hasOwn(options,key)) throw new Error('invalid option: '+rest[i]);
    options[key]=rest[i+1];
  }
  if(!options.file) throw new Error('--file is mandatory');
  let seed=[];
  try {seed=JSON.parse(await readFile(options.file,'utf8'));} catch(e) {if(e.code!=='ENOENT') throw e;}
  const catalog=createCatalog(seed);let output,write=false;
  const required=key=>{if(!options[key]) throw new Error('--'+key+' is mandatory');return options[key];};
  switch(command) {
    case 'list':output=searchRecords(catalog.list(),{text:options.text||'',tags:options.tags?options.tags.split(','):[]});break;
    case 'add':output=catalog.add(JSON.parse(required('record')));write=true;break;
    case 'remove':output=catalog.remove(required('id'));write=true;break;
    case 'plan':output={ids:planDependencies(catalog.list(),required('ids').split(','))};break;
    case 'import-csv':output={added:importCSV(await readFile(required('input'),'utf8'),catalog).length};write=true;break;
    case 'export-csv':output=exportCSV(catalog.list());break;
  }
  if(write) {
    const temp=options.file+'.'+randomUUID()+'.tmp';
    try {await writeFile(temp,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temp,options.file);}
    finally {await unlink(temp).catch(e=>{if(e.code!=='ENOENT') throw e;});}
  }
  process.stdout.write((command==='export-csv'?output:JSON.stringify(output))+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
}
