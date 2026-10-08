import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
async function main() {
  const [command,...args]=process.argv.slice(2),options={};
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command)) throw Error('unknown command');
  for(let i=0;i<args.length;i+=2) {
    const key=args[i];
    if(!key.startsWith('--') || !['file',...allowed[command]].includes(key.slice(2)) || args[i+1]===undefined || Object.hasOwn(options,key.slice(2))) throw Error('invalid arguments');
    options[key.slice(2)]=args[i+1];
  }
  if(!options.file) throw Error('--file is mandatory');
  let seed=[];
  try {seed=JSON.parse(await readFile(options.file,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const catalog=createCatalog(seed);let result,write=false;
  const required=key=>{if(!options[key]) throw Error('--'+key+' is mandatory');return options[key];};
  switch(command) {
    case 'list': result=searchRecords(catalog.list(),{text:options.text??'',tags:options.tags?.split(',')??[]});break;
    case 'add': result=catalog.add(JSON.parse(required('record')));write=true;break;
    case 'remove': {const id=required('id');if(!catalog.get(id)) throw Error('unknown id: '+id);result=catalog.remove(id);write=true;break;}
    case 'plan': result={ids:planDependencies(catalog.list(),required('ids').split(','))};break;
    case 'import-csv': result={added:importCSV(await readFile(required('input'),'utf8'),catalog).length};write=true;break;
    case 'export-csv': result=exportCSV(catalog.list());break;
  }
  if(write) {
    const temp=options.file+'.'+randomUUID()+'.tmp';
    try {await writeFile(temp,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temp,options.file);}
    finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT') throw error;});}
  }
  process.stdout.write(command==='export-csv'?result+'\n':JSON.stringify(result)+'\n');
}
main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
