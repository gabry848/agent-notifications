import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createFixture } from './fixture.mjs';

const root=dirname(fileURLToPath(import.meta.url));
const runtime=resolve(process.argv[2]??'');
if(!process.argv[2])throw new Error('Usage: node preflight.mjs root-confirmed-frozen-runtime');
const {startDefaultPi}=await import('file://'+join(runtime,'pi-runtime.mjs'));
const {PilotLedger}=await import('file://'+join(runtime,'meter.mjs'));
mkdirSync(join(root,'offline'),{recursive:true});const run=mkdtempSync(join(root,'offline','pi-zero-'));
const work=join(run,'work');createFixture(work,{seed:4100,kind:'compatibility'});
const ledgerPath=join(run,'ledger.sqlite'),trace=join(run,'feed.jsonl'),configDir=join(run,'config');
const pi=startDefaultPi({work,configDir,eventsPath:join(run,'rpc.jsonl'),extraExtensions:[join(root,'feed-extension.ts')],
  tools:['read','bash','edit','write','notifications_dismiss','await_update'],env:{
    PI_NOTIFY_READY:join(run,'ready.json'),PI_NOTIFY_DB:join(run,'notifications.sqlite'),PI_NOTIFY_CONTEXT:'1',
    PI_NOTIFY_PROMPT:join(runtime,'transport/prompt-v3.txt'),PI_NOTIFY_TRACE:join(run,'notifications.jsonl'),
    PILOT_LEDGER:ledgerPath,PILOT_SCOPE:'explorer',PILOT_SCOPE_CAP:'2',PILOT_RUN_ID:'offline-explorer-preflight',PILOT_METER_TRACE:join(run,'meter.jsonl'),
    EXPLORER_WORK:work,EXPLORER_RUN:run,EXPLORER_MODE:'N',EXPLORER_KIND:'compatibility',EXPLORER_SEED:'4100',EXPLORER_FEED_TRACE:trace}});
let result;
try{
  await pi.waitReady();const state=await pi.command({type:'get_state'});const messages=await pi.command({type:'get_messages'});
  await pi.wait(()=>existsSync(trace)&&readFileSync(trace,'utf8').includes('feed_ready'),'native feed ready',20000);
  assert.equal(state.model.provider,'openai-codex');assert.equal(state.model.id,'gpt-6.1-sol');assert.equal(state.thinkingLevel,'medium');
  assert.ok(!pi.args.includes('--model')&&!pi.args.includes('--provider')&&!pi.args.includes('--thinking'));
  const events=readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const feedReady=events.find(e=>e.type==='feed_ready');assert.ok(feedReady.activeTools.includes('read'));assert.ok(feedReady.activeTools.includes('await_update'));assert.ok(!feedReady.activeTools.includes('get_updates'));
  const ledger=new PilotLedger(ledgerPath,{scope:'explorer',scopeCap:2});const accounting=ledger.summary();ledger.close();assert.equal(accounting.attempts,0);
  assert.equal(pi.events.filter(e=>e.type==='message_end'&&e.message?.role==='assistant').length,0);
  result={phase:'zero-inference-preflight',passed:true,model:state.model.id,provider:state.model.provider,thinkingLevel:state.thinkingLevel,
    modelHttpAttempts:0,assistantMessages:0,feedReady,config:pi.config,cli:pi.args,messageCount:messages.messages?.length??null,
    gate:'root authorized RPC-only preflight; no prompt submitted'};
}catch(e){result={phase:'zero-inference-preflight',passed:false,error:e.message};throw e;}
finally{
  await pi.stop();if(existsSync(join(configDir,'auth.json')))unlinkSync(join(configDir,'auth.json'));
  writeFileSync(join(run,'assertions.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({path:run,passed:result?.passed,modelHttpAttempts:result?.modelHttpAttempts??null}));
}
