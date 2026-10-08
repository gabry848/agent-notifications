import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const base=import.meta.dirname,bytes=readFileSync(join(base,'metrics.json')),metrics=JSON.parse(bytes);
const hash=b=>createHash('sha256').update(b).digest('hex');
const q=(a,p)=>{const s=[...a].sort((a,b)=>a-b),i=(s.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return s.length?s[l]+(s[h]-s[l])*(i-l):null;};
const spread=a=>({n:a.length,median:q(a,.5),min:a.length?Math.min(...a):null,max:a.length?Math.max(...a):null,q1:q(a,.25),q3:q(a,.75),iqr:a.length?q(a,.75)-q(a,.25):null});
const initial=[['ci-0001','integrity',0],['ci-0002','csv',30000],['ci-0003','version',60000],['ci-0004','catalog',90000]];
const rows=metrics.runs.map(r=>{
 const events=initial.map(([jobId,group,queueMs])=>{
  const manifest=JSON.parse(readFileSync(join(base,'runs',`${r.stage}-${r.pair}-${r.mode}`,'jobs',jobId,'manifest.json')));
  if(manifest.group!==group||manifest.queueMs!==queueMs||manifest.trigger!=='initial')throw Error('Initial CI identity mismatch '+jobId);
  const e=r.ci.exposure.find(e=>e.jobId===jobId);if(!e)throw Error('Missing terminal initial result '+jobId);
  return{...e,queueMs,revision:manifest.revision,sourceHashes:manifest.sourceHashes};
 });
 const unexposedCount=events.filter(e=>!e.exposed).length;
 return{stage:r.stage,pair:r.pair,mode:r.mode,correct:r.correct,events,unexposedCount,staleAtPublicationCount:events.filter(e=>e.staleAtPublication).length,staleAtFirstExposureCount:events.filter(e=>e.staleAtFirstExposure).length,medianExposureLatencyMs:unexposedCount?null:q(events.map(e=>e.exposureLatencyMs),.5)};
});
const pairs=[...new Set(rows.filter(r=>r.stage==='measured').map(r=>r.pair))].sort().map(pair=>{
 const N=rows.find(r=>r.stage==='measured'&&r.pair===pair&&r.mode==='N'),PA=rows.find(r=>r.stage==='measured'&&r.pair===pair&&r.mode==='PA');
 const immutableSourceMatch=Boolean(N&&PA)&&N.events.every((e,i)=>e.revision===PA.events[i].revision&&JSON.stringify(e.sourceHashes)===JSON.stringify(PA.events[i].sourceHashes));
 if(N&&PA&&!immutableSourceMatch)throw Error('Initial source bytes differ '+pair);
 const eligible=Boolean(N?.correct&&PA?.correct&&N.medianExposureLatencyMs!==null&&PA.medianExposureLatencyMs!==null&&immutableSourceMatch);
 return{pair,eligible,immutableSourceMatch,N,PA,changePercent:eligible?100*(N.medianExposureLatencyMs-PA.medianExposureLatencyMs)/PA.medianExposureLatencyMs:null};
});
const eligible=pairs.filter(p=>p.eligible);
const output={created:new Date().toISOString(),secondaryAnalysisRequested:'2026-10-07; requested after p03 to compare identical initial events, not preregistered as a primary endpoint',definition:'Delivery-only publication to first provider payload containing unique terminal eventId, initial ci-0001..ci-0004. Per-trial median of four event latencies; no actionable-failure or completion attribution. Stale results remain included.',initialGroups:initial,denominator:'100*(N per-trial median - PA per-trial median)/PA per-trial median for each complete correct pair; summarize paired changes',quantileMethod:'linear interpolation at (n-1)*p',provenance:{metricsSha256:hash(bytes),scriptSha256:hash(readFileSync(import.meta.filename))},pairs,pairedChangesPercent:spread(eligible.map(p=>p.changePercent)),medianTrialLatencyMs:{N:q(eligible.map(p=>p.N.medianExposureLatencyMs),.5),PA:q(eligible.map(p=>p.PA.medianExposureLatencyMs),.5)},calibration:rows.filter(r=>r.stage==='calibration')};
writeFileSync(join(base,'delivery.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify({completePairs:eligible.length,pairedChangesPercent:output.pairedChangesPercent,medianTrialLatencyMs:output.medianTrialLatencyMs}));
