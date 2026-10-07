import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPayloads } from '../benchmark/metrics.mjs';

test('provider verification rejects a misplaced runtime section and cache writes over current data',()=>{
  const block='<runtime_notifications>\n## Notifications\nfixture';
  const snapshots=[{type:'context_snapshot',call:1,block,active:[]}];
  const stable={role:'developer',content:[{type:'input_text',text:'Instructions',prompt_cache_breakpoint:{mode:'explicit'}}]};
  const dynamic={role:'user',content:[{type:'input_text',text:block}]};
  const current={type:'function_call_output',call_id:'job',output:[{type:'input_text',text:'Current result'}]};
  const payload={input:[stable,dynamic,current],prompt_cache_options:{mode:'explicit'}};
  const verify=p=>verifyPayloads('N',[{call:1,payload:p}],snapshots,{position:'before-input',cache:'stable'});
  assert.equal(verify(payload).passed,true);
  assert.equal(verify({...payload,input:[stable,current,dynamic]}).passed,false);
  const cachedCurrent=structuredClone(payload);
  cachedCurrent.input[2].output[0].prompt_cache_breakpoint={mode:'explicit'};
  assert.equal(verify(cachedCurrent).passed,false);
  assert.equal(verifyPayloads('N',[{call:1,payload}],snapshots,{position:'tail'}).passed,false);
  const baseline={input:[stable,current],prompt_cache_options:{mode:'explicit'}};
  assert.equal(verifyPayloads('W',[{call:1,payload:baseline}],[],{cache:'stable'}).passed,true);
  assert.equal(verifyPayloads('W',[{call:1,payload:{input:[stable,current]}}],[],{cache:'stable'}).passed,false);
  assert.equal(verifyPayloads('disabled',[{call:1,payload:{input:[stable,current],tools:[{name:'notifications_history'}]}}],[]).passed,false);
});
