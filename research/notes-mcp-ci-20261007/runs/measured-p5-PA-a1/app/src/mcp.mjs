import {createInterface} from 'node:readline';
import {openStore} from './store.mjs';
import {importNotes, exportNotes, allNotes} from './import.mjs';

const args = process.argv.slice(2);
const dbIndex = args.indexOf('--db');
const store = openStore(dbIndex < 0 ? 'data/notes.sqlite' : args[dbIndex+1]);
const string = {type:'string'}, id = {type:'integer',minimum:1};
const tags = {type:'array',items:{type:'string',minLength:1,maxLength:40}};
const note = {type:'object',properties:{text:{type:'string',minLength:1,maxLength:4000},tags},required:['text'],additionalProperties:false};
const schema = (properties={},required=[]) => ({type:'object',properties,required,additionalProperties:false});
const tools = [
  {name:'notes_create',description:'Create a note',inputSchema:note},
  {name:'notes_get',description:'Get a note by ID',inputSchema:schema({id},['id'])},
  {name:'notes_list',description:'Search and list notes, newest first',inputSchema:schema({q:string,tag:string,limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}})},
  {name:'notes_update',description:'Replace note text or tags',inputSchema:schema({id,text:note.properties.text,tags},['id'])},
  {name:'notes_delete',description:'Delete a note',inputSchema:schema({id},['id'])},
  {name:'tags_list',description:'List tags and counts',inputSchema:schema()},
  {name:'notes_export',description:'Export all notes in oldest-first order',inputSchema:schema()},
  {name:'notes_import',description:'Atomically import a batch of notes',inputSchema:schema({notes:{type:'array',items:note}},['notes'])}
];
function callTool(name, input) {
  const tool = tools.find(tool=>tool.name===name);
  if (!tool) throw new Error('Unknown tool');
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Arguments must be an object');
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(input,key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(input)) if (!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
  switch (name) {
    case 'notes_create': return store.createNote(input.text,input.tags);
    case 'notes_get': return store.getNote(input.id);
    case 'notes_list': return store.listNotes(input);
    case 'notes_update': { const {id,...patch}=input; return store.updateNote(id,patch); }
    case 'notes_delete': return store.deleteNote(input.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store,input.notes);
  }
}
const rpcError = (code,message) => Object.assign(new Error(message),{code});
function dispatch(message) {
  const params = message.params ?? {};
  switch (message.method) {
    case 'initialize': return {protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'notifications/initialized': case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call': {
      try { return {content:[{type:'text',text:JSON.stringify(callTool(params.name,params.arguments ?? {}))}]}; }
      catch(error) { return {isError:true,content:[{type:'text',text:error.message}]}; }
    }
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if (params.uri !== 'notes://all') throw rpcError(-32002,'Unknown resource');
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw rpcError(-32601,'Method not found');
  }
}
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const lines = createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  if (!line.trim()) return;
  let message;
  try { message = JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' ||
      (Object.hasOwn(message,'id') && message.id !== null && typeof message.id !== 'string' && typeof message.id !== 'number')) {
    send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}}); return;
  }
  const hasId = Object.hasOwn(message,'id');
  try { const result=dispatch(message); if (hasId) send({jsonrpc:'2.0',id:message.id,result}); }
  catch(error) { if (hasId) send({jsonrpc:'2.0',id:message.id,error:{code:error.code ?? -32602,message:error.message}}); }
});
lines.on('close',()=>store.close());
