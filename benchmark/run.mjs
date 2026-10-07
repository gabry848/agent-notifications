import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { scenario, task, MODES, SCENARIOS } from './scenarios.mjs';
import { Ledger, PRICING, PHASE_LIMITS } from './meter.mjs';
import { startPi } from './pi-client.mjs';
import { assess, measures,notificationState } from './metrics.mjs';
import { hash, json, lines, save, shuffled, stamp, log, redact, pause } from './common.mjs';
import { runtimeSources } from './sources.mjs';

const exec=promisify(execFile);
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export function fixtures(work,spec) {
  mkdirSync(join(work,'fixture'),{recursive:true});
  const original={};const cases=[];
  for(let i=0;i<(spec.independent?8:0);i++){
    const factor=2+(spec.seed+i)%7,offset=(spec.seed+i)%11;
    const name=`module-${i}.mjs`;
    const source=`export const FACTOR = ${factor};\nexport const OFFSET = ${offset};\nexport function transform(n) { throw new Error('TODO'); }\n`;
    writeFileSync(join(work,'fixture',name),source);original[name]=source;
    cases.push(`test(${JSON.stringify(name)}, async()=>{const m=await import('./fixture/${name}');assert.equal(m.FACTOR,${factor});assert.equal(m.OFFSET,${offset});for(const n of [-3,0,7])assert.equal(m.transform(n),n*${factor}+${offset});});`);
  }
  writeFileSync(join(work,'fixture.test.mjs'),`import test from 'node:test';import assert from 'node:assert/strict';\n${cases.join('\n')}\n`);
  save(join(work,'original-files.json'),original);
}

