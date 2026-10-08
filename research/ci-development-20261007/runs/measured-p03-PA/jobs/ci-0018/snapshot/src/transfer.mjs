import {StringDecoder} from 'node:string_decoder';
import {parseCSV,stringifyCSV} from './csv.mjs';
import {normalizeRecord} from './catalog.mjs';
const header=['id','name','version','tags','dependencies'];
export function exportCSV(records) {
  return stringifyCSV([header,...records.map(r=>[r.id,r.name,r.version,r.tags.join('|'),r.dependencies.join('|')])]);
}
function commit(records,catalog) {
  const normalized=records.map(normalizeRecord);
  return catalog.applyBatch(normalized.map(record=>({type:'add',record})));
}
export function importCSV(text,catalog) {
  const rows=parseCSV(text);
  if(!rows.length || rows[0].length!==5 || rows[0].some((v,i)=>v!==header[i])) throw new Error('invalid CSV header');
  return commit(rows.slice(1).map(row=>{
    if(row.length!==5) throw new Error('invalid CSV row');
    return {id:row[0],name:row[1],version:row[2],tags:row[3]?row[3].split('|'):[],dependencies:row[4]?row[4].split('|'):[]};
  }),catalog);
}
export async function* exportNDJSON(records) {for(const r of records) yield JSON.stringify(r)+'\n';}
export async function importNDJSON(chunks,catalog) {
  const decoder=new StringDecoder('utf8');let pending='';const records=[];
  function consume(text) {
    pending+=text;let i;
    while((i=pending.indexOf('\n'))>=0) {const line=pending.slice(0,i);pending=pending.slice(i+1);if(line.trim()) records.push(JSON.parse(line));}
  }
  for await(const chunk of chunks) {
    if(Buffer.isBuffer(chunk)) consume(decoder.write(chunk));
    else if(typeof chunk==='string') {consume(decoder.end());consume(chunk);}
    else throw new Error('invalid NDJSON chunk');
  }
  consume(decoder.end());if(pending.trim()) records.push(JSON.parse(pending));
  return commit(records,catalog);
}
