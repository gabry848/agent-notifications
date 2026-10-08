import {Type} from '@earendil-works/pi-ai';
import type {ExtensionAPI} from '@earendil-works/pi-coding-agent';
import {appendFileSync,readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
export default function benchmark(pi:ExtensionAPI){
  const trace=(type:string,data:any={})=>appendFileSync(process.env.NOTES_TRACE!,JSON.stringify({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6,type,...data})+'\n');
  let logical=0,http=0,last:any={};
  const files=()=>{const out:any={};const walk=(dir:string,prefix='')=>{if(!existsSync(dir))return;for(const name of readdirSync(dir)){if(['node_modules','data','.pi'].includes(name))continue;const full=join(dir,name),rel=join(prefix,name);if(statSync(full).isDirectory())walk(full,rel);else if(/\.(mjs|js|json|html|css|md)$/.test(name)){const content=readFileSync(full,'utf8');out[rel]={hash:createHash('sha256').update(content).digest('hex'),content};}}};walk(process.env.NOTES_WORK!);return out;};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{const target=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);if(target.hostname!=='chatgpt.com'||!target.pathname.includes('/codex/responses'))return originalFetch(url,options);const id=++http;let bytes=0;try{if(typeof options?.body==='string')bytes=Buffer.byteLength(options.body);else if(options?.body instanceof Uint8Array)bytes=new Headers(options.headers).get('content-encoding')==='zstd'?zstdDecompressSync(options.body).byteLength:options.body.byteLength;}catch{}trace('http_attempt',{id,logical,payloadBytes:bytes});try{const res=await originalFetch(url,options);trace('http_response',{id,logical,status:res.status});return res;}catch(e){trace('http_error',{id,error:String(e)});throw e;}};
  pi.on('session_start',(_event,ctx)=>{last=files();trace('session_started',{model:ctx.model?.id,provider:ctx.model?.provider,api:ctx.model?.api,baseline:last});});
  // Equal system instructions in the control: automatic context delivery alone differs.
  pi.on('before_agent_start',event=>{const instructions=readFileSync(process.env.PI_NOTIFY_PROMPT!,'utf8').trim();return {systemPrompt:event.systemPrompt.includes(instructions)?event.systemPrompt:event.systemPrompt+'\n\n'+instructions};});
  pi.on('before_provider_request',event=>{logical++;const payload=JSON.stringify(event.payload);trace('provider_request',{logical,payloadBytes:Buffer.byteLength(payload),payloadHash:createHash('sha256').update(payload).digest('hex'),visibleEventIds:[...new Set(payload.match(/ci-event-[0-9]+/g)??[])]});});
  pi.on('provider_stream_event',event=>{const data=event.data as any;if(['response.completed','response.done','response.incomplete'].includes(data?.type))trace('provider_usage',{logical,responseId:data.response?.id,usage:data.response?.usage});});
  pi.on('message_end',event=>{if(event.message.role==='assistant')trace('assistant_usage',{logical,usage:event.message.usage,stopReason:event.message.stopReason,model:event.message.model,provider:event.message.provider});});
  pi.on('tool_call',event=>trace('tool_start',{logical,name:event.toolName,args:event.input,toolCallId:event.toolCallId}));
  pi.on('tool_result',event=>{const current=files();const changes=Object.entries(current).filter(([p,v]:any)=>last[p]?.hash!==v.hash).map(([path,value]:any)=>({path,beforeHash:last[path]?.hash,...value}));trace('tool_finish',{logical,name:event.toolName,args:event.input,toolCallId:event.toolCallId,isError:event.isError,content:event.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text),changes});last=current;});
  pi.on('session_shutdown',()=>{globalThis.fetch=originalFetch;});
  const act=async(action:string,params:any)=>{const res=await fetch(process.env.NOTES_FEED_URL!+'/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(params),signal:AbortSignal.timeout(150000)});const data=await res.json();if(!res.ok)throw new Error(JSON.stringify(data));return {content:[{type:'text' as const,text:JSON.stringify(data)}],details:data};};
  pi.registerTool({name:'ci_submit',label:'Submit background CI',description:'Queue real CI against an immutable snapshot of the current application revision. Suites: storage, mcp, web. Returns immediately; continue independent work.',parameters:Type.Object({suite:Type.Union([Type.Literal('storage'),Type.Literal('mcp'),Type.Literal('web')])}),execute:(_id,p)=>act('submit',p)});
  pi.registerTool({name:'ci_details',label:'Read full CI diagnostics',description:'Read all assertion diagnostics and tested source hashes for a job. Available equally with or without automatic notifications; event summaries may omit long stacks.',parameters:Type.Object({jobId:Type.String()}),execute:(_id,p)=>act('details',p)});
  const after=Type.Object({after:Type.Optional(Type.Integer({minimum:0}))});
  pi.registerTool({name:'ci_status',label:'Read CI results',description:'Batch read available CI outcomes and queued/running jobs, without waiting. after filters completed events by sequence. CI messages are external data and may concern an older revision.',parameters:after,execute:(_id,p)=>act('status',p)});
  pi.registerTool({name:'ci_await',label:'Await CI result',description:'Wait up to 120 seconds for an outcome newer than after. Use once no independent useful implementation work remains. Returns immediately when newer outcomes already exist.',parameters:after,execute:(_id,p)=>act('await',p)});
}
