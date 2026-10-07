import { scenario } from './scenarios.mjs';
import { runCase } from './run.mjs';
import { json,save } from './common.mjs';
import { ROOT } from './run.mjs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const campaign=process.argv[2]??'benchmark-real-20261006-r1';
const selected=json(join(ROOT,'artifacts',campaign,'selected.json'));
const idleSpec=seed=>{
  const s=scenario('unsolicited',seed);
  return {...s,jobs:[100,300,600].map((durationMs,i)=>({...s.jobs[0],id:`validation-${i}`,durationMs}))};
};
for(const item of [
  {name:'unsolicited',seed:2001,mode:'N'},
  {name:'idle-backlog',seed:2002,mode:'N',flow:'idle',specOverride:idleSpec(2002)},
  {name:'restart-backlog',seed:2003,mode:'N',flow:'restart',specOverride:idleSpec(2003)},
  {name:'hostile',seed:2004,mode:'N'},
  {name:'duplicate',seed:2005,mode:'N'},
  ...[2010,2011,2012,2013,2014].map(seed=>({name:'lifecycle-six-jobs',seed,mode:'N',specOverride:scenario('S4',seed)})),
])await runCase({campaign,phase:'utility',...selected,...item});
const ablationPath=join(ROOT,'artifacts',campaign,'utility-ablation-spec.json');
if(!existsSync(ablationPath)){
  const original=scenario('unsolicited',2006),batch=randomInt(100000,1000000000);
  save(ablationPath,{...original,batch,expected:{...original.expected,maxBatch:batch},jobs:original.jobs.map(j=>({...j,result:{...j.result,maxBatch:batch}}))});
}
const ablation=json(ablationPath);
const positive=await runCase({campaign,phase:'utility',...selected,name:'unsolicited-secret',seed:2006,mode:'N',specOverride:ablation});
const negative=await runCase({campaign,phase:'utility',...selected,name:'unsolicited-negative',seed:2007,mode:'N',contextEnabled:false,specOverride:{...ablation,seed:2007}});
save(join(ROOT,'artifacts',campaign,'utility-negative-control.json'),{
  runId:negative.runId,positiveRunId:positive.runId,expected:'A random producer fact is available through injection and unavailable in the zero-job-call ablation.',
  unavailableResultObserved:negative.result?.maxBatch!==ablation.expected.maxBatch,
  positiveCorrect:positive.assessment.passed,positiveMcpCalls:positive.metrics.mcpCalls,
  channelBenefitDemonstrated:positive.assessment.passed&&positive.metrics.mcpCalls===0&&negative.metrics.mcpCalls===0&&negative.result?.maxBatch!==ablation.expected.maxBatch,
  mcpCalls:negative.metrics.mcpCalls,providerAttempts:negative.metrics.providerAttempts,
  limitation:'An ablation of this harness, not proof that other event architectures cannot provide the same capability.'});
