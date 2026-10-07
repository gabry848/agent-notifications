import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { report } from '../benchmark/report.mjs';
import { save } from '../benchmark/common.mjs';
import { Ledger } from '../benchmark/meter.mjs';

test('a recovered HTTP 429 is excluded even when the task and usage are complete',t=>{
  const directory=mkdtempSync(join(tmpdir(),'pi-report-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  save(join(directory,'manifest.json'),{campaign:'test',model:'gpt-6.1-sol'});
  const ledger=new Ledger(join(directory,'budget.sqlite'));
  for(const [seed,limited]of [[1,false],[2,true]]){
    const runId='run-'+seed,work=join(directory,runId);mkdirSync(work);
    const result={region:'eu-west-1',release:'v1.4',maxBatch:7,status:'ready',jobIds:['validation']};
    const requestId=ledger.reserve(runId,'pilot',{input:'test'});
    ledger.settle(requestId,{input:40,output:20,cacheRead:0,cacheWrite:0,totalTokens:60},'response-'+seed);
    save(join(work,'spec.json'),{jobs:[{id:'validation'}],expected:{...result,jobIds:undefined},independent:false});
    save(join(work,'summary.json'),{runId,phase:'pilot',scenario:'S1',mode:'W',seed,variant:'v2',payload:'full',result,filesPassed:true,
      assessment:{passed:true,failures:[]},created:{monoMs:0},begun:{monoMs:1},ended:{monoMs:100},
      metrics:{startupMs:1,tokens:ledger.summary(runId).tokens},accounting:ledger.summary(runId)});
    const jsonl=(name,rows)=>writeFileSync(join(work,name),rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
    jsonl('provider.jsonl',[{payload:{input:[{role:'user',content:'Task'}]}}]);
    jsonl('notifications.jsonl',[]);jsonl('events.jsonl',[]);
    jsonl('mcp.jsonl',[{type:'job_started',jobId:'validation',monoMs:10},{type:'job_finished',jobId:'validation',monoMs:20,finished:{monoMs:20}}]);
    jsonl('runtime.jsonl',[{type:'http_attempt',requestId,monoMs:21},...(limited?[{type:'http_response',status:429,monoMs:22}]:[]),
      {type:'http_response',status:200,monoMs:23},{type:'raw_usage',requestId,monoMs:29},{type:'plan_submitted',result,monoMs:30}]);
  }
  ledger.close();
  const output=report(directory);
  assert.equal(output.runs.find(r=>r.seed===1).assessment.passed,true);
  const recovered=output.runs.find(r=>r.seed===2);
  assert.equal(recovered.originalAssessment.passed,true);
  assert.equal(recovered.verification.meteringComplete,true);
  assert.equal(recovered.verification.rateLimitSeen,true);
  assert.equal(recovered.assessment.passed,false);
  assert.equal(output.groups[0].passed,1);
});
