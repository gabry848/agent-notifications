import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createCatalog} from './catalog.mjs';
import {searchRecords} from './search.mjs';
import {planDependencies} from './graph.mjs';
import {importCSV,exportCSV} from './transfer.mjs';
export async function main(args=process.argv.slice(2)) {
  const [command,...rest]=args;
  const allowed={list:['text','tags'],add:['record'],remove:['id'],plan:['ids'],'import-csv':['input'],'export-csv':[]};
  if(!Object.hasOwn(allowed,command)) throw Error('unknown command');
  const options={};
  for(let i=0;i<rest.length;i+=2) {
    const flag=rest[i];
    if(!flag.startsWith('--') || !['file',...allowed[command]].includes(flag.slice(2)) || rest[i+1]===undefined || Object.hasOwn(options,flag.slice(2))) throw Error('invalid arguments');
    options[flag.slice(2)]=rest[i+1];
  }
  if(!options.file) throw Error('--file is mandatory');
  let seed=[];
  try {seed=JSON.parse(await readFile(options.file,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  const catalog=createCatalog(seed);
  const required=key=> {if(!options[key]) throw Error(`--${key} is required`);return options[key];};
  let output, changed=false;
  switch(command) {
    case 'list':output=searchRecords(catalog.list(),{text:options.text??'',tags:options.tags?.split(',')??[]});break;
    case 'add':output=catalog.add(JSON.parse(required('record')));changed=true;break;
    case 'remove':output=catalog.remove(required('id'));changed=true;break;
    case 'plan':output={ids:planDependencies(catalog.list(),required('ids').split(','))};break;
    case 'import-csv':output={added:importCSV(await readFile(required('input'),'utf8'),catalog).length};changed=true;break;
    case 'export-csv':output=exportCSV(catalog.list());break;
  }
  if(changed) {
    const temp=`${options.file}.${randomUUID()}.tmp`;
    try {await writeFile(temp,JSON.stringify(catalog.list(),null,2)+'\n',{flag:'wx'});await rename(temp,options.file);}
    finally {await unlink(temp).catch(error=> {if(error.code!=='ENOENT') throw error;});}
  }
  process.stdout.write((command==='export-csv'?output:JSON.stringify(output))+'\n');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=> {console.error(error.message);process.exitCode=1;});
