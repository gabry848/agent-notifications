import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store = openStore(values.db);
const text = {type:'string',minLength:1,maxLength:4000};
const tags = {type:'array',items:{type:'string',minLength:1,maxLength:40}};
const id = {type:'integer',minimum:1};
const specs = [
  ['notes_create',{text,tags},['text'], a=>store.createNote(a.text,a.tags)],
  ['notes_get',{id},['id'], a=>store.getNote(a.id)],
  ['notes_list',{q:{type:'string'},tag:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}},[], a=>store.listNotes(a)],
  ['notes_update',{id,text,tags},['id'], a=>{ const {id,...patch}=a; return store.updateNote(id,patch); }],
  ['notes_delete',{id},['id'], a=>store.deleteNote(a.id)],
  ['tags_list',{},[], ()=>store.listTags()],
  ['notes_export',{},[], ()=>exportNotes(store)],
  ['notes_import',{notes:{type:'array',items:{type:'object',properties:{text,tags},required:['text'],additionalProperties:false}}},['notes'], a=>importNotes(store,a.notes)]
];
const tools = specs.map(([name,properties,required])=>({name,description:name.replaceAll('_',' '),inputSchema:{type:'object',properties,required,additionalProperties:false}}));
function dispatch(method, params={}) {
  switch (method) {
    case 'initialize': return {protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'notifications/initialized': return {};
    case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call': {
      try {
        if (!params || typeof params !== 'object') throw new Error('invalid tool parameters');
        const spec = specs.find(s=>s[0]===params.name);
        if (!spec) throw new Error('unknown tool');
        const args = params.arguments === undefined ? {} : params.arguments;
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('arguments must be an object');
        if (spec[2].some(key=>!Object.hasOwn(args,key)) || Object.keys(args).some(key=>!Object.hasOwn(spec[1],key))) throw new Error('invalid tool arguments');
        return {content:[{type:'text',text:JSON.stringify(spec[3](args))}]};
      } catch (error) { return {isError:true,content:[{type:'text',text:error.message}]}; }
    }
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if (params?.uri !== 'notes://all') throw {code:-32002,message:'Unknown resource'};
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw {code:-32601,message:'Method not found'};
  }
}
const send = message => process.stdout.write(JSON.stringify(message)+'\n');
const lines = createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request=JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    send({jsonrpc:'2.0',id:request?.id ?? null,error:{code:-32600,message:'Invalid Request'}}); return;
  }
  try {
    const result=dispatch(request.method,request.params);
    if (Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,result});
  } catch (error) {
    if (Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,error:{code:error.code ?? -32602,message:error.message}});
  }
});
lines.on('close',()=>store.close());
