import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';
import { object } from './validation.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store = openStore(values.db);
const text = {type:'string',minLength:1,maxLength:4000};
const tags = {type:'array',items:{type:'string',minLength:1,maxLength:40}};
const id = {type:'integer',minimum:1};
const schema = (properties={},required=[]) => ({type:'object',properties,required,additionalProperties:false});
const tools = [
  ['notes_create','Create a note',schema({text,tags},['text'])],
  ['notes_get','Get a note',schema({id},['id'])],
  ['notes_list','Search notes, newest first',schema({q:{type:'string'},tag:{type:'string'},limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}})],
  ['notes_update','Replace text and/or tags',schema({id,text,tags},['id'])],
  ['notes_delete','Delete a note',schema({id},['id'])],
  ['tags_list','List tags and counts',schema()],
  ['notes_export','Export notes oldest first',schema()],
  ['notes_import','Atomically import a batch',schema({notes:{type:'array',items:schema({text,tags},['text'])}},['notes'])]
].map(([name,description,inputSchema])=>({name,description,inputSchema}));
function callTool(params) {
  object(params);
  const tool = tools.find(t=>t.name===params.name);
  if (!tool) throw new Error('Unknown tool');
  const args = object(params.arguments === undefined ? {} : params.arguments);
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(args,key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
  switch (params.name) {
    case 'notes_create': return store.createNote(args.text,args.tags);
    case 'notes_get': return store.getNote(args.id);
    case 'notes_list': return store.listNotes(args);
    case 'notes_update': { const {id,...patch}=args; return store.updateNote(id,patch); }
    case 'notes_delete': return store.deleteNote(args.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store,args.notes);
  }
}
const rpcError = (code,message) => Object.assign(new Error(message),{code});
function dispatch(request) {
  switch (request.method) {
    case 'initialize': return {protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'notifications/initialized': case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call':
      try { return {content:[{type:'text',text:JSON.stringify(callTool(request.params))}]}; }
      catch (error) { return {isError:true,content:[{type:'text',text:JSON.stringify({error:error.message})}]}; }
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if (request.params?.uri !== 'notes://all') throw rpcError(-32002,'Unknown resource');
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw rpcError(-32601,'Method not found');
  }
}
const send = message => process.stdout.write(JSON.stringify(message)+'\n');
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line => {
  if (!line.trim()) return;
  let request;
  try { request=JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}); return; }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (Object.hasOwn(request,'id') && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}}); return;
  }
  try {
    const result = dispatch(request);
    if (Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,result});
  } catch (error) {
    if (Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,error:{code:error.code??-32602,message:error.message}});
  }
});
input.on('close',()=>store.close());
process.on('SIGINT',()=>input.close());
process.on('SIGTERM',()=>input.close());
