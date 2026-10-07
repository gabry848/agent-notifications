import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { generate, roles } from './generate.mjs';
import { prompt } from './prompt.mjs';
import { verify } from './oracle.mjs';
import { startDefaultPi } from '../adapter/frozen/pi-runtime.mjs';
import { PilotLedger } from '../adapter/frozen/meter.mjs';

const directory=import.meta.dirname,adapter=resolve(directory,'../adapter/frozen');
const root=resolve(directory,'../../..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const stamp=()=>({time:new Date().toISOString(),monoMs:Number(process.hrtime.bigint())/1e6});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const readLines=path=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];
const save=(path,data)=>writeFileSync(path,JSON.stringify(data,null,2));
const gatePath=process.env.SUITE_GO_FILE??join(directory,'GO.json');
if(!existsSync(gatePath))throw Error('GO file absent: no Pi/server execution allowed yet');
const gate=JSON.parse(readFileSync(gatePath,'utf8'));
if(gate.authorized!==true||gate.scope!=='suite'||gate.maxGroups>3||gate.maxPiSessions>9)throw Error('Invalid suite GO');
for(const [path,hash] of Object.entries(gate.sourceHashes??{}))if(sha(resolve(root,path))!==hash)throw Error('Frozen source mismatch: '+path);
const frozen=JSON.parse(readFileSync(join(directory,'suite-frozen.json'),'utf8'));
for(const [path,hash] of Object.entries(frozen.sourceHashes))if(sha(join(directory,path))!==hash)throw Error('Workload changed after freeze: '+path);
const ledgerPath=resolve(gate.ledgerPath);if(!gate.ledgerPath)throw Error('Shared ledger path required');
const measuredMode=process.argv[2];
if(!frozen.modes.includes(measuredMode))throw Error('Specify exactly one preregistered mode PA/N/W');
const group=join(directory,'traces',`group-${measuredMode}`);
if(existsSync(group))throw Error('Attempt directory already exists; never overwrite measured attempts');
mkdirSync(group,{recursive:true});
const work=join(group,'work');generate(work);
const project=`notification-suite-${measuredMode}-${randomUUID()}`;
const actors=Object.fromEntries(roles.map(r=>[r,`${measuredMode}-${r}`]));
const immutablePaths=['package.json','README.md','dataset.jsonl',...roles.flatMap(r=>[`docs/${r}.md`,`test/${r}.test.mjs`]),'test/integration.test.mjs'];
const baselineHashes=Object.fromEntries(immutablePaths.map(p=>[p,sha(join(work,p))]));
save(join(group,'baseline.json'),{project,actors,mode:measuredMode,baselineHashes,gate,workload:frozen.id,...stamp()});
const readyFile=join(group,'coordinator-ready.json'),serverTrace=join(group,'coordinator.jsonl');
const server=spawn('python3',[join(adapter,'coordinator_server.py'),'--database',join(group,'coordinator.sqlite'),'--ready',readyFile,'--trace',serverTrace],{stdio:['ignore','pipe','pipe']});
server.stdout.on('data',b=>appendFileSync(join(group,'coordinator.stdout'),b));server.stderr.on('data',b=>appendFileSync(join(group,'coordinator.stderr'),b));
let serverExited=false;server.on('exit',()=>{serverExited=true;});
const participants=[],errors=[],triggered=new Set();let monitorBusy=false,monitor,serial=0;
const harnessTrace=join(group,'harness.jsonl');
const log=(type,data={})=>appendFileSync(harnessTrace,JSON.stringify({...stamp(),type,...data})+'\n');
const start=stamp();let endpoint,producerKey;
async function callTool(name,args){
  const response=await fetch(endpoint+'/rpc',{method:'POST',headers:{'Content-Type':'application/json',...(name==='publish_update'?{'X-Coordinator-Producer-Token':producerKey}:{})},body:JSON.stringify({jsonrpc:'2.0',id:'suite-harness-'+(++serial),method:'tools/call',params:{name,arguments:args}}),signal:AbortSignal.timeout(10000)});
  const body=await response.json();if(!response.ok||body.error||body.result?.isError)throw Error('Harness tool '+name+': '+JSON.stringify(body));
  return JSON.parse(body.result.content.find(x=>x.type==='text').text);
}
async function publish(kind,payload,targets){
  const value=await callTool('publish_update',{project,targets,kind,payload,producerId:'suite-diagnostics',revision:1});log('external_fact_published',{kind,payload,targets,result:value});
}
async function observe(){
  if(monitorBusy)return;monitorBusy=true;
  try{
    for(const p of participants){
      const rows=readLines(p.telemetryPath);
      if(p.role==='view'&&!triggered.has('contract')&&rows.some(r=>r.type==='tool_finish'&&r.changes?.some(c=>c.path==='src/pipeline/view.mjs'))){
        triggered.add('contract');await publish('contract',{maxMessageChars:192,description:'Verified context rendering policy revision: maximum message text 192 UTF-16 code units.'},[actors.view]);
        await publish('noise',{description:'Cafeteria availability changed. Unrelated to this project; no action required.'},Object.values(actors));
      }
      if(!triggered.has('receipt')&&rows.some(r=>r.type==='tool_finish'&&r.name==='bash'&&r.args.command?.includes('--test')&&r.args.command?.includes(p.role)&&/fail\s+0\b/.test((r.content??[]).join('\n')))){
        triggered.add('receipt');const diagnosticPath=join(group,'diagnostic.json');
        execFileSync(process.execPath,[join(directory,'diagnostic.mjs'),join(work,'dataset.jsonl'),diagnosticPath]);
        const diagnostic=JSON.parse(readFileSync(diagnosticPath,'utf8'));await publish('receipt',{...diagnostic,description:'Dataset receipt for final handoff only; does not change implementation.'},Object.values(actors));
      }
    }
  }catch(e){errors.push({stage:'producer',error:e.message,...stamp()});log('producer_error',{error:e.message});}
  finally{monitorBusy=false;}
}
let result;
try{
  const readyDeadline=Date.now()+15000;while(!existsSync(readyFile)){if(serverExited||Date.now()>readyDeadline)throw Error('Coordinator startup failed');await pause(25);}
  const serverReady=JSON.parse(readFileSync(readyFile,'utf8'));endpoint=serverReady.url;
  producerKey=readFileSync(serverReady.producerKeyFile,'utf8').trim();
  for(const role of roles){
    const own=join(group,role);mkdirSync(own);const id=randomUUID();
    const env={PILOT_SESSION_ID:id,PILOT_LEDGER:ledgerPath,PILOT_RUN_ID:`suite-${measuredMode}-${role}`,PILOT_SCOPE:'suite',PILOT_SCOPE_CAP:String(gate.scopeCapUsd??6),PILOT_GLOBAL_CAP:'10',PILOT_METER_TRACE:join(own,'meter.jsonl'),
      PILOT_ACTOR:actors[role],PILOT_COORDINATOR_PROJECT:project,PILOT_COORDINATOR_ENDPOINT:endpoint,PILOT_COORDINATOR_TRACE:join(own,'mcp.jsonl'),PILOT_COORDINATOR_CURSOR:'0',
      PI_NOTIFY_CONTEXT:measuredMode==='N'?'1':'0',PI_NOTIFY_READY:join(own,'ready.json'),PI_NOTIFY_DB:join(own,'notifications.sqlite'),PI_NOTIFY_TRACE:join(own,'notifications.jsonl'),PI_NOTIFY_PROMPT:join(adapter,'transport/prompt-v3.txt'),PI_NOTIFY_PORT:'0',
      SUITE_WORK:work,SUITE_ROLE:role,SUITE_TRACE:join(own,'telemetry.jsonl')};
    const tools=['read','edit','write','bash','grep','find','ls','list_activities','upsert_activity','start_activity','update_activity','finish_activity','post_message','list_messages','check_conflicts','get_updates','await_next',...(measuredMode==='N'?['notifications_dismiss','notifications_history']:[])];
    const pi=startDefaultPi({work,configDir:join(own,'config'),env,eventsPath:join(own,'rpc.jsonl'),extraExtensions:[join(adapter,'coordinator-extension.ts'),join(directory,'telemetry.ts')],tools,timeoutMs:900000});
    const p={role,pi,directory:own,telemetryPath:env.SUITE_TRACE,runId:env.PILOT_RUN_ID,sessionId:id,start:stamp()};participants.push(p);
    await pi.waitReady();const state=await pi.command({type:'get_state'});save(join(own,'resolved.json'),{state,args:pi.args,config:pi.config,ready:pi.ready()});
    if(state.model?.id!==gate.model||state.model?.provider!==gate.provider)throw Error('Resolved default model mismatch; no prompt issued');
  }
  monitor=setInterval(observe,100);
  // One initial prompt each. No follow-up user prompts or event wakeups.
  await Promise.allSettled(participants.map(async p=>{
    const text=prompt({role:p.role,mode:measuredMode,project,actors,toolPrefix:''});writeFileSync(join(p.directory,'prompt.txt'),text);p.promptStart=stamp();
    try{await p.pi.prompt(text);p.promptEnd=stamp();p.ok=true;}catch(e){p.promptEnd=stamp();p.ok=false;p.error=e.message;errors.push({stage:'pi',role:p.role,error:e.message,...stamp()});}
    await observe();
  }));
  await observe();
  const oracle=await verify(work);
  const immutable=Object.fromEntries(immutablePaths.map(p=>[p,existsSync(join(work,p))&&sha(join(work,p))===baselineHashes[p]]));
  const activities=await callTool('list_activities',{project,include_done:true,include_details:true});
  result={mode:measuredMode,project,start,end:stamp(),oracle,immutableFiles:immutable,allImmutablePreserved:Object.values(immutable).every(Boolean),activities,producerTriggers:[...triggered],errors,
    participants:participants.map(p=>({role:p.role,runId:p.runId,sessionId:p.sessionId,start:p.start,promptStart:p.promptStart,promptEnd:p.promptEnd,ok:p.ok,error:p.error})),
    attributionLimits:['Three agents share machine/provider resources. One group per mode.','Telemetry changes between tool results may include another actor edit; exact tool arguments and source history must be checked for actor attribution.','This is a real implementation fixture, not production compile/CI and not an artificially timed 10-minute job.']};
}catch(e){errors.push({stage:'group',error:e.message,...stamp()});result={mode:measuredMode,project,start,end:stamp(),errors,incomplete:true};}
finally{
  clearInterval(monitor);while(monitorBusy)await pause(25);
  await Promise.allSettled(participants.map(p=>p.pi.stop()));
  server.kill('SIGTERM');const deadline=Date.now()+5000;while(!serverExited&&Date.now()<deadline)await pause(25);if(!serverExited)server.kill('SIGKILL');
  const ledger=new PilotLedger(ledgerPath,{scope:'suite',scopeCap:gate.scopeCapUsd??6,globalCap:10});
  result.usage=Object.fromEntries(participants.map(p=>[p.role,ledger.summary(p.runId)]));ledger.close();
  result.cleanup={serverExited,piExitCodes:Object.fromEntries(participants.map(p=>[p.role,p.pi.exitCode])),finishedAt:stamp()};
  save(join(group,'summary.json'),result);
}
console.log(JSON.stringify({mode:measuredMode,group,passed:result.oracle?.passed&&result.allImmutablePreserved,errors:result.errors,costs:Object.fromEntries(Object.entries(result.usage).map(([k,u])=>[k,{estimated:u.estimatedUsd,unknown:u.unknownReservedUsd,attempts:u.attempts}]))},null,2));
