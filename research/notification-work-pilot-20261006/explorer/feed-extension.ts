import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuditFeed, append } from './feed.mjs';

export default function explorerFeed(pi:ExtensionAPI){
  let feed:AuditFeed|undefined;
  const trace=process.env.EXPLORER_FEED_TRACE!;
  pi.on('session_start',async()=>{
    const endpoint=JSON.parse(readFileSync(process.env.PI_NOTIFY_READY!,'utf8'));
    feed=new AuditFeed({work:process.env.EXPLORER_WORK!,run:process.env.EXPLORER_RUN!,
      mode:process.env.EXPLORER_MODE!,kind:process.env.EXPLORER_KIND!,seed:Number(process.env.EXPLORER_SEED!),trace,endpoint});
    await feed.start();
    append(trace,'feed_ready',{mode:process.env.EXPLORER_MODE,activeTools:pi.getActiveTools(),allTools:pi.getAllTools().map(t=>t.name)});
  });
  pi.on('session_shutdown',async()=>{await feed?.finish();});
  pi.on('tool_execution_start',event=>append(trace,'tool_start',{name:event.toolName,toolCallId:event.toolCallId}));
  pi.on('tool_execution_end',event=>append(trace,'tool_end',{name:event.toolName,toolCallId:event.toolCallId,isError:event.isError}));
  pi.on('context',()=>append(trace,'natural_context_boundary'));
  const toolResult=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:value});
  pi.registerTool({name:'get_updates',label:'Read external audit updates',description:'Read currently available external corpus audit reports. Does not start the producer or wait.',parameters:Type.Object({after:Type.Optional(Type.Integer({minimum:0}))}),
    async execute(_id,params){const value=feed!.snapshot(params.after??0);append(trace,'get_updates',{after:params.after??0,count:value.updates.length});return toolResult(value);}});
  pi.registerTool({name:'await_update',label:'Wait for next external audit update',description:'Suspend inference until a newer external report is available, returning immediately if one is already available. Use at an appropriate work boundary. Timeout 120 seconds, then return an empty snapshot.',parameters:Type.Object({after:Type.Optional(Type.Integer({minimum:0}))}),
    async execute(_id,params){const started=Date.now();append(trace,'await_update_start',{after:params.after??0});const value=await feed!.next(params.after??0);append(trace,'await_update_end',{waitMs:Date.now()-started,count:value.updates.length});return toolResult(value);}});
}
