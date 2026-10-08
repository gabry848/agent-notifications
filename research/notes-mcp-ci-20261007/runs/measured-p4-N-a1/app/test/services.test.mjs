import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function launch(script,args) {
  const child = spawn(process.execPath,[script,...args],{stdio:['pipe','pipe','pipe']});
  let stderr=''; child.stderr.on('data',chunk => stderr+=chunk);
  const lines=[], waiters=[];
  const input=createInterface({input:child.stdout});
  input.on('line',line => { if (waiters.length) waiters.shift()(line); else lines.push(line); });
  const exited=once(child,'exit');
  const next = async () => {
    let timer;
    try { return await Promise.race([lines.length ? Promise.resolve(lines.shift()) : new Promise(resolve => waiters.push(resolve)),new Promise((_,reject) => {timer=setTimeout(() => reject(new Error('Process response timeout: '+stderr)),5000);})]); }
    finally { clearTimeout(timer); }
  };
  return {child,next,exited,stop:async () => {if(child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); await exited;}};
}
function temp(t) {
  const dir = mkdtempSync(join(tmpdir(),'quick-notes-services-'));
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  return join(dir,'notes.sqlite');
}

test('real newline MCP protocol, all tools, errors, resources and restart', {timeout:15000}, async t => {
  const db = temp(t), process = launch('src/mcp.mjs',['--db',db]);
  t.after(() => process.stop());
  let id=0;
  async function rpc(method,params) {
    const requestId=++id;
    process.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');
    const reply=JSON.parse(await process.next());
    assert.equal(reply.id,requestId); return reply;
  }
  async function tool(name,args={}) { return (await rpc('tools/call',{name,arguments:args})).result; }
  const value = result => JSON.parse(result.content[0].text);
  assert.equal((await rpc('initialize',{})).result.protocolVersion,'2024-11-05');
  process.child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.deepEqual((await rpc('ping')).result,{});
  const tools=(await rpc('tools/list')).result.tools;
  assert.equal(tools.length,8);
  assert.ok(tools.every(tool => tool.inputSchema.type === 'object'));
  const created=value(await tool('notes_create',{text:' first ',tags:[' Work ']}));
  assert.equal(created.text,'first');
  assert.deepEqual(value(await tool('notes_get',{id:created.id})),created);
  assert.equal(value(await tool('notes_update',{id:created.id,text:'changed'})).text,'changed');
  assert.deepEqual(value(await tool('tags_list')),[{name:'work',count:1}]);
  assert.deepEqual(value(await tool('notes_list',{q:'CHANGED'})).map(n => n.id),[created.id]);
  assert.equal((await tool('notes_import',{notes:[{text:'valid'},{text:'bad',tags:[null]}]})).isError,true);
  assert.equal(value(await tool('notes_list')).length,1);
  assert.equal(value(await tool('notes_import',{notes:[{text:'second'}]})).length,1);
  assert.deepEqual(value(await tool('notes_export')),{version:1,notes:[{text:'changed',tags:['work']},{text:'second',tags:[]}]});
  assert.equal((await rpc('resources/list')).result.resources[0].uri,'notes://all');
  const resource=(await rpc('resources/read',{uri:'notes://all'})).result.contents[0];
  assert.equal(resource.mimeType,'application/json');
  assert.deepEqual(JSON.parse(resource.text),value(await tool('notes_list')));
  assert.equal((await rpc('resources/read',{uri:'notes://missing'})).error.code,-32002);
  assert.equal((await rpc('unsupported')).error.code,-32601);
  assert.equal((await tool('notes_get',{id:'1'})).isError,true);
  assert.equal((await tool('not_a_tool')).isError,true);
  process.child.stdin.write('{bad\n');
  assert.equal(JSON.parse(await process.next()).error.code,-32700);
  assert.equal(value(await tool('notes_delete',{id:created.id})),true);
  assert.equal(value(await tool('notes_get',{id:created.id})),null);
  process.child.stdin.end();
  assert.equal((await process.exited)[0],0);
  const restarted=launch('src/mcp.mjs',['--db',db]);
  t.after(() => restarted.stop());
  restarted.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:'restart',method:'tools/call',params:{name:'notes_list',arguments:{}}})+'\n');
  assert.equal(value(JSON.parse(await restarted.next()).result)[0].text,'second');
  restarted.child.stdin.end(); await restarted.exited;
});

