import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
const exec=promisify(execFile), campaign=resolve(import.meta.dirname,'..');
const id='explorer-compatibility-N-4101-847cae3a', run=join(campaign,'explorer/runs',id);
const summary=JSON.parse(readFileSync(join(run,'summary.json')));
const lines=path=>readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const rpc=lines(join(run,'rpc.jsonl'));
const cleanup=rpc.find(r=>r.type==='owned_process_group_cleanup');
let pidAlive=null,groupAlive=null;
if(cleanup?.pid){
  try{process.kill(cleanup.pid,0);pidAlive=true;}catch(e){pidAlive=e.code==='ESRCH'?false:null;}
  try{process.kill(-cleanup.pid,0);groupAlive=true;}catch(e){groupAlive=e.code==='ESRCH'?false:null;}
}
let ownedProcesses=null,processInspectionError;
try {
  const {stdout}=await exec('/bin/ps',['-axo','pid=,pgid=,args='],{maxBuffer:1000000});
  ownedProcesses=stdout.split('\n').filter(line=>line.includes(run)||line.includes('--session-id '+summary.events.firstExposure?.active?.[0]?.sessionId));
}catch(e){processInspectionError=e.message;}
const ready=JSON.parse(readFileSync(join(run,'ready.json')));
let endpointClosed=false;
try{await fetch(ready.url,{signal:AbortSignal.timeout(2000)});}catch(e){endpointClosed=e.cause?.code==='ECONNREFUSED';}
const copy=join(import.meta.dirname,'traces/explorer-calibration-demo');mkdirSync(copy,{recursive:true});
cpSync(join(run,'work/src'),join(copy,'src'),{recursive:true});
cpSync(join(run,'work/deployment.json'),join(copy,'deployment.json'));
cpSync(join(run,'work/package.json'),join(copy,'package.json'));
let demo;
try{const result=await exec(process.execPath,['src/cli.mjs','--demo'],{cwd:copy,timeout:15000,maxBuffer:100000});
  const output=result.stdout.split('\n').find(line=>line.startsWith('{'));
  const body=output?JSON.parse(output):null;
  demo={passed:body?.deliveries===1&&body.results?.length===1&&body.results[0]?.ok===true,
    exitCode:0,stdout:result.stdout,stderr:result.stderr,body};
}catch(e){demo={passed:false,exitCode:e.code,stdout:e.stdout,stderr:e.stderr,error:e.message};}
const db=new DatabaseSync(join(run,'notifications.sqlite'),{readOnly:true});
const notificationRows=db.prepare('SELECT * FROM notifications').all();db.close();
const active=notificationRows.filter(r=>r.dismissed_at==null);
const reconciliation=JSON.parse(readFileSync(join(import.meta.dirname,'usage-reconciliation.json'))).runs.find(r=>r.runId===id);
const auditTaskPassed=summary.tests.passed&&summary.tests.publicTestsUnmodified&&summary.release.passed&&
  summary.supplemental.readmePresent&&summary.supplemental.tests.passed&&demo.passed;
const cleanupLogErrors=rpc.filter(r=>r.type==='cleanup_error');
const ownedRuntimeStopped=ownedProcesses?.length===0&&endpointClosed&&cleanupLogErrors.length===0;
const checksPassed=auditTaskPassed&&summary.channelValid&&reconciliation?.accountingConsistent&&reconciliation.unsettledCount===0&&ownedRuntimeStopped&&active.length===0;
const result={auditedAt:new Date().toISOString(),id,newModelCalls:0,originalSummaryUnchanged:true,
  originalTaskPassed:summary.taskCorrect,originalPassed:summary.passed,independentTaskPassed:auditTaskPassed,
  checksPassed,parserIssue:'Static supplemental checker excluded src/ CLI candidates although task permits free organization; CLI behavioral check is separate evidence, not a rewritten original result.',
  demo,cleanup:{ownedPid:cleanup?.pid,pidAlive,groupAlive,ownedProcesses,processInspectionError,cleanupLogErrors,ownedRuntimeStopped,endpointClosed,activeNotifications:active.length,authLinkRemoved:!existsSync(join(run,'config/auth.json')),
    limit:'No PID cleanup line is emitted if the owned process group was already absent at final SIGTERM; process inventory is matched by the exact run path/session UUID and the receiver connection is checked independently.'},
  accounting:{consistent:reconciliation?.accountingConsistent,attempts:summary.usage.attempts,unknownReservedUsd:summary.usage.unknownReservedUsd,estimatedApiEquivalentUsd:summary.usage.estimatedUsd,actualSubscriptionBillingUsd:null},
  observed:{turnMs:summary.timing.usefulTurnMs,tenMinuteSession:false,publicMilestonesBeforeEvent:summary.work.milestonesBeforePublication,publicMilestonesAfterEvent:summary.work.milestonesAfterPublication,
    exposureLatencyMs:summary.events.exposureLatencyMs,artifactConsequenceLatencyMs:summary.events.consequenceLatencyMs,awaitCalls:summary.events.awaitCalls,getUpdates:summary.events.getUpdates},
  limits:['No paired efficiency conclusion from this single calibration.','All14 public milestones passed before publication; documentation/additional tests and CLI were subsequent real work.','Artifact consequence is a configuration/result write, not proof of earlier production request handling.']};
writeFileSync(join(import.meta.dirname,'explorer-calibration-check.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,demo:{passed:demo.passed,exitCode:demo.exitCode,error:demo.error}}));
if(!checksPassed)process.exitCode=1;
