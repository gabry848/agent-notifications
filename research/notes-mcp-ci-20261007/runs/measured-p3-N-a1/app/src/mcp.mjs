import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { tools, callTool, allNotes } from './service.mjs';

const {values}=parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store=openStore(values.db);
const resource={uri:'notes://all',name:'All notes',mimeType:'application/json'};
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const rpcError=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{
  if (!line.trim()) return;
  let request;
  try { request=JSON.parse(line); } catch { rpcError(null,-32700,'Parse error'); return; }
  if (!request || Array.isArray(request) || request.jsonrpc!=='2.0' || typeof request.method!=='string') {
    rpcError(request?.id??null,-32600,'Invalid request'); return;
  }
  if (!Object.hasOwn(request,'id')) return;
  const {id,method,params={}}=request;
  if (id!==null && typeof id!=='string' && typeof id!=='number') { rpcError(null,-32600,'Invalid request ID'); return; }
  let result;
  try {
    switch(method) {
      case 'initialize': result={protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}}; break;
      case 'ping': result={}; break;
      case 'tools/list': result={tools}; break;
      case 'tools/call':
        try { result={content:[{type:'text',text:JSON.stringify(callTool(store,params.name,params.arguments))}]}; }
        catch(error) { result={isError:true,content:[{type:'text',text:error.message}]}; }
        break;
      case 'resources/list': result={resources:[resource]}; break;
      case 'resources/read':
        if (params.uri!==resource.uri) { rpcError(id,-32002,'Unknown resource'); return; }
        result={contents:[{uri:resource.uri,mimeType:resource.mimeType,text:JSON.stringify(allNotes(store))}]}; break;
      default: rpcError(id,-32601,'Method not found'); return;
    }
    send({jsonrpc:'2.0',id,result});
  } catch(error) { rpcError(id,-32602,error.message); }
});
input.on('close',()=>store.close());
process.once('SIGINT',()=>input.close());
process.once('SIGTERM',()=>input.close());
