import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NotificationStore } from './transport/store.mjs';
import { startNotificationServer } from './transport/http.mjs';
import { PilotLedger, estimate, normalizeUsage, reserveAmount } from './meter.mjs';
import { startDefaultPi } from './pi-runtime.mjs';
const root=fileURLToPath(new URL('.',import.meta.url));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(check,label)=>{const end=Date.now()+10000;while(Date.now()<end){const v=await check();if(v)return v;await pause(20);}throw new Error('Timeout '+label);};

test('raw usage normalization, API-equivalent tiers, concurrent reserve guard and retained unknowns',()=>{
  const u=normalizeUsage({input_tokens:1000,output_tokens:120,input_tokens_details:{cached_tokens:400},output_tokens_details:{reasoning_tokens:90}});
  assert.deepEqual(u,{input:600,cacheRead:400,cacheWrite:0,output:120,reasoning:90,totalTokens:1120});
  assert.equal(estimate(u),0.00244);
  assert.equal(estimate({input:272001,cacheRead:0,cacheWrite:0,output:100}),1.089504);
  const folder=mkdtempSync(root+'traces/meter-');
  const ledger=new PilotLedger(join(folder,'ledger.sqlite'),{scopeCap:6});
  const ids=Array.from({length:3},(_,i)=>ledger.reserve('run-'+i,80000));
  assert.throws(()=>ledger.reserve('fourth',80000),/usage limit/);
  assert.ok(reserveAmount(80000)>1.28);
  ledger.settle(ids[0],'response-a',{input_tokens:1000,output_tokens:120,input_tokens_details:{cached_tokens:400}});
  ledger.unknown(ids[1]);
  assert.equal(ledger.summary().attempts,3);assert.ok(ledger.summary().unknownReservedUsd>2.56);
  ledger.close();
});

test('idempotent ingress preserves identity across dismissal/restart and separates UUID destinations',async()=>{
  const folder=mkdtempSync(root+'traces/ingress-'),path=join(folder,'notify.sqlite'),a=randomUUID(),b=randomUUID();
  let store=new NotificationStore({path,sessionId:a});
  const first=store.add({source:'coordinator',message:'fact',eventId:'rev-1'});
  assert.equal(store.add({source:'coordinator',message:'fact',eventId:'rev-1'}).id,first.id);
  assert.throws(()=>store.add({source:'coordinator',message:'different',eventId:'rev-1'}),/conflict/);
  store.dismiss(first.id);
  assert.equal(store.add({source:'coordinator',message:'fact',eventId:'rev-1'}).dismissedAt,store.history()[0].dismissedAt);
  assert.notEqual(store.forSession(b).add({source:'coordinator',message:'fact',eventId:'rev-1'}).id,first.id);
  store.close();store=new NotificationStore({path,sessionId:a});
  assert.equal(store.add({source:'coordinator',message:'fact',eventId:'rev-1'}).id,first.id);
  assert.equal(store.snapshot().active.length,0);store.close();
});

