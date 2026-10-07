import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationStore,injectSnapshot,CONTEXT_TYPE } from '../src/store.mjs';

test('before-input keeps stable history before notifications and current tool batch after them',t=>{
  const store=new NotificationStore();t.after(()=>store.close());const snapshot=store.snapshot();
  const messages=[{role:'user',content:'old task'},{role:'assistant',content:'old call'},
    {role:'toolResult',content:'old result'},{role:'assistant',content:'current calls'},
    {role:'toolResult',content:'current result a'},{role:'toolResult',content:'current result b'}];
  const copy=structuredClone(messages),injected=injectSnapshot(messages,snapshot,{position:'before-input'});
  assert.deepEqual(injected.slice(0,4),messages.slice(0,4));
  assert.equal(injected[4].customType,CONTEXT_TYPE);assert.deepEqual(injected.slice(5),messages.slice(4));
  assert.deepEqual(messages,copy);
});
test('latest user input follows runtime data, while tail mode remains compatible',t=>{
  const store=new NotificationStore();t.after(()=>store.close());const snapshot=store.snapshot();
  const messages=[{role:'user',content:'old'},{role:'assistant',content:'answer'},{role:'user',content:'new'}];
  const before=injectSnapshot(messages,snapshot,{position:'before-input'});
  assert.equal(before[2].customType,CONTEXT_TYPE);assert.equal(before[3].content,'new');
  assert.equal(injectSnapshot(messages,snapshot).at(-1).customType,CONTEXT_TYPE);
  assert.throws(()=>injectSnapshot(messages,snapshot,{position:'middle'}),/Unknown/);
});
