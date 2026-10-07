import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
const exec=promisify(execFile), campaign=resolve(import.meta.dirname,'..');
const mode=process.argv[2], group=join(campaign,'suite/traces','group-'+mode);
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const lines=path=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse):[];
const readDB=path=>new DatabaseSync(path,{readOnly:true});
if(!existsSync(join(group,'summary.json')))throw new Error('Group has no final summary yet');
const summary=json(join(group,'summary.json')),baseline=json(join(group,'baseline.json'));
const output=join(import.meta.dirname,'group-'+mode+'-supplemental.json');
let supplemental;
try {await exec(process.execPath,[join(import.meta.dirname,'supplemental-oracle.mjs'),join(group,'work'),output],{maxBuffer:200000});
  supplemental=json(output);
}catch(e){supplemental=existsSync(output)?json(output):{passed:false,errors:[e.message]};}
const ledgerSummary=json(join(import.meta.dirname,'usage-reconciliation.json'));
const board=readDB(join(group,'coordinator.sqlite'));
const tables=board.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
const events=board.prepare('SELECT * FROM events ORDER BY sequence').all();
const subscriptions=board.prepare('SELECT * FROM subscriptions').all();
const deliveries=board.prepare('SELECT state,COUNT(*) AS count FROM deliveries GROUP BY state').all();
const activities=board.prepare('SELECT * FROM activities').all();board.close();
const owners=Object.fromEntries(events.filter(e=>e.kind==='activity'&&e.revision===1).map(e=>[e.entity_id,e.actor]));
const coordinator=lines(join(group,'coordinator.jsonl'));
const mutations=coordinator.filter(r=>r.type==='tool_call'&&['upsert_activity','start_activity','update_activity','finish_activity','post_message'].includes(r.name));
const wrongOwners=mutations.filter(r=>r.arguments?.activity_id&&owners[r.arguments.activity_id]&&owners[r.arguments.activity_id]!==r.arguments.actor);
const wrongActors=mutations.filter(r=>r.arguments?.actor&&!Object.values(baseline.actors).includes(r.arguments.actor));
const actorResults=[];
for(const participant of summary.participants??[]) {
  const role=participant.role, own=join(group,role), telemetry=lines(join(own,'telemetry.jsonl'));
  const notify=lines(join(own,'notifications.jsonl')),meter=lines(join(own,'meter.jsonl')),mcp=lines(join(own,'mcp.jsonl'));
  const starts=telemetry.filter(r=>r.type==='tool_start'),finishes=telemetry.filter(r=>r.type==='tool_finish');
  const directEdits=starts.filter(r=>['write','edit'].includes(r.name)).map(r=>{
    const path=resolve(join(group,'work'),r.args.path);
    return {time:r.time,name:r.name,path,relative:path.slice(resolve(join(group,'work')).length+1),toolCallId:r.toolCallId};
  });
  const foreignDirectEdits=directEdits.filter(r=>['ingest','delivery','view'].some(other=>other!==role&&(
    r.relative===`src/pipeline/${other}.mjs`||r.relative===`results/${other}.json`||r.relative.startsWith(`test/${other}.`))));
  const outsideEdits=directEdits.filter(r=>!r.path.startsWith(resolve(join(group,'work'))+'/'));
  const sharedEdits=directEdits.filter(r=>['src/index.mjs','docs/handoff.md'].includes(r.relative)).map(r=>{
    const prior=starts.filter(s=>s.monoMs<=telemetry.find(t=>t.toolCallId===r.toolCallId&&t.type==='tool_start').monoMs);
    const conflict=prior.filter(s=>s.name==='check_conflicts'&&s.args.files?.includes(r.relative)).at(-1);
    const read=prior.filter(s=>s.name==='read'&&s.args.path===r.relative).at(-1);
    return {...r,priorConflictCheck:conflict?.time??null,priorRead:read?.time??null,
      limit:'Presence of a previous check is observable; reservation freshness/overlap still requires trace review.'};
  });
  const exposures=notify.filter(r=>r.type==='context_snapshot').flatMap(r=>(r.active??[]).map(n=>({time:r.time,id:n.id,message:n.message})));
  const received=notify.filter(r=>r.type==='notification_received');
  const notifyDb=readDB(join(own,'notifications.sqlite'));
  const notifications=notifyDb.prepare('SELECT * FROM notifications').all();notifyDb.close();
  const namespaceLeak=notifications.some(n=>n.session_id!==participant.sessionId);
  const settled=ledgerSummary.runs.find(r=>r.runId===participant.runId);
  const polling=[];let delayIndex=0;
  for(const current of starts.filter(r=>r.name==='get_updates')) {
    const prior=finishes.filter(r=>r.name==='get_updates'&&r.monoMs<current.monoMs).at(-1);
    if(!prior)continue;
    const text=prior.content?.join('\n');let result;
    try{result=JSON.parse(text);}catch{}
    if(result?.count===0){const required=[2,4,8,16,30][Math.min(delayIndex,4)]*1000;const elapsed=current.monoMs-prior.monoMs;
      polling.push({time:current.time,elapsedMs:elapsed,requiredMs:required,passed:elapsed>=required});delayIndex++;
    }else delayIndex=0;
  }
  const sdk=meter.filter(r=>r.type==='pi_message_usage').map(r=>r.usage);
  const tokenTotals=Object.fromEntries(['input','output','cacheRead','cacheWrite','totalTokens'].map(k=>[k,sdk.reduce((s,u)=>s+(u[k]??0),0)]));
  const firstSubmission=finishes.find(r=>r.changes?.some(c=>c.path===`results/${role}.json`));
  const rolePath=`src/pipeline/${role}.mjs`;
  let roleHash=telemetry.find(r=>r.type==='session_started')?.baseline?.[rolePath]?.hash;
  const overlappingVerificationCalls=[],uniqueVerifiedVersions=new Map();
  for(const finish of finishes) {
    for(const change of finish.changes??[])if(change.path===rolePath)roleHash=change.hash;
    if(finish.name!=='bash'||!finish.args.command?.includes('--test')||!finish.args.command?.includes(role)||!/fail\s+0\b/.test((finish.content??[]).join('\n')))continue;
    const peers=(summary.participants??[]).filter(peer=>peer.role!==role&&peer.promptStart&&Date.parse(peer.promptStart.time)<=Date.parse(finish.time)&&(!peer.promptEnd||Date.parse(peer.promptEnd.time)>Date.parse(finish.time))).map(p=>p.role);
    if(!peers.length)continue;
    const item={time:finish.time,roleHash,command:finish.args.command,openPeerTurns:peers};
    overlappingVerificationCalls.push(item);
    if(roleHash&&!uniqueVerifiedVersions.has(roleHash))uniqueVerifiedVersions.set(roleHash,item);
  }
  actorResults.push({role,runId:participant.runId,resolvedDefault:json(join(own,'resolved.json')).state.model?.id,
    provider:json(join(own,'resolved.json')).state.model?.provider,
    turnMs:participant.promptStart&&participant.promptEnd?Date.parse(participant.promptEnd.time)-Date.parse(participant.promptStart.time):null,
    firstSubmissionMs:firstSubmission&&participant.promptStart?Date.parse(firstSubmission.time)-Date.parse(participant.promptStart.time):null,
    directEdits,foreignDirectEdits,outsideEdits,sharedEdits,
    notificationContextPresent:notify.some(r=>r.type==='context_snapshot'),notificationsReceived:received.length,
    notificationExposures:exposures.length,uniqueNotificationsExposed:new Set(exposures.map(e=>e.id)).size,
    reinjections:exposures.length-new Set(exposures.map(e=>e.id)).size,
    activeNotifications:notifications.filter(n=>n.dismissed_at==null).length,namespaceLeak,
    getUpdatesCalls:starts.filter(r=>r.name==='get_updates').length,listMessagesCalls:starts.filter(r=>r.name==='list_messages').length,
    awaitCalls:starts.filter(r=>r.name==='await_next').length,checkConflictsCalls:starts.filter(r=>r.name==='check_conflicts').length,
    listActivitiesCalls:starts.filter(r=>r.name==='list_activities').length,allToolCalls:starts.length,
    mcpModelToolCalls:mcp.filter(r=>r.type==='mcp_tool_call').length,
    pollingIntervals:polling,pollingIntervalViolations:polling.filter(r=>!r.passed).length,
    accountingConsistent:settled?.accountingConsistent??false,unsettledCount:settled?.unsettledCount??null,
    estimatedApiEquivalentUsd:summary.usage?.[role]?.estimatedUsd,unknownReservedApiEquivalentUsd:summary.usage?.[role]?.unknownReservedUsd,
    tokens:tokenTotals,authLinkStillPresent:existsSync(join(own,'config/auth.json')),
    overlappingRoleVerificationCalls:overlappingVerificationCalls,
    uniqueRoleSourceVersionsVerifiedDuringPeerTurn:[...uniqueVerifiedVersions.values()],
    limitations:['Bash modifications require manual command review; direct file tool scope is checked here.','A prior conflict check is not an atomic file lock.','Overlap deduplicates by role module source hash, conservatively ignoring distinct new tests on identical implementation. It proves useful verification while a peer turn is open, not continuous peer computation or external long-job overlap.']});
}
const immutable=Object.entries(baseline.baselineHashes).map(([path,hash])=>({path,
  matches:existsSync(join(group,'work',path))&&createHash('sha256').update(readFileSync(join(group,'work',path))).digest('hex')===hash}));
