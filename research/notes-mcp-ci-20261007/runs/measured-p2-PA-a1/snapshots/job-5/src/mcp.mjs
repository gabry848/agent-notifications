import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { allNotes, exportNotes, importNotes } from './import.mjs';

const args = process.argv.slice(2);
const store = openStore(args.includes('--db') ? args[args.indexOf('--db') + 1] : 'data/notes.sqlite');
const string = {type:'string'}, id = {type:'integer',minimum:1}, tags = {type:'array',items:{type:'string'}};
const specs = [
  ['notes_create', {text:string,tags}, ['text'], a => store.createNote(a.text,a.tags)],
  ['notes_get', {id}, ['id'], a => store.getNote(a.id)],
  ['notes_list', {q:string,tag:string,limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}}, [], a => store.listNotes(a)],
  ['notes_update', {id,text:string,tags}, ['id'], a => store.updateNote(a.id,Object.fromEntries(Object.entries(a).filter(([k]) => k !== 'id')))],
  ['notes_delete', {id}, ['id'], a => store.deleteNote(a.id)],
  ['tags_list', {}, [], () => store.listTags()],
  ['notes_export', {}, [], () => exportNotes(store)],
  ['notes_import', {notes:{type:'array',items:{type:'object',properties:{text:string,tags},required:['text']}}}, ['notes'], a => importNotes(store,a.notes)]
];
const tools = specs.map(([name,properties,required]) => ({name,description:name.replaceAll('_',' '),inputSchema:{type:'object',properties,required,additionalProperties:false}}));
function dispatch(method, params = {}) {
  switch (method) {
    case 'initialize': return {protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call': {
      try {
        const spec = specs.find(s => s[0] === params.name);
        if (!spec) throw new Error('Unknown tool');
        const a = params.arguments ?? {};
        if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('arguments must be an object');
        for (const key of spec[2]) if (!Object.hasOwn(a,key)) throw new Error(`Missing ${key}`);
        for (const key of Object.keys(a)) if (!Object.hasOwn(spec[1],key)) throw new Error(`Unknown argument ${key}`);
        return {content:[{type:'text',text:JSON.stringify(spec[3](a))}]};
      } catch (e) { return {isError:true,content:[{type:'text',text:e.message}]}; }
    }
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if (params.uri !== 'notes://all') throw {code:-32002,message:'Unknown resource'};
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw {code:-32601,message:'Method not found'};
  }
}
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    send({jsonrpc:'2.0',id:request?.id ?? null,error:{code:-32600,message:'Invalid Request'}}); return;
  }
  if (!Object.hasOwn(request,'id')) return;
  try { send({jsonrpc:'2.0',id:request.id,result:dispatch(request.method,request.params)}); }
  catch (e) { send({jsonrpc:'2.0',id:request.id,error:{code:e.code ?? -32602,message:e.message ?? 'Invalid params'}}); }
});
input.on('close', () => store.close());
