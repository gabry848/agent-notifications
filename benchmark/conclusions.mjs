import { pairedComparison } from './metrics.mjs';

export function conclusions(runs,frozen){
  if(!frozen)return {status:'pending',reason:'Configuration and holdout not frozen yet.',scenarios:[]};
  const holdout=runs.filter(r=>r.phase==='confirm');
  const scenarios=frozen.scenarios.map(s=>{
    const n=holdout.filter(r=>r.scenario===s.name&&r.mode==='N');
    const complete=n.length===frozen.repeat;
    const correct=n.filter(r=>r.assessment.passed).length;
    const reliability=complete&&correct>=frozen.criterion.minimumCorrect;
    const references=[s.reference,'W'].map(reference=>{
      const timeMetric=frozen.criterion.timeMetric??'taskMs';
      const metrics=['estimatedUsd','tokens.totalTokens',timeMetric].map(metric=>{
        const c=pairedComparison(holdout,s.name,reference,metric);
        const threshold=metric===timeMetric?frozen.criterion.timeSavingPct:frozen.criterion.costOrTokensSavingPct;
        return {...c,thresholdPct:threshold,benefitConfirmed:reliability&&c.pairs>=frozen.criterion.minimumValidPairs&&c.medianSavingPct>=threshold&&c.ci95[0]>0};
      });
      return {reference,benefitConfirmed:metrics.some(m=>m.benefitConfirmed),metrics};
    });
    return {scenario:s.name,complete,correct,total:n.length,reliability,references,
      fallbackAwaits:n.reduce((a,r)=>a+r.metrics.fallbackAwaits,0),
      interpretation:references.some(r=>r.benefitConfirmed)?'Benefit confirmed for at least one measured metric and reference; inspect W separately.':'No confirmed benefit under the frozen thresholds.'};
  });
  return {status:scenarios.every(s=>s.complete)?'complete':'pending',scenarios,
    scope:'Single model and host. Notifications plus any blocking fallback; no claim of universal superiority.'};
}
