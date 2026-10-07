import { join,resolve } from 'node:path';
import { existsSync,readFileSync } from 'node:fs';
import { runCase,ROOT } from './run.mjs';
import { report } from './report.mjs';
import { save,json,shuffled,hash } from './common.mjs';
import { median,pairedComparison } from './metrics.mjs';
import { freezeSources } from './sources.mjs';

export async function refine(campaign){
  const directory=resolve(ROOT,'artifacts',campaign),chosenPath=join(directory,'selected.json');
  if(existsSync(chosenPath))return json(chosenPath);
  const candidates=['v2','v3'];
  const promptCases=[...['S1','S3','S5','S6'].flatMap((name,i)=>[0,1].map(r=>({name,seed:501+i*100+r}))),
    ...[851,852].map(seed=>({name:'S4',seed}))];
  const promptOrder=promptCases.flatMap(item=>shuffled(candidates,item.seed).map(variant=>({...item,variant,payload:item.name==='S6'?'compact':'full'})));
  save(join(directory,'refine-prompt-order.json'),promptOrder);
  for(const item of promptOrder)await runCase({campaign,phase:'refine',mode:'N',...item});
  const promptSeeds=new Set(promptCases.map(c=>c.seed));
  const promptRuns=report(directory).runs.filter(r=>r.phase==='refine'&&promptSeeds.has(r.seed)&&r.position==='tail'&&r.cache==='implicit');
  const scores=candidates.map(variant=>{
    const runs=promptRuns.filter(r=>r.variant===variant);
    return {variant,correct:runs.filter(r=>r.assessment.passed).length,cost:median(runs.map(r=>r.metrics.estimatedUsd))};
  }).sort((a,b)=>b.correct-a.correct||a.cost-b.cost);
  const variant=scores[0].variant;
  save(join(directory,'refine-prompt-selection.json'),{rule:'Maximize correctness, then minimize median cost; 10 cases per prompt, development only. S4 added after main-S4-403-N repeated a submission. Both prompts use compact S6 payloads because main-S6-601-N exceeded the 8000-character ingress contract.',scores,selected:variant});
  const profiles=[{position:'tail',cache:'implicit'},{position:'before-input',cache:'implicit'},{position:'tail',cache:'stable'},{position:'before-input',cache:'stable'}];
  const layoutOrder=['S3','S6'].flatMap((name,i)=>[0,1].flatMap(r=>shuffled(profiles,901+i*50+r).map(profile=>({name,seed:901+i*50+r,payload:name==='S6'?'compact':'full',...profile}))));
  save(join(directory,'refine-layout-order.json'),layoutOrder);
  const incompatible=new Set();
  for(const item of layoutOrder){
    const key=item.position+'/'+item.cache;
    if(incompatible.has(key))continue;
    const result=await runCase({campaign,phase:'refine',mode:'N',variant,...item});
    if(result.error&&/400|unknown parameter|unsupported|invalid.*input/i.test(result.error))incompatible.add(key);
  }
  const layoutRuns=report(directory).runs.filter(r=>r.phase==='refine'&&r.seed>=901&&r.seed<=952);
  const layoutScores=profiles.map(profile=>{
    const runs=layoutRuns.filter(r=>r.position===profile.position&&r.cache===profile.cache);
    return {...profile,n:runs.length,correct:runs.filter(r=>r.assessment.passed).length,cost:median(runs.map(r=>r.metrics.estimatedUsd)),cacheHitRate:median(runs.map(r=>r.metrics.cacheHitRate))};
  }).sort((a,b)=>b.correct-a.correct||(a.cost??Infinity)-(b.cost??Infinity));
  const layout=layoutScores.find(p=>p.n===4&&p.correct===4)??layoutScores[0];
  const payloadOrder=[971,972].flatMap(seed=>shuffled(['full','compact'],seed).map(payload=>({seed,payload})));
  save(join(directory,'refine-payload-order.json'),payloadOrder);
  for(const item of payloadOrder)await runCase({campaign,phase:'refine',name:'S6',mode:'N',variant,position:layout.position,cache:layout.cache,...item});
  const payloadRuns=report(directory).runs.filter(r=>r.phase==='refine'&&[971,972].includes(r.seed));
  const payloadScores=['full','compact'].map(payload=>{
    const runs=payloadRuns.filter(r=>r.payload===payload);
    return {payload,correct:runs.filter(r=>r.assessment.passed).length,cost:median(runs.map(r=>r.metrics.estimatedUsd))};
  }).sort((a,b)=>b.correct-a.correct||a.cost-b.cost);
  const payload=payloadScores[0].payload;
  const dismissOrder=[981,982,983,984].flatMap(seed=>shuffled(['single','batch'],seed).map(dismiss=>({seed,dismiss})));
  save(join(directory,'refine-dismiss-order.json'),dismissOrder);
  for(const item of dismissOrder)await runCase({campaign,phase:'refine',name:'S6',mode:'N',variant,position:layout.position,cache:layout.cache,payload,...item});
  const dismissRuns=report(directory).runs.filter(r=>r.phase==='refine'&&r.seed>=981&&r.seed<=984);
  const dismissScores=['single','batch'].map(dismiss=>{
    const runs=dismissRuns.filter(r=>r.dismiss===dismiss);
    return {dismiss,n:runs.length,correct:runs.filter(r=>r.assessment.passed).length,
      cleanupComplete:runs.filter(r=>r.assessment.passed&&r.metrics.notificationState?.active===0).length,
      cost:median(runs.map(r=>r.metrics.estimatedUsd)),modelHttp:median(runs.map(r=>r.metrics.providerAttempts)),
      toolCalls:median(runs.map(r=>r.metrics.toolCalls)),dismissCalls:median(runs.map(r=>r.metrics.dismissCalls)),
      tokens:median(runs.map(r=>r.metrics.tokens.totalTokens)),turnSeconds:median(runs.map(r=>r.metrics.wallMs/1000))};
  }).sort((a,b)=>b.correct-a.correct||b.cleanupComplete-a.cleanupComplete||a.cost-b.cost);
  const dismiss=dismissScores.find(s=>s.n===4&&s.correct===4&&s.cleanupComplete===4)?.dismiss??'single';
  const dismissComparison=['estimatedUsd','tokens.totalTokens','toolCalls','providerAttempts','wallMs'].map(metric=>pairedComparison(
    dismissRuns.map(r=>({...r,mode:r.dismiss==='batch'?'N':'single'})),'S6','single',metric));
  const selected={variant,position:layout.position,cache:layout.cache,payload,dismiss,
    promptHash:hash(readFileSync(join(ROOT,'prompts',variant+'.txt'),'utf8')),
    runtime:freezeSources(ROOT,directory),
    selection:{prompt:scores,layout:layoutScores,payload:payloadScores,dismiss:dismissScores,dismissComparison,
      dismissRule:'Only consider a strategy with 4/4 verified tasks and zero active notifications after every turn; choose lower median cost. Otherwise retain single.',incompatible:[...incompatible]},
    rule:'Development only. Correctness first; median API cost second. No changes after holdout starts.',createdAt:new Date().toISOString()};
  save(chosenPath,selected);return selected;
}
if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname)console.log(JSON.stringify(await refine(process.argv[2]??'benchmark-real-20261006-r1')));
