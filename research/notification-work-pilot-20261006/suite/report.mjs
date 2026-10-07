import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const directory=import.meta.dirname;
const lines=path=>existsSync(path)?readFileSync(path,'utf8').split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)];}catch{return [];}}):[];
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const ms=s=>Date.parse(s);
const parseTexts=event=>(event.content??[]).flatMap(text=>{try{return [JSON.parse(text)];}catch{return [];}});
const groups=[];
for(const name of existsSync(join(directory,'traces'))?readdirSync(join(directory,'traces')).filter(n=>n.startsWith('group-')):[]){
  const folder=join(directory,'traces',name);if(!existsSync(join(folder,'summary.json')))continue;
  const summary=json(join(folder,'summary.json')),harness=lines(join(folder,'harness.jsonl'));
  const facts=harness.filter(r=>r.type==='external_fact_published');
  const participants=[];
  for(const p of summary.participants??[]){
    const own=join(folder,p.role),telemetry=lines(join(own,'telemetry.jsonl')),notify=lines(join(own,'notifications.jsonl')),mcp=lines(join(own,'mcp.jsonl')),meter=lines(join(own,'meter.jsonl'));
    const starts=telemetry.filter(r=>r.type==='tool_start'),finishes=telemetry.filter(r=>r.type==='tool_finish');
    const acquisitions=finishes.filter(r=>['get_updates','await_next','list_messages'].includes(r.name)).flatMap(r=>parseTexts(r).flatMap(body=>(body.updates??[]).map(e=>({event:e,time:r.time,kind:r.name}))));
    const exposures=notify.filter(r=>r.type==='context_snapshot').flatMap(r=>(r.active??[]).flatMap(n=>{try{return [{event:JSON.parse(n.message),time:r.time,kind:'context_notification'}];}catch{return [];}}));
    const eventMetrics=facts.filter(f=>f.targets.includes(`${summary.mode}-${p.role}`)).map(f=>{
      const eventId=f.result.event.eventId,producedAt=f.result.event.createdAt??f.time;
      const exposed=exposures.concat(acquisitions).filter(e=>e.event.eventId===eventId).sort((a,b)=>ms(a.time)-ms(b.time))[0];
      let action;
      if(f.kind==='contract')action=finishes.find(r=>ms(r.time)>=ms(producedAt)&&r.changes?.some(c=>c.path==='src/pipeline/view.mjs'&&/maxMessageChars\s*:\s*192/.test(c.content)));
      if(f.kind==='receipt')action=finishes.find(r=>ms(r.time)>=ms(producedAt)&&r.changes?.some(c=>c.path===`results/${p.role}.json`&&c.content.includes(f.payload.datasetSha256)));
      return {kind:f.kind,eventId,producedAt,producerAckAt:f.time,firstExposedAt:exposed?.time??null,exposureChannel:exposed?.kind??null,exposureMs:exposed?ms(exposed.time)-ms(producedAt):null,firstUsefulActionAt:action?.time??null,actionMs:action?ms(action.time)-ms(producedAt):null,classification:f.kind==='noise'?'no action required':f.kind==='receipt'?'end-only result recording':'implementation policy'};
    });
    const submission=finishes.find(r=>r.changes?.some(c=>c.path===`results/${p.role}.json`));
    const verifications=finishes.filter(r=>r.name==='bash'&&r.args.command?.includes('--test')&&r.args.command?.includes(p.role)&&/fail\s+0\b/.test((r.content??[]).join('\n')));
    const overlap=verifications.filter(r=>summary.participants.some(other=>other.role!==p.role&&other.promptStart&&ms(other.promptStart.time)<=ms(r.time)&&(!other.promptEnd||ms(other.promptEnd.time)>ms(r.time)))).map(r=>({time:r.time,command:r.args.command,proof:'role test command succeeded while another real Pi turn was still open',scope:'verified task work; turn overlap alone does not prove the peer was continuously computing'}));
    const usage=summary.usage?.[p.role],normalized=(usage?.rows??[]).map(r=>r.normalized_usage).filter(Boolean);
    const tokenTotals=Object.fromEntries(['input','output','cacheRead','cacheWrite','totalTokens','reasoning'].map(k=>[k,normalized.reduce((s,u)=>s+(u[k]??0),0)]));
    const sdk=meter.filter(r=>r.type==='pi_message_usage').map(r=>r.usage?.cost?.total).filter(Number.isFinite);
    const boardChecks=starts.filter(r=>['list_activities','check_conflicts'].includes(r.name)).length;
    const eventChecks=starts.filter(r=>['get_updates','list_messages'].includes(r.name)).length;
    const awaitCalls=starts.filter(r=>r.name==='await_next').length;
    participants.push({role:p.role,ok:p.ok,error:p.error,resolved:existsSync(join(own,'resolved.json'))?json(join(own,'resolved.json')).state.model:null,
      turnMs:p.promptStart&&p.promptEnd?ms(p.promptEnd.time)-ms(p.promptStart.time):null,firstSubmissionMs:p.promptStart&&submission?ms(submission.time)-ms(p.promptStart.time):null,
      modelHttpAttempts:usage?.attempts??0,modelLogicalRequests:meter.filter(r=>r.type==='logical_provider_request').length,tokens:tokenTotals,estimatedApiEquivalentUsd:usage?.estimatedUsd??0,unknownReservedApiEquivalentUsd:usage?.unknownReservedUsd??0,sdkNominalCostUsd:sdk.reduce((a,b)=>a+b,0),actualBillingUsd:null,
      tools:starts.length,mcpTools:mcp.filter(r=>r.type==='mcp_tool_call').length,boardChecks,eventChecks,awaitCalls,notificationDismiss:starts.filter(r=>r.name==='notifications_dismiss').length,notificationHistory:starts.filter(r=>r.name==='notifications_history').length,
      notificationsReceived:notify.filter(r=>r.type==='notification_received').length,notificationExposures:exposures.length,notificationUniqueExposures:new Set(exposures.map(e=>e.event.eventId)).size,notificationReinjections:exposures.length-new Set(exposures.map(e=>e.event.eventId)).size,notificationDismissed:notify.filter(r=>r.type==='notification_dismissed'&&r.found!==false).length,
      successfulRoleVerifications:verifications.length,verifiedOverlap:overlap,eventMetrics});
  }
  const sdkCost=participants.reduce((a,p)=>a+p.sdkNominalCostUsd,0);
  const sums=key=>participants.reduce((a,p)=>a+(p[key]??0),0);
  const participantsLast=summary.participants?.filter(p=>p.promptEnd).map(p=>ms(p.promptEnd.time))??[];
  const participantsFirst=summary.participants?.filter(p=>p.promptStart).map(p=>ms(p.promptStart.time))??[];
  groups.push({mode:summary.mode,workload:'concurrent-pipeline-3pi-v1',passed:!!summary.oracle?.passed&&!!summary.allImmutablePreserved&&!summary.errors?.length,taskOracle:summary.oracle?.passed??false,immutablePreserved:summary.allImmutablePreserved??false,errors:summary.errors,
    groupTurnMs:participantsLast.length&&participantsFirst.length?Math.max(...participantsLast)-Math.min(...participantsFirst):null,startupAndTurnMs:summary.start&&summary.end?ms(summary.end.time)-ms(summary.start.time):null,
    apiEquivalentUsd:sums('estimatedApiEquivalentUsd'),unknownReservedApiEquivalentUsd:sums('unknownReservedApiEquivalentUsd'),sdkNominalCostUsd:sdkCost,actualBillingUsd:null,httpAttempts:sums('modelHttpAttempts'),tokens:participants.reduce((a,p)=>a+p.tokens.totalTokens,0),tools:sums('tools'),mcpTools:sums('mcpTools'),boardChecks:sums('boardChecks'),eventChecks:sums('eventChecks'),awaitCalls:sums('awaitCalls'),verifiedOverlapCount:participants.reduce((a,p)=>a+p.verifiedOverlap.length,0),participants,cleanup:summary.cleanup,
    evidence:`traces/${name}/summary.json`,limits:summary.attributionLimits});
}
const n=groups.find(g=>g.mode==='N');
const comparisons=n?groups.filter(g=>g.mode!=='N').map(b=>({baseline:b.mode,valid:n.passed&&b.passed,
  absoluteApiEquivalentDeltaUsd:b.apiEquivalentUsd-n.apiEquivalentUsd,relativeApiEquivalentSaving:b.apiEquivalentUsd?(b.apiEquivalentUsd-n.apiEquivalentUsd)/b.apiEquivalentUsd:null,
  absoluteWholeTurnDeltaMs:b.groupTurnMs-n.groupTurnMs,relativeWholeTurnSaving:b.groupTurnMs?(b.groupTurnMs-n.groupTurnMs)/b.groupTurnMs:null,
  absoluteTokenDelta:b.tokens-n.tokens,relativeTokenSaving:b.tokens?(b.tokens-n.tokens)/b.tokens:null,
  absoluteHttpDelta:b.httpAttempts-n.httpAttempts,
  note:'Positive deltas favor N. Incomplete tasks cannot establish speed or efficiency benefits. One paired group per mode, exploratory.'})):[];
