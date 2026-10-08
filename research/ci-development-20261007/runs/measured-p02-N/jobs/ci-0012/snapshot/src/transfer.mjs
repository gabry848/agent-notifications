import {StringDecoder} from 'node:string_decoder';
import {parseCSV,stringifyCSV} from './csv.mjs';
import {createCatalog} from './catalog.mjs';
const header=['id','name','version','tags','dependencies'];
const addAll=(records,catalog)=> {
  const validated=createCatalog(records).list();
  // Preserve input order in the returned additions.
  const byId=new Map(validated.map(r=>[r.id,r]));
  return catalog.applyBatch(records.map(r=>({type:'add',record:byId.get(r.id.trim())})));
};
export function exportCSV(records) {
  return stringifyCSV([header,...records.map(r=>[r.id,r.name,r.version,r.tags.join('|'),r.dependencies.join('|')])]);
}
export function importCSV(text,catalog) {
  const rows=parseCSV(text);
  if(!rows.length || rows[0].length!==5 || rows[0].some((v,i)=>v!==header[i])) throw Error('invalid CSV header');
  const records=rows.slice(1).map(row=> {
    if(row.length!==5) throw Error('invalid CSV record');
    const [id,name,version,tags,dependencies]=row;
    return {id,name,version,tags:tags?tags.split('|'):[],dependencies:dependencies?dependencies.split('|'):[]};
  });
  return addAll(records,catalog);
}
export async function* exportNDJSON(records) {for(const r of records) yield JSON.stringify(r)+'\n';}
export async function importNDJSON(chunks,catalog) {
  const decoder=new StringDecoder('utf8');let pending='';const records=[];
  const consume=text=> {
    pending+=text;let end;
    while((end=pending.indexOf('\n'))!==-1) {const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.trim()) records.push(JSON.parse(line));}
  };
  for await(const chunk of chunks) {
    if(Buffer.isBuffer(chunk)) consume(decoder.write(chunk));
    else if(typeof chunk==='string') {consume(decoder.end());consume(chunk);}
    else throw Error('invalid NDJSON chunk');
  }
  consume(decoder.end());if(pending.trim()) records.push(JSON.parse(pending));
  return addAll(records,catalog);
}
