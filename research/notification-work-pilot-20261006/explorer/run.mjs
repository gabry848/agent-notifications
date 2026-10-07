import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createFixture, contracts, verifyRelease } from './fixture.mjs';
import { checkWork, checkSupplementalWork, append } from './feed.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=value=>{
  if(Array.isArray(value))return value.filter(x=>x?.type!=='thinking').map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .filter(([k])=>!['thinking','thinkingSignature','textSignature','headers'].includes(k)).map(([k,v])=>[k,clean(v)]));
  return typeof value==='string'?value.replace(/sk-[A-Za-z0-9_-]{12,}/g,'[redacted]'):value;
};
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function readJson(path){return JSON.parse(readFileSync(path,'utf8'));}
function jsonl(path){return existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):[];}

export async function runCase({runtime,ledger,mode,kind,seed,goReceipt,timeoutMs=900000}){
  // A concrete receipt written by root is required, not a command-line boolean.
  const receipt=readJson(goReceipt);
  if(receipt.explorerAuthorized!==true)throw new Error('No measured explorer authorization receipt');
  if(!['N','PA','W'].includes(mode)||!['compatibility','status'].includes(kind))throw new Error('Invalid case');
  if(receipt.allowedCase&&Object.entries(receipt.allowedCase).some(([name,value])=>({mode,kind,seed})[name]!==value))throw new Error('Case is outside GO receipt');
  if(receipt.ledgerPath&&resolve(ledger)!==resolve(receipt.ledgerPath))throw new Error('Ledger is outside GO receipt');
  if(receipt.runtimeRoot&&resolve(runtime)!==resolve(receipt.runtimeRoot))throw new Error('Runtime is outside GO receipt');
  for(const [name,digest]of Object.entries(receipt.runtimeHashes??{}))if(hash(join(runtime,name))!==digest)throw new Error('Runtime mismatch with frozen GO receipt: '+name);
  for(const [name,digest]of Object.entries(receipt.explorerHashes??{}))if(hash(join(root,name))!==digest)throw new Error('Explorer source mismatch with frozen GO receipt: '+name);
  const existing=existsSync(join(root,'runs'))?readdirSync(join(root,'runs')).filter(x=>existsSync(join(root,'runs',x,'manifest.json'))):[];
  if(existing.length>=6)throw new Error('Explorer maximum six measured attempts reached');
  if(receipt.maxNewMeasuredCases&&existing.filter(id=>readJson(join(root,'runs',id,'manifest.json')).receipt===resolve(goReceipt)).length>=receipt.maxNewMeasuredCases)throw new Error('GO receipt measured-case allowance exhausted');
  const id=`explorer-${kind}-${mode}-${seed}-${randomUUID().slice(0,8)}`,run=join(root,'runs',id),work=join(run,'work');
  mkdirSync(run,{recursive:true});const spec=createFixture(work,{seed,kind});
  const {prepareDefaultConfig}=await import('file://'+join(runtime,'pi-runtime.mjs'));
  const configDir=join(run,'config'),config=prepareDefaultConfig(configDir);
  const ownRuntime=join(run,'runtime');mkdirSync(ownRuntime,{recursive:true});
  for(const file of ['fixture.mjs','feed.mjs','feed-extension.ts','audit-worker.mjs'])copyFileSync(join(root,file),join(ownRuntime,file));
  const runtimeHashes={};for(const name of ['meter.mjs','meter-extension.ts','pi-runtime.mjs','transport/pi-extension.ts','transport/store.mjs','transport/http.mjs','transport/prompt-v3.txt'])runtimeHashes[name]=hash(join(runtime,name));
  const frozenOwn=Object.fromEntries(['fixture.mjs','feed.mjs','feed-extension.ts','audit-worker.mjs'].map(x=>[x,hash(join(ownRuntime,x))]));
  if(receipt.runtimeHashes)for(const [name,digest]of Object.entries(receipt.runtimeHashes)){
    if(runtimeHashes[name]!==digest)throw new Error('Runtime mismatch with frozen GO receipt: '+name);
  }
  if(receipt.explorerHashes)for(const [name,digest]of Object.entries(receipt.explorerHashes)){
    if(hash(join(root,name))!==digest)throw new Error('Explorer source mismatch with frozen GO receipt: '+name);
  }
  const uuid=randomUUID(),ready=join(run,'ready.json'),rpcPath=join(run,'rpc.jsonl'),stderrPath=join(run,'stderr.jsonl');
  const manifest={id,mode,kind,seed,uuid,createdAt:new Date().toISOString(),designVersion:'delivery-hub-v2',spec,runtimeHashes,frozenOwn,
    modelPolicy:'Pi default, no provider/model/thinking override',config,targetMinutes:10,timeoutMs,receipt:resolve(goReceipt),
    importantLimits:['progress-gated laboratory report, not real external latency','one case per mode, exploratory','actual default Codex subscription charge unknown']};
  writeFileSync(join(run,'manifest.json'),JSON.stringify(manifest,null,2));
  const tools=['read','bash','edit','write',...(mode==='N'?['notifications_dismiss','await_update']:mode==='PA'?['get_updates']:['await_update'])];
  const args=['--mode','rpc','--no-session','--session-id',uuid,'--offline','--no-extensions','--no-skills','--no-prompt-templates','--no-context-files','--no-themes','--no-approve',
    '--tools',tools.join(','),'-e',join(runtime,'transport/pi-extension.ts'),'-e',join(runtime,'meter-extension.ts'),'-e',join(ownRuntime,'feed-extension.ts')];
  const env={...process.env,PI_CODING_AGENT_DIR:configDir,PI_TELEMETRY:'0',PI_OFFLINE:'1',PI_NOTIFY_DB:join(run,'notifications.sqlite'),PI_NOTIFY_READY:ready,PI_NOTIFY_CONTEXT:mode==='N'?'1':'0',PI_NOTIFY_DISMISS:'batch',PI_NOTIFY_POSITION:'tail',
    PI_NOTIFY_TRACE:join(run,'notifications.jsonl'),PI_NOTIFY_PROVIDER_TRACE:join(run,'provider.jsonl'),PI_NOTIFY_PROMPT:join(runtime,'transport/prompt-v3.txt'),
    PILOT_LEDGER:resolve(ledger),PILOT_SCOPE:'explorer',PILOT_SCOPE_CAP:'2',PILOT_GLOBAL_CAP:'10',PILOT_RUN_ID:id,PILOT_METER_TRACE:join(run,'meter.jsonl'),
    EXPLORER_WORK:work,EXPLORER_RUN:run,EXPLORER_MODE:mode,EXPLORER_KIND:kind,EXPLORER_SEED:String(seed),EXPLORER_FEED_TRACE:join(run,'feed.jsonl')};
  const started=Date.now(),child=spawn(process.env.PI_BINARY??'pi',args,{cwd:work,env,stdio:['pipe','pipe','pipe'],detached:true});
  let exitCode,spawnError,buffer='',serial=0;const events=[],responses=new Map();
  child.once('error',e=>{spawnError=e;});child.once('exit',code=>{exitCode=code??-1;});
  child.stderr.on('data',x=>append(stderrPath,'stderr',{text:clean(String(x))}));
  child.stdout.on('data',x=>{buffer+=x;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const event=clean(JSON.parse(line));if(event.type==='message_update')continue;events.push(event);append(rpcPath,'rpc',{event});if(event.type==='response')responses.set(event.id,event);}catch{if(line.trim())append(stderrPath,'non_rpc',{text:clean(line)});}}});
  const wait=async(check,label,limit=timeoutMs)=>{const deadline=Date.now()+limit;while(Date.now()<deadline){const x=check();if(x)return x;if(spawnError)throw spawnError;if(exitCode!==undefined)throw new Error('Pi exited '+exitCode+' waiting for '+label);await sleep(25);}throw new Error('Timeout '+label);};
  const command=async body=>{const id='rpc-'+ ++serial;child.stdin.write(JSON.stringify({id,...body})+'\n');const res=await wait(()=>responses.get(id),body.type,30000);if(!res.success)throw new Error(res.error??'RPC command failed');return res.data;};
  let error,resolvedModel,promptAt,settledAt;
  try{
    await wait(()=>existsSync(ready),'endpoint',30000);resolvedModel=await command({type:'get_state'});
    const model=resolvedModel.model;
    if(model?.provider!=='openai-codex'||model?.id!=='gpt-6.1-sol')throw new Error('Resolved default differs from frozen paired model');
    append(rpcPath,'preflight',{model:{id:model.id,provider:model.provider,api:model.api},configuredTools:tools,thinkingLevel:resolvedModel.thinkingLevel});
    // Reject any runtime source modification before first inference.
    for(const [name,digest]of Object.entries(runtimeHashes))if(hash(join(runtime,name))!==digest)throw new Error('Runtime changed before prompt');
    promptAt=Date.now();const offset=events.length;
    await command({type:'prompt',message:'Active experimental mode: '+mode+'. Work only in this task directory. '+contracts});
    await wait(()=>events.slice(offset).find(e=>e.type==='agent_settled'),'agent settled');settledAt=Date.now();
    const bad=events.slice(offset).find(e=>e.type==='message_end'&&e.message?.role==='assistant'&&e.message?.stopReason==='error');
    if(bad)throw new Error(bad.message.errorMessage??'Provider failure');
  }catch(e){error=e.message;append(rpcPath,'attempt_error',{error});}
  finally{
    child.stdin.end();let deadline=Date.now()+5000;while(exitCode===undefined&&Date.now()<deadline)await sleep(25);
    if(exitCode===undefined){child.kill('SIGTERM');deadline=Date.now()+3000;while(exitCode===undefined&&Date.now()<deadline)await sleep(25);}
    if(exitCode===undefined)child.kill('SIGKILL');
    // Only the process group created for this run; never touch another agent's Pi or board.
    try{process.kill(-child.pid,'SIGTERM');append(rpcPath,'owned_process_group_cleanup',{pid:child.pid});}catch(e){if(e.code!=='ESRCH')append(rpcPath,'cleanup_error',{error:e.message});}
    if(existsSync(join(configDir,'auth.json')))unlinkSync(join(configDir,'auth.json'));
  }
  const tests=await checkWork(work),supplemental=await checkSupplementalWork(work);
  // Use the copied fixture's exported trusted test source for correctness.
  const trusted=await import('file://'+join(ownRuntime,'fixture.mjs'));tests.publicTestsUnmodified=readFileSync(join(work,'public.test.mjs'),'utf8')===trusted.publicTests;
  const feed=jsonl(join(run,'feed.jsonl')),notices=jsonl(join(run,'notifications.jsonl'));
  const report=existsSync(join(run,'expected-report.json'))?readJson(join(run,'expected-report.json')):null;
  const release=report?verifyRelease(work,report):{passed:false,errors:['producer report unavailable']};
  const {PilotLedger}=await import('file://'+join(runtime,'meter.mjs'));const accounting=new PilotLedger(ledger,{scope:'explorer',scopeCap:2,globalCap:10});const usage=accounting.summary(id);accounting.close();
  const published=feed.find(e=>e.type==='report_published');
  const exposure=notices.find(e=>e.type==='context_snapshot'&&e.active?.some(n=>n.source==='external-corpus-auditor'));
  const exposures=notices.filter(e=>e.type==='context_snapshot'&&e.active?.some(n=>n.source==='external-corpus-auditor'));
  const consequence=feed.find(e=>e.type==='release_artifact_observed'&&e.afterPublication&&(kind==='compatibility'?e.deploymentCorrect:e.releaseCorrect));
  const checked=feed.filter(e=>e.type==='first_test_pass');
  const taskCorrect=!error&&tests.passed&&tests.publicTestsUnmodified&&release.passed&&supplemental.passed;
  const channelValid=mode!=='N'||(feed.some(e=>e.type==='report_ingress'&&e.status===201)&&!!exposure);
  const toolStarts=feed.filter(e=>e.type==='tool_start'),toolCounts=Object.fromEntries([...new Set(toolStarts.map(e=>e.name))].map(name=>[name,toolStarts.filter(e=>e.name===name).length]));
  const lastWork=feed.filter(e=>e.type==='work_checkpoint');
  const prematureAwait=feed.filter(e=>e.type==='await_update_start').filter(e=>{
    const checkpoint=lastWork.filter(c=>c.monoMs<=e.monoMs).at(-1);
    return !checkpoint?.passed;
  });
  const checks=feed.filter(e=>e.type==='get_updates');let emptyStreak=0;const pollingViolations=[];
  for(let i=1;i<checks.length;i++){
    if(checks[i-1].count===0){const required=[2000,4000,8000,16000,30000][Math.min(emptyStreak++,4)],elapsed=checks[i].monoMs-checks[i-1].monoMs;
      if(elapsed+1<required)pollingViolations.push({prior:checks[i-1].monoMs,next:checks[i].monoMs,elapsed,required});
    }else emptyStreak=0;
  }
  const schedulingValid=mode==='N'?prematureAwait.length===0:mode==='PA'?pollingViolations.length===0:true;
  const result={id,mode,kind,seed,error:error??null,passed:taskCorrect&&channelValid,taskCorrect,channelValid,
    scheduling:{valid:schedulingValid,notificationRegime:mode==='N'?(feed.some(e=>e.type==='await_update_start')?'hybrid':'context-only'):null,
      awaitBeforeLastVerifiedPublicCompletion:prematureAwait.length,pollingViolations,
      limitation:'Last observed public checkpoint is a conservative proxy for remaining implementation; CLI/docs can still remain.'},
    actualDefault:{id:resolvedModel?.model?.id,provider:resolvedModel?.model?.provider,thinkingLevel:resolvedModel?.thinkingLevel},timing:{startupMs:promptAt?promptAt-started:null,
      usefulTurnMs:promptAt&&settledAt?settledAt-promptAt:null,totalMs:Date.now()-started,targetMinutes:10},usage,
    work:{testsPassed:tests.passedTests,testsFailed:tests.failedTests,publicTestsUnmodified:tests.publicTestsUnmodified,
      milestoneCount:checked.length,milestonesBeforePublication:published?checked.filter(e=>e.monoMs<=published.monoMs).length:null,
      milestonesAfterPublication:published?checked.filter(e=>e.monoMs>published.monoMs).length:null},
    tools:{total:toolStarts.length,byName:toolCounts,mcpCalls:0,prematureAwaitCalls:mode==='N'?prematureAwait.length:null},
    events:{published:published??null,firstExposure:exposure??null,firstConsequence:consequence??null,
      exposureLatencyMs:published&&exposure?exposure.monoMs-published.monoMs:null,consequenceLatencyMs:published&&consequence?consequence.monoMs-published.monoMs:null,
      getUpdates:feed.filter(e=>e.type==='get_updates').length,awaitCalls:feed.filter(e=>e.type==='await_update_start').length,
      exposureCount:exposures.length,reinjections:Math.max(0,exposures.length-1),localProducerNotifyPosts:feed.filter(e=>e.type==='report_ingress').length,
      received:notices.filter(e=>e.type==='notification_received').length,dismissed:notices.filter(e=>e.type==='notification_dismissed').length,
      sourceToolKind:'native custom tools; zero MCP calls'},release,tests,supplemental};
  writeFileSync(join(run,'summary.json'),JSON.stringify(result,null,2));
  return result;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [runtime,ledger,mode,kind,seed,goReceipt]=process.argv.slice(2);if(!goReceipt)throw new Error('Usage: node run.mjs runtime ledger N|PA|W compatibility|status seed root-go-receipt.json');
  const result=await runCase({runtime:resolve(runtime),ledger:resolve(ledger),mode,kind,seed:Number(seed),goReceipt:resolve(goReceipt)});
  console.log(JSON.stringify({id:result.id,passed:result.passed,error:result.error,timeMs:result.timing.usefulTurnMs,estimatedUsd:result.usage.estimatedUsd,unknownReservedUsd:result.usage.unknownReservedUsd}));
}
