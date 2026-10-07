import test from 'node:test';
import assert from 'node:assert/strict';
import { conclusions } from '../benchmark/conclusions.mjs';

test('early submission cannot prove a speed benefit when the complete turn is slower',()=>{
  const frozen={scenarios:[{name:'S3',reference:'P10'}],repeat:10,
    criterion:{minimumCorrect:9,minimumValidPairs:10,costOrTokensSavingPct:15,timeSavingPct:10,timeMetric:'wallMs'}};
  const runs=Array.from({length:10},(_,seed)=>['N','P10','W'].map(mode=>({phase:'confirm',scenario:'S3',seed,mode,
    assessment:{passed:true},metrics:{estimatedUsd:1,tokens:{totalTokens:100},fallbackAwaits:0,
      taskMs:mode==='N'?1:100,wallMs:mode==='N'?200:100}}))).flat();
  const result=conclusions(runs,frozen);
  assert.equal(result.status,'complete');
  assert.equal(result.scenarios[0].references.some(r=>r.benefitConfirmed),false);
  for(const r of runs)if(r.mode==='N')r.metrics.wallMs=50;
  assert.equal(conclusions(runs,frozen).scenarios[0].references.every(r=>r.benefitConfirmed),true);
});
