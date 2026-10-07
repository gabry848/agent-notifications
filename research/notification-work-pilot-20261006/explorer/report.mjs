import { readdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url)),runsDir=join(root,'runs');
const runs=existsSync(runsDir)?readdirSync(runsDir).map(id=>join(runsDir,id,'summary.json')).filter(existsSync).map(p=>JSON.parse(readFileSync(p,'utf8'))):[];
if(!runs.length)throw new Error('No measured summary exists; do not overwrite preparation-only report');
const sum=pick=>runs.reduce((a,r)=>a+(pick(r)??0),0);
const comparisons=[];
for(const kind of ['compatibility','status']){
  const n=runs.find(r=>r.kind===kind&&r.mode==='N');
  for(const mode of ['PA','W']){
    const b=runs.find(r=>r.kind===kind&&r.mode===mode);
    if(!n||!b)continue;
    const aManifest=JSON.parse(readFileSync(join(runsDir,n.id,'manifest.json'),'utf8')),bManifest=JSON.parse(readFileSync(join(runsDir,b.id,'manifest.json'),'utf8'));
    const sameRuntime=JSON.stringify(aManifest.runtimeHashes)===JSON.stringify(bManifest.runtimeHashes)&&JSON.stringify(aManifest.frozenOwn)===JSON.stringify(bManifest.frozenOwn);
    const valid=n.passed&&b.passed&&n.scheduling.valid&&b.scheduling.valid&&sameRuntime&&n.seed===b.seed&&n.actualDefault.id===b.actualDefault.id&&n.actualDefault.provider===b.actualDefault.provider&&n.actualDefault.thinkingLevel===b.actualDefault.thinkingLevel&&n.usage.unknownReservedUsd===0&&b.usage.unknownReservedUsd===0;
    const field=(name,pick)=>({name,baseline:pick(b),notifications:pick(n),differenceBaselineMinusN:pick(b)-pick(n),relativeSavingsPct:pick(b)?100*(pick(b)-pick(n))/pick(b):null});
    comparisons.push({kind,baselineMode:mode,notificationRun:n.id,baselineRun:b.id,valid,exploratoryOnly:true,
      differences:valid?[field('API-equivalent USD',r=>r.usage.estimatedUsd),field('HTTP attempts',r=>r.usage.attempts),field('turn milliseconds',r=>r.timing.usefulTurnMs),field('total tokens',r=>r.usage.rows.reduce((x,u)=>x+(u.normalized_usage?.totalTokens??0),0))]:[]});
  }
}
const total={phase:'exploratory-pilot',measuredPiExecutions:runs.length,taskCorrect:runs.filter(r=>r.taskCorrect).length,
  validChannels:runs.filter(r=>r.channelValid).length,estimatedApiEquivalentUsd:sum(r=>r.usage.estimatedUsd),unknownReservedUsd:sum(r=>r.usage.unknownReservedUsd),
  actualSubscriptionCharge:null,referenceCapUsd:2,httpAttempts:sum(r=>r.usage.attempts),comparisons,runs};
writeFileSync(join(root,'metrics.json'),JSON.stringify(total,null,2));
const columns=['run_id','condition','mode','task_correct','channel_valid','actual_provider','actual_model','turn_ms','http_attempts','total_tokens','api_equivalent_usd','unknown_reserved_usd','tool_calls','source_checks','await_calls','first_exposure_ms','first_consequence_ms','tests_passed_before_report','tests_passed_after_report'];
const csv=x=>x===null||x===undefined?'':JSON.stringify(x);
const rows=runs.map(r=>[r.id,r.kind,r.mode,r.taskCorrect,r.channelValid,r.actualDefault.provider,r.actualDefault.id,r.timing.usefulTurnMs,r.usage.attempts,r.usage.rows.reduce((x,u)=>x+(u.normalized_usage?.totalTokens??0),0),r.usage.estimatedUsd,r.usage.unknownReservedUsd,r.tools.total,r.events.getUpdates,r.events.awaitCalls,r.events.exposureLatencyMs,r.events.consequenceLatencyMs,r.work.milestonesBeforePublication,r.work.milestonesAfterPublication]);
writeFileSync(join(root,'metrics.csv'),columns.join(',')+'\n'+rows.map(r=>r.map(csv).join(',')).join('\n')+'\n');
const fmt=(x,d=3)=>Number.isFinite(x)?x.toFixed(d):'—';
const table=runs.map(r=>`| ${r.kind} | ${r.mode} | ${r.taskCorrect?'yes':'no'} | ${fmt(r.timing.usefulTurnMs/60000,2)} | ${r.usage.attempts} | ${fmt(r.usage.estimatedUsd,6)} | ${r.events.getUpdates}/${r.events.awaitCalls} | ${r.work.milestonesBeforePublication??'—'}/${r.work.milestonesAfterPublication??'—'} | [trace](runs/${r.id}/summary.json) |`).join('\n');
const differences=comparisons.map(c=>`- ${c.kind}, N vs ${c.baselineMode}: ${c.valid?c.differences.map(d=>`${d.name} Δ=${fmt(d.differenceBaselineMinusN)} (${fmt(d.relativeSavingsPct,1)}% savings)`).join('; '):'not a valid complete comparison; preserve attempts without efficiency attribution'}.`).join('\n');
writeFileSync(join(root,'report.md'),`# Explorer — bounded pilot evidence\n\n${runs.length} measured Pi executions; ${total.taskCorrect} task-correct. API-equivalent estimate $${fmt(total.estimatedApiEquivalentUsd,6)}; unknown reserved $${fmt(total.unknownReservedUsd,6)}. Actual Codex subscription charges remain unknown.\n\n| Condition | Mode | Task correct | Actual minutes | HTTP attempts | API-equivalent USD | Checks/await | Tests before/after report | Evidence |\n|---|---|---|---:|---:|---:|---:|---:|---|\n${table}\n\n${differences}\n\nPositive differences mean baseline minus notifications. These are individual exploratory pairs, without statistical confirmation. A failure does not count as a faster or cheaper completed task.\n\n## Interpretation limits\n\nThe task implements a real local delivery hub with HTTP, SQLite, bounded concurrency and reloadable runtime policy. External facts affect live body acceptance and retry policy, rather than only a final plan. But the event source is controlled: a real small corpus worker starts after three public tests pass. Its short computation and progress trigger are not production long-job latency.\n\nActual duration is shown above. A run shorter than ten minutes is not evidence for a ten-minute, thirty-minute or hour-long working session. Check remaining verified milestones and code work after report publication before claiming useful overlap or earlier intervention. The first measured consequence is a semantically correct configuration/release write, not the model's hidden understanding. Exposure is captured at the next natural context boundary and never means autonomous wake-up.\n\nNative get_updates/await_update are not MCP calls (MCP calls zero in this explorer). W can work first and await a queued report at a sensible boundary. Independent analysis of the public corpus is allowed and must be counted if used. All scenarios preserve initial facts/contracts/model and actual failed attempts.\n\nSource hashes, actual model, config deviations, raw usage, RPC events, local notification traces, work checkpoints and final tests are retained per run. The independent audit should verify added integration tests, CLI wiring, cleanup and policy compliance before presenting a confirmed efficiency conclusion.\n`);
console.log(JSON.stringify({runs:runs.length,taskCorrect:total.taskCorrect,estimatedApiEquivalentUsd:total.estimatedApiEquivalentUsd,validPairs:comparisons.filter(c=>c.valid).length}));
