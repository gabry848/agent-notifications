import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { openStore } from '../src/store.mjs';
import { importNotes } from '../src/import.mjs';
import { exportNotes } from '../src/service.mjs';

function temporary(t) {
  const dir=mkdtempSync(join(process.cwd(),'.test-notes-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return join(dir,'nested','notes.sqlite');
}
test('storage validation, atomicity, filtering, cascade and restart',t=>{
  const path=temporary(t);let s=openStore(path);t.after(()=>s.close());
  const first=s.createNote('  A 100%_ literal  ',[' Work ','work','Z']);
  assert.equal(first.text,'A 100%_ literal');assert.deepEqual(first.tags,['work','z']);
  for (const text of ['',null,123,'x'.repeat(4001)]) assert.throws(()=>s.createNote(text));
  for (const tags of [null,'tag',[''],[3],['x'.repeat(41)]]) assert.throws(()=>s.createNote('bad',tags));
  assert.throws(()=>importNotes(s,[{text:'valid'},{text:'bad',tags:['ok',null]}]));
  assert.throws(()=>importNotes(s,[{text:'valid'},{text:' '} ]));
  assert.equal(s.listNotes().length,1);
  assert.throws(()=>s.updateNote(first.id,{text:'changed',tags:['']}));
  assert.deepEqual(s.getNote(first.id),first);
  const updated=s.updateNote(first.id,{tags:['New']});
  assert.equal(updated.createdAt,first.createdAt);assert.ok(updated.updatedAt>first.updatedAt);
  assert.deepEqual(updated.tags,['new']);
  const second=s.createNote('Other',['new']);
  assert.deepEqual(s.listNotes({q:'%_'}).map(n=>n.id),[first.id]);
  assert.equal(s.listNotes({q:'LITERAL',tag:' NEW '}).length,1);
  assert.deepEqual(s.listNotes({limit:1,offset:1}).map(n=>n.id),[first.id]);
  assert.deepEqual(s.listTags(),[{name:'new',count:2}]);
  for (const options of [{limit:0},{limit:101},{offset:-1},{limit:1.5}]) assert.throws(()=>s.listNotes(options));
  assert.equal(s.updateNote(999,{}),null);assert.equal(s.getNote(999),null);assert.equal(s.deleteNote(999),false);
  assert.deepEqual(exportNotes(s).notes.map(n=>n.text),[first.text,second.text]);
  s.close();s=openStore(path);assert.deepEqual(s.getNote(first.id),updated);
  s.deleteNote(first.id);s.deleteNote(second.id);assert.deepEqual(s.listTags(),[]);
});

function processLines(file,args=[]) {
  const child=spawn(process.execPath,[file,...args],{stdio:['pipe','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
  return {child,lines,stderr:()=>stderr};
}
test('real MCP stdio protocol, tools, resources, errors and atomic imports',async t=>{
  const path=temporary(t),p=processLines('src/mcp.mjs',['--db',path]);
  t.after(()=>p.child.kill());let id=0;
  async function request(method,params) {
    const current=++id;p.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:current,method,params})+'\n');
    const response=JSON.parse((await p.lines.next()).value);assert.equal(response.id,current);return response;
  }
  async function tool(name,args={}) {return (await request('tools/call',{name,arguments:args})).result;}
  assert.equal((await request('initialize',{})).result.protocolVersion,'2024-11-05');
  p.child.stdin.write('\n'+JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  assert.deepEqual((await request('ping')).result,{});
  assert.equal((await request('tools/list')).result.tools.length,8);
  const note=JSON.parse((await tool('notes_create',{text:' Hello ',tags:['A']})).content[0].text);
  assert.equal(note.text,'Hello');
  assert.equal((await tool('notes_import',{notes:[{text:'valid'},{text:'invalid',tags:[null]}]})).isError,true);
  assert.equal(JSON.parse((await tool('notes_list')).content[0].text).length,1);
  const resource=(await request('resources/read',{uri:'notes://all'})).result;
  assert.deepEqual(JSON.parse(resource.contents[0].text),[note]);
  assert.equal((await request('resources/read',{uri:'missing'})).error.code,-32002);
  assert.equal((await request('unknown')).error.code,-32601);
  p.child.stdin.write('{bad\n');assert.equal(JSON.parse((await p.lines.next()).value).error.code,-32700);
  const exit=once(p.child,'exit');p.child.stdin.end();assert.equal((await exit)[0],0,p.stderr());
  const restarted=openStore(path);assert.deepEqual(restarted.getNote(note.id),note);restarted.close();
});

test('web dashboard, forms, API, paging, escaping and import rollback',async t=>{
  const path=temporary(t),p=processLines('src/web.mjs',['--db',path,'--port','0']);
  t.after(async()=>{const exit=once(p.child,'exit');p.child.kill();await exit;});
  const {port}=JSON.parse((await p.lines.next()).value),base=`http://127.0.0.1:${port}`;
  const request=(path,method='GET',value)=>fetch(base+path,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined,redirect:'manual'});
  let r=await request('/api/notes','POST',{text:'<script>alert("x")</script>',tags:['Work']});assert.equal(r.status,201);const note=await r.json();
  r=await request('/');const html=await r.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('work (1)'));
  r=await request('/notes/'+note.id+'/edit');assert.equal(r.status,200);assert.ok((await r.text()).includes('textarea'));
  r=await request('/api/import','POST',{notes:[{text:'valid'},{text:'bad',tags:[false]}]});assert.equal(r.status,400);
  assert.equal((await (await request('/api/notes')).json()).length,1);
  r=await request('/api/notes/'+note.id,'PATCH',{text:'edited',tags:['new']});assert.equal((await r.json()).text,'edited');
  assert.equal((await (await request('/api/notes?q=EDIT&tag=NEW')).json()).length,1);
  r=await fetch(base+'/notes/'+note.id,{method:'POST',body:new URLSearchParams({text:'form edit',tags:'changed'}),redirect:'manual'});assert.equal(r.status,303);
  assert.deepEqual((await (await request('/api/notes/'+note.id)).json()).tags,['changed']);
  r=await fetch(base+'/notes',{method:'POST',body:new URLSearchParams({text:' ',tags:'a'}),redirect:'manual'});assert.equal(r.status,400);assert.ok((await r.text()).includes('role="alert"'));
  r=await fetch(base+'/notes',{method:'POST',body:new URLSearchParams({text:'form note',tags:'a, B'}),redirect:'manual'});assert.equal(r.status,303);assert.equal(r.headers.get('location'),'/');
  r=await request('/api/import','POST',{notes:Array.from({length:22},(_,i)=>({text:'page '+i}))});assert.equal(r.status,201);
  assert.ok((await (await request('/?page=2')).text()).includes('Previous'));
  assert.equal((await (await request('/api/export')).json()).notes.length,24);
  assert.equal((await request('/api/notes?limit=0')).status,400);
  assert.equal((await request('/api/notes/9999')).status,404);
  assert.equal((await request('/missing')).status,404);
  r=await request('/api/notes/'+note.id,'DELETE');assert.equal(await r.json(),true);
});
