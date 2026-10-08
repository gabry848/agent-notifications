import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';
import { options } from './cli.mjs';
import { objectValue } from './validation.mjs';

const string = {type:'string'}, tags = {type:'array', items:{type:'string'}}, id = {type:'integer', minimum:1};
const definitions = [
  ['notes_create', 'Create a note', {text:string, tags}, ['text']],
  ['notes_get', 'Get a note', {id}, ['id']],
  ['notes_list', 'Find notes newest first', {q:string, tag:string, limit:{type:'integer', minimum:1, maximum:100}, offset:{type:'integer', minimum:0}}, []],
  ['notes_update', 'Replace note text or tags', {id, text:string, tags}, ['id']],
  ['notes_delete', 'Delete a note', {id}, ['id']],
  ['tags_list', 'List tags with counts', {}, []],
  ['notes_export', 'Export notes oldest first', {}, []],
  ['notes_import', 'Import a validated batch atomically', {notes:{type:'array', items:{type:'object', properties:{text:string,tags}, required:['text'], additionalProperties:false}}}, ['notes']]
];
const tools = definitions.map(([name,description,properties,required]) => ({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
const store = openStore(options().db);
const rpcError = (code, message) => ({code,message});
function callTool(params) {
  try {
    objectValue(params);
    const descriptor = tools.find(t => t.name === params.name);
    if (!descriptor) throw new Error('Unknown tool');
    const a = params.arguments === undefined ? {} : objectValue(params.arguments);
    for (const key of descriptor.inputSchema.required) if (!Object.hasOwn(a,key)) throw new Error(`Missing ${key}`);
    for (const key of Object.keys(a)) if (!Object.hasOwn(descriptor.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
    let value;
    switch (params.name) {
      case 'notes_create': value = store.createNote(a.text,a.tags); break;
      case 'notes_get': value = store.getNote(a.id); break;
      case 'notes_list': value = store.listNotes(a); break;
      case 'notes_update': { const {id,...patch} = a; value = store.updateNote(id,patch); break; }
      case 'notes_delete': value = store.deleteNote(a.id); break;
      case 'tags_list': value = store.listTags(); break;
      case 'notes_export': value = exportNotes(store); break;
      case 'notes_import': value = importNotes(store,a.notes); break;
    }
    return {content:[{type:'text',text:JSON.stringify(value)}]};
  } catch (error) { return {isError:true,content:[{type:'text',text:error.message}]}; }
}
function dispatch(request) {
  switch (request.method) {
    case 'initialize': return {protocolVersion:'2024-11-05', capabilities:{tools:{},resources:{}}, serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'notifications/initialized': return {};
    case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call': return callTool(request.params);
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if (request.params?.uri !== 'notes://all') throw rpcError(-32002,'Unknown resource');
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw rpcError(-32601,'Method not found');
  }
}
const lines = createInterface({input:process.stdin, crlfDelay:Infinity});
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
lines.on('line', line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { send({jsonrpc:'2.0',id:null,error:rpcError(-32700,'Parse error')}); return; }
  if (!request || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string' ||
      (Object.hasOwn(request,'id') && request.id !== null && typeof request.id !== 'string' && typeof request.id !== 'number')) {
    send({jsonrpc:'2.0',id:null,error:rpcError(-32600,'Invalid Request')}); return;
  }
  const hasId = Object.hasOwn(request,'id');
  try { const result = dispatch(request); if (hasId) send({jsonrpc:'2.0',id:request.id,result}); }
  catch (error) { if (hasId) send({jsonrpc:'2.0',id:request.id,error:rpcError(error.code ?? -32603,error.message ?? 'Internal error')}); }
});
lines.on('close', () => store.close());
