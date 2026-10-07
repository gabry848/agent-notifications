import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NotificationStore } from '../src/store.mjs';
import { startNotificationServer } from '../src/http.mjs';
import { lines,pause } from '../benchmark/common.mjs';

async function setup(t,{unsolicited=false,mode='N',payload='full',diagnostic}={}){
  const work=mkdtempSync(join(tmpdir(),'pi-bench-mcp-'));
  const db=new NotificationStore({path:join(work,'notifications.sqlite'),sessionId:'target'});
  const server=await startNotificationServer({store:db});
  const ready=join(work,'ready.json'),spec=join(work,'spec.json'),trace=join(work,'mcp.jsonl');
  writeFileSync(ready,JSON.stringify({url:server.url,sessionId:'target'}));
  writeFileSync(spec,JSON.stringify({unsolicited,jobs:[{id:'job',durationMs:120,status:'succeeded',result:{maxBatch:23,diagnostic}}]}));
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../benchmark/jobs-server.mjs',import.meta.url))],env:{...process.env,BENCH_SPEC:spec,BENCH_WORK:work,BENCH_MCP_TRACE:trace,PI_NOTIFY_READY:ready,BENCH_MODE:mode,BENCH_PAYLOAD:payload},stderr:'pipe'});
  const client=new Client({name:'test',version:'1'});
  await client.connect(transport);
  t.after(async()=>{await client.close();await transport.close();await server.close();db.close();rmSync(work,{recursive:true,force:true});});
  return {client,db,trace,work};
}
test('real MCP protocol launches a subprocess and persists its result via HTTP',async t=>{
  const {client,db,trace,work}=await setup(t);
  assert.equal((await client.listTools()).tools.length,4);
  await client.callTool({name:'start_job',arguments:{ids:['job']}});
  const pending=JSON.parse((await client.callTool({name:'get_job',arguments:{ids:['job']}})).content[0].text);
  assert.equal(pending[0].status,'running');
  const done=JSON.parse((await client.callTool({name:'await_jobs',arguments:{ids:['job']}})).content[0].text);
  assert.equal(done[0].result.maxBatch,23);assert.ok(existsSync(join(work,'worker-job.json')));
  assert.equal(db.history().length,1);assert.equal(db.call,0);
  assert.equal(db.snapshot().active[0].turnAge,0);
  assert.equal(lines(trace).filter(e=>e.type==='tools_call').length,3);
});
test('MCP server can send an unsolicited event with zero tools/call',async t=>{
  const {db,trace}=await setup(t,{unsolicited:true});
  const deadline=Date.now()+5000;
  while(!db.history().length&&Date.now()<deadline)await pause(20);
  assert.equal(db.history().length,1);
  assert.equal(lines(trace).filter(e=>e.type==='tools_call').length,0);
});
test('baseline gets the same final result without sending notifications',async t=>{
  const {client,db,trace}=await setup(t,{mode:'W'});
  await client.callTool({name:'start_job',arguments:{ids:['job']}});
  const done=JSON.parse((await client.callTool({name:'await_jobs',arguments:{ids:['job']}})).content[0].text);
  assert.equal(done[0].result.maxBatch,23);assert.equal(db.history().length,0);
  assert.equal(lines(trace).filter(e=>e.type==='notify_attempt').length,0);
});

test('compact notifications, polling and await expose the same required facts',async t=>{
  const {client,db}=await setup(t,{payload:'compact',diagnostic:'Large irrelevant diagnostic. '.repeat(200)});
  await client.callTool({name:'start_job',arguments:{ids:['job']}});
  const awaited=JSON.parse((await client.callTool({name:'await_jobs',arguments:{ids:['job']}})).content[0].text)[0];
  const polled=JSON.parse((await client.callTool({name:'get_job',arguments:{ids:['job']}})).content[0].text)[0];
  const notification=JSON.parse(db.history()[0].message);
  for(const record of [awaited,polled,notification]){
    assert.deepEqual(record.result,{maxBatch:23});assert.equal(record.diagnosticRef,'job');
  }
});
