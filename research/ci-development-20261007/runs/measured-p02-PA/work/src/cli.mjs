import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
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
    const key=args[i];if(!key.startsWith('--') || i+1>=args.length || !['file',...allowed[command]].includes(key.slice(2)) || Object.hasOwn(options,key.slice(2))) throw Error('invalid option: '+key);
    options[key.slice(2)]=args[i+1];
  }
  if(!options.file) throw Error('--file is mandatory');
  const required={add:'record',remove:'id',plan:'ids','import-csv':'input'}[command];
  if(required && !options[required]) throw Error('--'+required+' is mandatory');
  const file=resolve(options.file);let seed=[];
  try {seed=JSON.parse(await readFile(file,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const catalog=createCatalog(seed);let result,write=false;
  switch(command) {
    case 'list':result=searchRecords(catalog.list(),{...(options.text!==undefined?{text:options.text}:{}),...(options.tags!==undefined?{tags:options.tags.split(',')}:{})});break;
    case 'add':result=catalog.add(JSON.parse(options.record));write=true;break;
    case 'remove':result=catalog.remove(options.id);write=true;break;
    case 'plan':result={ids:planDependencies(catalog.list(),options.ids.split(','))};break;
    case 'import-csv':result={added:importCSV(await readFile(options.input,'utf8'),catalog).length};write=true;break;
    case 'export-csv':result=exportCSV(catalog.list());break;
  }
  if(write) {
    const temporary=join(dirname(file),'.'+basename(file)+'.'+randomUUID()+'.tmp');
    try {await writeFile(temporary,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temporary,file);}
    finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT') throw error;});}
  }
  process.stdout.write((command==='export-csv'?result:JSON.stringify(result))+'\n');
}
main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
