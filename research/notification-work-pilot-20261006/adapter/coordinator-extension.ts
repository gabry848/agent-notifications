import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default async function coordinator(pi: ExtensionAPI) {
  const endpoint = process.env.PILOT_COORDINATOR_ENDPOINT;
  const actor = process.env.PILOT_ACTOR;
  const project = process.env.PILOT_COORDINATOR_PROJECT;
  if (!endpoint || !actor || !project) throw new Error('Coordinator endpoint, actor and project required');
  const client = new Client({name:'pi-coordinator-pilot',version:'0.1.0'});
  const transport = new StdioClientTransport({command:'python3',args:[
    fileURLToPath(new URL('./stdio_proxy.py',import.meta.url)),'--endpoint',endpoint]});
  await client.connect(transport);
  const trace=(type:string,data:object)=>{if(process.env.PILOT_COORDINATOR_TRACE)appendFileSync(process.env.PILOT_COORDINATOR_TRACE,
    JSON.stringify({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6,type,...data})+'\n');};
  const available=await client.listTools(); let subscriptionId:string|undefined;
  // Destination/lifecycle are runtime setup; they never require a model tool call.
  for (const tool of available.tools.filter(t=>!['subscribe_notifications','unsubscribe_notifications','cancel_wait','publish_update'].includes(t.name))) {
    pi.registerTool({name:tool.name,label:tool.name,description:tool.description??tool.name,parameters:tool.inputSchema as any,
      async execute(_id,params:any) {
        const args={...params,project,actor};
        if(['start_activity','update_activity','upsert_activity'].includes(tool.name))args.agent=actor;
        if(tool.name==='post_message')args.from_agent=actor;
        if(tool.name==='list_messages')args.agent=actor;
        if(tool.name==='check_conflicts')args.requester_agent=actor;
        trace('mcp_tool_call',{name:tool.name,args});
        const result=await client.callTool({name:tool.name,arguments:args});
        trace('mcp_tool_result',{name:tool.name,isError:result.isError??false});
        return {content:result.content as any,details:{isError:result.isError??false}};
      }});
  }
  pi.on('session_start',async(_event,ctx)=>{
    if(subscriptionId)await client.callTool({name:'unsubscribe_notifications',arguments:{subscriptionId}});
    if(process.env.PI_NOTIFY_CONTEXT==='0'){subscriptionId=undefined;return;}
    const ready=JSON.parse(readFileSync(process.env.PI_NOTIFY_READY!,'utf8'));
    if(ready.sessionId!==ctx.sessionManager.getSessionId())throw new Error('Destination UUID mismatch');
    const response=await client.callTool({name:'subscribe_notifications',arguments:{project,actor,
      sessionId:ready.sessionId,url:ready.url,ttl_seconds:7200,...(process.env.PILOT_COORDINATOR_CURSOR?{cursor:Number(process.env.PILOT_COORDINATOR_CURSOR)}:{})}});
    const content=response.content as any[];
    const result=JSON.parse(content.find(x=>x.type==='text').text);
    if(response.isError)throw new Error(result.error);
    subscriptionId=result.subscriptionId;trace('subscription_ready',{subscriptionId,project,actor,sessionId:ready.sessionId,url:ready.url});
    trace('model_tool_inventory',{activeTools:pi.getActiveTools(),allTools:pi.getAllTools().map(t=>t.name)});
  });
  pi.on('session_shutdown',async()=>{
    try {if(subscriptionId)await client.callTool({name:'unsubscribe_notifications',arguments:{subscriptionId}});}
    finally{await client.close();}
  });
}
