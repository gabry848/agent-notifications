import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema,ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync,watch } from 'node:fs';
import { join } from 'node:path';
import { json,log,pause,stamp } from '../common.mjs';

const exec=promisify(execFile),spec=json(process.env.BENCH_SPEC),job=spec.jobs[0];
const trace=(type,data={})=>log(process.env.BENCH_MCP_TRACE,type,data);
const statePath=join(spec.github.controlDir,spec.github.experimentId+'.json');
let launched=false,record,finished=false,cancelRequested=false,watcher;
const gh=async(args)=>{trace('github_api',{args});return (await exec('gh',args,{timeout:30000,env:{...process.env,GH_DEBUG:''},maxBuffer:200000})).stdout;};
const finish=(event,origin)=>{
  if(finished)return;
  finished=true;const observed=event.received??stamp();
  trace('job_finished',{jobId:job.id,revision:1,status:event.conclusion==='success'?'succeeded':'failed',result:{maxBatch:0,conclusion:event.conclusion,runId:event.runId,region:'eu-west-1',release:'v1.4'},finished:observed,monoMs:observed.monoMs,timeSource:origin});
};
const refresh=()=>{
  if(!existsSync(statePath))return null;
  const event=json(statePath);record=event;
  if(event.status==='completed')finish(event,'webhook_received');
  if(job.outcome==='cancelled'&&event.status==='in_progress'&&!cancelRequested){
    cancelRequested=true;
    void pause(10000).then(()=>gh(['api','--method','POST',`repos/${spec.github.repo}/actions/runs/${event.runId}/cancel`])).catch(e=>trace('cancel_error',{error:e.message}));
  }
  return event;
};
const waitFor=check=>new Promise((resolve,reject)=>{
  const immediate=check();if(immediate)return resolve(immediate);
  const timer=setTimeout(()=>{w.close();reject(new Error('GitHub event timeout'));},1100000);
  const w=watch(spec.github.controlDir,()=>{try{const value=check();if(value){clearTimeout(timer);w.close();resolve(value);}}catch(e){clearTimeout(timer);w.close();reject(e);}});
  const after=check();if(after){clearTimeout(timer);w.close();resolve(after);}
});
watcher=watch(spec.github.controlDir,()=>{try{refresh();}catch(e){trace('state_error',{error:e.message});}});
const visible=event=>({jobId:job.id,revision:1,status:event?.status==='completed'?(event.conclusion==='success'?'succeeded':'failed'):'running',
  ...(event?.status==='completed'?{result:{maxBatch:0,conclusion:event.conclusion,runId:event.runId,region:'eu-west-1',release:'v1.4'}}:{})});
const tools=[
  {name:'start_job',description:'Dispatch the real GitHub validation workflow.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'}}},required:['ids']}},
  {name:'get_job',description:'Query GitHub API for current workflow status.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'}}},required:['ids']}},
  {name:'await_jobs',description:'Wait for the workflow_run webhook without polling GitHub.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'}}},required:['ids']}},
  {name:'pause',description:'Wait without inference.',inputSchema:{type:'object',properties:{seconds:{type:'number'}},required:['seconds']}},
];
const server=new Server({name:'github-actions-benchmark',version:'1'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
server.setRequestHandler(CallToolRequestSchema,async req=>{
  const {name,arguments:args={}}=req.params;trace('tools_call',{name,args});
  try{
    let result;
    if(name==='pause'){if(!Number.isFinite(args.seconds)||args.seconds<0||args.seconds>30)throw new Error('Invalid pause');await pause(args.seconds*1000);result={waitedSeconds:args.seconds};}
    else{
      if(JSON.stringify(args.ids)!==JSON.stringify([job.id]))throw new Error('Expected the configured GitHub job ID');
      if(name==='start_job'){
        if(!launched){launched=true;trace('job_started',{jobId:job.id});
          await gh(['api','--method','POST',`repos/${spec.github.repo}/actions/workflows/bench.yml/dispatches`,'-f',`ref=${spec.github.ref}`,'-f',`inputs.experiment_id=${spec.github.experimentId}`,'-f',`inputs.outcome=${job.outcome}`]);
        }
        const event=await waitFor(()=>refresh());result=[{jobId:job.id,status:'running',runId:event.runId}];
      }else if(name==='get_job'){
        if(!launched||!record)throw new Error('Start the workflow first');
        const run=JSON.parse(await gh(['api',`repos/${spec.github.repo}/actions/runs/${record.runId}`]));
        if(run.status==='completed')finish({conclusion:run.conclusion,runId:run.id},'api_completion_observed');
        result=[visible({status:run.status,conclusion:run.conclusion,runId:run.id})];trace('status_check',{ids:args.ids,pending:run.status!=='completed'});
      }else if(name==='await_jobs'){
        if(!launched)throw new Error('Start the workflow first');
        const event=await waitFor(()=>{const r=refresh();return r?.status==='completed'?r:null;});result=[visible(event)];trace('await_completed',{ids:args.ids});
      }else throw new Error('Unknown tool');
    }
    trace('tools_result',{name});return {content:[{type:'text',text:JSON.stringify(result)}]};
  }catch(e){trace('tools_error',{name,error:e.message});return {isError:true,content:[{type:'text',text:e.message}]};}
});
const transport=new StdioServerTransport();await server.connect(transport);
const dispatch=transport.onmessage;transport.onmessage=(m,extra)=>{trace('protocol_message',{method:m.method??'response'});dispatch?.(m,extra);};
process.on('SIGTERM',()=>{watcher.close();process.exit(0);});process.stdin.on('end',()=>watcher.close());