test('actual Coordinator MCP: directed events, durable revisions, queue parity, wait cancellation and lifecycle', {timeout:60000},async t=>{
  const folder=mkdtempSync(root+'traces/coordinator-');
  const db=join(folder,'board.sqlite'),ready=join(folder,'ready.json'),trace=join(folder,'server.jsonl');
  const child=spawn('python3',[root+'coordinator_server.py','--database',db,'--ready',ready,'--trace',trace],{stdio:['ignore','pipe','pipe']});
  let error='';child.stderr.on('data',c=>{error+=c;});
  t.after(()=>child.kill('SIGTERM'));
  await wait(()=>existsSync(ready),'board ready');
  const endpoint=JSON.parse(readFileSync(ready)).url;
  const producerToken=readFileSync(JSON.parse(readFileSync(ready)).producerKeyFile,'utf8').trim();
  const client=new Client({name:'offline-preflight',version:'0.1.0'});
  await client.connect(new StdioClientTransport({command:'python3',args:[root+'stdio_proxy.py','--endpoint',endpoint]}));
  t.after(()=>client.close());
  const tools=(await client.listTools()).tools.map(x=>x.name);
  assert.ok(tools.includes('upsert_activity')&&tools.includes('get_updates')&&tools.includes('publish_update'));
  const call=async(name,args)=>{
    if(name==='publish_update')return rpc(name,args);
    const result=await client.callTool({name,arguments:args});
    const data=JSON.parse(result.content.find(x=>x.type==='text').text);
    if(result.isError)throw new Error(data.error);return data;
  };
  const rpc=async(name,args)=>{
    const response=await fetch(endpoint+'/rpc',{method:'POST',headers:name==='publish_update'?{'X-Coordinator-Producer-Token':producerToken}:{},body:JSON.stringify({jsonrpc:'2.0',id:randomUUID(),method:'tools/call',params:{name,arguments:args}})});
    const result=await response.json();const data=JSON.parse(result.result.content[0].text);
    if(result.result.isError)throw new Error(data.error);return data;
  };
  const sessionA=randomUUID(),sessionB=randomUUID();
  const receiver=new NotificationStore({path:join(folder,'received.sqlite'),sessionId:sessionA});receiver.forSession(sessionB);
  const server=await startNotificationServer({store:id=>receiver.forSession(id,{create:false})});
  t.after(async()=>{await server.close();receiver.close();});
  const sa=await call('subscribe_notifications',{project:'fixture',actor:'A',sessionId:sessionA,url:server.url,cursor:0});
  await call('subscribe_notifications',{project:'fixture',actor:'B',sessionId:sessionB,url:server.url,cursor:0});
  const activity=await call('start_activity',{project:'fixture',agent:'A',description:'Real fixture editing',files:['src/shared.mjs'],areas:['core'],status:'editing'});
  assert.equal((await call('check_conflicts',{project:'fixture',requester_agent:'B',files:['src/shared.mjs']})).should_wait,true);
  await call('update_activity',{activity_id:activity.activity.id,status:'testing'});
  const message=await call('post_message',{project:'fixture',from_agent:'A',to_agent:'B',message:'Use interface revision 2'});
  await assert.rejects(()=>call('post_message',{project:'fixture',from_agent:'A',to_activity_id:'missing',message:'Must not broadcast'}),/Unknown activity/);
  const fact={project:'fixture',targets:['B'],kind:'diagnostic',payload:{diagnosticRef:'real-test-output.json',passed:false},producerId:'test-runner',revision:1};
  assert.equal((await fetch(endpoint+'/rpc',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_update',arguments:fact}})})).status,403);
  const published=await call('publish_update',fact);
  assert.equal((await call('publish_update',fact)).duplicate,true);
  await assert.rejects(()=>call('publish_update',{...fact,payload:{passed:true}}),/conflict/);
  await call('publish_update',{...fact,project:'other-project',revision:2});
  await call('finish_activity',{activity_id:activity.activity.id});
  await wait(()=>receiver.forSession(sessionB).history().length===5,'five relevant B events delivered');
  assert.equal(receiver.history().length,0);assert.equal(receiver.forSession(sessionB).call,0);
  const updates=await call('get_updates',{project:'fixture',actor:'B',cursor:0});
  assert.equal(updates.count,5);
  assert.deepEqual(updates.updates.filter(x=>x.kind==='activity').map(x=>x.revision),[1,2,3]);
  const notify=receiver.forSession(sessionB).history().map(x=>JSON.parse(x.message).eventId).sort();
  assert.deepEqual(notify,updates.updates.map(x=>x.eventId).sort());
  assert.ok(updates.updates.find(x=>x.entityId===message.message.id));
  assert.ok(updates.updates.find(x=>x.eventId===published.event.eventId));
  const begin=Date.now();assert.equal((await call('await_next',{project:'fixture',actor:'B',cursor:0,timeout_seconds:5})).count,5);
  assert.ok(Date.now()-begin<1000,'queued results return immediately');
  const waiting=rpc('await_next',{project:'fixture',actor:'B',cursor:updates.cursor,timeout_seconds:5,waitId:'cancel-me'});
  await pause(50);await rpc('cancel_wait',{waitId:'cancel-me'});
  assert.equal((await waiting).cancelled,true);
  await call('unsubscribe_notifications',{subscriptionId:sa.subscriptionId});
  await call('post_message',{project:'fixture',from_agent:'B',to_agent:'A',message:'Must remain feed-only after unsubscribe'});
  await pause(100);assert.equal(receiver.history().length,0);
  assert.equal((await call('get_updates',{project:'fixture',actor:'A',cursor:0})).count,1);
  writeFileSync(join(folder,'assertions.json'),JSON.stringify({passed:true,tools,directedB:5,notifyFeedEqual:true,noInference:true,cancellation:true,subscriptionCleanup:true},null,2));
  assert.equal(error,'');
});

test('actual default Pi resolves without model override, loads transport/MCP/meter and no provider request', {timeout:45000},async t=>{
  const folder=mkdtempSync(root+'traces/pi-default-');mkdirSync(join(folder,'work'));
  const bready=join(folder,'board-ready.json');
  const board=spawn('python3',[root+'coordinator_server.py','--database',join(folder,'board.sqlite'),'--ready',bready],{stdio:'ignore'});
  t.after(()=>board.kill('SIGTERM'));await wait(()=>existsSync(bready),'board ready');
  const pi=startDefaultPi({work:join(folder,'work'),configDir:join(folder,'config'),eventsPath:join(folder,'pi-events.jsonl'),
    extraExtensions:[root+'coordinator-extension.ts'],env:{PI_NOTIFY_READY:join(folder,'pi-ready.json'),PI_NOTIFY_DB:join(folder,'notify.sqlite'),
      PI_NOTIFY_TRACE:join(folder,'notify.jsonl'),PILOT_RUN_ID:'offline-preflight',PILOT_SCOPE:'adapter',PILOT_SCOPE_CAP:'2',
      PILOT_LEDGER:join(folder,'ledger.sqlite'),PILOT_METER_TRACE:join(folder,'meter.jsonl'),
      PILOT_COORDINATOR_ENDPOINT:JSON.parse(readFileSync(bready)).url,PILOT_COORDINATOR_PROJECT:'pi-preflight',PILOT_ACTOR:'Pi-A',
      PILOT_COORDINATOR_TRACE:join(folder,'coord.jsonl')}});
  t.after(()=>pi.stop());await pi.waitReady();const state=await pi.command({type:'get_state'});
  assert.equal(state.model.provider,'openai-codex');assert.equal(state.model.id,'gpt-6.1-sol');assert.equal(state.thinkingLevel,'medium');
  assert.ok(!pi.args.includes('--model')&&!pi.args.includes('--provider'));
  await wait(()=>existsSync(join(folder,'coord.jsonl'))&&readFileSync(join(folder,'coord.jsonl'),'utf8').includes('subscription_ready'),'subscription ready');
  const bconfig=JSON.parse(readFileSync(bready));
  const response=await fetch(bconfig.url+'/rpc',{method:'POST',headers:{'X-Coordinator-Producer-Token':readFileSync(bconfig.producerKeyFile,'utf8').trim()},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'publish_update',arguments:{
    project:'pi-preflight',targets:['Pi-A'],kind:'compatibility',producerId:'fixture',revision:1,payload:{module:'real-module',interface:'v2'}}}})});
  assert.equal((await response.json()).result.isError,false);
  const store=new NotificationStore({path:join(folder,'notify.sqlite'),sessionId:state.sessionId});
  await wait(()=>store.history().length===1,'idle Pi ingress');assert.equal(store.call,0);store.close();
  assert.equal(pi.events.filter(x=>x.type==='message_end'&&x.message?.role==='assistant').length,0);
  const inventory=readFileSync(join(folder,'coord.jsonl'),'utf8').trim().split('\n').map(JSON.parse).find(x=>x.type==='model_tool_inventory');
  assert.ok(inventory);assert.ok(!inventory.activeTools.includes('publish_update')&&!inventory.allTools.includes('publish_update'));
  const ledger=new PilotLedger(join(folder,'ledger.sqlite'),{scope:'adapter',scopeCap:2});assert.equal(ledger.summary().attempts,0);ledger.close();
  writeFileSync(join(folder,'resolved-default.json'),JSON.stringify({model:state.model.id,provider:state.model.provider,thinkingLevel:state.thinkingLevel,
    api:state.model.api,nominalTariff:state.model.cost,config:pi.config,cli:pi.args,inferences:0},null,2));
  await pi.stop();
});