test('web dashboard and JSON CRUD, safe HTML, pagination, atomic imports and shared DB', {timeout:15000}, async t => {
  const db=temp(t), process=launch('src/web.mjs',['--db',db,'--port','0']);
  t.after(() => process.stop());
  const {port}=JSON.parse(await process.next());
  const base='http://127.0.0.1:'+port;
  const request=(path,method='GET',data) => fetch(base+path,{method,redirect:'manual',...(data === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})});
  const createdResponse=await request('/api/notes','POST',{text:'<script>alert("x")</script> %_',tags:['<Tag>','work']});
  assert.equal(createdResponse.status,201);
  const created=await createdResponse.json();
  let response=await request('/?q='+encodeURIComponent('<script>'));
  const html=await response.text();
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;tag&gt;'));
  assert.equal((await request('/api/notes?q=%25_')).status,200);
  assert.equal((await (await request('/api/notes?tag=WORK')).json()).length,1);
  assert.equal((await request('/api/notes?limit=0')).status,400);
  assert.equal((await request('/?page=0')).status,400);
  assert.equal((await request('/api/notes/'+created.id+'/unknown')).status,404);
  assert.equal((await request('/api/notes/999')).status,404);
  assert.equal((await request('/notes/'+created.id+'/edit')).status,200);
  assert.equal((await request('/api/notes/'+created.id,'PATCH',{text:' ',tags:[]})).status,400);
  assert.equal((await (await request('/api/notes/'+created.id)).json()).text,created.text);
  response=await request('/api/import','POST',{notes:[{text:'would persist'},{text:'invalid',tags:['']}]});
  assert.equal(response.status,400);
  assert.equal((await (await request('/api/notes')).json()).length,1);
  const notes=Array.from({length:22},(_,i) => ({text:'page '+i,tags:['paged']}));
  assert.equal((await request('/api/import','POST',{notes})).status,201);
  const page2=await (await request('/?tag=paged&page=2')).text();
  assert.equal((page2.match(/<article>/g) || []).length,2);
  assert.ok(page2.includes('Previous'));
  assert.equal((await (await request('/api/export')).json()).notes.length,23);
  const form=await fetch(base+'/notes',{method:'POST',redirect:'manual',body:new URLSearchParams({text:'form note',tags:' Form, form , Other'})});
  assert.equal(form.status,303); assert.equal(form.headers.get('location'),'/');
  const latest=(await (await request('/api/notes')).json())[0];
  assert.deepEqual(latest.tags,['form','other']);
  const update=await fetch(base+'/notes/'+latest.id,{method:'POST',redirect:'manual',body:new URLSearchParams({text:'edited form',tags:'changed'})});
  assert.equal(update.status,303);
  assert.equal((await (await request('/api/notes/'+latest.id)).json()).text,'edited form');
  assert.equal((await request('/api/notes/'+created.id,'DELETE')).status,200);
  assert.equal((await request('/api/notes/'+created.id,'DELETE')).status,404);
  const deletion=await fetch(base+'/notes/'+latest.id+'/delete',{method:'POST',redirect:'manual'});
  assert.equal(deletion.status,303);
  assert.ok(!(await (await request('/api/tags')).json()).some(t => t.name === 'changed'));
  assert.equal((await request('/missing')).status,404);
  await process.stop();
  const mcp=launch('src/mcp.mjs',['--db',db]); t.after(() => mcp.stop());
  mcp.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'notes_list',arguments:{}}})+'\n');
  assert.equal(JSON.parse(JSON.parse(await mcp.next()).result.content[0].text).length,22);
  mcp.child.stdin.end(); await mcp.exited;
});
