import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PilotLedger} from './meter.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const entries=JSON.parse(readFileSync(join(root,'episodes.json')));
const readLines=p=>readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sums=rows=>rows.reduce((a,r)=>{
  const u=r.raw_usage;a.input+=u.input_tokens;a.cached+=u.input_tokens_details?.cached_tokens??0;a.output+=u.output_tokens;
  a.estimatedUsd+=r.estimated??0;return a;
},{input:0,cached:0,output:0,estimatedUsd:0});
const metrics=entries.map(entry=>{
  const summary=JSON.parse(readFileSync(join(entry.directory,'summary.json')));
  const rows=summary.accounting.rows;
  const hashes=readLines(join(entry.directory,'hashes.jsonl'));
  const payloads=hashes.filter(e=>e.type==='payload_hashes');
  const actions=hashes.filter(e=>e.type==='action');
  const notifications=readLines(join(entry.directory,'notifications.jsonl'));
  const sumsAll=sums(rows),late=sums(rows.slice(3));
  const fields=['instructionsHash','toolsHash','cacheKeyHash'];
  return {id:entry.variant+'-'+entry.label,variant:entry.variant,triplet:entry.label,
    status:summary.failure?'failed':'complete',durationMs:summary.durationMs,httpAttempts:rows.length,
    toolCalls:actions.length,extraDismissOrHistoryCalls:0,correct:actions.length===6&&actions.every(e=>e.correct)&&summary.result?.finished===true,
    ...sumsAll,uncached:sumsAll.input-sumsAll.cached,weightedCacheFraction:sumsAll.cached/sumsAll.input,
    requestCacheHitFrequency:rows.filter(r=>r.raw_usage?.input_tokens_details?.cached_tokens>0).length/rows.length,
    rawCachedTokens:rows.map(r=>r.raw_usage.input_tokens_details?.cached_tokens??0),
    rawInputTokens:rows.map(r=>r.raw_usage.input_tokens),rawOutputTokens:rows.map(r=>r.raw_usage.output_tokens),
    cacheKeyAndToolsAndInstructionsStable:fields.every(f=>new Set(payloads.map(p=>p[f])).size===1),
    previousInputRetained:payloads.slice(1).map(p=>p.sharedLeadingItems===p.previousItems),
    currentDynamicSectionAtTail:payloads.every(p=>p.notificationIndexes.at(-1)===p.items-1),
    archiveCount:notifications.filter(e=>e.type==='cache_projection').map(e=>e.archived),
    lateWindow:{scope:'Requests4–7, reported additionally because both event updates have entered during this window; includes call4 before the second update.',
      requests:rows.slice(3).length,...late,weightedCacheFraction:late.cached/late.input},
    allSettled:rows.every(r=>r.state==='settled'),actualBillingUsd:null,authLinkRemoved:summary.authLinkRemoved,
    source:entry.directory.replace(fileURLToPath(new URL('../../',import.meta.url)),'')+'/summary.json'};
});
const ledger=new PilotLedger(join(root,'budget.sqlite'));const accounting=ledger.summary();ledger.close();
const by=id=>metrics.find(m=>m.id===id);
const compare=(treatment,baseline)=>({treatment,baseline,cacheFractionDelta:by(treatment).weightedCacheFraction-by(baseline).weightedCacheFraction,
  estimatedUsdDelta:by(treatment).estimatedUsd-by(baseline).estimatedUsd,
  lateCacheFractionDelta:by(treatment).lateWindow.weightedCacheFraction-by(baseline).lateWindow.weightedCacheFraction,
  lateEstimatedUsdDelta:by(treatment).lateWindow.estimatedUsd-by(baseline).lateWindow.estimatedUsd});
