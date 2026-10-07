import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export default function telemetry(pi: ExtensionAPI) {
  const work=process.env.SUITE_WORK!,role=process.env.SUITE_ROLE!,tracePath=process.env.SUITE_TRACE!;
  const paths=['src/index.mjs','docs/handoff.md',...['ingest','delivery','view'].map(r=>`src/pipeline/${r}.mjs`),...['ingest','delivery','view'].map(r=>`results/${r}.json`)];
  const stamp=()=>({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6});
  const trace=(type:string,data:object={})=>appendFileSync(tracePath,JSON.stringify({...stamp(),role,type,...data})+'\n');
  const state=()=>Object.fromEntries(paths.filter(p=>existsSync(join(work,p))).map(p=>{const content=readFileSync(join(work,p),'utf8');return [p,{hash:createHash('sha256').update(content).digest('hex'),content}];}));
  let last=state(),call=0;
  pi.on('session_start',(_event,ctx)=>trace('session_started',{model:ctx.model?.id,provider:ctx.model?.provider,api:ctx.model?.api,sessionId:ctx.sessionManager.getSessionId(),baseline:last}));
  pi.on('context',()=>{call++;trace('context',{call});});
  pi.on('tool_call',event=>trace('tool_start',{call,toolCallId:event.toolCallId,name:event.toolName,args:event.input}));
  pi.on('tool_result',event=>{
    const current=state(),changes=Object.entries(current).filter(([p,v])=>last[p]?.hash!==v.hash).map(([p,v])=>({path:p,beforeHash:last[p]?.hash,...v}));
    trace('tool_finish',{call,toolCallId:event.toolCallId,name:event.toolName,args:event.input,isError:event.isError,content:event.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text),details:event.details,changes});
    last=current;
  });
  pi.on('agent_settled',()=>trace('agent_settled',{final:state()}));
  pi.on('session_shutdown',()=>trace('session_shutdown'));
}
