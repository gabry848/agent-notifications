import{parseCSV,stringifyCSV}from'./csv.mjs';import{StringDecoder}from'node:string_decoder';
const header=['id','name','version','tags','dependencies'];
export function exportCSV(records){return stringifyCSV([header,...records.map(r=>[r.id,r.name,r.version,r.tags.join('|'),r.dependencies.join('|')])]);}
export function importCSV(text,catalog){const[h,...rows]=parseCSV(text);if(JSON.stringify(h)!==JSON.stringify(header))throw Error('invalid header');const records=rows.map(r=>{if(r.length!==5)throw Error('invalid row');return{id:r[0],name:r[1],version:r[2],tags:r[3]?r[3].split('|'):[],dependencies:r[4]?r[4].split('|'):[]};});return catalog.applyBatch(records.map(record=>({type:'add',record})));}
export async function*exportNDJSON(records){for(const r of records)yield JSON.stringify(r)+'\n';}
export async function importNDJSON(chunks,catalog){const decoder=new StringDecoder('utf8');let text='';for await(const c of chunks)text+=typeof c==='string'?decoder.end()+c:decoder.write(c);text+=decoder.end();const records=text.split(/\r?\n/).filter(l=>l.trim()).map(l=>JSON.parse(l));return catalog.applyBatch(records.map(record=>({type:'add',record})));}