let extraTests;
const testFiles=readdirSync(join(group,'work/test')).filter(name=>name.endsWith('.additional.test.mjs')).map(name=>'test/'+name);
if(!testFiles.length)extraTests={passed:true,files:[],note:'Task permits no added tests when unwarranted; review agent justification separately.'};
else try{const result=await exec(process.execPath,['--test',...testFiles],{cwd:join(group,'work'),timeout:30000,maxBuffer:200000});
  extraTests={passed:true,files:testFiles,stdout:result.stdout};}catch(e){extraTests={passed:false,files:testFiles,stdout:e.stdout,stderr:e.stderr,error:e.message};}
const allSettled=actorResults.every(r=>r.accountingConsistent&&r.unsettledCount===0);
const taskCorrect=!!summary.oracle?.passed&&immutable.every(r=>r.matches)&&supplemental.passed&&extraTests.passed;
const allTurnsCompleted=(summary.participants??[]).length===3&&(summary.participants??[]).every(p=>p.ok===true)&&!(summary.errors??[]).length;
const result={auditedAt:new Date().toISOString(),mode,group,newModelCalls:0,taskCorrect,
  artifactOraclePassed:taskCorrect,allTurnsCompleted,eligibleForEfficiencyComparison:taskCorrect&&allTurnsCompleted&&allSettled,
  interruptionKind:summary.errors?.some(e=>e.error?.includes('conservative reservation'))?'local-reservation-guard':null,
  allUsageReconciled:allSettled,
  supplemental,extraTests,immutable,actorResults,wrongOwners,wrongActors,
  board:{tables,eventCount:events.length,activeSubscriptions:subscriptions.filter(s=>s.active===1).length,deliveries,
    activeActivities:activities.filter(a=>!['done','abandoned'].includes(a.status)).map(a=>({id:a.id,agent:a.agent,status:a.status}))},
  originalCleanup:summary.cleanup,regimeViolations:actorResults.flatMap(a=>[
    ...(mode!=='N'&&a.notificationContextPresent?[{role:a.role,kind:'baseline_notification_context_enabled'}]:[]),
    ...(mode==='N'&&(a.getUpdatesCalls||a.listMessagesCalls)?[{role:a.role,kind:'notification_mode_retrieval_calls',getUpdates:a.getUpdatesCalls,listMessages:a.listMessagesCalls}]:[]),
    ...(mode==='PA'&&a.pollingIntervalViolations?[{role:a.role,kind:'polling_intervals',count:a.pollingIntervalViolations}]:[]),
  ]),limitations:['One group per mode: exploratory, not statistical confirmation.','Runtime duration is observed, not padded to target ten minutes.','Await timing and shared-edit changes need manual causal review.','Actual subscription billing unknown; estimates include all measured attempts.']};
writeFileSync(join(import.meta.dirname,'group-'+mode+'-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({mode,taskCorrect,allUsageReconciled:allSettled,supplementalPassed:supplemental.passed,
  extraTestsPassed:extraTests.passed,wrongOwners:wrongOwners.length,wrongActors:wrongActors.length,
  activeSubscriptions:result.board.activeSubscriptions,activeActivities:result.board.activeActivities,
  regimeViolations:result.regimeViolations,actors:actorResults.map(({directEdits,sharedEdits,pollingIntervals,...a})=>a)}));
