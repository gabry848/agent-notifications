import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { zstdDecompressSync } from 'node:zlib';
const hash = (v:any) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export default function probe(pi: ExtensionAPI) {
  let step=0,calls=0,lastFact='policy limit=31', lastPayload:any;
  const offline=process.env.CACHE_OFFLINE==='1';
  const original=globalThis.fetch;
  const log=(value:any)=>appendFileSync(process.env.CACHE_TRACE!,JSON.stringify(value)+'\n');
  if(offline) globalThis.fetch=async (url,options) => {
    const target=new URL(typeof url==='string'?url:url instanceof URL?url.href:url.url);
    if(target.hostname!=='chatgpt.com') {
      if(target.hostname==='127.0.0.1')return original(url,options);
      throw Error('Offline fixture disallows external network');
    }
    calls++;
    const callId='call_cache_'+calls, id='fc_cache_'+calls;
    const output=step<6?{type:'function_call',id,call_id:callId,name:'probe_step',arguments:JSON.stringify({step:step+1,observed:lastFact})}:
      {type:'message',id:'msg_cache_'+calls,role:'assistant',status:'completed',content:[{type:'output_text',text:'DONE policy limit=47',annotations:[]}]};
    const events=[{type:'response.created',response:{id:'resp_cache_'+calls,status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item:step<6?{...output,arguments:''}:{...output,content:[]}}];
    if(step<6)events.push({type:'response.function_call_arguments.delta',output_index:0,delta:output.arguments});
    else events.push({type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
      {type:'response.output_text.delta',output_index:0,content_index:0,delta:'DONE policy limit=47'});
    events.push({type:'response.output_item.done',output_index:0,item:output},
      {type:'response.completed',response:{id:'resp_cache_'+calls,status:'completed',output:[output],usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0}}}});
    return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{status:200,headers:{'content-type':'text/event-stream'}});
  };
  pi.on('before_agent_start', event=>{
    const instruction=readFileSync(process.env.CACHE_COMMON_PROMPT!,'utf8').trim();
    return {systemPrompt:event.systemPrompt.includes(instruction)?event.systemPrompt:event.systemPrompt+'\n\n'+instruction};
  });
  pi.on('before_provider_request',event=>{
    const p:any=event.payload;
    const input=p.input??[];
    const previous=lastPayload;
    let prefix=0;
    while(previous && prefix<Math.min(previous.input.length,input.length) && hash(previous.input[prefix])===hash(input[prefix]))prefix++;
    log({type:'payload_hashes',offline,step,items:input.length,sharedLeadingItems:previous?prefix:null,
      previousItems:previous?.input.length??null,instructionsHash:hash(p.instructions),toolsHash:hash(p.tools),cacheKeyHash:hash(p.prompt_cache_key),
      fullHash:hash(p),itemHashes:input.map(hash),notificationIndexes:input.flatMap((item:any,index:number)=>JSON.stringify(item).includes('<runtime_notifications>')?[index]:[])});
    if(process.env.CACHE_PRIVATE_PAYLOAD)appendFileSync(process.env.CACHE_PRIVATE_PAYLOAD,JSON.stringify({step,payload:p})+'\n',{mode:0o600});
    lastPayload=structuredClone(p);
  });
  pi.registerTool({name:'probe_step',label:'Controlled cache fixture step',description:'Advance exactly one fixture step. Return the observed policy fact verbatim.',
    parameters:Type.Object({step:Type.Integer({minimum:1,maximum:6}),observed:Type.String()}),
    async execute(_id,params){
      if(params.step!==step+1)throw Error('Unexpected fixture step');
      log({type:'action',step:params.step,observed:params.observed,expected:lastFact,correct:params.observed===lastFact});
      step++;
      if(step===2 || step===4){
        lastFact=step===2?'policy limit=47':'policy limit=47; audit verified';
        const ready=JSON.parse(readFileSync(process.env.PI_NOTIFY_READY!,'utf8'));
        const result=await fetch(ready.url+'/notify',{method:'POST',body:JSON.stringify({source:'controlled-policy-audit',message:lastFact})});
        if(!result.ok)throw Error('Notification producer failed');
        log({type:'external_notification',step,fact:lastFact,id:(await result.json()).id});
      }
      const fixture=Array.from({length:128},(_,i)=>`record ${step}:${i} hash=${hash('stable fixture '+step+':'+i).slice(0,24)} status=validated`).join('\n');
      return {content:[{type:'text',text:'Canonical policy fact: '+lastFact+'\n'+fixture}],details:{step}};
    }});
  pi.on('agent_end',(_event,ctx)=>{
    const entries=ctx.sessionManager.getBranch().filter(e=>e.type==='custom' && e.customType==='notification-context-journal-v1');
    writeFileSync(process.env.CACHE_RESULT!,JSON.stringify({offline,step,calls,finished:step===6,journalRecords:entries.length,
      journalSessionIsolated:entries.every(e=>(e as any).data.sessionId===ctx.sessionManager.getSessionId())},null,2));
  });
  pi.on('session_shutdown',()=>{if(offline)globalThis.fetch=original;});
}
