import test from 'node:test';
import assert from 'node:assert/strict';
import { NotificationStore, CONTEXT_TYPE } from '../src/store.mjs';
import { injectCachedSnapshot, ARCHIVE_TYPE } from '../src/notification-context.mjs';
const wire = messages => messages.map(({role,content}) => ({role:role==='custom'?'user':role,content}));

test('native cache projection preserves delivered snapshots before growing assistant/tool history', t => {
  let time=0,id=0;
  const store=new NotificationStore({clock:()=>new Date(++time*1000),id:()=>`n${++id}`});t.after(()=>store.close());
  const messages=[{role:'user',content:'work',timestamp:1}],records=[];
  store.add({source:'CI',message:'result ready'});
  const first=injectCachedSnapshot(messages,store.snapshot(),records);
  records.push(first.record);
  const nextMessages=[...messages,{role:'assistant',content:'use result',timestamp:2},{role:'toolResult',content:'done',timestamp:3}];
  const second=injectCachedSnapshot(nextMessages,store.snapshot(),records);
  assert.deepEqual(wire(second.messages).slice(0,first.messages.length),wire(first.messages));
  assert.equal(second.archived,1);
  assert.ok(second.messages.find(m=>m.customType===CONTEXT_TYPE).content.includes('[t-1]'));
  assert.deepEqual(messages,[{role:'user',content:'work',timestamp:1}]);
  assert.equal(second.messages.filter(m=>m.customType===ARCHIVE_TYPE).length,1);
});

test('dismiss changes only the last active section; archive stays immutable and history remains', t => {
  const store=new NotificationStore();t.after(()=>store.close());
  const event=store.add({source:'CI',message:'done'});
  const messages=[{role:'user',content:'work'}];
  const first=injectCachedSnapshot(messages,store.snapshot(),[]);
  store.dismiss('*');
  const second=injectCachedSnapshot([...messages,{role:'assistant',content:'done'}],store.snapshot(),[first.record]);
  assert.equal(second.messages.find(m=>m.customType===ARCHIVE_TYPE).content,first.record.content);
  assert.ok(!second.messages.find(m=>m.customType===CONTEXT_TYPE).content.includes(event.id));
  assert.equal(store.history()[0].id,event.id);
  assert.ok(store.history()[0].dismissedAt);
});

test('prefix anchors ignore snapshots belonging to a different or compacted history', t => {
  const store=new NotificationStore();t.after(()=>store.close());
  const old=[{role:'user',content:'old task'},{role:'assistant',content:'old reply'}];
  const first=injectCachedSnapshot(old,store.snapshot(),[]);
  const different=injectCachedSnapshot([{role:'user',content:'new task'},old[1]],store.snapshot(),[first.record]);
  const compacted=injectCachedSnapshot([{role:'compactionSummary',summary:'work summary'}],store.snapshot(),[first.record]);
  assert.equal(different.archived,0);assert.equal(compacted.archived,0);
  const restarted=injectCachedSnapshot(JSON.parse(JSON.stringify([...old,{role:'user',content:'continue'}])),store.snapshot(),JSON.parse(JSON.stringify([first.record])));
  assert.equal(restarted.archived,1);
});

test('before-input retains old snapshot and old input batch in their original order', t => {
  const store=new NotificationStore();t.after(()=>store.close());
  const original=[{role:'user',content:'task'}];
  const first=injectCachedSnapshot(original,store.snapshot(),[],{position:'before-input'});
  const second=injectCachedSnapshot([...original,{role:'assistant',content:'answer'},{role:'user',content:'follow-up'}],store.snapshot(),[first.record],{position:'before-input'});
  assert.deepEqual(wire(second.messages).slice(0,first.messages.length),wire(first.messages));
  assert.equal(second.messages.at(-1).content,'follow-up');
});

test('repeated context preparation and serialized metadata keep an append-only prefix', t => {
  const store=new NotificationStore();t.after(()=>store.close());
  const messages=[{role:'user',content:'task'}];
  const first=injectCachedSnapshot(messages,store.snapshot(),[]);
  const second=injectCachedSnapshot(first.messages,store.snapshot(),[first.record]);
  const third=injectCachedSnapshot(second.messages,store.snapshot(),[first.record,second.record]);
  assert.deepEqual(wire(third.messages).slice(0,second.messages.length),wire(second.messages));
  assert.equal(third.archived,2);
  assert.equal(third.messages.filter(m=>m.customType===CONTEXT_TYPE).length,1);
});
