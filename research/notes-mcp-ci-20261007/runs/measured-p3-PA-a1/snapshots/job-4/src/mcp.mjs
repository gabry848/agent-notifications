import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { openStore } from './store.mjs';
import { tools, callTool, allNotes } from './service.mjs';

const {values} = parseArgs({options:{db:{type:'string',default:'data/notes.sqlite'}}});
const store = openStore(values.db);
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
const fail = (id,code,message) => send({jsonrpc:'2.0',id,error:{code,message}});
const lines = createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line => {
  if (!line.trim()) return;
  let request;
  try { request=JSON.parse(line); } catch { fail(null,-32700,'Parse error'); return; }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    fail(request?.id ?? null,-32600,'Invalid request'); return;
  }
  const hasId = Object.hasOwn(request,'id');
  if (!hasId) return; // Notifications never receive responses.
  const {id,method,params={}} = request;
  try {
    let result;
    switch(method) {
      case 'initialize': result={protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'quick-notes',version:'1.0.0'}}; break;
      case 'ping': result={}; break;
      case 'tools/list': result={tools}; break;
      case 'tools/call':
        try { result={content:[{type:'text',text:JSON.stringify(callTool(store,params.name,params.arguments))}]}; }
        catch(error) { result={isError:true,content:[{type:'text',text:error.message}]}; }
        break;
      case 'resources/list': result={resources:[{uri:'notes://all',name:'All notes',mimeType:'application/json'}]}; break;
      case 'resources/read':
        if (params.uri !== 'notes://all') { fail(id,-32002,'Unknown resource'); return; }
        result={contents:[{uri:'notes://all',mimeType:'application/json',text:JSON.stringify(allNotes(store))}]}; break;
      default: fail(id,-32601,'Method not found'); return;
    }
    send({jsonrpc:'2.0',id,result});
  } catch(error) { fail(id,-32602,error.message); }
});
lines.on('close',()=>store.close());
