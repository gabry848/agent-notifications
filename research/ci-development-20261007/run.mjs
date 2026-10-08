import {mkdirSync,readFileSync,writeFileSync,existsSync,cpSync,appendFileSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {startDefaultPi} from './pi-runtime.mjs';
import {CIEngine,stamp,sha} from './ci-engine.mjs';
const base=import.meta.dirname,root=resolve(base,'../..');
const[stage,pair,mode]=process.argv.slice(2);
if(process.env.CI_INFERENCE_GO!=='1')throw Error('Root scheduling GO required before any inference');
if(!['calibration','measured'].includes(stage)||!/^p\d\d$/.test(pair)||!['N','PA'].includes(mode))throw Error('Usage: run.mjs calibration|measured p01 N|PA');
const frozen=JSON.parse(readFileSync(join(base,'frozen.json'),'utf8'));
for(const[path,hash]of Object.entries(frozen.hashes))if(sha(readFileSync(resolve(root,path)))!==hash)throw Error('Frozen source mismatch '+path);
const dir=join(base,'runs',`${stage}-${pair}-${mode}`);if(existsSync(dir))throw Error('Attempt exists; never overwrite');mkdirSync(dir,{recursive:true});
const work=join(dir,'work');cpSync(join(base,'scaffold'),work,{recursive:true});
const immutable=Object.fromEntries(['README.md','package.json','test/smoke.test.mjs'].map(p=>[p,sha(readFileSync(join(work,p)))]));
const initialPrompt='Complete Package Catalog according to README.md. Keep its immutable specification/package/existing tests unchanged. CI runs automatically against immutable source snapshots; ci_status returns current revision status and batched new results, ci_wait waits. Results may arrive as external runtime notifications. Use the same work-first strategy: implement useful independent features while checks run, query status adaptively when it helps, and wait only after useful work is exhausted. Resolve failures for current source revisions; avoid acting twice on stale results. Write meaningful additional tests and USAGE.md. Before finishing, run the complete local tests and confirm all latest current-revision CI groups have passed. Work autonomously with one initial prompt.';
writeFileSync(join(dir,'prompt.txt'),initialPrompt);
const env={CI_RUN_DIR:dir,CI_WORK:work,PILOT_SESSION_ID:randomUUID(),PI_NOTIFY_CONTEXT:mode==='N'?'1':'0',PI_NOTIFY_READY:join(dir,'notify-ready.json'),PI_NOTIFY_DB:join(dir,'notifications.sqlite'),PI_NOTIFY_TRACE:join(dir,'notifications.jsonl'),PI_NOTIFY_PROMPT:join(base,'notification-prompt.txt'),PI_NOTIFY_PORT:'0',CACHE_NOTIFICATION_EXTENSION:join(root,'src/pi-extension.ts')};
let ready,pi,monitor,lastTools=0,start,end,beforeDrain,error,stats,final,verifiedEnd;
const log=(type,data={})=>appendFileSync(join(dir,'harness.jsonl'),JSON.stringify({...stamp(),type,...data})+'\n');
const engine=new CIEngine({work,dir,publish:async event=>{if(mode==='N'){const response=await fetch(ready.url+'/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'CI',sessionId:ready.sessionId,message:JSON.stringify(event)}),signal:AbortSignal.timeout(10000)});const body=await response.json();if(!response.ok)throw Error('Notification publish failed '+response.status);log('notification_published',{jobId:event.jobId,response:body});}}});
const lines=path=>existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];
try{
 pi=startDefaultPi({work,configDir:join(dir,'config'),env,eventsPath:join(dir,'rpc.jsonl'),extraExtensions:[join(base,'extension.ts')],tools:['read','edit','write','bash','grep','find','ls','ci_status','ci_wait','notifications_dismiss','notifications_history'],timeoutMs:1800000});
 await pi.waitReady();ready=pi.ready();const state=await pi.command({type:'get_state'});writeFileSync(join(dir,'resolved.json'),JSON.stringify({state,args:pi.args,config:pi.config,ready},null,2));
 if(state.model?.provider!=='openai-codex'||state.model?.id!=='gpt-6.1-sol'||state.thinkingLevel!=='medium')throw Error('Installed defaults changed, no inference issued');
 monitor=setInterval(()=>{try{const count=lines(join(dir,'telemetry.jsonl')).filter(r=>r.type==='tool_finish').length;if(count!==lastTools){lastTools=count;engine.observe();}}catch(e){log('monitor_error',{error:String(e)});}},100);
 start=stamp();engine.start();log('prompt_start',{stage,pair,mode,start});await pi.prompt(initialPrompt);end=stamp();beforeDrain=engine.save();stats=await pi.command({type:'get_session_stats'});log('prompt_settled',{end,stats});final=spawnSync(process.execPath,[join(base,'oracle.mjs'),work,'all'],{encoding:'utf8',timeout:60000});verifiedEnd=stamp();
}catch(e){error=String(e);end=stamp();beforeDrain=engine.save();log('run_error',{error});}
finally{clearInterval(monitor);await pi?.stop();await engine.settle(105000);engine.stop();}
if(!final){final=spawnSync(process.execPath,[join(base,'oracle.mjs'),work,'all'],{encoding:'utf8',timeout:60000});verifiedEnd=stamp();}writeFileSync(join(dir,'final-oracle.stdout'),final.stdout??'');writeFileSync(join(dir,'final-oracle.stderr'),final.stderr??'');let oracle;try{oracle=JSON.parse(final.stdout.trim().split('\n').at(-1));}catch{oracle={passed:false,error:final.stderr||'oracle produced no JSON'};}
const unchanged=Object.fromEntries(Object.entries(immutable).map(([p,h])=>[p,existsSync(join(work,p))&&sha(readFileSync(join(work,p)))===h]));
const latest=engine.save().latest,latestAtSettle=beforeDrain?.latest??{};
const allGreenAtSettle=Object.keys(latestAtSettle).length===9&&Object.values(latestAtSettle).every(j=>j.status==='passed');
const summary={stage,pair,mode,start,end,agentWallMs:start?end.monoMs-start.monoMs:null,fullVerifiedWallMs:start?verifiedEnd.monoMs-start.monoMs:null,wallMs:start?verifiedEnd.monoMs-start.monoMs:null,verifiedEnd,error,oracle,immutable:unchanged,latestAtSettle,latestAfterDrain:latest,correct:!error&&oracle.passed&&Object.values(unchanged).every(Boolean)&&allGreenAtSettle,piExitCode:pi?.exitCode,stats,frozenManifestHash:sha(readFileSync(join(base,'frozen.json'))),cleanup:stamp()};
writeFileSync(join(dir,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({dir,stage,pair,mode,correct:summary.correct,oracle:oracle.passed,wallMs:summary.wallMs,error,latestAtSettle},null,2));
