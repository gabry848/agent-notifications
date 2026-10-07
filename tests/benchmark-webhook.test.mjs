import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webhook } from '../benchmark/github/webhook.mjs';
import { save,json,lines } from '../benchmark/common.mjs';
import { NotificationStore } from '../src/store.mjs';
import { startNotificationServer } from '../src/http.mjs';

test('signed GitHub events deliver once, reject unrelated events and preserve terminal state',async t=>{
  const work=mkdtempSync(join(tmpdir(),'pi-github-webhook-'));
  const db=new NotificationStore({path:join(work,'notifications.sqlite'),sessionId:'test'});
  const ingress=await startNotificationServer({store:db});
  const readyPath=join(work,'ready.json'),mcpPath=join(work,'mcp.jsonl');
  save(readyPath,{sessionId:'test',url:ingress.url});
  const secret='test-only-secret',receiver=await webhook({secret,repoId:123,controlDir:work,tracePath:join(work,'hooks.jsonl')});
  receiver.register('test-case',{mode:'N',jobId:'validation',readyPath,mcpPath});
  t.after(async()=>{await receiver.close();await ingress.close();db.close();rmSync(work,{recursive:true,force:true});});
  const send=async(delivery,status,{repoId=123,signature=true}={})=>{
    const body=JSON.stringify({repository:{id:repoId},action:status,workflow_run:{id:45,display_title:'bench-test-case',status,conclusion:status==='completed'?'failure':null,html_url:'https://github.com/example/actions/runs/45'}});
    return fetch(receiver.url+'/webhook',{method:'POST',headers:{'x-github-event':'workflow_run','x-github-delivery':delivery,'x-hub-signature-256':signature?'sha256='+createHmac('sha256',secret).update(body).digest('hex'):'invalid'},body});
  };
  assert.equal((await send('a','in_progress',{signature:false})).status,401);
  assert.equal((await send('b','in_progress',{repoId:999})).status,403);
  assert.equal((await send('c','in_progress')).status,200);
  assert.equal((await send('d','completed')).status,200);
  assert.equal(json(join(work,'test-case.json')).notificationDelivered,true);
  assert.equal(db.history().length,1);
  await send('d','completed');await send('e','in_progress');
  assert.equal(json(join(work,'test-case.json')).status,'completed');
  assert.equal(db.history().length,1);
  assert.equal(lines(mcpPath).filter(e=>e.type==='notify_accepted').length,1);
  assert.equal(db.call,0);
});
