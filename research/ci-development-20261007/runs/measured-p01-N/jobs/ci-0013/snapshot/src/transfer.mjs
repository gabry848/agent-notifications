import {StringDecoder} from 'node:string_decoder';
import {parseCSV,stringifyCSV} from './csv.mjs';
const header=['id','name','version','tags','dependencies'];
export function exportCSV(records) {
  return stringifyCSV([header,...records.map(r=>[r.id,r.name,r.version,r.tags.join('|'),r.dependencies.join('|')])]);
}
export function importCSV(text,catalog) {
  const rows=parseCSV(text);
  if(!rows.length || rows[0].length!==5 || rows[0].some((v,i)=>v!==header[i])) throw Error('invalid CSV header');
  const records=rows.slice(1).map(row=>{
    if(row.length!==5) throw Error('invalid CSV row');
    const [id,name,version,tags,dependencies]=row;
    return {id,name,version,tags:tags?tags.split('|'):[],dependencies:dependencies?dependencies.split('|'):[]};
  });
  return catalog.applyBatch(records.map(record=>({type:'add',record})));
}
export async function* exportNDJSON(records) {for(const record of records) yield JSON.stringify(record)+'\n';}
export async function importNDJSON(chunks,catalog) {
  const decoder=new StringDecoder('utf8');let pending='';const records=[];
  const line=text=>{if(text.trim()) records.push(JSON.parse(text));};
  const consume=text=>{pending+=text;let i;while((i=pending.indexOf('\n'))!==-1) {line(pending.slice(0,i));pending=pending.slice(i+1);}};
  for await(const chunk of chunks) {
    if(Buffer.isBuffer(chunk)) consume(decoder.write(chunk));
    else if(typeof chunk==='string') {consume(decoder.end());consume(chunk);}
    else throw Error('invalid NDJSON chunk');
  }
  consume(decoder.end());line(pending);
  return catalog.applyBatch(records.map(record=>({type:'add',record})));
}
