import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Ledger,cost,reservation,usageFromRaw } from '../benchmark/meter.mjs';
import { pairedComparison,assess,notificationState } from '../benchmark/metrics.mjs';
import { NotificationStore } from '../src/store.mjs';

test('provider usage separates cache and reasoning without doubling tokens',()=>{
  const u=usageFromRaw({input_tokens:1000,output_tokens:200,total_tokens:1200,input_tokens_details:{cached_tokens:300,cache_write_tokens:400},output_tokens_details:{reasoning_tokens:100}});
  assert.deepEqual(u,{input:300,cacheRead:300,cacheWrite:400,output:200,reasoning:100,totalTokens:1200});
  assert.equal(cost(u),.00363);
  assert.equal(usageFromRaw({}),null);
});
test('reservations retain unknown costs, settle once, and reject requests over the budget',t=>{
  const d=mkdtempSync(join(tmpdir(),'pi-bench-ledger-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
  const ledger=new Ledger(join(d,'ledger.sqlite'),.3);t.after(()=>ledger.close());
  const payload={input:'hello'},amount=reservation(payload),id=ledger.reserve('run','pilot',payload);
  ledger.unknown(id);assert.equal(ledger.total(),amount);assert.equal(ledger.summary().unconfirmedReservedUsd,amount);
  const id2=ledger.reserve('run','pilot',payload);
  const u={input:100,output:10,cacheRead:0,cacheWrite:0,totalTokens:110};
  ledger.settle(id2,u,'response-1');ledger.settle(id2,u,'response-1');
  assert.equal(ledger.summary().tokens.totalTokens,110);
  assert.throws(()=>ledger.reserve('run','pilot',{input:'x'.repeat(100000)}),/Budget limit/);
});
test('paired statistics use matched seeds, phases and successful runs only',()=>{
  const runs=Array.from({length:10},(_,seed)=>[
    {scenario:'S1',seed,phase:'confirm',mode:'N',assessment:{passed:true},metrics:{estimatedUsd:1}},
    {scenario:'S1',seed,phase:'confirm',mode:'P10',assessment:{passed:true},metrics:{estimatedUsd:2}},
  ]).flat();
  runs.push({scenario:'S1',seed:0,phase:'pilot',mode:'P10',assessment:{passed:true},metrics:{estimatedUsd:100}});
  const result=pairedComparison(runs,'S1','P10','estimatedUsd',1000);
  assert.equal(result.pairs,10);assert.equal(result.medianSaving,1);assert.deepEqual(result.ci95,[1,1]);
});

test('a failed workflow cannot stand in for the requested GitHub cancellation',()=>{
  const result={region:'eu-west-1',release:'v1.4',maxBatch:0,status:'blocked',jobIds:['validation']};
  const input={spec:{github:{},jobs:[{id:'validation',outcome:'cancelled'}],expected:{region:'eu-west-1',release:'v1.4',maxBatch:0,status:'blocked'}},
    mode:'W',result,mcp:[{type:'job_finished',jobId:'validation',monoMs:2,result:{conclusion:'failure'}}],
    runtime:[{type:'plan_submitted',monoMs:3}],notifications:[],events:[],filesPassed:true};
  assert.equal(assess(input).passed,false);
  input.mcp[0].result.conclusion='cancelled';assert.equal(assess(input).passed,true);
});

test('driver validation does not substitute for the agent verifying before submission',()=>{
  const result={region:'eu-west-1',release:'v1.4',maxBatch:7,status:'ready',jobIds:['validation']};
  const input={spec:{independent:true,jobs:[{id:'validation'}],expected:{region:'eu-west-1',release:'v1.4',maxBatch:7,status:'ready'}},
    mode:'W',result,mcp:[{type:'job_finished',jobId:'validation',monoMs:1}],
    runtime:[{type:'plan_submitted',monoMs:3},{type:'files_verified',passed:true,monoMs:4}],notifications:[],events:[],filesPassed:true};
  assert.equal(assess(input).passed,false);
  input.runtime[1].monoMs=2;assert.equal(assess(input).passed,true);
});

test('notification telemetry reads live WAL without changing first visibility or ages',t=>{
  const d=mkdtempSync(join(tmpdir(),'pi-state-read-'));t.after(()=>rmSync(d,{recursive:true,force:true}));
  const path=join(d,'notifications.sqlite'),store=new NotificationStore({path,sessionId:'target'});t.after(()=>store.close());
  const first=store.add({source:'worker',message:'first'});store.add({source:'worker',message:'second'});store.dismiss(first.id);
  assert.deepEqual(notificationState(path,'target'),{total:2,active:1,dismissed:1});
  assert.equal(store.call,0);assert.ok(store.history().every(n=>n.firstVisibleCall===null));
});
