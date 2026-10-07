import { join,resolve } from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { runCase,ROOT } from './run.mjs';
import { report } from './report.mjs';
import { save,json,shuffled,hash } from './common.mjs';
import { median,pairedComparison } from './metrics.mjs';
import { runtimeSources } from './sources.mjs';

export async function confirm(campaign){
  const directory=resolve(ROOT,'artifacts',campaign),selected=json(join(directory,'selected.json'));
  if(hash(readFileSync(join(ROOT,'prompts',selected.variant+'.txt'),'utf8'))!==selected.promptHash)throw new Error('Selected prompt changed before holdout');
  if(selected.runtime&&runtimeSources(ROOT).hash!==selected.runtime.hash)throw new Error('Selected runtime changed before holdout');
  const frozenPath=join(directory,'confirmation-frozen.json');let frozen;
  if(existsSync(frozenPath))frozen=json(frozenPath);
  else{
    const runs=report(directory).runs.filter(r=>r.phase==='main');
    const ranked=[...new Set(runs.map(r=>r.scenario))].map(name=>{
      const polls=['P10','PA'].map(mode=>{const rs=runs.filter(r=>r.scenario===name&&r.mode===mode);return {mode,correct:rs.filter(r=>r.assessment.passed).length,cost:median(rs.map(r=>r.metrics.estimatedUsd))};}).sort((a,b)=>b.correct-a.correct||a.cost-b.cost);
      const reference=polls[0].mode,comparison=pairedComparison(runs,name,reference,'estimatedUsd');
      const notificationRuns=runs.filter(r=>r.scenario===name&&r.mode==='N');
      return {name,reference,developmentSavingPct:comparison.medianSavingPct??-Infinity,
        developmentValidPairs:comparison.pairs,notificationCorrect:notificationRuns.filter(r=>r.assessment.passed).length,
        notificationTotal:notificationRuns.length,notificationAllAttemptsCostUsd:notificationRuns.reduce((a,r)=>a+r.metrics.estimatedUsd,0)};
    }).sort((a,b)=>b.developmentSavingPct-a.developmentSavingPct);
    frozen={selected,scenarios:[ranked[0],ranked.at(-1)],ranking:ranked,repeat:10,
      criterion:{minimumCorrect:9,minimumValidPairs:10,costOrTokensSavingPct:15,timeSavingPct:10,timeMetric:'wallMs',pairedCi95LowerBound:0},
      selectionRule:'Best and worst development cost saving versus the most correct, then cheapest polling policy. W always included. Baselines receive the same cache strategy. Time benefit uses the complete turn including post-submission work, not the first submission alone.',createdAt:new Date().toISOString()};
    save(frozenPath,frozen);
  }
  const order=frozen.scenarios.flatMap((s,i)=>Array.from({length:10},(_,r)=>({name:s.name,seed:1001+i*100+r,reference:s.reference}))).flatMap(s=>shuffled(['N',s.reference,'W'],s.seed).map(mode=>({...s,mode})));
  save(join(directory,'confirmation-order.json'),order);
  for(const item of order){
    if(selected.runtime&&runtimeSources(ROOT).hash!==selected.runtime.hash)throw new Error('Frozen runtime changed during holdout');
    await runCase({campaign,phase:'confirm',...item,variant:selected.variant,payload:selected.payload,position:item.mode==='N'?selected.position:'tail',cache:selected.cache,dismiss:selected.dismiss??'single'});
  }
  return frozen;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)console.log(JSON.stringify(await confirm(process.argv[2]??'benchmark-real-20261006-r1')));
