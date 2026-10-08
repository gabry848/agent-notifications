import { createInterface } from 'node:readline';
import { openStore } from './store.mjs';
import { parseArgs } from 'node:util';

const {values}=parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store=openStore(values.db);
const string={type:'string'}, tags={type:'array',items:string}, id={type:'integer',minimum:1};
const definitions=[
  ['notes_create','Create a note',{text:string,tags},['text']],
  ['notes_get','Get a note',{id},['id']],
  ['notes_list','Search notes',{q:string,tag:string,limit:{type:'integer',minimum:1,maximum:100},offset:{type:'integer',minimum:0}},[]],
  ['notes_update','Update a note',{id,text:string,tags},['id']],
  ['notes_delete','Delete a note',{id},['id']],
  ['tags_list','List tag counts',{},[]],
  ['notes_export','Export all notes',{},[]],
  ['notes_import','Import notes atomically',{notes:{type:'array',items:{type:'object',properties:{text:string,tags},required:['text'],additionalProperties:false}}},['notes']]
];
const tools=definitions.map(([name,description,properties,required])=>({name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}}));
const encode=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
function callTool(params) {
  try {
    const tool=tools.find(t=>t.name===params?.name);
    if (!tool) throw new Error('Unknown tool');
    const args=params.arguments??{};
    if (!args || typeof args!=='object' || Array.isArray(args)) throw new Error('Arguments must be an object');
    for (const key of tool.inputSchema.required) if (!Object.hasOwn(args,key)) throw new Error(`Missing ${key}`);
    for (const key of Object.keys(args)) if (!Object.hasOwn(tool.inputSchema.properties,key)) throw new Error(`Unknown argument ${key}`);
    let result;
    switch(tool.name) {
      case 'notes_create': result=store.createNote(args.text,args.tags); break;
      case 'notes_get': result=store.getNote(args.id); break;
      case 'notes_list': result=store.listNotes(args); break;
      case 'notes_update': {const {id,...patch}=args;result=store.updateNote(id,patch);break;}
      case 'notes_delete': result=store.deleteNote(args.id); break;
      case 'tags_list': result=store.listTags(); break;
      case 'notes_export': result=store.exportNotes(); break;
      case 'notes_import': result=store.importNotes(args.notes); break;
    }
    return encode(result);
  } catch (error) { return {...encode({error:error.message}),isError:true}; }
}
function allNotes() {
  const notes=[];
  for (let offset=0;;offset+=100) {
    const page=store.listNotes({limit:100,offset});
    notes.push(...page);
    if (page.length<100) return notes;
  }
}
const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
function handle(request) {
  if (!request || typeof request!=='object' || Array.isArray(request) || request.jsonrpc!=='2.0' || typeof request.method!=='string' ||
    (Object.hasOwn(request,'id') && request.id!==null && typeof request.id!=='string' && typeof request.id!=='number')) {
    send({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});return;
  }
  const notification=!Object.hasOwn(request,'id');
  let result,error;
  switch(request.method) {
    case 'initialize': result={protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}};break;
    case 'notifications/initialized': result={};break;
    case 'ping': result={};break;
    case 'tools/list': result={tools};break;
    case 'tools/call': result=callTool(request.params);break;
    case 'resources/list': result={resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]};break;
    case 'resources/read':
      if (request.params?.uri!=='notes://all') error={code:-32002,message:'Unknown resource'};
      else result={contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes())}]};break;
    default: error={code:-32601,message:'Method not found'};
  }
  if (!notification) send({jsonrpc:'2.0',id:request.id,...(error?{error}:{result})});
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{
  if (!line.trim()) return;
  let request;
  try {request=JSON.parse(line);} catch {send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}
  try {handle(request);} catch (error) {if (Object.hasOwn(request??{},'id')) send({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:error.message}});}
});
input.on('close',()=>store.close());
