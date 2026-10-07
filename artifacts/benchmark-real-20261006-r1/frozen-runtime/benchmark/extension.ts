import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Ledger, usageFromRaw } from './meter.mjs';
import { json, log, stamp } from './common.mjs';
import { stableCache } from './cache.mjs';

const exec=promisify(execFile);
export default function benchmark(pi: ExtensionAPI) {
  let client:Client|undefined, transport:StdioClientTransport|undefined, ledger:Ledger|undefined;
  let requestId:string|undefined, payload:Record<string,unknown>|undefined, preview:unknown, headersSeen=false, firstToken=false, call=0;
  const trace=(type:string,data:object={})=>log(process.env.BENCH_RUNTIME!,type,data);
  const spec=json(process.env.BENCH_SPEC!);
  const work=process.env.BENCH_WORK!;
  pi.on('session_start',async()=>{
    ledger=new Ledger(process.env.BENCH_LEDGER!,Number(process.env.BENCH_BUDGET??100));
    client=new Client({name:'pi-benchmark-client',version:'1.0.0'});
    transport=new StdioClientTransport({command:process.execPath,args:[process.env.BENCH_SERVER??fileURLToPath(new URL('./jobs-server.mjs',import.meta.url))],env:Object.fromEntries(Object.entries(process.env).filter(([,v])=>v!==undefined)) as Record<string,string>,stderr:'pipe'});
    await client.connect(transport); const tools=await client.listTools();
    trace('mcp_connected',{tools:tools.tools.map(t=>t.name),pid:transport.pid});
  });
  pi.on('session_shutdown',async()=>{
    ledger?.unknown(requestId);await client?.close();await transport?.close();ledger?.close();ledger=undefined;
  });
  pi.on('context',event=>{
    ledger?.unknown(requestId); requestId=undefined;payload=undefined;headersSeen=false;
    preview=event.messages;call++;trace('context_boundary',{call});
  });
  pi.on('context_with_system',event=>{preview=event.messages;});
  pi.on('before_provider_request',event=>{
    payload=event.payload as Record<string,unknown>;
    payload.max_output_tokens=4096;payload.service_tier='default';
    if(process.env.BENCH_CACHE==='stable'){
      const caching=stableCache(payload);
      trace('provider_cache',{call,...caching});
      log(process.env.BENCH_FINAL_PROVIDER!,'provider_request',{call,payload});
    }
    return payload;
  });
  pi.on('before_provider_headers',()=>{
    firstToken=false;
    if(headersSeen) ledger?.unknown(requestId);
    try { requestId=ledger!.reserve(process.env.BENCH_RUN_ID!,process.env.BENCH_PHASE!,payload??preview); }
    catch(error) {
      // Pi reports extension errors and continues; a thrown handler alone cannot enforce a cap.
      trace('budget_stop',{error:(error as Error).message});
      process.stderr.write('Benchmark budget cap reached; stopping before provider HTTP request.\n');
      process.exit(73);
    }
    headersSeen=true;trace('http_attempt',{call,requestId});
  });
  pi.on('after_provider_response',event=>trace('http_response',{call,requestId,status:event.status,providerRequestId:event.headers['x-request-id']}));
  pi.on('provider_stream_event',event=>{
    const data=event.data as {type?:string,response?:{id?:string,usage?:object,service_tier?:string,model?:string}};
    if(!firstToken&&['response.output_text.delta','response.function_call_arguments.delta','response.reasoning_summary_text.delta'].includes(data.type??'')){
      firstToken=true;trace('first_token',{call,requestId,eventType:data.type});
    }
    if(['response.completed','response.incomplete','response.failed'].includes(data.type??'')){
      const response=data.response;
      const usage=usageFromRaw(response?.usage);
      trace('raw_usage',{call,requestId,responseId:response?.id,usage:response?.usage,serviceTier:response?.service_tier,model:response?.model});
      if(usage)ledger!.settle(requestId!,usage,response?.id);
    }
  });
  pi.on('message_end',event=>{
    const m=event.message as {role?:string,usage?:object,responseId?:string};
    if(m.role==='assistant')trace('assistant_finished',{call,requestId,responseId:m.responseId,usage:m.usage});
  });
  const result=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:value});
  for(const name of ['start_job','get_job','await_jobs'])pi.registerTool({name,label:name,description:({start_job:'Start the requested validation jobs asynchronously; IDs are returned.',get_job:'Read job statuses and any final results, aggregating all IDs.',await_jobs:'Wait for all requested jobs in one call; inference is suspended while waiting.'} as Record<string,string>)[name],parameters:Type.Object({ids:Type.Array(Type.String())}),
    async execute(_id,params){trace('mcp_dispatch',{name,args:params});return await client!.callTool({name,arguments:params},undefined,{timeout:Number(process.env.BENCH_TIMEOUT??600000)});}});
  pi.registerTool({name:'pause',label:'Pause',description:'Wait 0–30 seconds without inference; complete this call before the next status check.',parameters:Type.Object({seconds:Type.Number({minimum:0,maximum:30})}),async execute(_id,params){trace('mcp_dispatch',{name:'pause',args:params});return await client!.callTool({name:'pause',arguments:params},undefined,{timeout:60000});}});
  const pathFor=(name:string)=>{if(!/^module-\d+\.mjs$/.test(name))throw new Error('Only fixture modules are accessible');return join(work,'fixture',name);};
  pi.registerTool({name:'read_files',label:'Read fixture modules',description:'Read all fixture modules or a selected module. These are real local files.',parameters:Type.Object({name:Type.Optional(Type.String())}),async execute(_id,params){
    const names=params.name?[params.name]:readdirSync(join(work,'fixture')).filter(n=>/^module-\d+\.mjs$/.test(n));
    trace('files_read',{names});return result(names.map(name=>({name,content:readFileSync(pathFor(name),'utf8')})));}});
  pi.registerTool({name:'write_file',label:'Write fixture module',description:'Replace one fixture module with its complete corrected source. Preserve FACTOR and OFFSET.',parameters:Type.Object({name:Type.String(),content:Type.String({maxLength:3000})}),async execute(_id,params){writeFileSync(pathFor(params.name),params.content);trace('file_written',{name:params.name});return result({written:params.name});}});
  pi.registerTool({name:'verify_files',label:'Test fixture files',description:'Run the real Node tests for every fixture module.',parameters:Type.Object({}),async execute(){
    try{const r=await exec(process.execPath,['--test','fixture.test.mjs'],{cwd:work,timeout:20000,maxBuffer:100000});trace('files_verified',{passed:true});return result({passed:true,output:r.stdout});}
    catch(error){const e=error as {stdout?:string,stderr?:string};trace('files_verified',{passed:false});return result({passed:false,output:e.stdout,errors:e.stderr});}}});
  pi.registerTool({name:'submit_plan',label:'Save deployment plan',description:'Save the final plan after all required results are known. Does not deploy.',parameters:Type.Object({region:Type.String(),release:Type.String(),maxBatch:Type.Integer(),status:Type.Union([Type.Literal('ready'),Type.Literal('blocked')]),jobIds:Type.Array(Type.String())}),async execute(_id,params){writeFileSync(join(work,'result.json'),JSON.stringify(params,null,2));trace('plan_submitted',{result:params});return result({saved:true,...stamp()});}});
}
