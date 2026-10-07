import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase,ROOT } from '../run.mjs';
import { webhook } from './webhook.mjs';
import { Ledger } from '../meter.mjs';
import { save,json,lines,shuffled,hash,log,pause } from '../common.mjs';

const exec=promisify(execFile),rate=.006;
export async function github(campaign,{order:orderOverride,attempt=''}={}){
  if(attempt&&!/^[a-z0-9-]+$/.test(attempt))throw new Error('Invalid GitHub attempt name');
  const suffix=attempt?'-'+attempt:'';
  const directory=resolve(ROOT,'artifacts',campaign),fixture=json(join(directory,'github-fixture.json'));
  const selected=json(join(directory,'selected.json'));
  const controlDir=join(directory,'github-control');mkdirSync(controlDir,{recursive:true});
  const driverTrace=join(directory,'github-driver.jsonl');
  const gh=async args=>{log(driverTrace,'driver_github_api',{args});return (await exec('gh',args,{timeout:30000,env:{...process.env,GH_DEBUG:''}})).stdout;};
  const status=(await exec('vpnbar',['share','status'],{timeout:15000})).stdout;
  if(!/Nessuna condivisione attiva|No active share/i.test(status))throw new Error('An existing vpnbar share is active; preserving it.');
  const secret=randomBytes(32).toString('hex'),privateDir=mkdtempSync(join(tmpdir(),'pi-github-hook-'));
  const receiver=await webhook({secret,repoId:fixture.repoId,controlDir,tracePath:join(directory,'github-webhooks.jsonl')});
  let hookId,shareOwned=false,publicUrl;
  const preflightPath=join(directory,`github-preflight${suffix}.json`);
  const order=orderOverride??['success','failure','cancelled'].flatMap((outcome,i)=>[0,1].flatMap(r=>shuffled(['N','P10'],3001+i*100+r).map(mode=>({outcome,seed:3001+i*100+r,mode}))));
  save(join(directory,`github-order${suffix}.json`),order);
  try{
    shareOwned=true;
    const share=await exec('vpnbar',['share',receiver.url],{timeout:45000,maxBuffer:50000});
    publicUrl=(share.stdout+'\n'+share.stderr).match(/https:\/\/[^\s\x1b]+/)?.[0]?.replace(/[),.]+$/,'').replace(/\/+$/,'');
    if(!publicUrl)throw new Error('vpnbar did not return a public HTTPS URL');
    save(preflightPath,{startedAt:new Date().toISOString(),publicUrl,receiverUrl:receiver.url,status:'checking-tunnel'});
    const healthDeadline=Date.now()+90000;let healthy=false;
    while(!healthy&&Date.now()<healthDeadline){
      try{
        const response=await fetch(publicUrl+'/health',{signal:AbortSignal.timeout(5000)});
        const body=response.ok?await response.json():null;
        healthy=body?.receiver===receiver.healthNonce;
        log(driverTrace,'tunnel_health',{attempt,publicUrl,status:response.status,healthy});
      }catch(error){log(driverTrace,'tunnel_health',{attempt,publicUrl,healthy:false,error:error.message});}
      if(!healthy)await pause(2000);
    }
    if(!healthy)throw new Error('vpnbar public endpoint did not reach the current receiver; no model trials started');
    const input=join(privateDir,'hook.json');
    writeFileSync(input,JSON.stringify({name:'web',active:true,events:['workflow_run'],config:{url:publicUrl+'/webhook',content_type:'json',secret,insecure_ssl:'0'}}),{mode:0o600});
    hookId=JSON.parse(await gh(['api','--method','POST',`repos/${fixture.repo}/hooks`,'--input',input])).id;
    rmSync(input,{force:true});
    const pingDeadline=Date.now()+90000;let nextPing=Date.now()+5000,pingRetries=0;
    const pingReceived=()=>lines(join(directory,'github-webhooks.jsonl')).some(e=>e.type==='github_webhook'&&e.event==='ping'&&String(e.hookId)===String(hookId));
    while(!pingReceived()&&Date.now()<pingDeadline){
      if(Date.now()>=nextPing&&pingRetries<3){
        await gh(['api','--method','POST',`repos/${fixture.repo}/hooks/${hookId}/pings`]);pingRetries++;nextPing=Date.now()+10000;
      }
      await pause(100);
    }
    if(!pingReceived())throw new Error('Signed GitHub ping did not reach vpnbar receiver; stopping before paid model trials');
    save(preflightPath,{completedAt:new Date().toISOString(),publicUrl,hookId,status:'ready',healthy,pingRetries});
    const sourceFiles=['server.mjs','webhook.mjs','bench.yml','run.mjs'];
    const sources=Object.fromEntries(sourceFiles.map(p=>[p,readFileSync(join(ROOT,'benchmark/github',p),'utf8')]));
    const sourceHashes=Object.fromEntries(Object.entries(sources).map(([p,content])=>[p,hash(content)]));
    const sourceDir=join(directory,'frozen-github'+suffix);mkdirSync(sourceDir,{recursive:true});
    for(const [p,content]of Object.entries(sources))writeFileSync(join(sourceDir,p),content);
    save(join(sourceDir,'hashes.json'),sourceHashes);
    save(join(directory,`github-live${suffix}.json`),{...fixture,publicUrl,hookId,pricing:{perMinuteUsd:rate,source:'https://docs.github.com/en/billing/reference/actions-runner-pricing',checkedAt:'2026-10-06'},sourceHash:hash(sources),sourceHashes,startedAt:new Date().toISOString()});
    for(const item of order){
      const name='GH-'+item.outcome,experimentId=`${campaign}-${name}-${item.seed}-${item.mode}`;
      const externalId='runner-'+experimentId,ledger=new Ledger(join(directory,'budget.sqlite'));
      ledger.external(externalId,.10,'GitHub Ubuntu runner reservation: bounded five-minute job plus setup/cleanup margin');ledger.close();
      const spec={name,seed:item.seed,independent:true,batch:0,jobs:[{id:'validation',outcome:item.outcome}],
        expected:{region:'eu-west-1',release:'v1.4',maxBatch:0,status:item.outcome==='success'?'ready':'blocked'},
        github:{...fixture,controlDir,experimentId}};
      const summary=await runCase({campaign,phase:'github',name,seed:item.seed,mode:item.mode,...selected,specOverride:spec,
        envExtra:{BENCH_SERVER:fileURLToPath(new URL('./server.mjs',import.meta.url)),BENCH_TIMEOUT:'1200000'},
        onReady:({readyPath,mcpPath})=>receiver.register(experimentId,{readyPath,mcpPath,mode:item.mode,jobId:'validation'})});
      const statePath=join(controlDir,experimentId+'.json');let state;
      try{state=json(statePath);}catch{}
      if(state?.runId){
        const jobs=JSON.parse(await gh(['api',`repos/${fixture.repo}/actions/runs/${state.runId}/jobs`]));
        const minutes=jobs.jobs.reduce((a,j)=>a+(j.started_at&&j.completed_at?Math.ceil(Math.max(0,Date.parse(j.completed_at)-Date.parse(j.started_at))/60000):0),0);
        const meter=new Ledger(join(directory,'budget.sqlite'));if(jobs.jobs.every(j=>j.completed_at))meter.estimateExternal(externalId,minutes*rate);meter.close();
        save(join(directory,summary.runId,'github-evidence.json'),{run:state,jobs:jobs.jobs.map(j=>({id:j.id,name:j.name,status:j.status,conclusion:j.conclusion,startedAt:j.started_at,completedAt:j.completed_at,url:j.html_url})),estimatedRunnerUsd:minutes*rate,invoiceConfirmed:false,
          queueMs:state.startedAt&&state.createdAt?Date.parse(state.startedAt)-Date.parse(state.createdAt):null,
          timingNote:'Local MCP completion is webhook receipt or API observation, not the remote worker finish. Queue and job UTC timestamps are preserved separately.',
          mcpServerGithubRequests:lines(join(directory,summary.runId,'mcp.jsonl')).filter(e=>e.type==='github_api').length,
          automaticCancellationRequests:lines(join(directory,summary.runId,'mcp.jsonl')).filter(e=>e.type==='github_api'&&e.args.some(a=>String(a).endsWith('/cancel'))).length,
          driverGithubRequestsExcludedFromServerMetric:1});
      }
      if(summary.error&&/401|403|quota|billing|exited 73/i.test(summary.error))throw new Error(summary.error);
    }
  }catch(error){
    save(preflightPath,{failedAt:new Date().toISOString(),publicUrl,hookId,status:'failed',error:error.message});throw error;
  }finally{
    for(const [id,entry]of receiver.records){
      try{const state=json(join(controlDir,id+'.json'));if(state.status!=='completed')await gh(['api','--method','POST',`repos/${fixture.repo}/actions/runs/${state.runId}/cancel`]);}
      catch(e){log(driverTrace,'cleanup_run',{id,error:e.message});}
    }
    if(hookId)try{await gh(['api','--method','DELETE',`repos/${fixture.repo}/hooks/${hookId}`]);}catch(e){log(driverTrace,'cleanup_hook_error',{hookId,error:e.message});}
    await receiver.close();
    if(shareOwned)try{await exec('vpnbar',['share','stop'],{timeout:15000});}catch(e){log(driverTrace,'cleanup_share_error',{error:e.message});}
    rmSync(privateDir,{recursive:true,force:true});
    save(join(directory,`github-cleanup${suffix}.json`),{finishedAt:new Date().toISOString(),hookId,shareOwned,repositoryRetained:fixture.url});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await github(process.argv[2]??'benchmark-real-20261006-r1');