const result={type:'Controlled native Pi cache probes; NOT productivity/long-session benchmarks',generatedAt:new Date().toISOString(),
  nativeDefault:{provider:'openai-codex',model:'gpt-6.1-sol',thinking:'medium',piVersion:'0.99.2'},
  settingsEqualWithinTriplet:true,measuredConcurrency:1,episodeCount:metrics.length,httpAttempts:accounting.attempts,
  totalEstimatedUsd:accounting.estimatedUsd,actualBillingUsd:null,unknownReservedUsd:accounting.unknownReservedUsd,
  accounting:accounting.accounting,metrics,
  comparisons:[compare('journal-pair1','current-pair1'),compare('journal-pair1','baseline-pair1'),compare('fixed-pair2','current-pair2'),compare('fixed-pair2','baseline-pair2')],
  limits:['First triplet tests an in-memory prototype; second tests the applied persistent metadata implementation.',
    'Notification facts are intentionally repeated in common tool results for equal information in all variants. This isolates caching and proves no productivity advantage.',
    'One initial cache miss before notifications arrive exists in fixed-pair2 and current-pair2; exact provider cause unobserved. Full-episode costs retain it.',
    'Archive snapshots increase context size; no zero-overhead or long-session claim. No model/tool/output overrides.',
    'Six short episodes, no statistical significance or exact billing inference. Old pilot outcomes remain untouched.']};
writeFileSync(join(root,'metrics.json'),JSON.stringify(result,null,2));
const columns=['id','status','correct','httpAttempts','toolCalls','input','cached','uncached','output','weightedCacheFraction','requestCacheHitFrequency','estimatedUsd','durationMs'];
writeFileSync(join(root,'metrics.csv'),columns.join(',')+'\n'+metrics.map(r=>columns.map(k=>r[k]).join(',')).join('\n')+'\n');
const sources=['src/pi-extension.ts','src/store.mjs','src/notification-context.mjs','prompts/v1.txt','prompts/v2.txt','prompts/v3.txt',
  'tests/notification-cache.test.mjs','research/cache-fix-20261006/run.mjs','research/cache-fix-20261006/pi-runtime.mjs','research/cache-fix-20261006/probe-extension.ts',
  'research/cache-fix-20261006/journal-prototype.ts','research/cache-fix-20261006/meter.mjs','research/cache-fix-20261006/meter-extension.ts','research/cache-fix-20261006/offline-resume.mjs',
  'research/cache-fix-20261006/verification-prompt.txt'];
const project=fileURLToPath(new URL('../../',import.meta.url));
writeFileSync(join(root,'source-hashes.json'),JSON.stringify(Object.fromEntries(sources.map(p=>[p,createHash('sha256').update(readFileSync(join(project,p))).digest('hex')])),null,2));
const control=JSON.parse(readFileSync(join(root,'control-freeze.json')));
const mismatches=Object.entries(control.sourceHashes).filter(([p,hash])=>p.includes('/control/')&&createHash('sha256').update(readFileSync(join(project,p))).digest('hex')!==hash).map(([p])=>p);
const processes=execFileSync('ps',['-ax','-o','pid=,command='],{encoding:'utf8'}).split('\n')
  .filter(line=>line.includes(root)&&/\/pi |\/cli\.js |--mode rpc/.test(line));
const endpoints=[];
for(const entry of entries){const ready=JSON.parse(readFileSync(join(entry.directory,'ready.json')));let live=false;
  try{await fetch(ready.url+'/health',{signal:AbortSignal.timeout(500)});live=true;}catch{}endpoints.push({id:entry.variant+'-'+entry.label,live});}
const verification={measuredEpisodes:metrics.length,attempts:accounting.attempts,allComplete:metrics.every(m=>m.status==='complete'),
  correct:metrics.every(m=>m.correct),allSettled:metrics.every(m=>m.allSettled),sameDefaultAndStableFields:metrics.every(m=>m.cacheKeyAndToolsAndInstructionsStable),
  authLinksRemoved:metrics.every(m=>m.authLinkRemoved),controlHashMismatches:mismatches,ownPiProcessesRemaining:processes,
  ownReceivers:endpoints,allOwnReceiversClosed:endpoints.every(e=>!e.live),externalHttpCountMatchesLedger:metrics.reduce((sum,m)=>sum+m.httpAttempts,0)===accounting.attempts};
writeFileSync(join(root,'verification.json'),JSON.stringify(verification,null,2));
console.log(JSON.stringify({episodes:metrics.length,httpAttempts:accounting.attempts,estimatedUsd:accounting.estimatedUsd,verification}));