export async function runCase({campaign,phase,name,seed,mode,variant='v2',payload='full',position='tail',cache='implicit',dismiss='single',contextEnabled=true,budget=100,offlineOnly=false,specOverride,flow='normal',envExtra={},onReady}) {
  if(!['single','batch'].includes(dismiss))throw new Error('Invalid dismiss strategy');
  if(mode!=='N')dismiss='single';
  const output=resolve(ROOT,'artifacts',campaign);mkdirSync(output,{recursive:true});
  const runId=`${phase}-${name}-${seed}-${mode}-${variant}-${payload}${position==='tail'?'':'-'+position}${cache==='implicit'?'':'-'+cache}${dismiss==='single'?'':'-batch'}${contextEnabled?'':'-disabled'}`;
  const directory=join(output,runId);
  if(existsSync(join(directory,'summary.json')))return json(join(directory,'summary.json'));
  if(existsSync(directory))throw new Error(`Incomplete attempt exists: ${runId}; use a distinct variant or seed to retain it`);
  mkdirSync(directory,{recursive:true});
  const spec=specOverride??scenario(name,seed);
  const specPath=join(directory,'spec.json'),work=join(directory,'work');
  mkdirSync(work);fixtures(work,spec);
  const config=mkdtempSync(join(tmpdir(),'pi-bench-config-'));
  const existing=json(join(homedir(),'.pi','agent','auth.json'));
  if(!existing.openai)throw new Error('No approved existing OpenAI credential');
  writeFileSync(join(config,'auth.json'),JSON.stringify({openai:existing.openai}),{mode:0o600});
  writeFileSync(join(config,'settings.json'),JSON.stringify({defaultProvider:'openai',defaultModel:'gpt-6.1-sol',defaultThinkingLevel:'medium',enableMcp:false,packages:[]}));
  const runtimePath=join(directory,'runtime.jsonl'),mcpPath=join(directory,'mcp.jsonl'),notifyPath=join(directory,'notifications.jsonl');
  const eventsPath=join(directory,'events.jsonl'),stderrPath=join(directory,'stderr.jsonl'),readyPath=join(work,'ready.json');
  const promptPath=join(ROOT,'prompts',`${variant}.txt`),prompt=task(spec,mode);
  const sourceBundle=runtimeSources(ROOT),sourceHash=sourceBundle.hash;
  save(specPath,{...spec,mode,phase,variant,payload,position,cache,dismiss,prompt,policyVersion:1});
  const ledgerPath=join(output,'budget.sqlite');new Ledger(ledgerPath,budget).close();
  const created=stamp();let begun,ended,error,utilityProof,filesPassed=!spec.independent,transcriptBlockPersisted=null;
  const env={...envExtra,BENCH_SPEC:specPath,BENCH_WORK:work,BENCH_RUN_ID:runId,BENCH_PHASE:phase,BENCH_MODE:mode,BENCH_PAYLOAD:payload,BENCH_CACHE:cache,
    BENCH_FINAL_PROVIDER:join(directory,'provider-final.jsonl'),
    BENCH_LEDGER:ledgerPath,BENCH_BUDGET:String(budget),BENCH_RUNTIME:runtimePath,BENCH_MCP_TRACE:mcpPath,BENCH_SESSION_ID:randomUUID(),
    PI_NOTIFY_CONTEXT:mode==='N'&&contextEnabled?'1':'0',PI_NOTIFY_POSITION:position,PI_NOTIFY_DISMISS:dismiss,PI_NOTIFY_DB:join(directory,'notifications.sqlite'),PI_NOTIFY_PORT:'0',
    PI_NOTIFY_READY:readyPath,PI_NOTIFY_TRACE:notifyPath,PI_NOTIFY_PROVIDER_TRACE:join(directory,'provider.jsonl'),PI_NOTIFY_PROMPT:promptPath,PI_NOTIFY_LAB:'0'};
  let pi=startPi({work,config,env,eventsPath,stderrPath,root:ROOT});
  try{
    await pi.waitReady();
    if(onReady)await onReady({readyPath,mcpPath,directory,pi});
    await pi.command({type:'get_state'});
    await pi.wait(()=>lines(runtimePath).some(e=>e.type==='mcp_connected'),'MCP connected',20000);
    if(['idle','restart'].includes(flow)){
      await pi.wait(()=>lines(mcpPath).filter(e=>e.type==='notify_accepted').length===spec.jobs.length,'idle backlog',20000);
      await pause(1000);
      const check=new Ledger(ledgerPath,budget),before=check.summary(runId);check.close();
      if(before.requests!==0)throw new Error('Notification reception triggered a provider request while idle');
      utilityProof={flow,acceptedWhileIdle:spec.jobs.length,providerAttemptsBeforePrompt:before.requests,initialSession:pi.ready().sessionId};
      if(flow==='restart'){
        await pi.stop();rmSync(readyPath,{force:true});
        const restartSpec=join(directory,'restart-server-spec.json');save(restartSpec,{...spec,unsolicited:false});
        pi=startPi({work,config,env:{...env,BENCH_SPEC:restartSpec},eventsPath,stderrPath,root:ROOT});
        await pi.waitReady();await pi.command({type:'get_state'});
        utilityProof.resumedSession=pi.ready().sessionId;
        if(utilityProof.resumedSession!==utilityProof.initialSession)throw new Error('Restart changed the Pi session ID');
      }
    }
    begun=stamp();log(runtimePath,'task_started');
    if(!offlineOnly){
      await pi.prompt(prompt);
      const transcript=await pi.command({type:'get_messages'});
      transcriptBlockPersisted=transcript.messages.some(m=>m.role==='custom'&&m.customType==='dynamic-notification-memory');
      if(transcriptBlockPersisted)throw new Error('Dynamic notification block persisted in transcript');
      if(spec.independent){try{const r=await exec(process.execPath,['--test','fixture.test.mjs'],{cwd:work,timeout:20000});filesPassed=true;writeFileSync(join(directory,'file-test-output.txt'),r.stdout);}catch(e){filesPassed=false;writeFileSync(join(directory,'file-test-output.txt'),e.stdout??String(e));}}
    }
  }catch(e){error=redact(e.message);}
  finally{ended=stamp();await pi.stop();rmSync(config,{recursive:true,force:true});}
  begun??=created;
  const events=lines(eventsPath).map(r=>r.event),runtime=lines(runtimePath),mcp=lines(mcpPath),notifications=lines(notifyPath);
  const resultPath=join(work,'result.json'),result=existsSync(resultPath)?json(resultPath):null;
  const ledger=new Ledger(ledgerPath,budget),accounting=ledger.summary(runId);const total=ledger.total();ledger.close();
  const metrics=measures({started:begun,finished:ended,ledger:accounting,mcp,runtime,notifications,events});
  metrics.startupMs=begun.monoMs-created.monoMs;
  metrics.totalWallMs=ended.monoMs-created.monoMs;
  metrics.notificationState=existsSync(readyPath)?notificationState(join(directory,'notifications.sqlite'),json(readyPath).sessionId):null;
  const assessment=offlineOnly?{passed:!error,failures:error?[error]:[],offlineOnly:true}:assess({spec,mode,result,mcp,runtime,notifications,events,filesPassed,error});
  const summary={runId,phase,scenario:name,seed,mode,variant,payload,position,cache,dismiss,contextEnabled,flow,utilityProof,created,begun,ended,error:error??null,result,filesPassed,transcriptBlockPersisted,
    assessment,metrics,accounting,configuration:{model:'gpt-6.1-sol',thinking:'medium',pricing:PRICING,sourceHash,sourceHashes:sourceBundle.hashes,promptHash:hash(readFileSync(promptPath,'utf8')),taskHash:hash(prompt),specHash:hash(spec)},budgetConservativeTotalUsd:total};
  save(join(directory,'summary.json'),summary);
  console.log(`${runId}: ${assessment.passed?'PASS':'FAIL'} calls=${metrics.providerAttempts} tokens=${metrics.tokens.totalTokens??0} estimated=$${metrics.estimatedUsd.toFixed(4)} task=${(metrics.taskMs/1000).toFixed(1)}s ${error??assessment.failures.join('; ')}`);
  return summary;
}

