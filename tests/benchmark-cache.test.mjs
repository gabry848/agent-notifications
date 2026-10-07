import test from 'node:test';
import assert from 'node:assert/strict';
import { stableCache } from '../benchmark/cache.mjs';

test('explicit cache never marks mutable notifications or current input',()=>{
  const payload={input:[{role:'developer',content:'Instructions'},
    {role:'user',content:[{type:'input_text',text:'Old user turn'}]},
    {type:'function_call_output',call_id:'a',output:'Old tool result'},
    {role:'user',content:[{type:'input_text',text:'<runtime_notifications>\n## Notifications\nDynamic'}]},
    {type:'function_call_output',call_id:'b',output:'Current result'}]};
  const r=stableCache(payload);
  assert.deepEqual(r.breakpointIndexes,[0,1,2]);
  assert.equal(payload.input[2].output[0].prompt_cache_breakpoint.mode,'explicit');
  assert.equal(payload.input[3].content[0].prompt_cache_breakpoint,undefined);
  assert.equal(payload.input[4].output,'Current result');
});

test('at most four endpoints retain the previous history boundary',()=>{
  const payload={input:Array.from({length:8},(_,i)=>({role:i===0?'developer':'user',content:'turn '+i}))};
  assert.deepEqual(stableCache(payload).breakpointIndexes,[0,5,6,7]);
  payload.input.push({role:'user',content:'next turn'});
  assert.deepEqual(stableCache(payload).breakpointIndexes,[0,6,7,8]);
});