const result={status:groups.length===3?'pilot_completed':'partial_or_waiting',workload:'concurrent-pipeline-3pi-v1',measuredGroups:groups.length,piSessions:groups.reduce((a,g)=>a+g.participants.length,0),estimatedPiUsd:groups.reduce((a,g)=>a+g.apiEquivalentUsd,0),accounting:{kind:'API-equivalent estimate, not subscription invoice',actualBilling:null},limits:{groups:3,piSessions:9,apiEquivalentUsd:6,globalApiEquivalentUsd:10},groups,comparisons};
writeFileSync(join(directory,'metrics.json'),JSON.stringify(result,null,2));
const columns=['mode','passed','groupTurnMs','apiEquivalentUsd','unknownReservedApiEquivalentUsd','httpAttempts','tokens','tools','mcpTools','boardChecks','eventChecks','awaitCalls','verifiedOverlapCount'];
writeFileSync(join(directory,'metrics.csv'),columns.join(',')+'\n'+groups.map(g=>columns.map(k=>g[k]??'').join(',')).join('\n')+'\n');
const text=`# Suite prefissata — report\n\n${groups.length} gruppi misurati; ${result.piSessions} sessioni Pi. ${result.estimatedPiUsd.toFixed(6)} USD equivalenti API stimati; fatturazione reale della subscription non disponibile.\n\n`+groups.map(g=>`- **${g.mode}**: oracle ${g.taskOracle?'corretto':'non superato'}, file immutabili ${g.immutablePreserved?'conservati':'non verificati'}, turno ${(g.groupTurnMs/1000).toFixed(1)} s, ${g.httpAttempts} HTTP, ${g.tokens} token, ${g.apiEquivalentUsd.toFixed(6)} USD equivalenti API; verifiche con altro turno Pi aperto ${g.verifiedOverlapCount}. [Tracce](${g.evidence}).`).join('\n')+`\n\nUn solo gruppo per modalità: risultati esplorativi. La durata è quella reale, non un'ora simulata né dieci minuti riempiti con sleep. L'overlap indica verifiche utili durante un altro turno aperto, senza inferire attività di calcolo continua del peer. I timestamp di esposizione non provano da soli comprensione; l'azione sulla policy richiede un cambiamento osservabile del codice. Esposizioni e reiniezioni sono distinte: queste ultime escludono la prima apparizione di ogni evento. L'oracle di integrazione esercita alcuni export condivisi, non tutti i diciotto; l'audit indipendente deve verificarli tutti e provare direttamente il rendering lungo alla policy ricevuta. Verifica indipendente di scope, rumore e cleanup ancora necessaria.\n\nWorkload e oracle: [freeze](suite-frozen.json). Budget emendato prima delle prove: [amendment](runtime-budget-amendment.json).\n`;
writeFileSync(join(directory,'report.md'),text);console.log(JSON.stringify({groups:groups.length,sessions:result.piSessions,apiEquivalentUsd:result.estimatedPiUsd}));
