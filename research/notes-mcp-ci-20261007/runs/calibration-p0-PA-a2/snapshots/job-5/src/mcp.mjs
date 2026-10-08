import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { importNotes, exportNotes, allNotes } from './import.mjs';

const string={type:'string'}, tags={type:'array',items:{type:'string'}}, id={type:'integer',minimum:1};
const definitions=[
  ['notes_create','Create a note',{text:string,tags},['text']],
  ['notes_get','Get a note',{id},['id']],
  ['notes_list','Search notes',{q:string,tag:string,limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}},[]],
  ['notes_update','Update a note',{id,text:string,tags},['id']],
  ['notes_delete','Delete a note',{id},['id']],
  ['tags_list','List tags',{},[]],
  ['notes_export','Export notes',{},[]],
  ['notes_import','Import notes atomically',{notes:{type:'array',items:{type:'object',properties:{text:string,tags},required:['text']}}},['notes']]
];
const tools=definitions.map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
const args=process.argv.slice(2);
const store=openStore(args.includes('--db') ? args[args.indexOf('--db')+1] : 'data/notes.sqlite');
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
function call(name,a={}) {
  const tool=tools.find(t=>t.name===name);
  if (!tool) throw new Error('Unknown tool');
  if (!a || typeof a!=='object' || Array.isArray(a)) throw new Error('arguments must be an object');
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(a,key)) throw new Error(`Missing ${key}`);
  for (const key of Object.keys(a)) if (!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
  switch(name) {
    case 'notes_create': return store.createNote(a.text,a.tags);
    case 'notes_get': return store.getNote(a.id);
    case 'notes_list': return store.listNotes(a);
    case 'notes_update': {const {id,...patch}=a; return store.updateNote(id,patch);}
    case 'notes_delete': return store.deleteNote(a.id);
    case 'tags_list': return store.listTags();
    case 'notes_export': return exportNotes(store);
    case 'notes_import': return importNotes(store,a.notes);
  }
}
function dispatch(request) {
  switch(request.method) {
    case 'initialize': return {protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};
    case 'notifications/initialized': case 'ping': return {};
    case 'tools/list': return {tools};
    case 'tools/call':
      try {return {content:[{type:'text',text:JSON.stringify(call(request.params?.name,request.params?.arguments))}]};}
      catch(error) {return {isError:true,content:[{type:'text',text:error.message}]};}
    case 'resources/list': return {resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};
    case 'resources/read':
      if(request.params?.uri!=='notes://all') throw {code:-32002,message:'Unknown resource'};
      return {contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]};
    default: throw {code:-32601,message:'Method not found'};
  }
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
  if(!line.trim()) return;
  let request;
  try {request=JSON.parse(line);} catch {send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}
  if(!request || typeof request!=='object' || Array.isArray(request) || request.jsonrpc!=='2.0' || typeof request.method!=='string' || (Object.hasOwn(request,'id') && request.id!==null && typeof request.id!=='string' && typeof request.id!=='number')) {
    send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});return;
  }
  try {const result=dispatch(request); if(Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,result});}
  catch(error) {if(Object.hasOwn(request,'id')) send({jsonrpc:'2.0',id:request.id,error:{code:error.code??-32602,message:error.message}});}
});
lines.on('close',()=>store.close());