async function main(){
  const args=process.argv.slice(2),arg=(key,fallback)=>{const i=args.indexOf('--'+key);return i<0?fallback:args[i+1];};
  const campaign=arg('campaign',`benchmark-${new Date().toISOString().replaceAll(':','-')}`),phase=arg('phase','pilot');
  const names=arg('scenarios',phase==='pilot'?'S1,S3':SCENARIOS.join(',')).split(',');
  const modes=arg('modes',MODES.join(',')).split(',');
  const repeat=Number(arg('repeat',phase==='pilot'?'2':'5')),baseSeed=Number(arg('seed',phase==='pilot'?'1':phase==='main'?'101':phase==='refine'?'501':'1001'));
  const budget=Number(arg('budget','100')),variant=arg('variant','v2'),payload=arg('payload','full'),position=arg('position','tail'),cache=arg('cache','implicit'),dismiss=arg('dismiss','single');
  if(!PHASE_LIMITS[phase]||!Number.isInteger(repeat)||repeat<1||!Number.isFinite(budget)||budget<0||budget>100||modes.some(m=>!MODES.includes(m)))throw new Error('Invalid benchmark arguments');
  const output=resolve(ROOT,'artifacts',campaign);mkdirSync(output,{recursive:true});
  if(!existsSync(join(output,'manifest.json')))save(join(output,'manifest.json'),{campaign,created:stamp(),node:process.version,model:'gpt-6.1-sol',thinking:'medium',budgetUsd:budget,pricing:PRICING});
  const batches=names.flatMap((name,i)=>Array.from({length:repeat},(_,r)=>({name,seed:baseSeed+i*100+r})));
  const order=batches.flatMap(b=>shuffled(modes,b.seed).map(mode=>({...b,mode})));
  save(join(output,`${phase}-${variant}-${payload}-${position}-${cache}-${dismiss}-order.json`),order);
  for(const run of order){
    const ledger=new Ledger(join(output,'budget.sqlite'),budget);const available=Math.min(budget,PHASE_LIMITS[phase])-ledger.total();ledger.close();
    if(available<.75){console.log(`Budget stop before next case: available ${available.toFixed(3)} USD`);break;}
    const result=await runCase({campaign,phase,...run,variant,payload,position,cache,dismiss,budget,offlineOnly:args.includes('--offline-check')});
    if(result.error?.includes('exited 73'))break;
    if(result.error&&/model|API key|401|403|quota/i.test(result.error))throw new Error(`Provider preflight failed: ${result.error}`);
  }
  console.log(`Artifacts: ${output}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
