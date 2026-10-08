import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store = openStore(values.db);
const string = {type:'string'}, id = {type:'integer',minimum:1};
const tags = {type:'array',items:{type:'string',minLength:1,maxLength:40}};
const text = {type:'string',minLength:1,maxLength:4000};
const schema = (properties={},required=[]) => ({type:'object',properties,required,additionalProperties:false});
const descriptors = [
  ['notes_create','Create a note',schema({text,tags},['text'])],
  ['notes_get','Get a note',schema({id},['id'])],
  ['notes_list','Search notes newest first',schema({q:string,tag:string,limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}})],
  ['notes_update','Replace note text and/or tags',schema({id,text,tags},['id'])],
  ['notes_delete','Delete a note',schema({id},['id'])],
  ['tags_list','List tag counts',schema()],
  ['notes_export','Export notes oldest first',schema()],
  ['notes_import','Import a validated batch',schema({notes:{type:'array',items:schema({text,tags},['text'])}},['notes'])]
].map(([name,description,inputSchema]) => ({name,description,inputSchema}));
function call(name,args) {
  const descriptor = descriptors.find(t => t.name === name);
  if (!descriptor) throw new Error('Unknown tool');
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be an object');
  for (const key of descriptor.inputSchema.required) if (!Object.hasOwn(args,key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(args)) if (!Object.hasOwn(descriptor.inputSchema.properties,key)) throw new Error(`Unknown argument: ${key}`);
  switch (name) {
    case 'notes_create': return store.createNote(args.text,args.tags);
    case 'notes_get': return store.getNote(args.id);
    case 'notes_list': return store.listNotes(args);
    case 'notes_update': { const {id,...patch} = args; return store.updateNote(id,patch); }
    case 'notes_delete': return store.deleteNote(args.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store,args.notes);
  }
}
const error = (code,message) => ({error:{code,message}});
function dispatch(request) {
  switch (request.method) {
    case 'initialize': return {result:{protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}}};
    case 'notifications/initialized': return {result:{}};
    case 'ping': return {result:{}};
    case 'tools/list': return {result:{tools:descriptors}};
    case 'tools/call':
      try { return {result:{content:[{type:'text',text:JSON.stringify(call(request.params?.name,request.params?.arguments ?? {}))}]}}; }
      catch (err) { return {result:{isError:true,content:[{type:'text',text:err.message}]}}; }
    case 'resources/list': return {result:{resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]}};
    case 'resources/read':
      if (request.params?.uri !== 'notes://all') return error(-32002,'Unknown resource');
      return {result:{contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]}};
    default: return error(-32601,'Method not found');
  }
}
const send = message => process.stdout.write(JSON.stringify(message)+'\n');
const input = createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,...error(-32700,'Parse error')}); return; }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    send({jsonrpc:'2.0',id:request?.id ?? null,...error(-32600,'Invalid request')}); return;
  }
  let response;
  try { response = dispatch(request); }
  catch (err) { response = error(-32603,err.message); }
  if (Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,...response});
});
input.on('close', () => store.close());
process.on('SIGINT', () => input.close());
process.on('SIGTERM', () => { input.close(); process.exit(0); });
